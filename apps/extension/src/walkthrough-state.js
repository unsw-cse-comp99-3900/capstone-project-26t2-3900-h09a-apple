export const WalkthroughStatus = Object.freeze({
  IDLE: 'idle',
  PLAYING: 'playing',
});

export const WALKTHROUGH_STORAGE_KEY = 'walkthroughState';
export const WALKTHROUGH_PAYLOAD_KEY = 'walkthroughPayload';

export function createWalkthroughState() {
  return {
    status: WalkthroughStatus.IDLE,
    sopId: null,
    stepIndex: 0,
    tabId: null,
  };
}

export function canStartWalkthrough(state, sopId, { isRecording = false } = {}) {
  if (isRecording) {
    return false;
  }
  if (state.status === WalkthroughStatus.PLAYING) {
    return false;
  }
  return typeof sopId === 'string' && sopId.trim().length > 0;
}

export function canStopWalkthrough(state) {
  return state.status === WalkthroughStatus.PLAYING;
}

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
  };
}

export function stopWalkthrough() {
  return createWalkthroughState();
}

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

export function goToPreviousStep(state) {
  if (state.status !== WalkthroughStatus.PLAYING || state.stepIndex <= 0) {
    return state;
  }

  return {
    ...state,
    stepIndex: state.stepIndex - 1,
  };
}

export function canGoPrevious(state) {
  return state.status === WalkthroughStatus.PLAYING && state.stepIndex > 0;
}

export function canGoNext(state, stepCount) {
  return (
    state.status === WalkthroughStatus.PLAYING && stepCount > 0 && state.stepIndex < stepCount - 1
  );
}

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
