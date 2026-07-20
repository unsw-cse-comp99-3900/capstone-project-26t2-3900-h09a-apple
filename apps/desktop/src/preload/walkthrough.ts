import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('walkthroughAPI', {
  onState: (handler: (state: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => handler(state);
    ipcRenderer.on('walkthrough:state', listener);
    return () => ipcRenderer.removeListener('walkthrough:state', listener);
  },
  previous: () => ipcRenderer.invoke('walkthrough:previous'),
  next: () => ipcRenderer.invoke('walkthrough:next'),
  finish: () => ipcRenderer.invoke('walkthrough:finish'),
  dismiss: () => ipcRenderer.invoke('walkthrough:dismiss'),
  copyExport: () => ipcRenderer.invoke('walkthrough:copy-export'),
  saveExport: () => ipcRenderer.invoke('walkthrough:save-export'),
  setTooltipInteractive: (enabled: boolean) =>
    ipcRenderer.send('walkthrough:tooltip-interactive', enabled),
});
