const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, session, shell, nativeImage, globalShortcut } = require('electron');
const { createShortcuts } = require('./shortcuts');
const advancedEdition = require('../package.json').edition === 'advanced';
const { createNativeMedia } = require('./native-media');
const { createLiveRecording } = require('./live-recording');
const nativeMedia = advancedEdition ? createNativeMedia(pathForNativeBinary()) : null;
function pathForNativeBinary() {
  const p = require('node:path');
  return p.join(app.isPackaged ? process.resourcesPath : p.join(__dirname, '..', 'vendor'), 'ffmpeg', 'ffmpeg.exe');
}
const { createRecordingIndicator } = require('./recording-indicator');
const { checkForUpdates, releasesUrl } = require('./updates');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createUniqueRecording, readSettings, writeSettings, serveRecording } = require('./recording-files');
const playableRecordings = new Map();
let saveSettings = {};
const settingsPath = () => path.join(app.getPath('userData'), 'recording-settings.json');
let settingsQueue = Promise.resolve();
function updateSettings(patch) {
  const operation = settingsQueue.then(async () => {
    const next = { ...saveSettings, ...patch };
    await writeSettings(settingsPath(), next);
    saveSettings = next;
  });
  settingsQueue = operation.catch(() => {});
  return operation;
}

let mainWindow;
const shortcuts = createShortcuts(globalShortcut, key => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!activeRecording) { mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
  mainWindow.webContents.send('recording:shortcut', key);
});
const recordingIndicator = createRecordingIndicator({ getWindow: () => mainWindow, nativeImage });
let activeRecording = null;
let selectedCapture = null;
let localServer = null;
let localAppOrigin = '';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm'
};

function startLocalAppServer() {
  const appRoot = path.resolve(__dirname, '..');
  localServer = http.createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405).end('Method Not Allowed');
        return;
      }
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname.startsWith('/recordings/')) {
        const recordingPath = playableRecordings.get(url.pathname.slice('/recordings/'.length));
        if (!recordingPath) { response.writeHead(404).end(); return; }
        await serveRecording(request, response, recordingPath);
        return;
      }
      const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const filePath = path.resolve(appRoot, `.${pathname}`);
      if (filePath !== appRoot && !filePath.startsWith(`${appRoot}${path.sep}`)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      const data = await fs.readFile(filePath);
      response.writeHead(200, {
        'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless'
      });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch (error) {
      response.writeHead(error?.code === 'ENOENT' ? 404 : 500).end('Not Found');
    }
  });

  return new Promise((resolve, reject) => {
    localServer.once('error', reject);
    localServer.listen(0, '127.0.0.1', () => {
      const address = localServer.address();
      localAppOrigin = `http://127.0.0.1:${address.port}`;
      resolve(localAppOrigin);
    });
  });
}

function safeSuggestedName(value, format = 'webm') {
  const name = path.basename(String(value || 'screen-recording.webm'))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
  return name.toLowerCase().endsWith(`.${format}`) ? name : `${name}.${format}`;
}

async function closeActiveRecording({ remove = false } = {}) {
  if (!activeRecording) return;
  const { handle, filePath, live } = activeRecording;
  activeRecording = null;
  try { if (live) { if (remove) await live.cancel(); else await live.finalize(); } else await handle.close(); } catch (_) {}
  if (remove) {
    try { await fs.unlink(filePath); } catch (_) {}
  }
}

