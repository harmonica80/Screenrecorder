const test = require('node:test');
const assert = require('node:assert/strict');
const { findUpdate } = require('./updates');
const release = tag_name => ({ tag_name, assets: [{ name: `Screenrecorder-Pro-Lite-${tag_name}-Portable.exe` }] });
test('update comparison selects stable portable releases and distinguishes missing publications', () => {
  assert.equal(findUpdate([], '0.1.4').status, 'unpublished');
  assert.equal(findUpdate([{ ...release('9.0.0'), prerelease: true }, { tag_name: '8.0.0', assets: [] }], '0.1.4').status, 'unpublished');
  assert.equal(findUpdate([release('v0.1.4')], '0.1.4').status, 'current');
  assert.equal(findUpdate([release('v0.1.3')], '0.1.4').status, 'current');
  const result = findUpdate([release('0.1.9'), release('v0.1.10')], '0.1.4');
  assert.equal(result.status, 'available');
  assert.equal(result.latestVersion, '0.1.10');
});
