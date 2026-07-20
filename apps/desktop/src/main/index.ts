import { DEFAULT_SENSITIVE_APP_PATTERNS, saveSensitiveAppConfig } from '@h09a/desktop-storage';
import { existsSync } from 'node:fs';
import { app, BrowserWindow, dialog, ipcMain, screen, shell } from 'electron';
import { join, resolve } from 'node:path';
import { DesktopSessionStore } from './desktop-session-store';
import { RecordingService, type RecorderState } from './recording-service';
import { handleProtocolUrl } from './auth/handoff-handler';
import { launchHandoff } from './auth/handoff-launcher';
import { loadTokens } from './auth/token-store';
import { startHandoffServer, stopHandoffServer } from './auth/handoff-server';
import { hasCurrentConsent, saveConsent } from './consent/consent-store';
import { postConsentAccept } from './consent/consent-service';
import { getCurrentAuth, logout } from './auth/auth-service';
import { WEB_APP_URL } from './config';
import { submitSession } from './session/submission-service';
import { fetchWalkthroughPayload } from './walkthrough/payload-client';
import { parseWalkthroughProtocolSopId } from './walkthrough/protocol';
import { normalizeWalkthroughSopId } from './walkthrough/sop-id';
import { WalkthroughService } from './walkthrough/walkthrough-service';
import { readFile } from 'node:fs/promises';
import type { CompletedLocalSession } from './desktop-session-store';

let sessionStore: DesktopSessionStore | undefined;
let recordingService: RecordingService | undefined;
let walkthroughService: WalkthroughService | undefined;
let recorderWindow: BrowserWindow | undefined;
let lastCompletedSession: CompletedLocalSession | null = null;
let servicesReady = false;
const pendingProtocolUrls: string[] = [];
let walkthroughStartInFlight: Promise<void> | null = null;
let windowDragState:
  | {
      startCursor: { x: number; y: number };
      startWindow: { x: number; y: number };
    }
  | undefined;

type WindowMode = 'compact' | 'expanded';
type WalkthroughStartSource = 'http' | 'protocol' | 'ipc';

const WINDOW_SIZES: Record<WindowMode, { width: number; height: number }> = {
  compact: { width: 88, height: 88 },
  expanded: { width: 440, height: 460 },
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

function notifyRenderer(message: string): void {
  if (!recorderWindow || recorderWindow.isDestroyed()) {
    return;
  }
  recorderWindow.webContents.send('desktop:notice', { message });
  if (recorderWindow.isMinimized()) {
    recorderWindow.restore();
  }
  recorderWindow.show();
  recorderWindow.focus();
}

async function showWalkthroughError(message: string): Promise<void> {
  console.error('[walkthrough]', message);
  notifyRenderer(message);
  try {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Walkthrough',
      message: 'Could not start walkthrough',
      detail: message,
    });
  } catch {
    // dialog may fail before app is fully ready; renderer notice is enough
  }
}

async function confirmProtocolWalkthrough(sopId: string): Promise<boolean> {
  const result = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Start walkthrough', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    title: 'Start walkthrough?',
    message: 'A page requested a WorkTrace walkthrough.',
    detail: `SOP: ${sopId}\n\nOnly continue if you just clicked Start walkthrough in WorkTrace.`,
  });
  return result.response === 0;
}

async function startWalkthroughBySopId(
  rawSopId: string,
  source: WalkthroughStartSource,
): Promise<void> {
  const run = async (): Promise<void> => {
    if (!walkthroughService) {
      throw new Error('Walkthrough service is not ready');
    }

    if (recordingService?.getState() === 'recording') {
      throw new Error('Stop recording before starting a walkthrough');
    }

    const auth = getCurrentAuth();
    if (!auth) {
      throw new Error('Sign in to the desktop app before starting a walkthrough');
    }

    if (!hasCurrentConsent(auth.userId)) {
      throw new Error('Accept data capture consent in desktop before starting a walkthrough');
    }

    const sopId = normalizeWalkthroughSopId(rawSopId);

    if (source === 'protocol') {
      const confirmed = await confirmProtocolWalkthrough(sopId);
      if (!confirmed) {
        throw new Error('Walkthrough start cancelled');
      }
    }

    if (walkthroughService.getUiState().status === 'playing') {
      const replace = await dialog.showMessageBox({
        type: 'question',
        buttons: ['Replace current', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        title: 'Walkthrough already running',
        message: 'Replace the current walkthrough?',
      });
      if (replace.response !== 0) {
        throw new Error('Walkthrough start cancelled');
      }
      await walkthroughService.dismiss();
    }

    const payload = await fetchWalkthroughPayload(sopId);
    await walkthroughService.start(payload);
    notifyRenderer(`Walkthrough started (${source}).`);
  };

  if (walkthroughStartInFlight) {
    await walkthroughStartInFlight.catch(() => undefined);
  }
  walkthroughStartInFlight = run().finally(() => {
    walkthroughStartInFlight = null;
  });
  await walkthroughStartInFlight;
}

/**
 * Auth handoff (`worktrace://auth-callback`) or walkthrough launch
 * (`worktrace://walkthrough?sopId=...`).
 */
async function dispatchProtocolUrl(url: string): Promise<void> {
  if (!servicesReady) {
    pendingProtocolUrls.push(url);
    console.info('[protocol] queued until services are ready');
    return;
  }

  try {
    const handledAuth = await handleProtocolUrl(url);
    if (handledAuth) {
      notifyRenderer('Signed in via browser handoff.');
      return;
    }

    const sopId = parseWalkthroughProtocolSopId(url);
    if (!sopId) {
      console.warn('[protocol] ignored unsupported worktrace URL:', url);
      return;
    }

    console.info('[walkthrough] starting from protocol URL, sopId=', sopId);
    await startWalkthroughBySopId(sopId, 'protocol');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message !== 'Walkthrough start cancelled') {
      await showWalkthroughError(message);
    }
  }
}

