const role = (new URLSearchParams(window.location.search).get('role') || 'panel') as
  | 'panel'
  | 'spotlight';

const highlight = document.getElementById('highlight') as HTMLDivElement;
const tooltip = document.getElementById('tooltip') as HTMLDivElement;
const eyebrow = document.getElementById('eyebrow') as HTMLParagraphElement;
const instruction = document.getElementById('instruction') as HTMLParagraphElement;
const preview = document.getElementById('preview') as HTMLImageElement;
const fallbackNote = document.getElementById('fallbackNote') as HTMLParagraphElement;
const exportPanel = document.getElementById('exportPanel') as HTMLDivElement;
const actions = document.getElementById('actions') as HTMLDivElement;
const errorEl = document.getElementById('error') as HTMLParagraphElement;
const previousBtn = tooltip.querySelector('[data-action="previous"]') as HTMLButtonElement;
const nextBtn = tooltip.querySelector('[data-action="next"]') as HTMLButtonElement;
const finishBtn = tooltip.querySelector('[data-action="finish"]') as HTMLButtonElement;

let captureCloak = false;
let lastState: WalkthroughUiState | null = null;

document.documentElement.dataset.role = role;
if (role === 'spotlight') {
  tooltip.hidden = true;
  exportPanel.hidden = true;
  actions.hidden = true;
} else {
  highlight.hidden = true;
}

function placeTooltip(anchor: { top: number; left: number; bottom: number; width: number }): void {
  // Panel window is the card itself; keep tooltip filling the panel.
  tooltip.style.top = '12px';
  tooltip.style.left = '12px';
  tooltip.style.right = '12px';
  tooltip.style.width = 'auto';
  void anchor;
}

function centerAnchor() {
  return {
    top: 12,
    bottom: 12,
    left: 12,
    width: 320,
  };
}

function renderSpotlight(state: WalkthroughUiState): void {
  lastState = state;
  tooltip.hidden = true;

  if (state.status !== 'playing' || captureCloak || !state.highlight) {
    highlight.hidden = true;
    return;
  }

  if (state.highlight.width > 0 && state.highlight.height > 0) {
    highlight.hidden = false;
    highlight.style.left = `${state.highlight.x}px`;
    highlight.style.top = `${state.highlight.y}px`;
    highlight.style.width = `${state.highlight.width}px`;
    highlight.style.height = `${state.highlight.height}px`;
  } else {
    highlight.hidden = true;
  }
}

function renderPanel(state: WalkthroughUiState): void {
  lastState = state;
  highlight.hidden = true;
  tooltip.hidden = false;

  if (state.status === 'finished') {
    actions.hidden = true;
    exportPanel.hidden = false;
    eyebrow.textContent = 'Walkthrough complete';
    instruction.textContent = state.exportAvailable
      ? 'Your validated agent prompt is ready to paste into Claude.'
      : 'Session complete. No agent prompt export for this walkthrough.';
    preview.hidden = true;
    fallbackNote.hidden = true;

    const copyBtn = exportPanel.querySelector('[data-action="copy-export"]') as HTMLButtonElement;
    const saveBtn = exportPanel.querySelector('[data-action="save-export"]') as HTMLButtonElement;
    copyBtn.hidden = !state.exportAvailable;
    saveBtn.hidden = !state.exportAvailable;
    const exportLabel = exportPanel.querySelector('.export-label') as HTMLParagraphElement | null;
    if (exportLabel) {
      exportLabel.hidden = !state.exportAvailable;
    }
    placeTooltip(centerAnchor());
  } else if (state.status === 'idle') {
    tooltip.hidden = true;
  } else {
    actions.hidden = false;
    exportPanel.hidden = true;
    eyebrow.textContent = state.eyebrow;
    instruction.textContent = state.instruction;
    const busy = Boolean(state.navBusy);
    previousBtn.disabled = state.previousDisabled || busy;
    nextBtn.disabled = busy;
    finishBtn.disabled = busy;
    nextBtn.hidden = state.isLastStep;
    finishBtn.hidden = !state.isLastStep;
    previousBtn.textContent = busy ? 'Resolving...' : 'Previous';
    nextBtn.textContent = busy ? 'Resolving...' : 'Next';
    finishBtn.textContent = busy ? 'Resolving...' : 'Finish';
    actions.classList.toggle('is-busy', busy);
    actions.setAttribute('aria-busy', busy ? 'true' : 'false');

    if (state.screenshotUrl) {
      preview.hidden = false;
      preview.src = state.screenshotUrl;
    } else {
      preview.hidden = true;
      preview.removeAttribute('src');
    }

    if (state.fallbackNote) {
      fallbackNote.hidden = false;
      fallbackNote.textContent = state.fallbackNote;
    } else {
      fallbackNote.hidden = true;
    }

    placeTooltip(centerAnchor());
  }

  if (state.error) {
    errorEl.hidden = false;
    errorEl.textContent = state.error;
  } else {
    errorEl.hidden = true;
  }
}

function render(state: WalkthroughUiState): void {
  if (role === 'spotlight') {
    renderSpotlight(state);
  } else {
    renderPanel(state);
  }
}

if (role === 'panel') {
  tooltip.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest(
      'button[data-action]',
    ) as HTMLButtonElement | null;
    if (!button || button.disabled) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const action = button.getAttribute('data-action');
    if (action === 'previous') {
      void window.walkthroughAPI.previous().then(render);
    } else if (action === 'next') {
      void window.walkthroughAPI.next().then(render);
    } else if (action === 'finish') {
      void window.walkthroughAPI.finish().then(render);
    } else if (action === 'copy-export') {
      void window.walkthroughAPI.copyExport();
    } else if (action === 'save-export') {
      void window.walkthroughAPI.saveExport();
    } else if (action === 'dismiss') {
      void window.walkthroughAPI.dismiss().then(() => {
        tooltip.hidden = true;
      });
    }
  });
}

window.walkthroughAPI.onState(render);
window.walkthroughAPI.onCaptureCloak((cloaked) => {
  captureCloak = cloaked;
  if (role === 'spotlight') {
    if (cloaked) {
      highlight.hidden = true;
    } else if (lastState) {
      render(lastState);
    }
  }
});
window.walkthroughAPI.notifyReady();

void window.walkthroughAPI.getState().then((state) => {
  if (state.status === 'playing' || state.status === 'finished') {
    render(state);
  }
});
