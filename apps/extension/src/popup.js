import {
  RecordingStatus,
  canStartRecording,
  canStopRecording,
  createRecordingState,
  setWorkflowName,
  startRecording,
  stopRecording,
} from './recording-state.js';
import { WEB_APP_BASE_URL } from './config.js';
import { AUTH_STORAGE_KEYS, hasStoredAuthTokens } from './auth.js';
import { isConsentCurrent, readDataCaptureConsent, saveDataCaptureConsent } from './consent.js';

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

const statusLabels = {
  [RecordingStatus.READY]: 'Ready',
  [RecordingStatus.RECORDING]: 'Recording',
  [RecordingStatus.COMPLETED]: 'Completed',
};

let state = createRecordingState();
let eventCount = 0;
let reviewSessionReady = false;
let consentRecord = null;
let isAuthenticated = false;
let authReady = false;

function openSignInPage() {
  chrome.tabs.create({ url: new URL('/login', WEB_APP_BASE_URL).toString() });
}

function setPanelVisibility(authenticated) {
  authSection.hidden = authenticated;
  recordingSection.hidden = !authenticated;
}

async function refreshAuthState() {
  isAuthenticated = await hasStoredAuthTokens();
  render();
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

  if (area === 'local') {
    if (
      changes[AUTH_STORAGE_KEYS.accessToken] ||
      changes[AUTH_STORAGE_KEYS.refreshToken] ||
      changes[AUTH_STORAGE_KEYS.expiresAt]
    ) {
      void refreshAuthState();
    }

    if (state.client_session_id) {
      const storageKey = `session_${state.client_session_id}`;

      if (changes[storageKey]?.newValue) {
        reviewSessionReady = true;
        render();
      }
    }
  }
});

function checkReviewSessionReady() {
  if (state.status !== RecordingStatus.COMPLETED || !state.client_session_id) {
    reviewSessionReady = false;
    render();
    return;
  }

  const storageKey = `session_${state.client_session_id}`;
  chrome.storage?.local.get([storageKey], (result) => {
    reviewSessionReady = Boolean(result[storageKey]);
    render();
  });
}

function openReviewPage() {
  const reviewUrl = new URL('/session/review', WEB_APP_BASE_URL);
  reviewUrl.searchParams.set('id', state.client_session_id);

  chrome.tabs.create({ url: reviewUrl.toString() });
}

function showConsentModal() {
  consentDeclineMessage.hidden = true;
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

  workflowNameInput.value = state.workflowName;
  workflowNameInput.disabled = isRecording;
  startButton.disabled = !canStartRecording(state);
  stopButton.disabled = !canStopRecording(state);
  reviewButton.hidden = !isCompleted;
  reviewButton.disabled = !canReview;
  reviewButton.textContent = canReview ? 'Review Session' : 'Preparing Session...';
  statusText.textContent = statusLabels[state.status];
  statusBadge.className = `status-badge status-${state.status}`;

  if (isRecording) {
    workflowHint.textContent = `Recording "${state.workflowName}" in progress. Captured ${eventCount} events.`;
  } else if (state.status === RecordingStatus.COMPLETED) {
    workflowHint.textContent = `Capture completed (${eventCount} events). You can edit the name and start again.`;
  } else if (!hasConsent) {
    workflowHint.textContent = 'Accept the data capture agreement before recording can start.';
  } else {
    workflowHint.textContent = 'Required before recording can start.';
  }
}

function updateState(newState) {
  state = newState;
  if (state.status !== RecordingStatus.COMPLETED) {
    reviewSessionReady = false;
  }
  chrome.storage?.local.set({ recordingState: state });
  render();
}

async function beginRecording() {
  eventCount = 0;
  await chrome.storage?.session?.set({ eventBuffer: [] });
  updateState(startRecording(state));
}

workflowNameInput.addEventListener('input', (event) => {
  updateState(setWorkflowName(state, event.target.value));
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!isConsentCurrent(consentRecord)) {
    showConsentModal();
    return;
  }

  await beginRecording();
});

consentAcceptButton.addEventListener('click', () => {
  saveDataCaptureConsent((record) => {
    consentRecord = record;
    hideConsentModal();
    render();
  });
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
  isAuthenticated = await hasStoredAuthTokens();
  authReady = true;

  readDataCaptureConsent((consent) => {
    consentRecord = consent;
    render();
  });

  chrome.storage?.local.get(['recordingState'], (result) => {
    if (result.recordingState) {
      state = result.recordingState;
      checkReviewSessionReady();
    } else {
      render();
    }
  });

  chrome.storage?.session?.get(['eventBuffer'], (result) => {
    if (result.eventBuffer) {
      eventCount = result.eventBuffer.length;
      render();
    }
  });

  render();
}

void initPopup();
