const https = require('node:https');
const releasesUrl = 'https://github.com/harmonica80/Screenrecorder/releases';
function findUpdate(releases, currentVersion) {
  const parse = value => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value)?.slice(1).map(Number);
  const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  const current = parse(currentVersion);
  if (!current) throw new Error('無法辨識目前版本');
  const candidates = releases.filter(r => !r.draft && !r.prerelease && parse(r.tag_name) &&
    r.assets?.some(a => /^Screenrecorder-Pro-Lite-.*-Portable\.exe$/i.test(a.name)));
  candidates.sort((a, b) => compare(parse(b.tag_name), parse(a.tag_name)));
  if (!candidates.length) return { status: 'unpublished', currentVersion, releasesUrl };
  const latestVersion = candidates[0].tag_name.replace(/^v/, '');
  return { status: compare(parse(latestVersion), current) > 0 ? 'available' : 'current', currentVersion, latestVersion, releasesUrl };
}
function checkForUpdates(currentVersion) {
  return new Promise((resolve, reject) => {
    const request = https.get('https://api.github.com/repos/harmonica80/Screenrecorder/releases?per_page=100', {
      headers: { 'User-Agent': 'Screenrecorder-Pro-Lite', Accept: 'application/vnd.github+json' }
    }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(response.statusCode === 403 || response.statusCode === 429 ? '更新服務暫時限制查詢，請稍後重試。' : `無法取得版本資訊（HTTP ${response.statusCode}）。`));
        return;
      }
      let body = '';
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 2000000) request.destroy(new Error('更新資料過大。'));
      });
      response.on('error', reject);
      response.on('end', () => {
        try {
          const releases = JSON.parse(body);
          if (!Array.isArray(releases)) throw new Error('版本資訊格式無效。');
          resolve(findUpdate(releases, currentVersion));
        } catch (error) { reject(error); }
      });
    });
    request.setTimeout(12000, () => request.destroy(new Error('連線逾時，請確認網路後再試。')));
    request.on('error', reject);
  });
}
module.exports = { findUpdate, checkForUpdates, releasesUrl };
