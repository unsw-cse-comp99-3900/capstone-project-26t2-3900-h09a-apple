import { assembleSession } from './session-assembly.js';
import {
  clearActiveSessionBuffers,
  getActiveSessionBuffers,
  getSessionPayload,
  saveActiveSessionBuffers,
  saveSessionPayload,
} from './local-db.js';

let writeQueue = Promise.resolve();
let lastScreenshotAt = 0;
let lastScreenshot = null;

const SCREENSHOT_THROTTLE_MS = 2000;
const SCREENSHOT_FORMAT = 'jpeg';
const SCREENSHOT_QUALITY = 20;
const MAX_SCREENSHOTS_PER_SESSION = 25;
const RECORDED_EVENT_TYPES = new Set(['CLICK', 'NAVIGATION', 'INPUT']);
const SESSION_SCREENSHOT_SAVE_LIMITS = [25, 10, 0];

function resetSessionBuffers() {
  lastScreenshotAt = 0;
  lastScreenshot = null;
  return Promise.all([
    clearActiveSessionBuffers(),
    chrome.storage?.session.set({ eventCount: 0 }),
  ]);
}

function parseScreenshotDataUrl(dataUrl) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl);
  if (!match) {
    return null;
  }

  return {
    content_type: match[1],
    data_base64: match[2],
  };
}

function isQuotaExceededError(error) {
  return error instanceof Error && /quota/i.test(error.message);
}

function limitSessionScreenshots(sessionPayload, screenshotLimit) {
  if (sessionPayload.screenshots.length <= screenshotLimit) {
    return sessionPayload;
  }

  const keptScreenshots = sessionPayload.screenshots.slice(0, screenshotLimit);
  const keptScreenshotIds = new Set(keptScreenshots.map((screenshot) => screenshot.id));
  const events = sessionPayload.events.map((event) => {
    if (!event.screenshot_id || keptScreenshotIds.has(event.screenshot_id)) {
      return event;
    }

    return {
      ...event,
      screenshot_id: null,
    };
  });

  return {
    ...sessionPayload,
    events,
    screenshots: keptScreenshots,
  };
}

async function saveSessionPayloadWithinQuota(sessionPayload) {
  let lastError;

  for (const screenshotLimit of SESSION_SCREENSHOT_SAVE_LIMITS) {
    const payloadToSave = limitSessionScreenshots(sessionPayload, screenshotLimit);

    try {
      await saveSessionPayload(payloadToSave.client_session_id, payloadToSave);
      return payloadToSave;
    } catch (error) {
      if (!isQuotaExceededError(error)) {
        throw error;
      }

      lastError = error;
      console.warn(
        `Session payload exceeded local quota with ${payloadToSave.screenshots.length} screenshots.`,
      );
    }
  }

  throw lastError || new Error('Failed to save session payload');
}

async function getScreenshotForEvent(tab, existingScreenshots = []) {
  const now = Date.now();
  const canReuseLastScreenshot =
    lastScreenshot &&
    now - lastScreenshotAt < SCREENSHOT_THROTTLE_MS &&
    existingScreenshots.some((screenshot) => screenshot.id === lastScreenshot.id);

  if (canReuseLastScreenshot) {
    return {
      screenshot: null,
      screenshotId: lastScreenshot.id,
    };
  }

  if (!tab?.windowId || !tab?.active) {
    return { screenshot: null, screenshotId: null };
  }

  if (existingScreenshots.length >= MAX_SCREENSHOTS_PER_SESSION) {
    return { screenshot: null, screenshotId: null };
  }

  lastScreenshotAt = now;

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: SCREENSHOT_FORMAT,
      quality: SCREENSHOT_QUALITY,
    });

    const parsed = parseScreenshotDataUrl(dataUrl);
    if (!parsed) {
      return { screenshot: null, screenshotId: null };
    }

    const screenshot = {
      id: crypto.randomUUID(),
      ...parsed,
    };

    lastScreenshot = screenshot;

    return {
      screenshot,
      screenshotId: screenshot.id,
    };
  } catch (error) {
    console.warn('Failed to capture screenshot:', error);
    return { screenshot: null, screenshotId: null };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'RESET_SESSION_BUFFERS') {
    resetSessionBuffers()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to reset session buffers',
        });
      });

    return true;
  }

  if (message.type === 'GET_SESSION_PAYLOAD') {
    getSessionPayload(message.sessionId)
      .then((session) => {
        sendResponse({
          ok: true,
          session: session || null,
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to read session payload',
        });
      });

    return true;
  }

  if (RECORDED_EVENT_TYPES.has(message.type)) {
    writeQueue = writeQueue
      .then(async () => {
        const result = await getActiveSessionBuffers();

        const { screenshot, screenshotId } = await getScreenshotForEvent(
          sender.tab,
          result.screenshots,
        );

        const payload = {
          ...message.payload,
          ...(screenshotId ? { screenshot_id: screenshotId } : {}),
        };
        const newEvent = {
          type: message.type,
          payload,
          tabId: sender.tab?.id,
          receivedAt: Date.now(),
        };

        const eventBuffer = [...result.eventBuffer, newEvent];
        const screenshots = screenshot ? [...result.screenshots, screenshot] : result.screenshots;

        await saveActiveSessionBuffers({ eventBuffer, screenshots });
        await chrome.storage.session.set({ eventCount: eventBuffer.length });

        console.log('Event buffered in session:', newEvent);
      })
      .catch((error) => console.error('Failed to write event to storage:', error));
  }

  return false;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.recordingState) {
    const oldState = changes.recordingState.oldValue;
    const newState = changes.recordingState.newValue;

    if (oldState?.status === 'recording' && newState?.status === 'completed') {
      writeQueue = writeQueue
        .then(async () => {
          const result = await getActiveSessionBuffers();
          const sessionPayload = assembleSession(result.eventBuffer, {
            client_session_id: oldState.client_session_id,
            workflowName: oldState.workflowName,
            startedAt: oldState.startedAt,
            stoppedAt: Date.now(),
            screenshots: result.screenshots,
          });
          const readyKey = `sessionReady_${sessionPayload.client_session_id}`;

          await clearActiveSessionBuffers();
          const savedPayload = await saveSessionPayloadWithinQuota(sessionPayload);
          await chrome.storage.local.set({ [readyKey]: true });
          await chrome.storage?.session.set({ eventCount: 0 });
          lastScreenshotAt = 0;
          lastScreenshot = null;
          console.log(
            'Structured session assembled and saved locally:',
            readyKey,
            `${savedPayload.screenshots.length} screenshots`,
          );
        })
        .catch((err) => console.error('Failed to assemble session:', err));
    }
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage?.local.set({ recordingState: { status: 'ready', workflowName: '' } });
  resetSessionBuffers();
  chrome.storage?.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage?.local.set({ recordingState: { status: 'ready', workflowName: '' } });
  resetSessionBuffers();
});
