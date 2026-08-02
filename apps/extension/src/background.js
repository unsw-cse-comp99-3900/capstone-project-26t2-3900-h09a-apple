import { assembleSession } from './session-assembly.js';
import {
  deleteSessionPayload,
  getSessionPayload,
  saveSessionPayloadWithCap,
} from './session-store.js';
import { authenticatedFetch, clearStoredAuthTokens, redeemHandoffCode } from './auth.js';
import { clearDataCaptureConsent } from './consent.js';
import { handleExternalAuthMessage } from './external-auth.js';
import { buildVisionCacheKey } from './vision-locate.js';
import {
  WALKTHROUGH_PAYLOAD_KEY,
  WALKTHROUGH_STORAGE_KEY,
  startWalkthrough,
} from './walkthrough-state.js';
import {
  ensureWalkthroughPage,
  inferLaunchUrl,
  syncWalkthroughToTab,
  waitForTabComplete,
} from './walkthrough-launch.js';
import { serializeFrictionEvents } from './walkthrough-completion.js';

const externalAuthHandlers = {
  redeemHandoffCode,
  clearStoredAuthTokens,
  deleteSessionPayload,
  startWalkthroughFromSop,
};

let writeQueue = Promise.resolve();
let lastScreenshotAt = 0;
let lastScreenshot = null;

/** @type {Map<string, { x: number, y: number, width: number, height: number }>} */
const visionLocateCache = new Map();

const SCREENSHOT_THROTTLE_MS = 500;
const SCREENSHOT_FORMAT = 'jpeg';
const SCREENSHOT_QUALITY = 50;
const VISION_CAPTURE_QUALITY = 70;
const RECORDED_EVENT_TYPES = new Set(['CLICK', 'NAVIGATION', 'INPUT']);

