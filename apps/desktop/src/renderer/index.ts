function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Missing renderer element: ${id}`);
  }

  return element as T;
}

const startButton = requireElement<HTMLButtonElement>('start-recording');
const stopButton = requireElement<HTMLButtonElement>('stop-recording');
const reviewButton = requireElement<HTMLButtonElement>('review-session');
const floatingOrbShell = requireElement<HTMLDivElement>('floating-orb-shell');
const collapseButton = requireElement<HTMLButtonElement>('collapse-window');
const closeButton = requireElement<HTMLButtonElement>('close-window');
const statusPill = requireElement<HTMLDivElement>('status-pill');
const statusLabel = requireElement<HTMLSpanElement>('status-label');
const statusMessage = requireElement<HTMLParagraphElement>('status-message');
const eventCount = requireElement<HTMLParagraphElement>('event-count');
const sessionResult = requireElement<HTMLDivElement>('session-result');
const sessionPath = requireElement<HTMLElement>('session-path');
const platform = requireElement<HTMLSpanElement>('platform');
const signInPanel = requireElement<HTMLDivElement>('signin-panel');
const signInButton = requireElement<HTMLButtonElement>('signin-button');
const recorderPanel = requireElement<HTMLDivElement>('recorder-panel');
const logoutButton = requireElement<HTMLButtonElement>('logout-button');
const consentOverlay = requireElement<HTMLDivElement>('consent-overlay');
const consentAcceptButton = requireElement<HTMLButtonElement>('consent-accept');
const consentDeclineButton = requireElement<HTMLButtonElement>('consent-decline');
const reviewModal = requireElement<HTMLDivElement>('review-modal');
const workflowText = requireElement<HTMLSpanElement>('review-workflow');
const durationText = requireElement<HTMLSpanElement>('review-duration');
const eventsText = requireElement<HTMLSpanElement>('review-events');
const submitButton = requireElement<HTMLButtonElement>('submit-session-button');
const cancelButton = requireElement<HTMLButtonElement>('cancel-review-button');
const workflowGoalInput = requireElement<HTMLInputElement>('workflow-goal');

let busy = false;
let dragPointerId: number | null = null;
let dragStart = { x: 0, y: 0 };
let dragMoved = false;
let suppressOrbClick = false;
let authenticated = false;

const DRAG_THRESHOLD_PX = 4;

const stateLabels: Record<RecorderState, string> = {
  idle: 'Ready',
  recording: 'Recording',
  paused: 'Paused',
  error: 'Error',
};

function renderStatus(status: RecordingStatus): void {
  document.body.dataset.state = status.state;
  statusLabel.textContent = stateLabels[status.state];
  eventCount.textContent = String(status.eventCount);

  startButton.disabled =
    busy || status.state === 'recording' || workflowGoalInput.value.trim().length === 0;
  stopButton.disabled = busy || status.state === 'idle';
  reviewButton.disabled = busy || status.state !== 'idle' || !status.sessionPath;
  logoutButton.disabled = busy || status.state === 'recording';
  workflowGoalInput.disabled = busy || status.state !== 'idle';

  if (status.error) {
    statusMessage.textContent = status.error;
  } else if (status.state === 'recording') {
    statusMessage.textContent = 'Capturing activity from other desktop applications.';
  } else if (status.sessionPath) {
    statusMessage.textContent = 'Recording complete. Your local session is ready.';
  } else {
    statusMessage.textContent = 'Ready to capture your desktop workflow.';
  }

  sessionResult.hidden = !status.sessionPath;
  sessionPath.textContent = status.sessionPath ?? '';
  sessionPath.title = status.sessionPath ?? '';
}

async function runAction(action: () => Promise<RecordingStatus>): Promise<void> {
  busy = true;
  startButton.disabled = true;
  stopButton.disabled = true;
  reviewButton.disabled = true;

  try {
    renderStatus(await action());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    statusMessage.textContent = message;
    document.body.dataset.state = 'error';
    statusLabel.textContent = 'Error';
  } finally {
    busy = false;
    renderStatus(await window.desktopAPI.getRecordingStatus());
  }
}

async function refreshAuth(): Promise<void> {
  const auth = await window.desktopAPI.getAuthStatus();

  authenticated = auth.authenticated;

  signInPanel.hidden = authenticated;
  recorderPanel.hidden = !authenticated;
  statusPill.hidden = !authenticated;
  logoutButton.hidden = !authenticated;

  if (!authenticated) {
    hideConsent();
  }
}

function showConsent(): void {
  consentOverlay.hidden = false;
}

function hideConsent(): void {
  consentOverlay.hidden = true;
}

async function startRecordingWithGoal(): Promise<void> {
  const workflowGoal = workflowGoalInput.value.trim();
  if (!workflowGoal) {
    statusMessage.textContent =
      'Describe the task first so the generated SOP can preserve its intent.';
    workflowGoalInput.focus();
    return;
  }

  await runAction(() => window.desktopAPI.startRecording(workflowGoal));
}

workflowGoalInput.addEventListener('input', () => {
  startButton.disabled =
    busy ||
    document.body.dataset.state === 'recording' ||
    workflowGoalInput.value.trim().length === 0;
});

startButton.addEventListener('click', () => {
  void (async () => {
    const consent = await window.desktopAPI.getConsentStatus();

    if (!consent.accepted) {
      showConsent();
      return;
    }

    await startRecordingWithGoal();
  })();
});

stopButton.addEventListener('click', () => {
  void runAction(() => window.desktopAPI.stopRecording());
});

reviewButton.addEventListener('click', async () => {
  const review = await window.desktopAPI.getReviewSession();

  workflowText.textContent = review.workflowName;

  durationText.textContent = `${review.durationSeconds}s`;

  eventsText.textContent = String(review.eventCount);

  reviewModal.hidden = false;
});

cancelButton.addEventListener('click', () => {
  reviewModal.hidden = true;
});

submitButton.addEventListener('click', async () => {
  submitButton.disabled = true;
  const originalLabel = submitButton.textContent;
  submitButton.textContent = 'Generating draft...';

  try {
    const result = await window.desktopAPI.submitSession();
    reviewModal.hidden = true;
    alert(`SOP draft generated successfully.\nSOP ID: ${result.sopId}`);
  } catch (error) {
    alert(error instanceof Error ? error.message : String(error));
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = originalLabel;
  }
});

floatingOrbShell.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || dragPointerId !== null) return;

  dragPointerId = event.pointerId;
  dragStart = { x: event.screenX, y: event.screenY };
  dragMoved = false;
  floatingOrbShell.setPointerCapture(event.pointerId);
  window.desktopAPI.beginWindowDrag();
});

floatingOrbShell.addEventListener('pointermove', (event) => {
  if (event.pointerId !== dragPointerId) return;

  if (Math.hypot(event.screenX - dragStart.x, event.screenY - dragStart.y) >= DRAG_THRESHOLD_PX) {
    dragMoved = true;
    floatingOrbShell.classList.add('is-dragging');
  }

  if (dragMoved) {
    window.desktopAPI.updateWindowDrag();
  }
});

floatingOrbShell.addEventListener('pointerup', (event) => {
  if (event.pointerId !== dragPointerId) return;

  suppressOrbClick = dragMoved;
  floatingOrbShell.releasePointerCapture(event.pointerId);
  window.desktopAPI.endWindowDrag();
  dragPointerId = null;
  floatingOrbShell.classList.remove('is-dragging');
});

floatingOrbShell.addEventListener('pointercancel', (event) => {
  if (event.pointerId !== dragPointerId) return;

  window.desktopAPI.endWindowDrag();
  dragPointerId = null;
  dragMoved = false;
  floatingOrbShell.classList.remove('is-dragging');
});

floatingOrbShell.addEventListener('click', async () => {
  if (suppressOrbClick) {
    suppressOrbClick = false;
    return;
  }

  document.body.dataset.windowMode = await window.desktopAPI.setWindowMode('expanded');
});

collapseButton.addEventListener('click', async () => {
  document.body.dataset.windowMode = await window.desktopAPI.setWindowMode('compact');
});

closeButton.addEventListener('click', () => {
  void window.desktopAPI.closeWindow();
});

signInButton.addEventListener('click', async () => {
  await window.desktopAPI.launchHandoff();

  const timer = window.setInterval(async () => {
    await refreshAuth();

    if (authenticated) {
      clearInterval(timer);
    }
  }, 1000);
});

logoutButton.addEventListener('click', () => {
  void (async () => {
    await window.desktopAPI.logout();
    await refreshAuth();
  })();
});

consentAcceptButton.addEventListener('click', () => {
  void (async () => {
    await window.desktopAPI.acceptConsent();

    hideConsent();

    await startRecordingWithGoal();
  })();
});

consentDeclineButton.addEventListener('click', () => {
  hideConsent();
});

platform.textContent = window.desktopAPI.platform;

void (async () => {
  await refreshAuth();
  renderStatus(await window.desktopAPI.getRecordingStatus());
})();

window.setInterval(() => {
  if (!busy) {
    void refreshAuth();
    void window.desktopAPI.getRecordingStatus().then(renderStatus);
  }
}, 500);
