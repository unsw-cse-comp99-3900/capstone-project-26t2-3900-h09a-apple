import {
  RecordingStatus,
  canStartRecording,
  canStopRecording,
  createRecordingState,
  setWorkflowName,
  startRecording,
  stopRecording,
} from './recording-state.js';
import {
  WALKTHROUGH_PAYLOAD_KEY,
  WALKTHROUGH_STORAGE_KEY,
  WalkthroughStatus,
  canStartWalkthrough,
  canStopWalkthrough,
  createWalkthroughState,
  startWalkthrough,
  stopWalkthrough,
} from './walkthrough-state.js';
import { WEB_APP_BASE_URL } from './config.js';
import { AUTH_STORAGE_KEYS, authenticatedFetch, getStoredAuthTokens } from './auth.js';
import {
  clearDataCaptureConsent,
  isConsentCurrent,
  postConsentAccept,
  saveDataCaptureConsent,
  syncConsentFromServer,
} from './consent.js';
import { hasSessionPayload } from './session-store.js';

const authSection = document.querySelector('#authSection');
const recordingSection = document.querySelector('#recordingSection');
const signInButton = document.querySelector('#signInButton');
const footerText = document.querySelector('#footerText');
const form = document.querySelector('#recordingForm');
const workflowNameInput = document.querySelector('#workflowName');
const workflowHint = document.querySelector('#workflowHint');
const startButton = document.querySelector('#startButton');
const stopButton = document.querySelector('#stopButton');
const reviewButton = document.querySelector('#reviewButton');
const statusBadge = document.querySelector('#statusBadge');
const statusText = document.querySelector('#statusText');
const consentOverlay = document.querySelector('#consentOverlay');
const consentDeclineMessage = document.querySelector('#consentDeclineMessage');
const consentAcceptButton = document.querySelector('#consentAcceptButton');
const consentDeclineButton = document.querySelector('#consentDeclineButton');
const sopIdInput = document.querySelector('#sopIdInput');
const walkthroughHint = document.querySelector('#walkthroughHint');
const startWalkthroughButton = document.querySelector('#startWalkthroughButton');
const stopWalkthroughButton = document.querySelector('#stopWalkthroughButton');
const walkthroughBadge = document.querySelector('#walkthroughBadge');
const walkthroughStatusText = document.querySelector('#walkthroughStatusText');

const statusLabels = {
  [RecordingStatus.READY]: 'Ready',
  [RecordingStatus.RECORDING]: 'Recording',
  [RecordingStatus.COMPLETED]: 'Completed',
};

const walkthroughStatusLabels = {
  [WalkthroughStatus.IDLE]: 'Idle',
  [WalkthroughStatus.PLAYING]: 'Playing',
};

let state = createRecordingState();
let walkthroughState = createWalkthroughState();
let walkthroughStepCount = 0;
let walkthroughBusy = false;
let eventCount = 0;
let reviewSessionReady = false;
let consentRecord = null;
let isAuthenticated = false;
let authReady = false;
let currentUserId = null;
let sessionStorageError = null;

function getLocalStorage(keys) {
  return new Promise((resolve) => {
    chrome.storage?.local.get(keys, resolve);
  });
}

function getSessionStorage(keys) {
  return new Promise((resolve) => {
    chrome.storage?.session?.get(keys, resolve);
  });
}

function openSignInPage() {
  chrome.tabs.create({ url: new URL('/login', WEB_APP_BASE_URL).toString() });
}

function setPanelVisibility(authenticated) {
  authSection.hidden = authenticated;
  recordingSection.hidden = !authenticated;
}

function clearLocalConsent() {
  return new Promise((resolve) => {
    clearDataCaptureConsent(() => {
      consentRecord = null;
      resolve();
    });
  });
}

async function syncConsentForCurrentUser({ renderAfter = true } = {}) {
  try {
    consentRecord = await syncConsentFromServer();
  } catch {
    // Keep the local consent cache when the status endpoint is unreachable.
  }
  if (renderAfter) {
    render();
  }
}

