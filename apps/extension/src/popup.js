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

function render() {
  const isRecording = state.status === RecordingStatus.RECORDING;

  workflowNameInput.value = state.workflowName;
  workflowNameInput.disabled = isRecording;
  startButton.disabled = !canStartRecording(state);
  stopButton.disabled = !canStopRecording(state);
  statusText.textContent = statusLabels[state.status];
  statusBadge.className = `status-badge status-${state.status}`;

  if (isRecording) {
    workflowHint.textContent = `Recording "${state.workflowName}" in this popup.`;
  } else if (state.status === RecordingStatus.COMPLETED) {
    workflowHint.textContent = 'Capture completed. You can edit the name and start again.';
  } else {
    workflowHint.textContent = 'Required before recording can start.';
  }
}

workflowNameInput.addEventListener('input', (event) => {
  state = setWorkflowName(state, event.target.value);
  render();
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  state = startRecording(state);
  render();
});

stopButton.addEventListener('click', () => {
  state = stopRecording(state);
  render();
});

render();
