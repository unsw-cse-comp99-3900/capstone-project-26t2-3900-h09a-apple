import { DEFAULT_SENSITIVE_APP_PATTERNS, saveSensitiveAppConfig } from '@h09a/desktop-storage';
import { existsSync } from 'node:fs';
import { app, BrowserWindow, ipcMain, screen, shell } from 'electron';
import { join } from 'node:path';
import { DesktopSessionStore } from './desktop-session-store';
import { RecordingService, type RecorderState } from './recording-service';

let sessionStore: DesktopSessionStore | undefined;
let recordingService: RecordingService | undefined;
let recorderWindow: BrowserWindow | undefined;
let lastSessionPath: string | null = null;
let windowDragState:
  | {
      startCursor: { x: number; y: number };
      startWindow: { x: number; y: number };
    }
  | undefined;

type WindowMode = 'compact' | 'expanded';

const WINDOW_SIZES: Record<WindowMode, { width: number; height: number }> = {
  compact: { width: 88, height: 88 },
  expanded: { width: 440, height: 370 },
};

interface RecordingStatus {
  ok: boolean;
  state: RecorderState;
  eventCount: number;
  sessionPath: string | null;
  error: string | null;
}

function getRecordingStatus(error: string | null = null): RecordingStatus {
  return {
    ok: error === null,
    state: recordingService?.getState() ?? 'idle',
    eventCount: recordingService?.getEventCount() ?? 0,
    sessionPath: lastSessionPath,
    error,
  };
}

ipcMain.handle('recording:get-status', () => getRecordingStatus());

ipcMain.handle('recording:start', () => {
  try {
    if (!recordingService) {
      throw new Error('The recording service is not ready');
    }

    lastSessionPath = null;
    recordingService.start();
    return getRecordingStatus();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return getRecordingStatus(message);
  }
});

ipcMain.handle('recording:stop', () => {
  try {
    if (!recordingService) {
      throw new Error('The recording service is not ready');
    }

    lastSessionPath = recordingService.stop();
    return getRecordingStatus();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return getRecordingStatus(message);
  }
});

ipcMain.handle('recording:review', async () => {
  if (!lastSessionPath) {
    return getRecordingStatus('Complete a recording before reviewing a session');
  }

  const error = await shell.openPath(lastSessionPath);
  return getRecordingStatus(error || null);
});

ipcMain.handle('window:set-mode', (_event, mode: WindowMode) => {
  if (mode !== 'compact' && mode !== 'expanded') {
    throw new Error(`Unsupported recorder window mode: ${String(mode)}`);
  }

  setRecorderWindowMode(mode);
  return mode;
});

ipcMain.handle('window:close', () => {
  app.quit();
});

ipcMain.on('window:drag-start', (event) => {
  if (!recorderWindow || event.sender !== recorderWindow.webContents) return;

  const cursor = screen.getCursorScreenPoint();
  const bounds = recorderWindow.getBounds();
  windowDragState = {
    startCursor: cursor,
    startWindow: { x: bounds.x, y: bounds.y },
  };
});

ipcMain.on('window:drag-move', (event) => {
  if (!recorderWindow || event.sender !== recorderWindow.webContents || !windowDragState) return;

  const cursor = screen.getCursorScreenPoint();
  recorderWindow.setPosition(
    windowDragState.startWindow.x + cursor.x - windowDragState.startCursor.x,
    windowDragState.startWindow.y + cursor.y - windowDragState.startCursor.y,
    false,
  );
});

ipcMain.on('window:drag-end', (event) => {
  if (!recorderWindow || event.sender !== recorderWindow.webContents) return;
  windowDragState = undefined;
});

function setRecorderWindowMode(mode: WindowMode): void {
  if (!recorderWindow) return;

  const currentBounds = recorderWindow.getBounds();
  const workArea = screen.getDisplayMatching(currentBounds).workArea;
  const size = WINDOW_SIZES[mode];
  const maximumX = workArea.x + workArea.width - size.width;
  const maximumY = workArea.y + workArea.height - size.height;

  recorderWindow.setBounds(
    {
      x: Math.min(Math.max(currentBounds.x, workArea.x), maximumX),
      y: Math.min(Math.max(currentBounds.y, workArea.y), maximumY),
      width: size.width,
      height: size.height,
    },
    true,
  );
}

function createWindow(): void {
  recorderWindow = new BrowserWindow({
    ...WINDOW_SIZES.compact,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    title: 'WorkTrace Desktop',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  recorderWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  recorderWindow.on('closed', () => {
    windowDragState = undefined;
    recorderWindow = undefined;
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void recorderWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void recorderWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

void app.whenReady().then(() => {
  const userDataDirectory = app.getPath('userData');
  const sensitiveAppsConfigPath = join(userDataDirectory, 'sensitive-apps.json');

  if (!existsSync(sensitiveAppsConfigPath)) {
    saveSensitiveAppConfig(sensitiveAppsConfigPath, DEFAULT_SENSITIVE_APP_PATTERNS);
  }

  sessionStore = new DesktopSessionStore(
    join(userDataDirectory, 'worktrace.sqlite'),
    join(userDataDirectory, 'sessions'),
  );
  recordingService = new RecordingService(sessionStore, sensitiveAppsConfigPath);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  recordingService?.stop();
  sessionStore?.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