async function refreshAuthState({ renderAfter = true } = {}) {
  const tokens = await getStoredAuthTokens();
  const wasAuthenticated = isAuthenticated;
  const previousUserId = currentUserId;
  isAuthenticated = Boolean(tokens.accessToken && tokens.refreshToken);
  currentUserId = tokens.userId ?? null;

  if (!isAuthenticated) {
    // Drop cached consent on logout so the next account cannot reuse it.
    await clearLocalConsent();
    consentRecord = null;
    if (renderAfter) {
      render();
    }
    return;
  }

  // Authentication changed to a different user.
  // Do not keep the previous user's cached consent while waiting for
  // the backend consent status to be refreshed.
  if (previousUserId !== currentUserId) {
    await clearLocalConsent();
    consentRecord = null;
  }

  // Fresh login with the same user after the popup starts.
  if (!wasAuthenticated) {
    consentRecord = null;
  }

  if (renderAfter) {
    render();
  }
  await syncConsentForCurrentUser({ renderAfter });
}

signInButton.addEventListener('click', () => {
  openSignInPage();
});

window.addEventListener('focus', () => {
  void refreshAuthState();
});

chrome.storage?.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.eventBuffer) {
    eventCount = changes.eventBuffer.newValue?.length || 0;
    render();
  }

  if (area === 'session') {
    if (changes[WALKTHROUGH_STORAGE_KEY]) {
      walkthroughState = changes[WALKTHROUGH_STORAGE_KEY].newValue ?? createWalkthroughState();
      render();
    }
    if (changes[WALKTHROUGH_PAYLOAD_KEY]) {
      walkthroughStepCount = changes[WALKTHROUGH_PAYLOAD_KEY].newValue?.steps?.length || 0;
      render();
    }
  }

  if (area === 'local' && state.client_session_id) {
    if (changes.recordingState?.newValue?.status === RecordingStatus.COMPLETED) {
      checkReviewSessionReady();
    }
  }

  if (area === 'local') {
    if (
      changes[AUTH_STORAGE_KEYS.accessToken] ||
      changes[AUTH_STORAGE_KEYS.refreshToken] ||
      changes[AUTH_STORAGE_KEYS.expiresAt] ||
      changes[AUTH_STORAGE_KEYS.userId]
    ) {
      void refreshAuthState();
    }
  }
});

chrome.runtime?.onMessage?.addListener((message) => {
  if (message.type === 'SESSION_PAYLOAD_READY' && message.sessionId === state.client_session_id) {
    sessionStorageError = null;
    reviewSessionReady = true;
    render();
  }

  if (message.type === 'SESSION_PAYLOAD_ERROR') {
    sessionStorageError =
      message.error || 'Captured session could not be saved locally. Try recording again.';
    reviewSessionReady = false;
    render();
  }
});

async function checkReviewSessionReady() {
  if (state.status !== RecordingStatus.COMPLETED || !state.client_session_id) {
    reviewSessionReady = false;
    render();
    return;
  }

  try {
    reviewSessionReady = await hasSessionPayload(state.client_session_id);
    sessionStorageError = reviewSessionReady
      ? null
      : 'Preparing session payload. If this does not clear, stop and record again.';
    render();
  } catch (error) {
    console.warn('Failed to check session payload readiness:', error);
    sessionStorageError =
      error instanceof Error
        ? `Could not read captured session locally: ${error.message}`
        : 'Could not read captured session locally.';
    reviewSessionReady = false;
    render();
  }
}

function openReviewPage() {
  const reviewUrl = new URL('/session/review', WEB_APP_BASE_URL);
  reviewUrl.searchParams.set('id', state.client_session_id);

  chrome.tabs.create({ url: reviewUrl.toString() });
}

function showConsentModal() {
  consentDeclineMessage.hidden = true;
  consentDeclineMessage.textContent =
    'Recording stays disabled without consent. You can review this agreement again before starting a session.';
  consentOverlay.hidden = false;
}

function hideConsentModal() {
  consentOverlay.hidden = true;
  consentDeclineMessage.hidden = true;
}

