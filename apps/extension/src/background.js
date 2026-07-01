import { assembleSession } from './session-assembly.js';

let writeQueue = Promise.resolve();
let lastScreenshotAt = 0;
let lastScreenshot = null;

const SCREENSHOT_THROTTLE_MS = 500;
const SCREENSHOT_FORMAT = 'jpeg';
const SCREENSHOT_QUALITY = 70;
const RECORDED_EVENT_TYPES = new Set(['CLICK', 'NAVIGATION', 'INPUT']);

function resetSessionBuffers() {
  lastScreenshotAt = 0;
  lastScreenshot = null;
  return chrome.storage?.session.set({ eventBuffer: [], screenshots: [] });
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

  if (!tab?.windowId) {
    return { screenshot: null, screenshotId: null };
  }

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
    lastScreenshotAt = now;

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
  if (message.type === 'GET_SESSION_PAYLOAD') {
    const storageKey = `session_${message.sessionId}`;

    chrome.storage.local
      .get([storageKey])
      .then((result) => {
        sendResponse({
          ok: true,
          session: result[storageKey] || null,
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
        const result = await chrome.storage.session.get({
          eventBuffer: [],
          screenshots: [],
        });

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

        await chrome.storage.session.set({
          eventBuffer: [...result.eventBuffer, newEvent],
          screenshots: screenshot ? [...result.screenshots, screenshot] : result.screenshots,
        });

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
          const result = await chrome.storage.session.get({
            eventBuffer: [],
            screenshots: [],
          });
          const sessionPayload = assembleSession(result.eventBuffer, {
            client_session_id: oldState.client_session_id,
            workflowName: oldState.workflowName,
            startedAt: oldState.startedAt,
            stoppedAt: Date.now(),
            screenshots: result.screenshots,
          });
          const storageKey = `session_${sessionPayload.client_session_id}`;

          await chrome.storage.local.set({ [storageKey]: sessionPayload });
          await resetSessionBuffers();
          console.log('Structured session assembled and saved locally:', storageKey);
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
