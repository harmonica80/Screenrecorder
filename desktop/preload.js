const { contextBridge, ipcRenderer } = require('electron');

window.addEventListener('error', event => {
  const show = () => {
    let notice = document.getElementById('desktopStartupError');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'desktopStartupError';
      notice.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;padding:16px;background:#991b1b;color:white;white-space:pre-wrap';
      document.body.appendChild(notice);
    }
    notice.textContent = '程式發生錯誤，請將此訊息回報：\n' + event.message;
  };
  if (document.body) show();
  else window.addEventListener('DOMContentLoaded', show, { once: true });
});

contextBridge.exposeInMainWorld('desktopRecorderBridge', {
  isDesktop: true,
  configureShortcuts: bindings => ipcRenderer.invoke('recording:configure-shortcuts', bindings),
  onShortcut: callback => {
    const listener = (_event, key) => callback(key);
    ipcRenderer.on('recording:shortcut', listener);
    return () => ipcRenderer.removeListener('recording:shortcut', listener);
  },
  version: ipcRenderer.sendSync('app:version'),
  checkForUpdates: () => ipcRenderer.invoke('app:check-updates'),
  openReleases: () => ipcRenderer.invoke('app:open-releases'),
  initialPreferences: ipcRenderer.sendSync('settings:initial-preferences'),
  savePreferences: preferences => ipcRenderer.invoke('settings:save-preferences', preferences),
  setRecordingIndicator: state => ipcRenderer.invoke('recording:indicator', state),
  getRecordingFolder: () => ipcRenderer.invoke('settings:get-folder'),
  chooseRecordingFolder: () => ipcRenderer.invoke('settings:choose-folder'),
  clearRecordingFolder: () => ipcRenderer.invoke('settings:clear-folder'),
  listCaptureSources: kind => ipcRenderer.invoke('capture:list-sources', kind),
  selectCaptureSource: selection => ipcRenderer.invoke('capture:select-source', selection),
  prepareRecording: suggestedName => ipcRenderer.invoke('recording:prepare', suggestedName),
  appendChunk: arrayBuffer => ipcRenderer.invoke('recording:append', arrayBuffer),
  finalizeRecording: () => ipcRenderer.invoke('recording:finalize'),
  cancelRecording: () => ipcRenderer.invoke('recording:cancel'),
  showInFolder: filePath => ipcRenderer.invoke('recording:show-in-folder', filePath)
});