function render() {
  if (!authReady) {
    return;
  }

  setPanelVisibility(isAuthenticated);
  footerText.textContent = isAuthenticated
    ? 'This preview keeps recording state on your device only.'
    : 'Sign in through the web app to connect this extension to your workspace.';

  if (!isAuthenticated) {
    return;
  }

  const isRecording = state.status === RecordingStatus.RECORDING;
  const isCompleted =
    state.status === RecordingStatus.COMPLETED && Boolean(state.client_session_id);
  const canReview = isCompleted && reviewSessionReady;
  const hasConsent = isConsentCurrent(consentRecord);
  const isWalkthroughPlaying = walkthroughState.status === WalkthroughStatus.PLAYING;

  workflowNameInput.value = state.workflowName;
  workflowNameInput.disabled = isRecording || isWalkthroughPlaying;
  startButton.disabled = !canStartRecording(state) || isWalkthroughPlaying;
  stopButton.disabled = !canStopRecording(state);
  reviewButton.hidden = !isCompleted;
  reviewButton.disabled = !canReview;
  reviewButton.textContent = canReview ? 'Review Session' : 'Preparing Session...';
  statusText.textContent = statusLabels[state.status];
  statusBadge.className = `status-badge status-${state.status}`;

  if (sopIdInput) {
    sopIdInput.value = walkthroughState.sopId ?? sopIdInput.value;
    sopIdInput.disabled = isWalkthroughPlaying || isRecording || walkthroughBusy;
  }

  if (startWalkthroughButton) {
    startWalkthroughButton.disabled =
      walkthroughBusy ||
      !canStartWalkthrough(walkthroughState, sopIdInput?.value ?? '', { isRecording });
  }
  if (stopWalkthroughButton) {
    stopWalkthroughButton.disabled = walkthroughBusy || !canStopWalkthrough(walkthroughState);
  }
  if (walkthroughStatusText) {
    walkthroughStatusText.textContent = walkthroughStatusLabels[walkthroughState.status] ?? 'Idle';
  }
  if (walkthroughBadge) {
    walkthroughBadge.className = `status-badge status-${
      isWalkthroughPlaying ? 'recording' : 'ready'
    }`;
  }

  if (isRecording) {
    workflowHint.textContent = `Recording "${state.workflowName}" in progress. Captured ${eventCount} events.`;
  } else if (state.status === RecordingStatus.COMPLETED) {
    workflowHint.textContent =
      sessionStorageError ??
      `Capture completed (${eventCount} events). You can edit the name and start again.`;
  } else if (!hasConsent) {
    workflowHint.textContent = 'Accept the data capture agreement before recording can start.';
  } else if (isWalkthroughPlaying) {
    workflowHint.textContent = 'Stop the walkthrough before starting a new recording.';
  } else {
    workflowHint.textContent = 'Required before recording can start.';
  }

  if (walkthroughHint) {
    if (walkthroughBusy) {
      walkthroughHint.textContent = 'Loading walkthrough steps…';
    } else if (isWalkthroughPlaying) {
      walkthroughHint.textContent = `Playing step ${walkthroughState.stepIndex + 1} of ${
        walkthroughStepCount || '?'
      }. Use Previous / Next on the page overlay.`;
    } else if (isRecording) {
      walkthroughHint.textContent = 'Stop recording before starting a walkthrough.';
    } else {
      walkthroughHint.textContent =
        'Starts an overlay on the current tab. Progress is kept for this browser session.';
    }
  }
}

function updateState(newState) {
  state = newState;
  if (state.status !== RecordingStatus.COMPLETED) {
    reviewSessionReady = false;
    sessionStorageError = null;
  }
  chrome.storage?.local.set({ recordingState: state });
  render();
}

async function beginRecording() {
  eventCount = 0;
  await chrome.storage?.session?.set({ eventBuffer: [] });
  updateState(startRecording(state));
}

