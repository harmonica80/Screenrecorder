const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, session, shell, nativeImage, globalShortcut } = require('electron');
const { createShortcuts } = require('./shortcuts');
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

function safeSuggestedName(value) {
  const name = path.basename(String(value || 'screen-recording.webm'))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
  return name.toLowerCase().endsWith('.webm') ? name : `${name}.webm`;
}

async function closeActiveRecording({ remove = false } = {}) {
  if (!activeRecording) return;
  const { handle, filePath } = activeRecording;
  activeRecording = null;
  try { await handle.close(); } catch (_) {}
  if (remove) {
    try { await fs.unlink(filePath); } catch (_) {}
  }
}

function registerRecordingHandlers() {
  ipcMain.handle('recording:configure-shortcuts', (_event, bindings) => shortcuts.configure(bindings));
  ipcMain.on('app:version', event => { event.returnValue = app.getVersion(); });
  ipcMain.handle('app:check-updates', () => checkForUpdates(app.getVersion()));
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

  ipcMain.handle('recording:prepare', async (_event, suggestedName) => {
    if (activeRecording) throw new Error('上一段影片仍在儲存，請稍候。');
    if (saveSettings.recordingDirectory) {
      try {
        const created = await createUniqueRecording(saveSettings.recordingDirectory, safeSuggestedName(suggestedName));
        activeRecording = { ...created, bytesWritten: 0 };
        return { canceled: false, filePath: created.filePath };
      } catch (error) {
        throw new Error('預設儲存資料夾無法寫入，請在錄影進階設定重新選擇資料夾：' + error.message);
      }
    }
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '選擇錄影檔儲存位置',
      defaultPath: path.join(app.getPath('videos'), safeSuggestedName(suggestedName)),
      filters: [{ name: 'WebM 影片', extensions: ['webm'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    });
    if (result.canceled || !result.filePath) return { canceled: true };

    const filePath = result.filePath.toLowerCase().endsWith('.webm')
      ? result.filePath
      : `${result.filePath}.webm`;
    const handle = await fs.open(filePath, 'w');
    activeRecording = { filePath, handle, bytesWritten: 0 };
    return { canceled: false, filePath };
  });

  ipcMain.handle('recording:append', async (_event, arrayBuffer) => {
    if (!activeRecording) throw new Error('錄影檔尚未建立。');
    const buffer = Buffer.from(arrayBuffer);
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
    const { filePath, handle, bytesWritten } = activeRecording;
    await handle.sync();
    await handle.close();
    activeRecording = null;
    const token = randomUUID();
    playableRecordings.set(token, filePath);
    return { filePath, fileUrl: `${localAppOrigin}/recordings/${token}`, bytesWritten };
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
    icon: path.join(__dirname, '../assets/lite-icon.ico'),
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    title: '螢幕錄影工具 Pro－輕量版',
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
  mainWindow.webContents.on('render-process-gone', () => { recordingIndicator.dispose(); shortcuts.clear(); });
  mainWindow.loadURL(`${localAppOrigin}/index.html`);
  mainWindow.on('closed', () => { recordingIndicator.dispose(); shortcuts.clear(); mainWindow = null; });
}

app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('tw.shuwen.screenrecorder.lite');
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
