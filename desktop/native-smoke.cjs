// Windows CI smoke: capture a real desktop through WGC, pause/resume, mux a
// video track, then fully decode the result with FFmpeg. Audio needs device tests.
const path = require('node:path');
const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { listRustSources, createRustRecording } = require('./rust-recorder');
const exec = promisify(execFile);
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
(async () => {
  const binary = path.resolve('vendor/native/screenrecorder-native.exe');
  const ffmpeg = path.resolve('vendor/ffmpeg/ffmpeg.exe');
  const sources = await listRustSources(binary,'screen');
  if (!sources.length) throw new Error('Windows CI has no capture display');
  const folder = path.resolve('native-smoke-output');
  await fs.mkdir(folder,{recursive:true});
  const file = path.join(folder,'smoke.mp4');
  const events = [];
  const recording = createRustRecording(binary,ffmpeg,file,{
    source:sources[0].id,format:'mp4',codec:'h264',quality:'small',software:true,
    systemAudio:false,microphone:false
  }, event => { events.push(event); console.log(JSON.stringify(event)); });
  try {
    await recording.ready;
    await delay(1200);
    await recording.pause(true);
    await delay(1200);
    await recording.pause(false);
    await delay(1200);
    await recording.finalize();
    if (recording.result.seconds < 2 || recording.result.seconds > 3.5) throw new Error('Pause leaked into video duration');
    await exec(ffmpeg,['-v','error','-i',file,'-f','null','-'],{windowsHide:true,timeout:60000});
    if (events.some(e=>e.event==='warning'||e.event==='error')) throw new Error('Capture reported a warning/error');
    console.log('Native WGC capture, pause/resume, MP4 mux and full video decode passed.');
  } finally { await recording.cancel(); }
})().catch(error=>{ console.error(error); process.exitCode=1; });
