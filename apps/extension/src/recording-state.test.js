import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RecordingStatus,
  canStartRecording,
  canStopRecording,
  createRecordingState,
  setWorkflowName,
  startRecording,
  stopRecording,
} from './recording-state.js';

test('workflow name is required before recording can start', () => {
  const emptyState = createRecordingState('   ');

  assert.equal(canStartRecording(emptyState), false);
  assert.deepEqual(startRecording(emptyState), emptyState);
});

test('starting a named workflow enables stop and locks the name', () => {
  const readyState = setWorkflowName(createRecordingState(), '  Process refund  ');
  const recordingState = startRecording(readyState);

  assert.equal(recordingState.status, RecordingStatus.RECORDING);
  assert.equal(recordingState.workflowName, 'Process refund');
  assert.equal(canStartRecording(recordingState), false);
  assert.equal(canStopRecording(recordingState), true);
  assert.deepEqual(setWorkflowName(recordingState, 'Changed name'), recordingState);
});

test('stopping a recording marks it completed and permits another start', () => {
  const recordingState = startRecording(createRecordingState('Process refund'));
  const completedState = stopRecording(recordingState);

  assert.equal(completedState.status, RecordingStatus.COMPLETED);
  assert.equal(canStopRecording(completedState), false);
  assert.equal(canStartRecording(completedState), true);
});
