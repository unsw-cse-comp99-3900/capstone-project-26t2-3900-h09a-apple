const role = (new URLSearchParams(window.location.search).get('role') || 'panel') as
  | 'panel'
  | 'spotlight';

const highlight = document.getElementById('highlight') as HTMLDivElement;
const tooltip = document.getElementById('tooltip') as HTMLDivElement;
const eyebrow = document.getElementById('eyebrow') as HTMLParagraphElement;
const platformBanner = document.getElementById('platformBanner') as HTMLParagraphElement;
const instruction = document.getElementById('instruction') as HTMLParagraphElement;
const stepContextEl = document.getElementById('stepContext') as HTMLDListElement;
const preview = document.getElementById('preview') as HTMLImageElement;
const fallbackNote = document.getElementById('fallbackNote') as HTMLParagraphElement;
const exportPanel = document.getElementById('exportPanel') as HTMLDivElement;
const actions = document.getElementById('actions') as HTMLDivElement;
const errorEl = document.getElementById('error') as HTMLParagraphElement;
const previousBtn = tooltip.querySelector('[data-action="previous"]') as HTMLButtonElement;
const recheckBtn = tooltip.querySelector('[data-action="recheck"]') as HTMLButtonElement;
const openPageBtn = tooltip.querySelector('[data-action="open-page"]') as HTMLButtonElement;
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

function renderStepContext(state: WalkthroughUiState): void {
  const ctx = state.stepContext;
  if (!ctx || state.status !== 'playing') {
    stepContextEl.hidden = true;
    stepContextEl.replaceChildren();
    return;
  }

  let target = ctx.targetLabel?.trim() ? ctx.targetLabel : 'Unknown';
  if (state.highlightStyle === 'approximate') {
    target = `${target} (approximate)`;
  }
  const rows: Array<[string, string]> = [
    ['App', ctx.app?.trim() ? ctx.app : 'Unknown'],
    ['Window', ctx.windowTitle?.trim() ? ctx.windowTitle : 'Unknown'],
    ['Target', target],
  ];
  if (ctx.recordedUrl?.trim()) {
    rows.push(['Recorded URL', ctx.recordedUrl]);
  }

  stepContextEl.replaceChildren();
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dd.title = value;
    stepContextEl.append(dt, dd);
  }
  stepContextEl.hidden = false;
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
    highlight.classList.toggle('is-approximate', state.highlightStyle === 'approximate');
    // DIP coords from main. On some Windows transparent overlays the CSS
    // viewport is physical-sized while bounds stay DIP — scale so the hole
    // does not drift bottom-right.
    let x = state.highlight.x;
    let y = state.highlight.y;
    let w = state.highlight.width;
    let h = state.highlight.height;
    const dipW = state.displaySize?.width;
    const dipH = state.displaySize?.height;
    if (dipW && dipH && dipW > 0 && dipH > 0) {
      const sx = window.innerWidth / dipW;
      const sy = window.innerHeight / dipH;
      if (
        Number.isFinite(sx) &&
        Number.isFinite(sy) &&
        (Math.abs(sx - 1) > 0.02 || Math.abs(sy - 1) > 0.02)
      ) {
        x *= sx;
        y *= sy;
        w *= sx;
        h *= sy;
      }
    }
    highlight.style.left = `${x}px`;
    highlight.style.top = `${y}px`;
    highlight.style.width = `${w}px`;
    highlight.style.height = `${h}px`;
  } else {
    highlight.hidden = true;
    highlight.classList.remove('is-approximate');
  }
}

function renderPanel(state: WalkthroughUiState): void {
  lastState = state;
  highlight.hidden = true;
  tooltip.hidden = false;

  if (state.status === 'finished') {
    actions.hidden = true;
    exportPanel.hidden = false;
    platformBanner.hidden = true;
    stepContextEl.hidden = true;
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

    if (state.platformBanner) {
      platformBanner.hidden = false;
      platformBanner.textContent = state.platformBanner;
    } else {
      platformBanner.hidden = true;
    }

    renderStepContext(state);

    const busy = Boolean(state.navBusy);
    const noLiveTarget = !state.highlight || state.highlightStyle === 'approximate';
    previousBtn.disabled = state.previousDisabled || busy;
    recheckBtn.disabled = busy;
    nextBtn.disabled = busy;
    finishBtn.disabled = busy;
    openPageBtn.disabled = busy || !state.openPageUrl;
    openPageBtn.hidden = !state.openPageUrl;
    nextBtn.hidden = state.isLastStep;
    finishBtn.hidden = !state.isLastStep;
    previousBtn.textContent = busy ? 'Resolving...' : 'Previous';
    recheckBtn.textContent = busy ? 'Resolving...' : 'Re-check';
    nextBtn.textContent = busy ? 'Resolving...' : noLiveTarget ? 'Next (manual)' : 'Next';
    finishBtn.textContent = busy ? 'Resolving...' : 'Finish';
    openPageBtn.textContent = 'Open page';
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
    } else if (action === 'open-page') {
      void window.walkthroughAPI.openPage().then(render);
    } else if (action === 'recheck') {
      void window.walkthroughAPI.recheck().then(render);
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
