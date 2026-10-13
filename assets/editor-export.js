// Isolated playback keeps timeline seeking and preview audio out of the export.
window.exportDesktopClip = async ({ url, start, end, filename, gainAt, onProgress, signal }) => {
  const bridge = window.desktopRecorderBridge;
  const video = document.createElement('video');
  video.preload = 'auto';
  video.src = url;
  video.playsInline = true;
  let context, stream, recorder, drawTimer, monitorTimer, prepared = false;
  let writes = Promise.resolve(), writeError;
  const waitEvent = (target, name, timeout = 20000) => new Promise((resolve, reject) => {
    const done = error => {
      clearTimeout(timer); target.removeEventListener(name, success); target.removeEventListener('error', failure);
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve();
    };
    const success = () => done();
    const failure = () => done(new Error('無法讀取影片，請重新載入檔案。'));
    const abort = () => done(new Error('已取消輸出。'));
    const timer = setTimeout(() => done(new Error('影片讀取逾時。')), timeout);
    target.addEventListener(name, success, { once: true });
    target.addEventListener('error', failure, { once: true });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
  try {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error('輸出時間範圍無效。');
    const metadata = waitEvent(video, 'loadedmetadata');
    video.load();
    await metadata;
    if (start > 0) { const seek = waitEvent(video, 'seeked'); video.currentTime = start; await seek; }
    else if (video.readyState < 2) await waitEvent(video, 'loadeddata');
    const info = await bridge.prepareRecording(filename);
    if (!info || info.canceled) throw new Error('已取消輸出。');
    prepared = true;
    if (signal?.aborted) throw new Error('已取消輸出。');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const drawing = canvas.getContext('2d');
    stream = canvas.captureStream(30);
    context = new AudioContext();
    const source = context.createMediaElementSource(video);
    const gain = context.createGain();
    const destination = context.createMediaStreamDestination();
    source.connect(gain).connect(destination);
    for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
    await context.resume();
    const mimeType = ['video/webm;codecs=vp8,opus', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('目前系統無法輸出 WebM。');
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6000000, audioBitsPerSecond: 128000 });
    let recorderError;
    const stopped = new Promise(resolve => {
      recorder.onstop = resolve;
      recorder.onerror = event => { recorderError = event.error || new Error('影片編碼失敗。'); };
    });
    recorder.ondataavailable = event => {
      if (!event.data.size) return;
      writes = writes.then(async () => {
        if (!writeError) await bridge.appendChunk(await event.data.arrayBuffer());
      }).catch(error => { writeError = error; });
    };
    const draw = () => {
      if (video.readyState >= 2) drawing.drawImage(video, 0, 0, canvas.width, canvas.height);
      gain.gain.setValueAtTime(gainAt(video.currentTime) / 100, context.currentTime);
    };
    draw();
    recorder.start(1000);
    drawTimer = setInterval(draw, 1000 / 30);
    await video.play();
    await new Promise((resolve, reject) => {
      let lastTime = video.currentTime, lastProgress = Date.now();
      monitorTimer = setInterval(() => {
        if (video.currentTime > lastTime) { lastTime = video.currentTime; lastProgress = Date.now(); }
        onProgress(Math.min(100, Math.round((video.currentTime - start) / (end - start) * 100)));
        if (signal?.aborted) reject(new Error('已取消輸出。'));
        else if (writeError || recorderError) reject(writeError || recorderError);
        else if (video.error) reject(new Error('播放影片時發生錯誤。'));
        else if (video.currentTime >= end - 0.015 || video.ended) resolve();
        else if (Date.now() - lastProgress > 20000) reject(new Error('影片播放停滯，請重新載入後重試。'));
      }, 20);
    });
    video.pause();
    clearInterval(drawTimer); clearInterval(monitorTimer);
    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;
    await writes;
    if (writeError || recorderError) throw writeError || recorderError;
    const result = await bridge.finalizeRecording();
    prepared = false;
    return result;
  } finally {
    video.pause();
    clearInterval(drawTimer); clearInterval(monitorTimer);
    if (recorder && recorder.state !== 'inactive') {
      await new Promise(resolve => { recorder.addEventListener('stop', resolve, { once: true }); recorder.stop(); });
    }
    await writes;
    if (prepared) await bridge.cancelRecording().catch(() => {});
    stream?.getTracks().forEach(track => track.stop());
    if (context && context.state !== 'closed') await context.close();
    video.removeAttribute('src'); video.load();
  }
};
