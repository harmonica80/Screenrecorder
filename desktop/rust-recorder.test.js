const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { validateRustOptions, createRustRecording } = require('./rust-recorder');
const options = {source:'monitor:42',format:'mp4',codec:'h264'};

test('native settings reject unsupported containers and arbitrary source handles', () => {
  for (const patch of [{format:'webm'},{source:'screen:0:0'},{source:'monitor:0'},{codec:'shell'}]) {
    assert.throws(() => validateRustOptions({...options,...patch}));
  }
  assert.equal(validateRustOptions({...options,quality:'bad'}).quality,'balanced');
});
function fakeEngine(onCommand) {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let input = '';
  child.stdin = new Writable({ write(chunk,_encoding,done) {
    input += chunk;
    while (input.includes('\n')) {
      const index = input.indexOf('\n');
      const value = JSON.parse(input.slice(0,index)); input = input.slice(index+1);
      setImmediate(() => onCommand(value,child));
    }
    done();
  }});
  child.send = value => child.stdout.write(JSON.stringify(value)+'\n');
  child.close = code => { child.stdout.end(); child.stderr.end(); child.emit('close',code); };
  child.kill = () => child.close(1);
  return child;
}
test('ready, acknowledged pause/resume and finalization share one engine session', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(),'rust-recorder-test-'));
  try {
    const output = path.join(dir,'video.mp4');
    const commands = [];
    const child = fakeEngine(async (value, child) => {
      commands.push(value);
      if (value.output) child.send({event:'ready',encoder:'test'});
      if (value.command === 'pause') child.send({event:'paused'});
      if (value.command === 'resume') child.send({event:'resumed'});
      if (value.command === 'stop') {
        await writeFile(output,'test video');
        child.send({event:'finished',seconds:2,bytesWritten:10}); child.close(0);
      }
    });
    const engine = createRustRecording('native.exe','ffmpeg.exe',output,options,()=>{},()=>child);
    assert.equal((await engine.ready).encoder,'test');
    await engine.pause(true); await engine.pause(false);
    assert.equal(await engine.finalize(),10);
    assert.equal(engine.result.seconds,2);
    assert.deepEqual(commands.slice(1).map(v=>v.command),['pause','resume','stop']);
    assert.equal(commands[0].source,'monitor:42');
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('an early engine exit rejects startup and never reports success', async () => {
  const child = fakeEngine((_value,child)=>child.close(1));
  const engine = createRustRecording('native.exe','ffmpeg.exe','failed.mp4',options,()=>{},()=>child);
  await assert.rejects(engine.ready,/未正常完成/);
  await assert.rejects(engine.finalize(),/未正常完成/);
});
test('a running engine crash rejects a pending pause and retains an error', async () => {
  const child = fakeEngine((value,child)=>{
    if (value.output) child.send({event:'ready'});
    else child.close(1);
  });
  const engine = createRustRecording('native.exe','ffmpeg.exe','failed.mp4',options,()=>{},()=>child);
  await engine.ready;
  await assert.rejects(engine.pause(true),/未正常完成/);
  await assert.rejects(engine.finalize(),/未正常完成/);
});
