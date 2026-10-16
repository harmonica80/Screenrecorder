const { spawn, execFile } = require('node:child_process');
const { createInterface } = require('node:readline');
const fs = require('node:fs/promises');
const { promisify } = require('node:util');
const exec = promisify(execFile);

function validateRustOptions(options) {
  if (!['mp4', 'mkv'].includes(options.format)) throw new Error('Rust 原生模式目前支援 MP4／MKV。');
  if (!['auto', 'h264', 'h265'].includes(options.codec || 'auto')) throw new Error('原生影片編碼無效。');
  if (!/^(monitor|window):[1-9]\d*$/.test(options.source || '')) throw new Error('請重新選擇原生錄影來源。');
  return {
    source: options.source, format: options.format, codec: options.codec || 'auto',
    quality: ['high', 'small'].includes(options.quality) ? options.quality : 'balanced',
    systemAudio: !!options.systemAudio, microphone: !!options.microphone,
    microphoneName: String(options.microphoneName || '').slice(0, 512), software: !!options.software
  };
}
async function listRustSources(binary, kind) {
  const { stdout } = await exec(binary, ['--sources', kind === 'screen' ? 'screen' : 'window'], { windowsHide:true, timeout:15000, maxBuffer:2*1024*1024 });
  return JSON.parse(stdout.trim()).sources;
}
function createRustRecording(binary, ffmpeg, filePath, options, onEvent = () => {}, spawnProcess = spawn) {
  const config = { ...validateRustOptions(options), output:filePath, ffmpeg };
  const child = spawnProcess(binary, [], { windowsHide:true, stdio:['pipe','pipe','pipe'] });
  let error = null, stderr = '', finished = null, ended = false, stopping = false, lastEvent = Date.now();
  let readyResolve, readyReject, pauseWaiter;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  // Attach immediately, including when a user closes the window during startup.
  ready.catch(() => {});
  const recovery = () => `\n影片與復原暫存檔位置：${filePath}`;
  const terminate = () => {
    if (process.platform === 'win32' && child.pid) execFile('taskkill', ['/pid',String(child.pid),'/t','/f'], {windowsHide:true}, () => {});
    else child.kill();
  };
  const done = new Promise(resolve => {
    child.once('error', err => { error = err; readyReject(err); });
    child.once('close', code => {
      ended = true;
      clearInterval(watchdog);
      if (!finished || code !== 0) error ||= new Error(`原生錄影未正常完成（${code}）：${stderr.slice(-1500)}${recovery()}`);
      if (error) readyReject(error);
      if (pauseWaiter) { clearTimeout(pauseWaiter.timer); pauseWaiter.reject(error || new Error('錄影已停止')); pauseWaiter = null; }
      onEvent({event:'exit', error:error?.message, finished});
      resolve();
    });
  });
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-4000); });
  child.stdin.on('error', err => { error ||= err; readyReject(err); });
  const reader = createInterface({ input:child.stdout });
  reader.on('line', line => {
    let event;
    try { event = JSON.parse(line); } catch { return; }
    lastEvent = Date.now();
    if (event.event === 'ready') readyResolve(event);
    if (event.event === 'error') { error = new Error(event.message + recovery()); readyReject(error); }
    if (event.event === 'finished') finished = event;
    if (event.event === 'finalizing') stopping = true;
    if (pauseWaiter && event.event === pauseWaiter.expected) {
      clearTimeout(pauseWaiter.timer); pauseWaiter.resolve(); pauseWaiter = null;
    }
    onEvent(event);
  });
  // Also covers a driver/pipe stall. Paused sessions send no progress, so pause
  // state has its own exemption. A hung final mux gets a generous 10-minute limit.
  let paused = false;
  const watchdog = setInterval(() => {
    if (ended || (paused && !stopping)) return;
    if (Date.now() - lastEvent > (stopping ? 600000 : 60000)) {
      error = new Error('原生錄影引擎逾時，已停止；請檢查顯示卡／音訊裝置。' + recovery());
      readyReject(error); terminate();
    }
  }, 1000);
  child.stdin.write(JSON.stringify(config) + '\n');
  return {
    ready,
    async pause(value) {
      if (ended || stopping || pauseWaiter) throw new Error('錄影狀態正在變更，請稍候。');
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pauseWaiter = null; reject(new Error('原生暫停／繼續未回應')); }, 5000);
        pauseWaiter = {resolve, reject, timer, expected:value ? 'paused' : 'resumed'};
        child.stdin.write(JSON.stringify({command:value ? 'pause' : 'resume'}) + '\n');
      });
      paused = value; lastEvent = Date.now();
    },
    async finalize() {
      if (!ended && !stopping) {
        stopping = true; lastEvent = Date.now();
        child.stdin.end('{"command":"stop"}\n');
      }
      await done;
      if (error) throw error;
      const stat = await fs.stat(filePath);
      if (!stat.size) throw new Error('原生錄影沒有產生影片。');
      return stat.size;
    },
    async cancel() {
      if (!ended) terminate();
      await done;
    },
    get result() { return finished; }
  };
}
module.exports = { validateRustOptions, listRustSources, createRustRecording };
