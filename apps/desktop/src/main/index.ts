import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { RecordingService } from './recording-service';

const recordingService = new RecordingService();

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 640,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

void app.whenReady().then(() => {
  createWindow();

  try {
    recordingService.start();
  } catch {
    // Keep the UI open when the native hook cannot start. A later UI step will
    // surface this capture or permission error to the user.
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  recordingService.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
