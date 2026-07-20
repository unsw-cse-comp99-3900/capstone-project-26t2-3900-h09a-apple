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
  getAuthStatus: () => ipcRenderer.invoke('auth:get-status'),
  getConsentStatus: () => ipcRenderer.invoke('consent:get-status'),
  acceptConsent: () => ipcRenderer.invoke('consent:accept'),
  logout: () => ipcRenderer.invoke('auth:logout'),

  // Recording
  getRecordingStatus: () => ipcRenderer.invoke('recording:get-status'),
  startRecording: () => ipcRenderer.invoke('recording:start'),
  stopRecording: () => ipcRenderer.invoke('recording:stop'),
  getReviewSession: () => ipcRenderer.invoke('recording:get-review'),
  reviewSession: () => ipcRenderer.invoke('recording:review'),
  submitSession: () => ipcRenderer.invoke('recording:submit'),

  startWalkthrough: (sopId: string) => ipcRenderer.invoke('walkthrough:start', sopId),

  onNotice: (listener: (message: string) => void) => {
    const handler = (_event: unknown, payload: { message?: string }) => {
      if (typeof payload?.message === 'string' && payload.message.trim()) {
        listener(payload.message);
      }
    };
    ipcRenderer.on('desktop:notice', handler);
    return () => {
      ipcRenderer.removeListener('desktop:notice', handler);
    };
  },

  // Window
  setWindowMode: (mode: 'compact' | 'expanded') => ipcRenderer.invoke('window:set-mode', mode),
  beginWindowDrag: () => ipcRenderer.send('window:drag-start'),
  updateWindowDrag: () => ipcRenderer.send('window:drag-move'),
  endWindowDrag: () => ipcRenderer.send('window:drag-end'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
});
