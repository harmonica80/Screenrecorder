const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');

// Input arrives at capture speed. Only a bounded stream buffer is held in memory.
function createLiveRecording(binary, filePath, { format, quality = 'balanced' }) {
  if (!['mp4', 'mkv'].includes(format)) throw new Error('即時錄影格式無效。');
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'webm', '-i', 'pipe:0', '-map', '0:v:0', '-map', '0:a:0?'];
  if (format === 'mkv') args.push('-c', 'copy', '-cluster_time_limit', '1000');
  else args.push('-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', String({ high:18, balanced:23, small:28 }[quality] ?? 23), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '1000000');
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
