import { assembleSession } from './session-assembly.js';
import {
  deleteSessionPayload,
  getSessionPayload,
  saveSessionPayloadWithCap,
} from './session-store.js';
import { authenticatedFetch, clearStoredAuthTokens, redeemHandoffCode } from './auth.js';
import { clearDataCaptureConsent } from './consent.js';
import { handleExternalAuthMessage } from './external-auth.js';
import {
  WALKTHROUGH_PAYLOAD_KEY,
  WALKTHROUGH_STORAGE_KEY,
  startWalkthrough,
} from './walkthrough-state.js';

const externalAuthHandlers = {
  redeemHandoffCode,
  clearStoredAuthTokens,
  deleteSessionPayload,
  startWalkthroughFromSop,
};

let writeQueue = Promise.resolve();
let lastScreenshotAt = 0;
let lastScreenshot = null;

const SCREENSHOT_THROTTLE_MS = 500;
const SCREENSHOT_FORMAT = 'jpeg';
const SCREENSHOT_QUALITY = 50;
const RECORDED_EVENT_TYPES = new Set(['CLICK', 'NAVIGATION', 'INPUT']);
const URL_PATTERN =
  /\bhttps?:\/\/[^\s)]+|\b(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+(?:\/[^\s)]*)?/i;

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

function normalizeLaunchUrl(value) {
  if (!value) {
    return null;
  }

  const trimmed = String(value)
    .trim()
    .replace(/[.,;:!?]+$/, '');
  if (!trimmed) {
    return null;
  }

  const parseable = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(parseable).toString();
  } catch {
    return null;
  }
}

function inferLaunchUrl(payload) {
  const steps = Array.isArray(payload?.steps) ? payload.steps : [];
  for (const step of steps) {
    const instruction = typeof step?.instruction === 'string' ? step.instruction : '';
    const match = instruction.match(URL_PATTERN);
    const url = normalizeLaunchUrl(match?.[0]);
    if (url) {
      return url;
    }
  }
  return null;
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs?.query?.({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs?.[0] ?? null);
    });
  });
}

async function resolveWalkthroughTab(payload) {
  const launchUrl = inferLaunchUrl(payload);
  if (launchUrl) {
    return chrome.tabs.create({ url: launchUrl, active: true });
  }

  const activeTab = await getActiveTab();
  if (activeTab?.id != null) {
    await chrome.tabs.update(activeTab.id, { active: true });
    return activeTab;
  }

  return chrome.tabs.create({ url: 'about:blank', active: true });
}

async function startWalkthroughFromSop(sopId) {
  const trimmedSopId = typeof sopId === 'string' ? sopId.trim() : '';
  if (!trimmedSopId) {
    throw new Error('Missing SOP id');
  }

  const response = await authenticatedFetch(
    `/api/v1/sops/${encodeURIComponent(trimmedSopId)}/walkthrough`,
  );
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Sign in to the WorkTrace extension before starting walkthroughs.');
    }
    if (response.status === 404) {
      throw new Error('Published SOP not found for this workspace.');
    }
    if (response.status === 422) {
      throw new Error('Walkthrough data is incomplete for this SOP.');
    }
    throw new Error('Could not load walkthrough data.');
  }

  const payload = await response.json();
  if (!Array.isArray(payload?.steps) || payload.steps.length === 0) {
    throw new Error('This SOP has no walkthrough steps.');
  }

  const tab = await resolveWalkthroughTab(payload);
  const nextState = startWalkthrough(
    { status: 'idle', sopId: null, stepIndex: 0, tabId: null },
    trimmedSopId,
    { tabId: tab?.id ?? null },
  );

  await chrome.storage?.session?.set({
    [WALKTHROUGH_STORAGE_KEY]: nextState,
    [WALKTHROUGH_PAYLOAD_KEY]: payload,
  });

  return {
    sopId: trimmedSopId,
    tabId: tab?.id ?? null,
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
    message.type === 'WALKTHROUGH_STEP_LEFT' ||
    message.type === 'WALKTHROUGH_FINISHED'
  ) {
    // H09AAPPLE-30 will persist timing / completion events from these hooks.
    console.log('Walkthrough analytics hook:', message.type, message);
    sendResponse({ ok: true });
    return false;
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
