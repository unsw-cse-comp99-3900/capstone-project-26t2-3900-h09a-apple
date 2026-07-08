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
import {
  isConsentCurrent,
  readDataCaptureConsent,
  saveDataCaptureConsent,
} from './consent.js';

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
let pendingRecordingStart = false;

chrome.storage?.local.get(['recordingState'], (result) => {
  if (result.recordingState) {
    state = result.recordingState;
    checkReviewSessionReady();
  }
});

readDataCaptureConsent((consent) => {
  consentRecord = consent;
  render();
});

chrome.storage?.session?.get(['eventBuffer'], (result) => {
  if (result.eventBuffer) {
    eventCount = result.eventBuffer.length;
    render();
  }
});

chrome.storage?.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.eventBuffer) {
    eventCount = changes.eventBuffer.newValue?.length || 0;
    render();
  }

  if (area === 'local' && state.client_session_id) {
    const storageKey = `session_${state.client_session_id}`;

    if (changes[storageKey]?.newValue) {
      reviewSessionReady = true;
      render();
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
    pendingRecordingStart = true;
    showConsentModal();
    return;
  }

  await beginRecording();
});

consentAcceptButton.addEventListener('click', async () => {
  saveDataCaptureConsent(async (record) => {
    consentRecord = record;
    hideConsentModal();

    if (pendingRecordingStart) {
      pendingRecordingStart = false;
      await beginRecording();
      return;
    }

    render();
  });
});

consentDeclineButton.addEventListener('click', () => {
  pendingRecordingStart = false;
  consentDeclineMessage.hidden = false;
});

consentOverlay.addEventListener('click', (event) => {
  if (event.target === consentOverlay) {
    pendingRecordingStart = false;
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

render();
