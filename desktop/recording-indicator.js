// The badge is generated locally as a 32px bitmap; no external image assets.
function badgeBitmap(paused = false) {
  const size = 32, buffer = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const distance = Math.hypot(x - 15.5, y - 15.5);
    if (distance > 15) continue;
    const border = distance > 12;
    const i = (y * size + x) * 4;
    // Native bitmap uses BGRA bytes.
    buffer[i] = border ? 255 : paused ? 11 : 68;
    buffer[i + 1] = border ? 255 : paused ? 158 : 68;
    buffer[i + 2] = border ? 255 : paused ? 245 : 239;
    buffer[i + 3] = Math.round(Math.min(1, 15 - distance) * 255);
  }
  return buffer;
}

function createRecordingIndicator({ getWindow, nativeImage, platform = process.platform, schedule = setInterval, cancel = clearInterval }) {
  let timer = null;
  const red = nativeImage.createFromBitmap(badgeBitmap(), { width: 32, height: 32 });
  const amber = nativeImage.createFromBitmap(badgeBitmap(true), { width: 32, height: 32 });
  function paint(icon, label) {
    const win = getWindow();
    if (platform === 'win32' && win && !win.isDestroyed()) win.setOverlayIcon(icon, label);
  }
  function setState(state) {
    if (timer !== null) { cancel(timer); timer = null; }
    if (state === 'recording') {
      let visible = true;
      paint(red, '正在錄影');
      timer = schedule(() => { visible = !visible; paint(visible ? red : null, '正在錄影'); }, 900);
    } else paint(state === 'paused' ? amber : null, state === 'paused' ? '錄影已暫停' : '');
  }
  return { setState, dispose: () => setState('idle') };
}
module.exports = { createRecordingIndicator, badgeBitmap };
