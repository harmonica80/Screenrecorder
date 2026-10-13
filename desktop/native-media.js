const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

function volumeFilter(points, start, duration) {
  const nodes = points.map(p => ({ time: Number(p.time), gain: Number(p.gain) / 100 }))
    .filter(p => Number.isFinite(p.time) && p.time >= 0 && Number.isFinite(p.gain) && p.gain >= 0 && p.gain <= 2)
    .sort((a, b) => a.time - b.time);
  if (!nodes.length) return 'volume=1';
  const at = time => {
    const right = nodes.findIndex(p => p.time >= time);
    if (right === 0) return nodes[0].gain;
    if (right < 0) return nodes.at(-1).gain;
    const a = nodes[right - 1], b = nodes[right];
    return a.gain + (b.gain - a.gain) * (time - a.time) / Math.max(.00001, b.time - a.time);
  };
  const end = start + duration;
  const selected = [{time:0,gain:at(start)}, ...nodes.filter(p => p.time > start && p.time < end).map(p => ({time:p.time-start,gain:p.gain})), {time:duration,gain:at(end)}];
  let expression = selected.at(-1).gain.toFixed(5);
  for (let i = selected.length - 2; i >= 0; i--) {
    const a = selected[i], b = selected[i+1];
    expression = `if(lt(t,${b.time.toFixed(5)}),${a.gain.toFixed(5)}+(${b.gain.toFixed(5)}-${a.gain.toFixed(5)})*(t-${a.time.toFixed(5)})/${Math.max(.00001,b.time-a.time).toFixed(5)},${expression})`;
  }
  return `asetpts=PTS-STARTPTS,volume='${expression}':eval=frame`;
}

function buildArgs(input, output, options) {
  const { format = 'mp4', start = 0, end, quality = 'balanced', copy = false, volume = [] } = options;
  if (!['mp4','mkv','webm'].includes(format)) throw new Error('輸出格式無效。');
  if (!Number.isFinite(start) || start < 0 || (end != null && (!Number.isFinite(end) || end <= start))) throw new Error('影片時間範圍無效。');
  if (copy && format !== 'mkv') throw new Error('無損快速封裝請選 MKV 格式。');
  const args = ['-hide_banner','-nostdin','-y'];
  if (start) args.push('-ss', String(start));
  args.push('-i',input);
  if (end != null) args.push('-t', String(end-start));
  args.push('-map','0:v:0','-map','0:a:0?');
  if (copy) args.push('-c','copy');
  else {
    const crf = {high:18,balanced:23,small:28}[quality] ?? 23;
    args.push('-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2');
    if (format === 'webm') args.push('-c:v','libvpx-vp9','-crf',String(crf+7),'-b:v','0','-deadline','good','-cpu-used','4','-c:a','libopus');
    else args.push('-c:v','libx264','-preset','veryfast','-crf',String(crf),'-pix_fmt','yuv420p','-c:a','aac');
    if (volume.length) {
      if (end == null) throw new Error('音量編輯需要指定影片結束時間。');
      args.push('-af',volumeFilter(volume,start,end-start));
    }
    args.push('-b:a','160k');
  }
  if (format === 'mp4') args.push('-movflags','+faststart');
  args.push('-progress','pipe:1','-nostats','-f',format === 'mkv' ? 'matroska' : format,output);
  return args;
}

function createNativeMedia(binary) {
  let job = null;
  return {
    get busy() { return !!job; },
    cancel() { if (job) { job.canceled = true; job.child?.kill(); } },
    async export(input, target, options, progress = () => {}) {
      if (job) throw new Error('另一項影片處理尚未完成。');
      const state = { child: null, canceled: false }; job = state;
      let output, partial;
      try {
        await fs.access(binary);
        const parsed = path.parse(target);
        for (let i = 0; i < 10000; i++) {
          const candidate = path.join(parsed.dir, `${parsed.name}${i ? ` (${i})` : ''}.${options.format}`);
          try { const handle = await fs.open(candidate,'wx'); await handle.close(); output = candidate; break; }
          catch (error) { if (error.code !== 'EEXIST') throw error; }
        }
        if (!output) throw new Error('無法建立輸出檔案。');
        partial = output + '.partial';
        const args = buildArgs(input,partial,options);
        if (state.canceled) throw new Error('已取消影片處理，原始影片仍保留。');
        await new Promise((resolve,reject) => {
          const child = spawn(binary,args,{windowsHide:true,stdio:['ignore','pipe','pipe']}); state.child = child;
          let errors = '', pending = '';
          child.stdout.on('data', chunk => {
            pending += chunk;
            const lines = pending.split('\n'); pending = lines.pop();
            for (const line of lines) if (line.startsWith('out_time_us=')) {
              const seconds = Number(line.split('=')[1]) / 1000000;
              progress({seconds, percent: options.end == null ? null : Math.min(99,Math.floor(seconds/(options.end-(options.start||0))*100))});
            }
          });
          child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-6000); });
          child.once('error',reject);
          child.once('close', code => state.canceled ? reject(new Error('已取消影片處理，原始影片仍保留。')) : code === 0 ? resolve() : reject(new Error(`影片處理失敗（${code}）：${errors.slice(-1200)}`)));
        });
        const stat = await fs.stat(partial);
        if (!stat.size) throw new Error('未產生有效影片。');
        await fs.rename(partial,output);
        progress({percent:100});
        return {filePath:output,bytesWritten:stat.size};
      } catch (error) {
        if (partial) await fs.unlink(partial).catch(()=>{});
        if (output) await fs.unlink(output).catch(()=>{});
        throw error;
      } finally { job = null; }
    }
  };
}
module.exports = {buildArgs,volumeFilter,createNativeMedia};