async function beginWalkthrough() {
  const sopId = sopIdInput?.value?.trim() ?? '';
  if (
    !canStartWalkthrough(walkthroughState, sopId, {
      isRecording: state.status === RecordingStatus.RECORDING,
    })
  ) {
    return;
  }

  walkthroughBusy = true;
  render();

  try {
    const response = await authenticatedFetch(
      `/api/v1/sops/${encodeURIComponent(sopId)}/walkthrough`,
    );
    if (!response.ok) {
      const detail =
        response.status === 404
          ? 'Published SOP not found for this workspace.'
          : response.status === 422
            ? 'Walkthrough data is incomplete for this SOP.'
            : 'Could not load walkthrough data.';
      if (walkthroughHint) {
        walkthroughHint.textContent = detail;
      }
      return;
    }

    const payload = await response.json();
    if (!Array.isArray(payload?.steps) || payload.steps.length === 0) {
      if (walkthroughHint) {
        walkthroughHint.textContent = 'This SOP has no walkthrough steps.';
      }
      return;
    }

    const tabId = await new Promise((resolve) => {
      chrome.tabs?.query?.({ active: true, currentWindow: true }, (tabs) => {
        resolve(tabs?.[0]?.id ?? null);
      });
    });

    const nextState = startWalkthrough(walkthroughState, sopId, { tabId });
    walkthroughState = nextState;
    walkthroughStepCount = payload.steps.length;
    await chrome.storage?.session?.set({
      [WALKTHROUGH_STORAGE_KEY]: nextState,
      [WALKTHROUGH_PAYLOAD_KEY]: payload,
    });
    render();
  } catch (error) {
    if (walkthroughHint) {
      walkthroughHint.textContent =
        error instanceof Error ? error.message : 'Could not start walkthrough.';
    }
  } finally {
    walkthroughBusy = false;
    render();
  }
}

async function endWalkthrough() {
  if (!canStopWalkthrough(walkthroughState)) {
    return;
  }

  walkthroughState = stopWalkthrough();
  walkthroughStepCount = 0;
  await chrome.storage?.session?.set({
    [WALKTHROUGH_STORAGE_KEY]: walkthroughState,
    [WALKTHROUGH_PAYLOAD_KEY]: null,
  });
  render();
}

workflowNameInput.addEventListener('input', (event) => {
  updateState(setWorkflowName(state, event.target.value));
});

sopIdInput?.addEventListener('input', () => {
  render();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (walkthroughState.status === WalkthroughStatus.PLAYING) {
    return;
  }

  if (!isConsentCurrent(consentRecord)) {
    showConsentModal();
    return;
  }

  await beginRecording();
});

consentAcceptButton.addEventListener('click', () => {
  void (async () => {
    consentAcceptButton.disabled = true;
    try {
      const result = await postConsentAccept();
      saveDataCaptureConsent(result.accepted_at, (record) => {
        consentRecord = record;
        hideConsentModal();
        render();
      });
    } catch {
      consentDeclineMessage.hidden = false;
      consentDeclineMessage.textContent =
        'Could not record consent. Please try again after signing in.';
    } finally {
      consentAcceptButton.disabled = false;
    }
  })();
});

consentDeclineButton.addEventListener('click', () => {
  consentDeclineMessage.hidden = false;
});

consentOverlay.addEventListener('click', (event) => {
  if (event.target === consentOverlay) {
    hideConsentModal();
    render();
  }
});

stopButton.addEventListener('click', () => {
  updateState(stopRecording(state));
  checkReviewSessionReady();
});

startWalkthroughButton?.addEventListener('click', () => {
  void beginWalkthrough();
});

stopWalkthroughButton?.addEventListener('click', () => {
  void endWalkthrough();
});

reviewButton.addEventListener('click', () => {
  if (
    state.status !== RecordingStatus.COMPLETED ||
    !state.client_session_id ||
    !reviewSessionReady
  ) {
    return;
  }

  openReviewPage();
});

async function initPopup() {
  authReady = true;
  await refreshAuthState({ renderAfter: false });

  const [localState, sessionState] = await Promise.all([
    getLocalStorage(['recordingState', 'sessionStorageError']),
    getSessionStorage(['eventBuffer', WALKTHROUGH_STORAGE_KEY, WALKTHROUGH_PAYLOAD_KEY]),
  ]);

  if (localState.recordingState) {
    state = localState.recordingState;
  }

  sessionStorageError = localState.sessionStorageError ?? null;

  if (sessionState.eventBuffer) {
    eventCount = sessionState.eventBuffer.length;
  }

  if (sessionState[WALKTHROUGH_STORAGE_KEY]) {
    walkthroughState = sessionState[WALKTHROUGH_STORAGE_KEY];
  }
  walkthroughStepCount = sessionState[WALKTHROUGH_PAYLOAD_KEY]?.steps?.length || 0;

  if (state.status === RecordingStatus.COMPLETED) {
    await checkReviewSessionReady();
    return;
  }

  render();
}

void initPopup();
