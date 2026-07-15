/**
 * H09AAPPLE-70 — minimal Electron global-capture feasibility prototype.
 *
 * Set VALIDATION_STEP=1|2|3 to verify incrementally:
 *   1 = uiohook global click/keydown only
 *   2 = + active-win foreground app on each event
 *   3 = + desktopCapturer full-screen screenshot (500ms throttle, extension parity)
 */
const { app, BrowserWindow, desktopCapturer } = require('electron');
const fs = require('fs');
const path = require('path');
const { uIOhook } = require('uiohook-napi');

const SCREENSHOT_THROTTLE_MS = 500;
const SCREENSHOT_THUMBNAIL_SIZE = { width: 1920, height: 1080 };

const VALIDATION_STEP = Number(process.env.VALIDATION_STEP || '3');
const OUTPUT_DIR = path.join(__dirname, 'output');
const SCREENSHOT_DIR = path.join(OUTPUT_DIR, 'screenshots');
const LOG_FILE = path.join(OUTPUT_DIR, 'events.log');

let mainWindow = null;
let lastScreenshotAt = 0;
let lastScreenshotRef = null;
let activeWinSync = null;

function ensureOutputDirs() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

function appendLog(record) {
  const line = `${JSON.stringify(record)}\n`;
  fs.appendFileSync(LOG_FILE, line, 'utf8');
  console.log(line.trim());
}

function loadActiveWinSync() {
  if (VALIDATION_STEP < 2 || activeWinSync) {
    return activeWinSync;
  }

  activeWinSync = require('active-win').sync;
  return activeWinSync;
}

function getForegroundContext() {
  if (VALIDATION_STEP < 2) {
    return { foreground_app: null, window_title: null };
  }

  try {
    const getActiveWindow = loadActiveWinSync();
    // macOS: active-win returns empty title unless screenRecordingPermission is true
    // (see active-win readme). Step 3 already needs Screen Recording for desktopCapturer.
    const win = getActiveWindow({
      accessibilityPermission: true,
      screenRecordingPermission: process.platform === 'darwin',
    });
    if (!win) {
      return { foreground_app: 'unknown', window_title: null };
    }

    return {
      foreground_app: win.owner?.name || win.owner?.path || 'unknown',
      window_title: win.title || null,
    };
  } catch (error) {
    console.warn('active-win failed:', error instanceof Error ? error.message : error);
    return { foreground_app: 'error', window_title: null, active_win_error: String(error) };
  }
}

async function getScreenshotRef() {
  if (VALIDATION_STEP < 3) {
    return null;
  }

  const now = Date.now();
  if (lastScreenshotRef && now - lastScreenshotAt < SCREENSHOT_THROTTLE_MS) {
    return lastScreenshotRef;
  }

  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: SCREENSHOT_THUMBNAIL_SIZE,
    });

    if (!sources.length) {
      console.warn('desktopCapturer returned no screen sources');
      return null;
    }

    const primary =
      sources.find((source) => source.display_id === '0:0' || source.id.startsWith('screen:0')) ||
      sources[0];
    const png = primary.thumbnail.toPNG();
    const screenshotId = `${now}-${Math.random().toString(36).slice(2, 8)}`;
    const filename = `${screenshotId}.png`;
    const filepath = path.join(SCREENSHOT_DIR, filename);

    fs.writeFileSync(filepath, png);
    lastScreenshotAt = now;
    lastScreenshotRef = filepath;
    return filepath;
  } catch (error) {
    console.warn('screenshot capture failed:', error instanceof Error ? error.message : error);
    return null;
  }
}

async function recordEvent(eventType, hookEvent) {
  const timestamp = Date.now();
  const { foreground_app, window_title, active_win_error } = getForegroundContext();
  const screenshot_ref = await getScreenshotRef();

  const record = {
    event_type: eventType,
    timestamp,
    foreground_app,
    window_title,
    screenshot_ref,
  };

  if (active_win_error) {
    record.active_win_error = active_win_error;
  }

  if (eventType === 'CLICK') {
    record.x = hookEvent.x;
    record.y = hookEvent.y;
    record.button = hookEvent.button;
  } else if (eventType === 'KEYDOWN') {
    record.keycode = hookEvent.keycode;
  }

  appendLog(record);
}

function startGlobalHooks() {
  uIOhook.on('click', (event) => {
    if (VALIDATION_STEP === 1) {
      appendLog({
        event_type: 'CLICK',
        timestamp: Date.now(),
        x: event.x,
        y: event.y,
        button: event.button,
        foreground_app: null,
        screenshot_ref: null,
      });
      return;
    }
    void recordEvent('CLICK', event);
  });

  uIOhook.on('keydown', (event) => {
    if (VALIDATION_STEP === 1) {
      appendLog({
        event_type: 'KEYDOWN',
        timestamp: Date.now(),
        keycode: event.keycode,
        foreground_app: null,
        screenshot_ref: null,
      });
      return;
    }
    void recordEvent('KEYDOWN', event);
  });

  uIOhook.start();
  console.log(`[H09AAPPLE-70] uIOhook started (VALIDATION_STEP=${VALIDATION_STEP})`);
}

function createProbeWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 160,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(
    'data:text/html;charset=utf-8,' +
      encodeURIComponent(
        '<!doctype html><title>WorkTrace capture POC</title><body style="font-family:sans-serif;padding:16px"><h1>Capture POC</h1><p>Window stays hidden/minimized. Global hooks log to output/events.log</p></body>',
      ),
  );

  mainWindow.once('ready-to-show', () => {
    mainWindow.hide();
    console.log('[H09AAPPLE-70] Electron window hidden — testing capture without focus');
  });
}

app.whenReady().then(() => {
  ensureOutputDirs();
  createProbeWindow();
  startGlobalHooks();
  console.log(`[H09AAPPLE-70] Logging to ${LOG_FILE}`);
  console.log('[H09AAPPLE-70] Click/type in other apps to generate events. Ctrl+C to stop.');
});

app.on('before-quit', () => {
  try {
    uIOhook.stop();
  } catch {
    // ignore shutdown races
  }
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
});
