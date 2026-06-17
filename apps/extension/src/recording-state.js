export const RecordingStatus = Object.freeze({
  READY: 'ready',
  RECORDING: 'recording',
  COMPLETED: 'completed',
});

export function createRecordingState(workflowName = '') {
  return {
    workflowName,
    status: RecordingStatus.READY,
  };
}

export function canStartRecording(state) {
  return state.status !== RecordingStatus.RECORDING && state.workflowName.trim().length > 0;
}

export function canStopRecording(state) {
  return state.status === RecordingStatus.RECORDING;
}

export function setWorkflowName(state, workflowName) {
  if (state.status === RecordingStatus.RECORDING) {
    return state;
  }

  return {
    ...state,
    workflowName,
  };
}

export function startRecording(state) {
  if (!canStartRecording(state)) {
    return state;
  }

  return {
    ...state,
    workflowName: state.workflowName.trim(),
    status: RecordingStatus.RECORDING,
    client_session_id: crypto.randomUUID(), // Unique session ID
    startedAt: Date.now(), // Baseline start time
  };
}

export function stopRecording(state) {
  if (!canStopRecording(state)) {
    return state;
  }

  return {
    ...state,
    status: RecordingStatus.COMPLETED,
  };
}
