const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createLiveRecording } = require('./live-recording');
const { createUniqueRecording } = require('./recording-files');
const binary = process.env.FFMPEG_TEST_BINARY || (process.platform === 'win32' ? path.resolve('vendor/ffmpeg/ffmpeg.exe') : '/usr/bin/ffmpeg');
test('live MP4 and MKV preserve audio and duration; silent video and failed encoder handled', {timeout:60000}, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'recorder-live-'));
  try {
    for (const audio of [true,false]) {
      const input = path.join(dir,`input-${audio}.webm`);
      const args = ['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30'];
      if (audio) args.push('-f','lavfi','-i','sine=frequency=440:sample_rate=48000');
      args.push('-t','3','-c:v','libvpx','-deadline','realtime','-c:a','libopus',input);
      const fixture = spawnSync(binary,args,{windowsHide:true});
      assert.equal(fixture.status,0,fixture.stderr?.toString());
      const bytes = await fs.readFile(input);
      for (const format of ['mp4','mkv']) {
        const reserved = await createUniqueRecording(dir,`測試.${format}`,format);
        await reserved.handle.close();
        const live = createLiveRecording(binary,reserved.filePath,{format});
        for (let offset=0;offset<bytes.length;offset+=8192) await live.append(bytes.subarray(offset,offset+8192));
        assert.ok(await live.finalize()>1000);
        const decode = spawnSync(binary,['-v','error','-i',reserved.filePath,'-f','null','-'],{windowsHide:true});
        assert.equal(decode.status,0,decode.stderr?.toString());
        if (audio) {
          const pcm = spawnSync(binary,['-v','error','-i',reserved.filePath,'-vn','-f','f32le','-ac','1','-ar','48000','-'],{windowsHide:true,maxBuffer:2000000});
          assert.equal(pcm.status,0);
          assert.ok(Math.abs(pcm.stdout.length/4/48000-3)<.15);
          let power=0; for(let i=0;i<pcm.stdout.length;i+=4) power+=pcm.stdout.readFloatLE(i)**2;
          assert.ok(power>1,'audio is audible');
        }
      }
    }
    const broken = createLiveRecording(path.join(dir,'missing.exe'),path.join(dir,'failed.mp4'),{format:'mp4'});
    await assert.rejects(broken.finalize(),/ENOENT/);
    const canceled = createLiveRecording(binary,path.join(dir,'canceled.mkv'),{format:'mkv'});
    await canceled.cancel();
    await assert.rejects(canceled.append(Buffer.from('x')));
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
