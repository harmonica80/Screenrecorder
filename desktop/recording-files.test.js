const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createUniqueRecording, readSettings, writeSettings, serveRecording } = require('./recording-files');

test('recording folder survives reload; duplicate names never overwrite', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'recorder-test-'));
  const config = path.join(dir, 'settings.json');
  assert.deepEqual(await readSettings(config), {});
  await writeSettings(config, { recordingDirectory: dir });
  assert.equal((await readSettings(config)).recordingDirectory, dir);
  const first = await createUniqueRecording(dir, '01.webm');
  await first.handle.writeFile('original'); await first.handle.close();
  const next = await createUniqueRecording(dir, '01.webm');
  await next.handle.close();
  assert.equal(path.basename(next.filePath), '01 (1).webm');
  assert.equal(await fs.readFile(first.filePath, 'utf8'), 'original');
  await writeSettings(config, { recordingDirectory: '' });
  assert.equal((await readSettings(config)).recordingDirectory, '');
  await fs.rm(dir, { recursive: true });
});

test('local video supports normal, seek, suffix, HEAD and invalid ranges', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'recorder-http-test-'));
  const file = path.join(dir, '中文 空格.webm');
  await fs.writeFile(file, Buffer.from('0123456789'));
  const server = http.createServer((req, res) => serveRecording(req, res, file));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/recordings/token`;
  try {
    let r = await fetch(url);
    assert.equal(r.status, 200); assert.equal(await r.text(), '0123456789');
    r = await fetch(url, { headers: { Range: 'bytes=3-6' } });
    assert.equal(r.status, 206); assert.equal(r.headers.get('content-range'), 'bytes 3-6/10');
    assert.equal(await r.text(), '3456');
    r = await fetch(url, { headers: { Range: 'bytes=-2' } });
    assert.equal(await r.text(), '89');
    r = await fetch(url, { method: 'HEAD' });
    assert.equal(r.headers.get('content-length'), '10'); assert.equal(await r.text(), '');
    r = await fetch(url, { headers: { Range: 'bytes=10-' } });
    assert.equal(r.status, 416);
  } finally { await new Promise(resolve => server.close(resolve)); await fs.rm(dir, { recursive: true }); }
});
