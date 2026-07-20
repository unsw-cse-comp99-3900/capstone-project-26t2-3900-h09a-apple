import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WalkthroughStatus,
  canGoNext,
  canGoPrevious,
  canStartWalkthrough,
  canStopWalkthrough,
  createWalkthroughState,
  goToNextStep,
  goToPreviousStep,
  isLastStep,
  markStepEntered,
  startWalkthrough,
  stopWalkthrough,
} from './walkthrough-state.js';

test('walkthrough requires a SOP id and cannot start while recording', () => {
  const idle = createWalkthroughState();

  assert.equal(canStartWalkthrough(idle, ''), false);
  assert.equal(canStartWalkthrough(idle, '  '), false);
  assert.equal(canStartWalkthrough(idle, 'sop-1', { isRecording: true }), false);
  assert.equal(canStartWalkthrough(idle, 'sop-1'), true);
});

test('starting a walkthrough resets to step 0 and can bind a tab id', () => {
  const playing = startWalkthrough(createWalkthroughState(), '  sop-abc  ', { tabId: 42 });

  assert.equal(playing.status, WalkthroughStatus.PLAYING);
  assert.equal(playing.sopId, 'sop-abc');
  assert.equal(playing.stepIndex, 0);
  assert.equal(playing.tabId, 42);
  assert.deepEqual(playing.resolvedUrls, {});
  assert.equal(canStopWalkthrough(playing), true);
  assert.equal(canStartWalkthrough(playing, 'sop-abc'), false);
});

test('stop clears walkthrough progress including tab id', () => {
  const playing = goToNextStep(
    startWalkthrough(createWalkthroughState(), 'sop-1', { tabId: 7 }),
    2,
  );
  const idle = stopWalkthrough(playing);

  assert.equal(idle.status, WalkthroughStatus.IDLE);
  assert.equal(idle.sopId, null);
  assert.equal(idle.stepIndex, 0);
  assert.equal(idle.tabId, null);
});

test('previous is disabled on step 1 and enabled afterward', () => {
  const playing = startWalkthrough(createWalkthroughState(), 'sop-1');

  assert.equal(canGoPrevious(playing), false);
  assert.deepEqual(goToPreviousStep(playing), playing);

  const step2 = goToNextStep(playing, 3);
  assert.equal(step2.stepIndex, 1);
  assert.equal(canGoPrevious(step2), true);

  const back = goToPreviousStep(step2);
  assert.equal(back.stepIndex, 0);
});

test('next advances until the last step, then finish is the terminal action', () => {
  let state = startWalkthrough(createWalkthroughState(), 'sop-1');

  assert.equal(canGoNext(state, 3), true);
  assert.equal(isLastStep(state, 3), false);

  state = goToNextStep(state, 3);
  state = goToNextStep(state, 3);
  assert.equal(state.stepIndex, 2);
  assert.equal(canGoNext(state, 3), false);
  assert.equal(isLastStep(state, 3), true);
  assert.deepEqual(goToNextStep(state, 3), state);
});

test('re-entering a step yields a fresh entered_at visit marker', () => {
  const first = markStepEntered(2, 1000);
  const second = markStepEntered(2, 2000);

  assert.equal(first.step_number, 2);
  assert.equal(second.step_number, 2);
  assert.notEqual(first.entered_at, second.entered_at);
});
