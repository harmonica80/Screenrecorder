const test = require('node:test');
const assert = require('node:assert/strict');
const { findUpdate } = require('./updates');
const release = (tag_name, edition = 'lite', options = {}) => ({
  tag_name,
  draft: false,
  prerelease: tag_name.includes('-beta.'),
  html_url: `https://github.com/harmonica80/Screenrecorder/releases/tag/${tag_name}`,
  assets: [{ name: `Screenrecorder-Pro-${edition === 'advanced' ? 'Advanced' : 'Lite'}-${tag_name}-Portable.exe` }],
  ...options
});

test('Lite update check selects only stable Lite releases', () => {
  assert.equal(findUpdate([], '0.1.4').status, 'unpublished');
  assert.equal(findUpdate([{ ...release('9.0.0', 'lite'), prerelease: true }, release('8.0.0', 'advanced')], '0.1.4').status, 'unpublished');
  assert.equal(findUpdate([release('v0.1.4')], '0.1.4').status, 'current');
  const result = findUpdate([release('v0.1.9'), release('v0.1.10'), release('v0.2.0-beta.1', 'lite')], '0.1.4');
  assert.equal(result.status, 'available');
  assert.equal(result.latestVersion, '0.1.10');
  assert.equal(result.releaseUrl, 'https://github.com/harmonica80/Screenrecorder/releases/tag/v0.1.10');
});

test('Advanced update check links to an Advanced release and includes beta versions', () => {
  const releases = [
    release('v0.1.10', 'lite'),
    release('advanced-v0.2.0-beta.9', 'advanced'),
    release('advanced-v0.2.0-beta.10', 'advanced')
  ];
  const result = findUpdate(releases, '0.2.0-beta.8', 'advanced');
  assert.equal(result.status, 'available');
  assert.equal(result.latestVersion, '0.2.0-beta.10');
  assert.equal(result.releaseUrl, 'https://github.com/harmonica80/Screenrecorder/releases/tag/advanced-v0.2.0-beta.10');
});
