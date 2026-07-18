import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktopAPI', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },

  // Authentication
  launchHandoff: () => ipcRenderer.invoke('auth:launch-handoff'),

  // Recording
  getRecordingStatus: () => ipcRenderer.invoke('recording:get-status'),
  startRecording: () => ipcRenderer.invoke('recording:start'),
  stopRecording: () => ipcRenderer.invoke('recording:stop'),
  reviewSession: () => ipcRenderer.invoke('recording:review'),

  // Window
  setWindowMode: (mode: 'compact' | 'expanded') =>
    ipcRenderer.invoke('window:set-mode', mode),
  beginWindowDrag: () => ipcRenderer.send('window:drag-start'),
  updateWindowDrag: () => ipcRenderer.send('window:drag-move'),
  endWindowDrag: () => ipcRenderer.send('window:drag-end'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
});