function registerRecordingHandlers() {
  ipcMain.on('app:edition', event => { event.returnValue = advancedEdition ? 'advanced' : 'lite'; });
  ipcMain.handle('media:import', async (_event, filePath) => {
    if (!advancedEdition || typeof filePath !== 'string' || !path.isAbsolute(filePath) || !/\.(webm|mp4|mkv|mov|m4v)$/i.test(filePath)) throw new Error('請選擇本機影片檔案。');
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error('影片檔案無效。');
    const token = randomUUID(); playableRecordings.set(token,filePath);
    return { filePath, fileUrl: `${localAppOrigin}/recordings/${token}` };
  });
  ipcMain.handle('media:cancel', () => { nativeMedia?.cancel(); });
  ipcMain.handle('media:export', async (_event, options) => {
    if (!nativeMedia) throw new Error('此功能需要進階版。');
    if (activeRecording || nativeMedia.busy) throw new Error('請等候目前錄影或影片處理完成。');
    if (![...playableRecordings.values()].includes(options?.filePath)) throw new Error('請先載入影片。');
    const format = options.format;
    if (!['mp4','mkv','webm'].includes(format)) throw new Error('影片格式無效。');
    let target = path.join(saveSettings.recordingDirectory || path.dirname(options.filePath), path.parse(options.filePath).name + '_' + String(options.label || '轉檔').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0,40) + '.' + format);
    if (!saveSettings.recordingDirectory) {
      const result = await dialog.showSaveDialog(mainWindow,{title:'儲存處理後的影片',defaultPath:target,filters:[{name:format.toUpperCase()+' 影片',extensions:[format]}]});
      if (result.canceled || !result.filePath) throw new Error('已取消影片處理。');
      target = result.filePath;
    }
    const result = await nativeMedia.export(options.filePath,target,{
      format, start: options.start || 0, end: options.end == null ? undefined : options.end,
      quality: options.quality, copy: !!options.copy,
      volume: Array.isArray(options.volume) ? options.volume.slice(0,500) : []
    }, progress => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('media:progress',progress); });
    const token = randomUUID(); playableRecordings.set(token,result.filePath);
    return {...result,fileUrl:`${localAppOrigin}/recordings/${token}`};
  });
  ipcMain.handle('recording:configure-shortcuts', (_event, bindings) => shortcuts.configure(bindings));
  ipcMain.on('app:version', event => { event.returnValue = app.getVersion(); });
  ipcMain.handle('app:check-updates', () => checkForUpdates(app.getVersion(),advancedEdition ? 'advanced' : 'lite'));
  ipcMain.handle('app:open-releases', () => shell.openExternal(releasesUrl));
  ipcMain.on('settings:initial-preferences', event => { event.returnValue = saveSettings.preferences || {}; });
  ipcMain.handle('settings:save-preferences', async (_event, preferences) => {
    if (!preferences || typeof preferences !== 'object' || JSON.stringify(preferences).length > 50000) throw new Error('設定資料無效');
    await updateSettings({ preferences });
  });
  ipcMain.handle('recording:indicator', (_event, state) => {
    if (!['recording', 'paused', 'idle'].includes(state)) return false;
    recordingIndicator.setState(state);
    return true;
  });
  ipcMain.handle('settings:get-folder', () => saveSettings.recordingDirectory || '');
  ipcMain.handle('settings:choose-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '選擇預設錄影影片儲存位置',
      defaultPath: saveSettings.recordingDirectory || app.getPath('videos'),
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled) return saveSettings.recordingDirectory || '';
    const folder = result.filePaths[0];
    await fs.access(folder, require('node:fs').constants.W_OK);
    await updateSettings({ recordingDirectory: folder });
    return folder;
  });
  ipcMain.handle('settings:clear-folder', async () => {
    await updateSettings({ recordingDirectory: '' });
    return '';
  });
  ipcMain.handle('capture:list-sources', async (_event, kind) => {
    const types = kind === 'screen' ? ['screen'] : ['window'];
    const sources = await desktopCapturer.getSources({
      types,
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true
    });
    return sources.map(source => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL(),
      appIcon: source.appIcon?.toDataURL() || ''
    }));
  });

  ipcMain.handle('capture:select-source', async (_event, selection) => {
    selectedCapture = {
      id: String(selection?.id || ''),
      includeAudio: Boolean(selection?.includeAudio)
    };
    return Boolean(selectedCapture.id);
  });

  ipcMain.handle('recording:prepare', async (_event, request) => {
    if (nativeMedia?.busy) throw new Error('影片處理中，請完成後再錄影。');
    if (activeRecording) throw new Error('上一段影片仍在儲存，請稍候。');
    const options = typeof request === 'string' ? { suggestedName:request } : request || {};
    const format = advancedEdition ? (options.format || 'webm') : 'webm';
    if (!['mp4','mkv','webm'].includes(format)) throw new Error('錄影格式無效。');
    if (format !== 'webm') await fs.access(pathForNativeBinary());
    const name = safeSuggestedName(options.suggestedName, format);
    let created;
    if (saveSettings.recordingDirectory) {
      try { created = await createUniqueRecording(saveSettings.recordingDirectory, name, format); }
      catch (error) { throw new Error('預設儲存資料夾無法寫入，請重新選擇資料夾：' + error.message); }
    } else {
      const result = await dialog.showSaveDialog(mainWindow, {
        title:'選擇錄影檔儲存位置', defaultPath:path.join(app.getPath('videos'),name),
        filters:[{name:`${format.toUpperCase()} 影片`,extensions:[format]}],
        properties:['createDirectory','showOverwriteConfirmation']
      });
      if (result.canceled || !result.filePath) return {canceled:true};
      const filePath = result.filePath.toLowerCase().endsWith(`.${format}`) ? result.filePath : `${result.filePath}.${format}`;
      created = {filePath,handle:await fs.open(filePath,'w')};
    }
    activeRecording = {...created,bytesWritten:0,format};
    if (format !== 'webm') {
      await created.handle.close();
      activeRecording.handle = null;
      activeRecording.live = createLiveRecording(pathForNativeBinary(),created.filePath,{format,quality:options.quality});
    }
    return {canceled:false,filePath:created.filePath};
  });

  ipcMain.handle('recording:append', async (_event, arrayBuffer) => {
    if (!activeRecording) throw new Error('錄影檔尚未建立。');
    const buffer = Buffer.from(arrayBuffer);
    if (activeRecording.live) {
      activeRecording.bytesWritten = await activeRecording.live.append(buffer);
      return {bytesWritten:activeRecording.bytesWritten};
    }
    let offset = 0;
    while (offset < buffer.length) {
      const result = await activeRecording.handle.write(buffer, offset, buffer.length - offset, activeRecording.bytesWritten);
      if (!result.bytesWritten) throw new Error('硬碟寫入中斷');
      offset += result.bytesWritten;
      activeRecording.bytesWritten += result.bytesWritten;
    }
    return { bytesWritten: activeRecording.bytesWritten };
  });

  ipcMain.handle('recording:finalize', async () => {
    if (!activeRecording) throw new Error('找不到正在寫入的錄影檔。');
    const { filePath, handle, live, format } = activeRecording;
    let bytesWritten;
    try {
      if (live) bytesWritten = await live.finalize();
      else { await handle.sync(); await handle.close(); bytesWritten = activeRecording.bytesWritten; }
    } finally { activeRecording = null; }
    const token = randomUUID();
    playableRecordings.set(token, filePath);
    return { filePath, fileUrl: `${localAppOrigin}/recordings/${token}`, bytesWritten, format };
  });

  ipcMain.handle('recording:cancel', async () => {
    await closeActiveRecording({ remove: true });
    return true;
  });

  ipcMain.handle('recording:show-in-folder', async (_event, filePath) => {
    if (!filePath || !path.isAbsolute(filePath)) return false;
    shell.showItemInFolder(filePath);
    return true;
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    icon: path.join(__dirname, '../assets/app-icon.ico'),
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    title: advancedEdition ? '螢幕錄影工具 Pro－進階測試版' : '螢幕錄影工具 Pro－輕量版',
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  mainWindow.removeMenu();
  const openExternalLink = url => {
    try {
      const parsed = new URL(url);
      if (['https:', 'http:'].includes(parsed.protocol)) {
        shell.openExternal(parsed.href).catch(error => console.error('無法開啟外部連結', error));
      }
    } catch (_) { /* Ignore invalid links. */ }
  };
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalLink(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== localAppOrigin) {
      event.preventDefault();
      openExternalLink(url);
    }
  });
  mainWindow.webContents.on('render-process-gone', () => { recordingIndicator.dispose(); shortcuts.clear(); });
  mainWindow.loadURL(`${localAppOrigin}/index.html`);
  mainWindow.on('closed', () => { recordingIndicator.dispose(); shortcuts.clear(); mainWindow = null; });
}

