import {
  RecordingStatus,
  canStartRecording,
  canStopRecording,
  createRecordingState,
  setWorkflowName,
  startRecording,
  stopRecording,
} from './recording-state.js';

const form = document.querySelector('#recordingForm');
const workflowNameInput = document.querySelector('#workflowName');
const workflowHint = document.querySelector('#workflowHint');
const startButton = document.querySelector('#startButton');
const stopButton = document.querySelector('#stopButton');
const statusBadge = document.querySelector('#statusBadge');
const statusText = document.querySelector('#statusText');

const statusLabels = {
  [RecordingStatus.READY]: 'Ready',
  [RecordingStatus.RECORDING]: 'Recording',
  [RecordingStatus.COMPLETED]: 'Completed',
};

let state = createRecordingState();
let eventCount = 0;

// When opening a pop-up window, restore the state from the local storage first
chrome.storage?.local.get(['recordingState'], (result) => {
  if (result.recordingState) {
    state = result.recordingState;
    render();
  }
});

// Read the total number of events in session storage and render
chrome.storage?.session?.get(['eventBuffer'], (result) => {
  if (result.eventBuffer) {
    eventCount = result.eventBuffer.length;
    render();
  }
});

// Continuously monitor the changes in the number of events during the recording period
chrome.storage?.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.eventBuffer) {
    eventCount = changes.eventBuffer.newValue?.length || 0;
    render();
  }
});

function render() {
  const isRecording = state.status === RecordingStatus.RECORDING;

  workflowNameInput.value = state.workflowName;
  workflowNameInput.disabled = isRecording;
  startButton.disabled = !canStartRecording(state);
  stopButton.disabled = !canStopRecording(state);
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
  chrome.storage?.local.set({ recordingState: state });
  render();
}

workflowNameInput.addEventListener('input', (event) => {
  updateState(setWorkflowName(state, event.target.value));
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  updateState(startRecording(state));
  eventCount = 0; // resert event count
  chrome.storage?.session?.set({ eventBuffer: [] }); // Clear the previous buffer when starting a new recording
});

stopButton.addEventListener('click', () => {
  updateState(stopRecording(state));
});

render();
