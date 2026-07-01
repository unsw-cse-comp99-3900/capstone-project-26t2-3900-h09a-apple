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

const form = document.querySelector('#recordingForm');
const workflowNameInput = document.querySelector('#workflowName');
const workflowHint = document.querySelector('#workflowHint');
const startButton = document.querySelector('#startButton');
const stopButton = document.querySelector('#stopButton');
const reviewButton = document.querySelector('#reviewButton');
const statusBadge = document.querySelector('#statusBadge');
const statusText = document.querySelector('#statusText');

const statusLabels = {
  [RecordingStatus.READY]: 'Ready',
  [RecordingStatus.RECORDING]: 'Recording',
  [RecordingStatus.COMPLETED]: 'Completed',
};

let state = createRecordingState();
let eventCount = 0;
let reviewSessionReady = false;

// When opening a pop-up window, restore the state from the local storage first
chrome.storage?.local.get(['recordingState'], (result) => {
  if (result.recordingState) {
    state = result.recordingState;
    checkReviewSessionReady();
  }
});

// Read the total number of events in session storage and render
chrome.storage?.session?.get(['eventCount'], (result) => {
  if (Number.isInteger(result.eventCount)) {
    eventCount = result.eventCount;
    render();
  }
});

// Continuously monitor the changes in the number of events during the recording period
chrome.storage?.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.eventCount) {
    eventCount = changes.eventCount.newValue || 0;
    render();
  }

  if (area === 'local' && state.client_session_id) {
    const readyKey = `sessionReady_${state.client_session_id}`;

    if (changes[readyKey]?.newValue) {
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

  const readyKey = `sessionReady_${state.client_session_id}`;
  chrome.storage?.local.get([readyKey], (result) => {
    reviewSessionReady = Boolean(result[readyKey]);
    render();
  });
}

function openReviewPage() {
  const reviewUrl = new URL('/session/review', WEB_APP_BASE_URL);
  reviewUrl.searchParams.set('id', state.client_session_id);

  chrome.tabs.create({ url: reviewUrl.toString() });
}

function render() {
  const isRecording = state.status === RecordingStatus.RECORDING;
  const isCompleted =
    state.status === RecordingStatus.COMPLETED && Boolean(state.client_session_id);
  const canReview = isCompleted && reviewSessionReady;

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
  } else {
    workflowHint.textContent = 'Required before recording can start.';
  }
}

// A unified status update entry point, which updates memory and persists to storage simultaneously
function updateState(newState) {
  state = newState;
  if (state.status !== RecordingStatus.COMPLETED) {
    reviewSessionReady = false;
  }
  chrome.storage?.local.set({ recordingState: state });
  render();
}

workflowNameInput.addEventListener('input', (event) => {
  updateState(setWorkflowName(state, event.target.value));
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  eventCount = 0; // resert event count
  await chrome.runtime?.sendMessage({ type: 'RESET_SESSION_BUFFERS' });
  updateState(startRecording(state));
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
