const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRecordingIndicator } = require('./recording-indicator');
test('recording blinks; pause and stop remove timers', () => {
  const calls = [], timers = new Map(); let next = 0;
  const indicator = createRecordingIndicator({
    platform: 'win32',
    nativeImage: { createFromBitmap: buffer => buffer },
    getWindow: () => ({ isDestroyed: () => false, setOverlayIcon: (icon, text) => calls.push({ icon, text }) }),
    schedule: (cb, delay) => { assert.equal(delay, 900); timers.set(++next, cb); return next; },
    cancel: id => timers.delete(id)
  });
  indicator.setState('recording');
  assert.equal(calls.at(-1).text, '正在錄影');
  assert.ok(calls.at(-1).icon);
  timers.get(next)(); assert.equal(calls.at(-1).icon, null);
  timers.get(next)(); assert.ok(calls.at(-1).icon);
  indicator.setState('paused'); assert.equal(timers.size, 0);
  assert.equal(calls.at(-1).text, '錄影已暫停'); assert.ok(calls.at(-1).icon);
  indicator.setState('recording'); assert.equal(timers.size, 1);
  indicator.dispose(); assert.equal(timers.size, 0); assert.equal(calls.at(-1).icon, null);
});
