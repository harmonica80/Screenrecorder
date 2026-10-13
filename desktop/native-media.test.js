const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const {buildArgs,createNativeMedia} = require('./native-media');
const binary = process.env.FFMPEG_TEST_BINARY || (process.platform === 'win32' ? path.resolve('vendor/ffmpeg/ffmpeg.exe') : '/usr/bin/ffmpeg');
test('native export validates ranges and lossless format', () => {
  assert.throws(()=>buildArgs('a','b',{format:'exe'}));
  assert.throws(()=>buildArgs('a','b',{format:'mp4',start:4,end:2}));
  assert.throws(()=>buildArgs('a','b',{format:'mp4',copy:true}));
  assert.ok(buildArgs('a','b',{format:'mp4',start:1,end:3}).includes('libx264'));
});
test('native engine converts formats, preserves source and names, applies audio and cancels', {timeout:90000}, async t => {
  try { await fs.access(binary); } catch { t.skip('native FFmpeg unavailable'); return; }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'recorder-native-'));
  const input = path.join(dir,'測試 原始.webm');
  const fixture = spawnSync(binary,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','4','-c:v','libvpx','-c:a','libopus',input],{windowsHide:true});
  assert.equal(fixture.status,0,fixture.stderr?.toString());
  const original = await fs.readFile(input), engine = createNativeMedia(binary);
  try {
    for (const format of ['mp4','mkv','webm']) {
      const result = await engine.export(input,path.join(dir,'成品.'+format),{format,start:1,end:3,volume:[{time:0,gain:0},{time:2,gain:0},{time:2.05,gain:100},{time:4,gain:100}]});
      assert.ok(result.bytesWritten > 1000);
      const audio = spawnSync(binary,['-v','error','-i',result.filePath,'-f','f32le','-ac','1','-ar','48000','-'],{windowsHide:true,maxBuffer:2000000});
      assert.equal(audio.status,0,audio.stderr?.toString());
      const rms = (start,end) => {
        let sum=0,n=0;for(let i=Math.round(start*48000);i<Math.min(audio.stdout.length/4,Math.round(end*48000));i++){sum+=audio.stdout.readFloatLE(i*4)**2;n++}return Math.sqrt(sum/n);
      };
      assert.ok(rms(.2,.7)<.002,format+' first half silent');
      assert.ok(rms(1.3,1.8)>.02,format+' second half audible');
      const seconds = audio.stdout.length/4/48000;
      assert.ok(seconds>1.8&&seconds<2.2,format+' duration '+seconds);
    }
    const second = await engine.export(input,path.join(dir,'成品.mp4'),{format:'mp4',end:1});
    assert.match(second.filePath,/\(1\)\.mp4$/);
    const copy = await engine.export(input,path.join(dir,'無損.mkv'),{format:'mkv',copy:true});
    assert.ok(copy.bytesWritten>1000);
    const canceled = engine.export(input,path.join(dir,'取消.mp4'),{format:'mp4'});
    engine.cancel();
    await assert.rejects(canceled,/取消/);
    assert.deepEqual(await fs.readFile(input),original);
    assert.equal((await fs.readdir(dir)).some(f=>f.includes('取消')||f.endsWith('.partial')),false);
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