async function flushPendingProtocolUrls(): Promise<void> {
  const queued = pendingProtocolUrls.splice(0, pendingProtocolUrls.length);
  for (const url of queued) {
    await dispatchProtocolUrl(url);
  }
}

/**
 * Registers the `worktrace://` protocol handler.
 *
 * In dev mode, electron-vite launches Electron as `electron.exe .`
 * (it loads the project directory, then internally requires
 * out/main/index.js) - so process.argv[1] is just "." and is NOT
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
      void dispatchProtocolUrl(protocolUrl);
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
      const auth = getCurrentAuth();
      if (!auth) {
        throw new Error('Desktop is not authenticated');
      }

      if (!hasCurrentConsent(auth.userId)) {
        throw new Error('Consent required');
      }

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

    const completed = lastCompletedSession;
    const result = await submitSession(completed.artifactPath);

    if (!result.success || !result.sessionId) {
      return {
        ...result,
        generatingUrl: null,
        browserOpened: false,
      };
    }

    const generatingUrl = new URL(
      `/session/${result.sessionId}/generating`,
      WEB_APP_URL,
    ).toString();

    // Open the Generate page before deleting the local artifact so a browser
    // failure still leaves the user with a recoverable local session.
    let browserOpened = false;
    try {
      console.info('[submit] opening SOP generation page:', generatingUrl);
      await shell.openExternal(generatingUrl);
      browserOpened = true;
    } catch (error) {
      console.error('[submit] failed to open Generate page:', error);
    }

    if (sessionStore) {
      sessionStore.markSubmitted(completed.sessionId);
      await sessionStore.deleteCompletedSession(completed.sessionId, completed.sessionDirectory);
      lastCompletedSession = null;
    }

    return {
      ...result,
      generatingUrl,
      browserOpened,
    };
  });

  ipcMain.handle('walkthrough:start', async (_event, sopId: string) => {
    try {
      await startWalkthroughBySopId(String(sopId ?? ''), 'ipc');
      return walkthroughService?.getUiState();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== 'Walkthrough start cancelled') {
        await showWalkthroughError(message);
      }
      throw error;
    }
  });

  ipcMain.handle('walkthrough:previous', async () => {
    if (!walkthroughService) {
      throw new Error('Walkthrough service is not ready');
    }
    return walkthroughService.previous();
  });

  ipcMain.handle('walkthrough:next', async () => {
    if (!walkthroughService) {
      throw new Error('Walkthrough service is not ready');
    }
    return walkthroughService.next();
  });

  ipcMain.handle('walkthrough:finish', async () => {
    if (!walkthroughService) {
      throw new Error('Walkthrough service is not ready');
    }
    return walkthroughService.finish();
  });

  ipcMain.handle('walkthrough:dismiss', async () => {
    await walkthroughService?.dismiss();
    return { ok: true };
  });

  ipcMain.handle('walkthrough:get-state', () => {
    if (!walkthroughService) {
      return {
        status: 'idle',
        sopId: null,
        stepIndex: 0,
        stepCount: 0,
        instruction: '',
        eyebrow: 'Walkthrough',
        screenshotUrl: null,
        fallbackNote: null,
        highlight: null,
        previousDisabled: true,
        isLastStep: false,
        exportAvailable: false,
        exportPreview: null,
        error: null,
      };
    }
    return walkthroughService.getUiState();
  });

  ipcMain.handle('walkthrough:copy-export', async () => {
    if (!walkthroughService) {
      return { ok: false, error: 'Walkthrough service is not ready' };
    }
    return walkthroughService.copyExport();
  });

  ipcMain.handle('walkthrough:save-export', async () => {
    if (!walkthroughService) {
      return { ok: false, error: 'Walkthrough service is not ready' };
    }
    return walkthroughService.saveExport();
  });

  ipcMain.handle('walkthrough:voice', async (_event, transcript: string) => {
    if (!walkthroughService) {
      throw new Error('Walkthrough service is not ready');
    }
    return walkthroughService.handleVoiceTranscript(String(transcript ?? ''));
  });

  ipcMain.on('walkthrough:tooltip-interactive', (_event, enabled: boolean) => {
    walkthroughService?.setTooltipHitTesting(Boolean(enabled));
  });

  ipcMain.on('walkthrough:ui-nav-guard', () => {
    walkthroughService?.armUiNavigationGuard();
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

  app.on('open-url', (event, url) => {
    event.preventDefault();
    void dispatchProtocolUrl(url);
  });

  app.on('before-quit', () => {
    void walkthroughService?.dismiss();
    stopHandoffServer();
    recordingService?.stop();
    sessionStore?.close();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  void app.whenReady().then(async () => {
    registerProtocolClient();

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
    walkthroughService = new WalkthroughService();

    startHandoffServer({
      onStartWalkthrough: async (sopId) => {
        await startWalkthroughBySopId(sopId, 'http');
      },
    });

    createWindow();
    servicesReady = true;
    await flushPendingProtocolUrls();

    // Protocol cold-start must run after walkthroughService exists.
    const protocolUrl = process.argv.find((arg) => arg.startsWith('worktrace://'));
    if (protocolUrl) {
      await dispatchProtocolUrl(protocolUrl);
    }

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
