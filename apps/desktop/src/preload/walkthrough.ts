import { contextBridge, ipcRenderer } from 'electron';

function withNavGuard<T>(invoke: () => Promise<T>): Promise<T> {
  // Fire before invoke so the global click hook cannot race Previous/Next.
  ipcRenderer.send('walkthrough:ui-nav-guard');
  return invoke();
}

contextBridge.exposeInMainWorld('walkthroughAPI', {
  onState: (handler: (state: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => handler(state);
    ipcRenderer.on('walkthrough:state', listener);
    return () => ipcRenderer.removeListener('walkthrough:state', listener);
  },
  onCaptureCloak: (handler: (cloaked: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, cloaked: boolean) => handler(cloaked);
    ipcRenderer.on('walkthrough:capture-cloak', listener);
    return () => ipcRenderer.removeListener('walkthrough:capture-cloak', listener);
  },
  getState: () => ipcRenderer.invoke('walkthrough:get-state'),
  notifyReady: () => ipcRenderer.send('walkthrough:renderer-ready'),
  previous: () => withNavGuard(() => ipcRenderer.invoke('walkthrough:previous')),
  next: () => withNavGuard(() => ipcRenderer.invoke('walkthrough:next')),
  finish: () => withNavGuard(() => ipcRenderer.invoke('walkthrough:finish')),
  dismiss: () => ipcRenderer.invoke('walkthrough:dismiss'),
  copyExport: () => ipcRenderer.invoke('walkthrough:copy-export'),
  saveExport: () => ipcRenderer.invoke('walkthrough:save-export'),
  setTooltipInteractive: (enabled: boolean) =>
    ipcRenderer.send('walkthrough:tooltip-interactive', enabled),
});
