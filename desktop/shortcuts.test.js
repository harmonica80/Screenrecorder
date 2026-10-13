const test = require('node:test');
const assert = require('node:assert/strict');
const { createShortcuts } = require('./shortcuts');
test('global shortcuts group shared keys, report conflicts, replace and clear bindings', () => {
  const bindings = new Map(), events = [];
  const shortcuts = createShortcuts({
    unregisterAll: () => bindings.clear(),
    register: (key, callback) => { if (key === 'F12') return false; bindings.set(key, callback); return true; }
  }, key => events.push(key));
  assert.deepEqual(shortcuts.configure({ record: 'F9', pause: 'F9', stop: 'F10' }), []);
  assert.equal(bindings.size, 2);
  bindings.get('F9')();
  assert.deepEqual(events, ['F9']);
  assert.deepEqual(shortcuts.configure({ record: 'Ctrl+F8', stop: 'F12' }), ['F12']);
  assert.equal(bindings.has('F9'), false);
  shortcuts.clear();
  assert.equal(bindings.size, 0);
});