app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId(advancedEdition ? 'tw.shuwen.screenrecorder.advanced' : 'tw.shuwen.screenrecorder.lite');
  saveSettings = await readSettings(settingsPath()).catch(() => ({}));
  registerRecordingHandlers();
  await startLocalAppServer();
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return ['media', 'display-capture'].includes(permission) && String(requestingOrigin || '').startsWith(localAppOrigin);
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const isLocalApp = webContents.getURL().startsWith(localAppOrigin);
    callback(isLocalApp && ['media', 'display-capture'].includes(permission));
  });
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      if (!selectedCapture?.id) return callback(null);
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
      const source = sources.find(item => item.id === selectedCapture.id);
      if (!source) return callback(null);
      const response = { video: source };
      if (process.platform === 'win32' && selectedCapture.includeAudio && request.audioRequested) {
        response.audio = 'loopback';
      }
      selectedCapture = null;
      callback(response);
    } catch (error) {
      console.error('選擇擷取來源失敗：', error);
      selectedCapture = null;
      callback(null);
    }
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', event => {
  nativeMedia?.cancel();
  shortcuts.clear();
  if (!activeRecording) return;
  event.preventDefault();
  closeActiveRecording().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (localServer) {
    localServer.close();
    localServer = null;
  }
  if (process.platform !== 'darwin') app.quit();
});