async function locateElementViaVision(message, sender) {
  const tabId = message.tabId ?? sender.tab?.id ?? null;
  const cacheKey = buildVisionCacheKey({
    sopId: message.sopId,
    stepNumber: message.stepNumber,
    tabId,
    pageKey: message.pageKey,
  });

  if (visionLocateCache.has(cacheKey)) {
    return {
      ok: true,
      cached: true,
      rect: visionLocateCache.get(cacheKey),
    };
  }

  if (!tabId) {
    throw new Error('Missing tab id for vision locate');
  }

  const description = typeof message.description === 'string' ? message.description.trim() : '';
  if (!description) {
    throw new Error('Missing element description for vision locate');
  }

  const tab = await chrome.tabs.get(tabId);
  if (!tab?.windowId) {
    throw new Error('Walkthrough tab is not available for capture');
  }

  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: SCREENSHOT_FORMAT,
    quality: VISION_CAPTURE_QUALITY,
  });

  const response = await authenticatedFetch('/api/v1/walkthroughs/locate-element', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      image_base64: dataUrl,
      content_type: 'image/jpeg',
      description,
      instruction: message.instruction ?? null,
      viewport_width: message.viewportWidth,
      viewport_height: message.viewportHeight,
      step_number: message.stepNumber ?? null,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Vision locate failed (${response.status}): ${detail.slice(0, 200)}`);
  }

  const body = await response.json();
  const rect = {
    x: Number(body.x),
    y: Number(body.y),
    width: Number(body.width),
    height: Number(body.height),
  };

  visionLocateCache.set(cacheKey, rect);
  return {
    ok: true,
    cached: false,
    rect,
    coarse_cell: body.coarse_cell,
    fine_cell: body.fine_cell,
    method: body.method,
  };
}

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

function base64ToBlob(base64, contentType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: contentType || 'application/octet-stream' });
}

async function uploadWalkthroughVoiceFeedback(message) {
  const sopId = typeof message.sopId === 'string' ? message.sopId.trim() : '';
  const audioBase64 = typeof message.audioBase64 === 'string' ? message.audioBase64.trim() : '';
  const contentType =
    typeof message.contentType === 'string' && message.contentType.trim()
      ? message.contentType.trim()
      : 'audio/webm';
  const filename =
    typeof message.filename === 'string' && message.filename.trim()
      ? message.filename.trim()
      : 'feedback.webm';

  if (!sopId) {
    throw new Error('Missing SOP id for voice upload');
  }
  if (!audioBase64) {
    throw new Error('Missing audio payload for voice upload');
  }

  const audioBlob = base64ToBlob(audioBase64, contentType);
  if (audioBlob.size < 1) {
    throw new Error('Recorded audio is empty');
  }

  const form = new FormData();
  form.append('audio', audioBlob, filename);
  form.append('sop_id', sopId);
  if (typeof message.recordedAt === 'string' && message.recordedAt.trim()) {
    form.append('recorded_at', message.recordedAt.trim());
  }

  const response = await authenticatedFetch('/api/v1/feedback/voice', {
    method: 'POST',
    body: form,
  });

  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 401) {
      throw new Error('Sign in to the WorkTrace extension before sending voice feedback.');
    }
    throw new Error(
      detail?.trim()
        ? `Voice upload failed (${response.status}): ${detail.slice(0, 200)}`
        : `Voice upload failed (${response.status})`,
    );
  }

  const payload = await response.json();
  return {
    feedbackId: payload.feedback_id ?? null,
    transcript: payload.transcript ?? '',
    classification: payload.classification ?? null,
    status: payload.status ?? null,
    durationSeconds: payload.duration_seconds ?? null,
  };
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

  const launchUrl = inferLaunchUrl(payload);
  if (!launchUrl) {
    throw new Error(
      'This walkthrough has no start page URL. Re-publish the SOP from a session that recorded page URLs.',
    );
  }

  const tab = await chrome.tabs.create({ url: launchUrl, active: true });
  const nextState = startWalkthrough(
    { status: 'idle', sopId: null, stepIndex: 0, tabId: null },
    trimmedSopId,
    { tabId: tab?.id ?? null },
  );

  await chrome.storage?.session?.set({
    [WALKTHROUGH_STORAGE_KEY]: nextState,
    [WALKTHROUGH_PAYLOAD_KEY]: payload,
  });

  if (tab?.id != null) {
    await waitForTabComplete(chrome.tabs, tab.id);
    await syncWalkthroughToTab(chrome.tabs, tab.id);
  }

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

  if (message.type === 'WALKTHROUGH_ASSISTANT_ASK') {
    authenticatedFetch('/api/v1/assistant/walkthrough', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        question: message.question,
        mode: message.mode ?? 'walkthrough',
        page_url: message.page_url ?? null,
        step: {
          index: message.step?.index ?? 0,
          total: message.step?.total ?? 1,
          title: message.step?.title ?? 'Current step',
          instruction: message.step?.instruction ?? '',
        },
      }),
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Assistant request failed');
        }

        const payload = await response.json();

        sendResponse({
          ok: true,
          answer: payload.answer ?? '',
        });
      })
      .catch((error) => {
        console.error('Walkthrough assistant request failed:', error);
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Assistant request failed',
        });
      });

    return true;
  }

  if (message.type === 'WALKTHROUGH_VOICE_UPLOAD') {
    uploadWalkthroughVoiceFeedback(message)
      .then((payload) => {
        sendResponse({
          ok: true,
          ...payload,
        });
      })
      .catch((error) => {
        console.error('Walkthrough voice upload failed:', error);
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Voice upload failed',
        });
      });

    return true;
  }

  if (message.type === 'WALKTHROUGH_VISION_LOCATE') {
    locateElementViaVision(message, sender)
      .then((result) => {
        sendResponse(result);
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Vision locate failed',
        });
      });
    return true;
  }

  if (message.type === 'WALKTHROUGH_ENSURE_PAGE') {
    ensureWalkthroughPage(
      chrome.tabs,
      chrome.storage,
      { stateKey: WALKTHROUGH_STORAGE_KEY },
      message.url,
      message.tabId ?? sender.tab?.id ?? null,
    )
      .then((tab) => {
        sendResponse({ ok: true, tabId: tab?.id ?? null });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to open walkthrough page',
        });
      });
    return true;
  }

  if (message.type === 'WALKTHROUGH_VISION_CACHE_CLEAR') {
    visionLocateCache.clear();
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'WALKTHROUGH_STEP_ENTERED' || message.type === 'WALKTHROUGH_STEP_LEFT') {
    console.log('Walkthrough analytics hook:', message.type, message);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'WALKTHROUGH_FINISHED') {
    visionLocateCache.clear();
    (async () => {
      try {
        const durationMs = (message.step_timings ?? []).reduce(
          (total, step) => total + (step.duration_ms ?? 0),
          0,
        );

        const response = await authenticatedFetch('/api/v1/walkthroughs/complete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sop_id: message.sopId,
            completed_at: new Date().toISOString(),
            duration_seconds: Math.round(durationMs / 1000),
            friction_events: serializeFrictionEvents(message.friction_events),
            step_timings: message.step_timings ?? [],
            step_sequence: message.step_sequence ?? [],
          }),
        });

        if (!response.ok) {
          throw new Error(`Completion upload failed: ${response.status}`);
        }

        const body = await response.json();

        console.log('Walkthrough completion uploaded:', body.completion_id);

        sendResponse({
          ok: true,
          completionId: body.completion_id,
        });
      } catch (error) {
        console.error('Failed to upload walkthrough completion:', error);
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to upload walkthrough completion',
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
