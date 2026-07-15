import { assembleSession } from './session-assembly.js';
import {
  deleteSessionPayload,
  getSessionPayload,
  saveSessionPayloadWithCap,
} from './session-store.js';
import {
  authenticatedFetch,
  clearStoredAuthTokens,
  redeemHandoffCode,
} from './auth.js';
import { clearDataCaptureConsent } from './consent.js';
import { handleExternalAuthMessage } from './external-auth.js';

const externalAuthHandlers = {
  redeemHandoffCode,
  clearStoredAuthTokens,
  deleteSessionPayload,
};

let writeQueue = Promise.resolve();
let lastScreenshotAt = 0;
let lastScreenshot = null;

const SCREENSHOT_THROTTLE_MS = 500;
const SCREENSHOT_FORMAT = 'jpeg';
const SCREENSHOT_QUALITY = 50;
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

  if (!tab?.windowId || !tab?.active) {
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
  if (message.type === 'EXTENSION_HANDOFF') {
    redeemHandoffCode(message.code)
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to redeem handoff code',
        });
      });

    return true;
  }

  if (message.type === 'EXTENSION_LOGOUT') {
    clearStoredAuthTokens()
      .then(
        () =>
          new Promise((resolve) => {
            clearDataCaptureConsent(resolve);
          }),
      )
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to clear extension auth',
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

  if (message.type === 'SESSION_SUBMITTED') {
    deleteSessionPayload(message.sessionId)
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to delete submitted session',
        });
      });

    return true;
  }

  if (message.type === 'GET_TAB_ID') {
    sendResponse({
      ok: true,
      tabId: sender.tab?.id ?? null,
    });
    return false;
  }

  if (
    message.type === 'WALKTHROUGH_STEP_ENTERED' ||
    message.type === 'WALKTHROUGH_STEP_LEFT'
  ) {
    console.log('Walkthrough analytics hook:', message.type, message);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'WALKTHROUGH_FINISHED') {
    (async () => {
      try {
        const durationMs = (message.step_timings ?? []).reduce(
          (total, step) => total + (step.duration_ms ?? 0),
          0,
        );

        const response = await authenticatedFetch(
          '/api/v1/walkthroughs/complete',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              sop_id: message.sopId,
              completed_at: new Date().toISOString(),
              duration_seconds: Math.round(durationMs / 1000),
              friction_events: message.friction_events ?? [],
              step_timings: message.step_timings ?? [],
            }),
          },
        );

        if (!response.ok) {
          throw new Error(`Completion upload failed: ${response.status}`);
        }

        const body = await response.json();

        console.log(
          'Walkthrough completion uploaded:',
          body.completion_id,
        );

        sendResponse({
          ok: true,
          completionId: body.completion_id,
        });
      } catch (error) {
        console.error('Failed to upload walkthrough completion:', error);
        sendResponse({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to upload walkthrough completion',
        });
      }
    })();

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

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) =>
  handleExternalAuthMessage(message, sender, sendResponse, externalAuthHandlers),
);

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

          await saveSessionPayloadWithCap(sessionPayload);
          await resetSessionBuffers();
          await chrome.storage.local.remove('sessionStorageError');
          chrome.runtime
            .sendMessage({
              type: 'SESSION_PAYLOAD_READY',
              sessionId: sessionPayload.client_session_id,
            })
            .catch(() => {});
          console.log(
            'Structured session assembled and saved to IndexedDB:',
            sessionPayload.client_session_id,
          );
        })
        .catch((err) => {
          const message =
            err instanceof Error ? err.message : 'Captured session could not be saved locally.';
          chrome.storage.local.set({
            sessionStorageError: `Could not save captured session locally: ${message}`,
          });
          chrome.runtime
            .sendMessage({
              type: 'SESSION_PAYLOAD_ERROR',
              error: message,
            })
            .catch(() => {});
          console.error('Failed to assemble session:', err);
        });
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
