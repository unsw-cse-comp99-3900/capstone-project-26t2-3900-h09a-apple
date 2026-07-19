import { app, BrowserWindow, ipcMain, screen, shell } from 'electron';
import { join, resolve } from 'node:path';
import { DesktopSessionStore } from './desktop-session-store';
import { RecordingService, type RecorderState } from './recording-service';
import { handleProtocolUrl } from './auth/handoff-handler';
import { launchHandoff } from './auth/handoff-launcher';
import { loadTokens } from './auth/token-store';
import { startHandoffServer, stopHandoffServer } from './auth/handoff-server';
import { hasCurrentConsent, saveConsent } from './consent/consent-store';
import { postConsentAccept } from './consent/consent-service';
import { logout } from './auth/auth-service';
import { submitSession } from './session/submission-service';
import { readFile } from 'node:fs/promises';
import type { CompletedLocalSession } from './desktop-session-store';

let sessionStore: DesktopSessionStore | undefined;
let recordingService: RecordingService | undefined;
let recorderWindow: BrowserWindow | undefined;
let lastCompletedSession: CompletedLocalSession | null = null;
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
    sessionPath: lastCompletedSession?.artifactPath ?? null,
    error,
  };
}

/**
 * Registers the `worktrace://` protocol handler.
 *
 * In dev mode, electron-vite launches Electron as `electron.exe .`
 * (it loads the project directory, then internally requires
 * out/main/index.js) — so process.argv[1] is just "." and is NOT
 * a usable entry path for protocol registration.
 *
 * __dirname, on the other hand, always points to the directory this
 * running module lives in (out/main), regardless of how Electron was
 * launched, so it's used here instead to reliably locate the entry
 * script for the registered protocol command.
 */
function registerProtocolClient(): void {
  if (process.defaultApp) {
    app.setAsDefaultProtocolClient('worktrace', process.execPath, [resolve(process.cwd())]);
  } else {
    // Packaged production build: electron.exe itself IS the app,
    // no extra entry path argument needed.
    app.setAsDefaultProtocolClient('worktrace');
  }
}

// --- Single instance lock: must happen as early as possible, before any
// windows are created, so a second launch (e.g. triggered by a protocol
// handoff while the app is already running) hands its URL off to the
// existing instance instead of spawning a second app window. ---
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    console.log('second-instance fired');
    console.log(commandLine);

    const protocolUrl = commandLine.find((arg) => arg.startsWith('worktrace://'));

    console.log('protocolUrl:', protocolUrl);

    if (protocolUrl) {
      void handleProtocolUrl(protocolUrl).catch((error) => {
        console.error('Failed to handle protocol URL (second-instance):', error);
      });
    }

    if (recorderWindow) {
      if (recorderWindow.isMinimized()) {
        recorderWindow.restore();
      }
      recorderWindow.show();
      recorderWindow.focus();
    }
  });

  ipcMain.handle('auth:launch-handoff', async () => {
    try {
      await launchHandoff();

      return {
        ok: true,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Exposes current auth state to the renderer so the UI can show
  // "Sign in" vs. an authenticated state without guessing.
  ipcMain.handle('auth:get-status', async () => {
    try {
      const tokens = await loadTokens();
      return {
        authenticated: tokens !== null,
      };
    } catch (error) {
      console.error('Failed to load auth tokens:', error);
      return {
        authenticated: false,
      };
    }
  });

  ipcMain.handle('auth:logout', async () => {
    logout();

    return {
      ok: true,
    };
  });

  ipcMain.handle('recording:get-status', () => getRecordingStatus());

  ipcMain.handle('recording:start', () => {
    try {
      if (!recordingService) {
        throw new Error('The recording service is not ready');
      }

      lastCompletedSession = null;
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

      lastCompletedSession = recordingService.stop();
      return getRecordingStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return getRecordingStatus(message);
    }
  });

  ipcMain.handle('recording:get-review', async () => {
    if (!lastCompletedSession) {
      throw new Error('No completed recording session available');
    }

    const content = await readFile(lastCompletedSession.artifactPath, 'utf8');
    const session = JSON.parse(content);

    const started = new Date(session.started_at).getTime();
    const stopped = new Date(session.stopped_at).getTime();

    return {
      workflowName: session.workflow_name,
      durationSeconds: Math.max(0, Math.round((stopped - started) / 1000)),
      eventCount: session.events.length,
    };
  });

  ipcMain.handle('recording:review', async () => {
    if (!lastCompletedSession) {
      return getRecordingStatus('Complete a recording before reviewing a session');
    }

    const error = await shell.openPath(lastCompletedSession.artifactPath);
    return getRecordingStatus(error || null);
  });

  ipcMain.handle('recording:submit', async () => {
    if (!lastCompletedSession) {
      throw new Error('No completed recording session available');
    }

    const result = await submitSession(lastCompletedSession.artifactPath);

    if (result.success && sessionStore) {
      await sessionStore.deleteCompletedSession(
        lastCompletedSession.sessionId,
        lastCompletedSession.sessionDirectory,
      );

      lastCompletedSession = null;
    }

    return result;
  });

  ipcMain.handle('consent:get-status', async () => {
    const tokens = await loadTokens();

    if (!tokens) {
      return {
        authenticated: false,
        accepted: false,
      };
    }

    return {
      authenticated: true,
      accepted: hasCurrentConsent(tokens.userId),
    };
  });

  ipcMain.handle('consent:accept', async () => {
    const tokens = await loadTokens();

    if (!tokens) {
      throw new Error('Desktop is not authenticated');
    }

    const result = await postConsentAccept();

    saveConsent(tokens.userId, result.accepted_at);

    return {
      accepted: true,
    };
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

  app.on('open-url', async (event, url) => {
    event.preventDefault();

    try {
      await handleProtocolUrl(url);
    } catch (error) {
      console.error('Failed to handle protocol URL (open-url):', error);
    }
  });

  app.on('before-quit', () => {
    stopHandoffServer();
  });

  void app.whenReady().then(async () => {
    registerProtocolClient();
    startHandoffServer();

    const protocolUrl = process.argv.find((arg) => arg.startsWith('worktrace://'));

    if (protocolUrl) {
      try {
        await handleProtocolUrl(protocolUrl);
      } catch (error) {
        console.error('Failed to handle startup protocol URL:', error);
      }
    }

    const userDataDirectory = app.getPath('userData');
    sessionStore = new DesktopSessionStore(
      join(userDataDirectory, 'worktrace.sqlite'),
      join(userDataDirectory, 'sessions'),
    );
    recordingService = new RecordingService(sessionStore);

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

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
