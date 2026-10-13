const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');

async function createUniqueRecording(directory, filename) {
  const stem = path.basename(filename, '.webm');
  for (let n = 0; n < 100000; n++) {
    const filePath = path.join(directory, `${stem}${n ? ` (${n})` : ''}.webm`);
    try { return { filePath, handle: await fs.open(filePath, 'wx') }; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  throw new Error('同名檔案過多，請更換檔名。');
}

async function readSettings(settingsPath) {
  try { return JSON.parse(await fs.readFile(settingsPath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}

async function writeSettings(settingsPath, settings) {
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  const temp = settingsPath + '.tmp';
  await fs.writeFile(temp, JSON.stringify(settings), 'utf8');
  await fs.rename(temp, settingsPath);
}

async function serveRecording(request, response, filePath) {
  const { size } = await fs.stat(filePath);
  let start = 0, end = size - 1, status = 200;
  if (request.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
    if (!match || (!match[1] && !match[2])) {
      response.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return;
    }
    if (!match[1]) start = Math.max(0, size - Number(match[2]));
    else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
      response.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return;
    }
    status = 206;
  }
  const headers = { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes', 'Content-Length': Math.max(0, end - start + 1), 'Cache-Control': 'no-store' };
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  response.writeHead(status, headers);
  if (request.method === 'HEAD' || !size) { response.end(); return; }
  const stream = createReadStream(filePath, { start, end });
  stream.on('error', () => response.destroy());
  response.on('close', () => stream.destroy());
  stream.pipe(response);
}

module.exports = { createUniqueRecording, readSettings, writeSettings, serveRecording };
