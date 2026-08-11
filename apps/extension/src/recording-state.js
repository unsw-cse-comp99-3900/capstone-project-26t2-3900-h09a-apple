/**
 * Pure recording state machine used by the popup (ready / recording / completed).
 */

export const RecordingStatus = Object.freeze({
  READY: 'ready',
  RECORDING: 'recording',
  COMPLETED: 'completed',
});

/** Create an idle recording state with an optional workflow name. */
export function createRecordingState(workflowName = '') {
  return {
    workflowName,
    status: RecordingStatus.READY,
  };
}

/** True when not already recording and a workflow name is set. */
export function canStartRecording(state) {
  return state.status !== RecordingStatus.RECORDING && state.workflowName.trim().length > 0;
}

/** True while a recording is in progress. */
export function canStopRecording(state) {
  return state.status === RecordingStatus.RECORDING;
}

/** Update workflow name when not actively recording. */
export function setWorkflowName(state, workflowName) {
  if (state.status === RecordingStatus.RECORDING) {
    return state;
  }

  return {
    ...state,
    workflowName,
  };
}

/** Transition to RECORDING and allocate client_session_id / startedAt. */
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

/** Transition from RECORDING to COMPLETED. */
export function stopRecording(state) {
  if (!canStopRecording(state)) {
    return state;
  }

  return {
    ...state,
    status: RecordingStatus.COMPLETED,
  };
}
