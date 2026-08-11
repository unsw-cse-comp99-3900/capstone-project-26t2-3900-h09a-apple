/**
 * Pure walkthrough playback state (idle/playing, step index, learned URL map).
 */

export const WalkthroughStatus = Object.freeze({
  IDLE: 'idle',
  PLAYING: 'playing',
});

export const WALKTHROUGH_STORAGE_KEY = 'walkthroughState';
export const WALKTHROUGH_PAYLOAD_KEY = 'walkthroughPayload';

/** Fresh idle walkthrough state with empty resolvedUrls. */
export function createWalkthroughState() {
  return {
    status: WalkthroughStatus.IDLE,
    sopId: null,
    stepIndex: 0,
    tabId: null,
    // origin+path-template -> live absolute URL learned during this playback
    resolvedUrls: {},
  };
}

/** Guard: not recording, not already playing, and sopId non-empty. */
export function canStartWalkthrough(state, sopId, { isRecording = false } = {}) {
  if (isRecording) {
    return false;
  }
  if (state.status === WalkthroughStatus.PLAYING) {
    return false;
  }
  return typeof sopId === 'string' && sopId.trim().length > 0;
}

/** True while a walkthrough is playing. */
export function canStopWalkthrough(state) {
  return state.status === WalkthroughStatus.PLAYING;
}

/** Enter PLAYING at step 0 for the given SOP (optional tabId). */
export function startWalkthrough(state, sopId, { tabId = null } = {}) {
  const trimmed = typeof sopId === 'string' ? sopId.trim() : '';
  if (!trimmed || state.status === WalkthroughStatus.PLAYING) {
    return state;
  }

  return {
    status: WalkthroughStatus.PLAYING,
    sopId: trimmed,
    stepIndex: 0,
    tabId: tabId ?? null,
    resolvedUrls: {},
  };
}

/** Reset to a fresh idle walkthrough state. */
export function stopWalkthrough() {
  return createWalkthroughState();
}

/** Advance stepIndex when another step remains. */
export function goToNextStep(state, stepCount) {
  if (state.status !== WalkthroughStatus.PLAYING || stepCount < 1) {
    return state;
  }

  if (state.stepIndex >= stepCount - 1) {
    return state;
  }

  return {
    ...state,
    stepIndex: state.stepIndex + 1,
  };
}

/** Move stepIndex back when not on the first step. */
export function goToPreviousStep(state) {
  if (state.status !== WalkthroughStatus.PLAYING || state.stepIndex <= 0) {
    return state;
  }

  return {
    ...state,
    stepIndex: state.stepIndex - 1,
  };
}

/** True when playing and stepIndex > 0. */
export function canGoPrevious(state) {
  return state.status === WalkthroughStatus.PLAYING && state.stepIndex > 0;
}

/** True when playing and not on the last step. */
export function canGoNext(state, stepCount) {
  return (
    state.status === WalkthroughStatus.PLAYING && stepCount > 0 && state.stepIndex < stepCount - 1
  );
}

/** True when playing on the final step. */
export function isLastStep(state, stepCount) {
  return (
    state.status === WalkthroughStatus.PLAYING && stepCount > 0 && state.stepIndex >= stepCount - 1
  );
}

/**
 * Hook for H09AAPPLE-30: re-entering a step (including via Previous → Next)
 * should start a fresh visit with a new entered_at, not duplicate an open timing record.
 * Previous also discards the abandoned forward step's timing (see runtime
 * abandonCurrentStep / retractPathToStep).
 */
export function markStepEntered(stepNumber, enteredAt = Date.now()) {
  return {
    step_number: stepNumber,
    entered_at: enteredAt,
  };
}
