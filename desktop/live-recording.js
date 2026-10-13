const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');

// Input arrives at capture speed. Only a bounded stream buffer is held in memory.
function createLiveRecording(binary, filePath, { format, quality = 'balanced', codec = 'auto' }) {
  if (!['mp4', 'mkv'].includes(format)) throw new Error('即時錄影格式無效。');
  if (!['auto','h264','h265'].includes(codec)) throw new Error('影片編碼無效。');
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'webm', '-i', 'pipe:0', '-map', '0:v:0', '-map', '0:a:0?'];
  if (format === 'mkv' && codec === 'auto') args.push('-c', 'copy', '-cluster_time_limit', '1000');
  else {
    const hevc = codec === 'h265';
    args.push('-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', hevc ? 'libx265' : 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', String(({ high:18, balanced:23, small:28 }[quality] ?? 23) + (hevc ? 5 : 0)), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k');
    if (hevc) args.push('-x265-params','pools=2:frame-threads=2:log-level=error');
    if (format === 'mp4') {
      if (hevc) args.push('-tag:v','hvc1');
      args.push('-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '1000000');
    } else args.push('-cluster_time_limit', '1000');
  }
  args.push('-flush_packets', '1', '-f', format === 'mkv' ? 'matroska' : 'mp4', filePath);
  const child = spawn(binary, args, { windowsHide:true, stdio:['pipe','ignore','pipe'] });
  let failure, errors = '', ended = false;
  child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-3000); });
  // Keep the completion promise fulfilled until explicitly inspected, avoiding
  // unhandled rejections if an encoder dies between IPC calls.
  const done = new Promise(resolve => {
    child.once('error', error => { failure = error; });
    child.once('close', code => {
      ended = true;
      if (code !== 0 && !failure) failure = new Error(`即時錄影處理失敗（${code}）：${errors.slice(-1200)}`);
      resolve();
    });
  });
  child.stdin.on('error', error => { failure ||= error; });
  return {
    async append(buffer) {
      if (failure || ended) throw failure || new Error('錄影引擎已停止。');
      await new Promise((resolve, reject) => child.stdin.write(buffer, error => error ? reject(error) : resolve()));
      if (failure) throw failure;
      return (await fs.stat(filePath)).size;
    },
    async finalize() {
      if (!ended) child.stdin.end();
      await done;
      if (failure) throw new Error(`${failure.message}\n未完成檔案保留於：${filePath}`);
      const stat = await fs.stat(filePath);
      if (!stat.size) throw new Error('未產生有效影片。');
      return stat.size;
    },
    async cancel() { if (!ended) child.kill(); await done; }
  };
}
module.exports = { createLiveRecording };
