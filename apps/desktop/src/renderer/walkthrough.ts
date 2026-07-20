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

function placeTooltip(anchor: { top: number; left: number; bottom: number; width: number }): void {
  const gap = 12;
  const width = tooltip.offsetWidth || 320;
  const height = tooltip.offsetHeight || 160;

  let top = anchor.bottom + gap;
  let left = anchor.left;

  if (top + height > window.innerHeight - 8) {
    top = Math.max(8, anchor.top - height - gap);
  }
  if (left + width > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - width - 8);
  }
  left = Math.max(8, left);

  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;
}

function centerAnchor() {
  return {
    top: window.innerHeight / 2 - 40,
    bottom: window.innerHeight / 2 + 40,
    left: window.innerWidth / 2 - 80,
    width: 160,
  };
}

function render(state: WalkthroughUiState): void {
  tooltip.hidden = false;

  if (state.status === 'finished') {
    highlight.hidden = true;
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
    highlight.hidden = true;
  } else {
    actions.hidden = false;
    exportPanel.hidden = true;
    eyebrow.textContent = state.eyebrow;
    instruction.textContent = state.instruction;
    previousBtn.disabled = state.previousDisabled;
    nextBtn.hidden = state.isLastStep;
    finishBtn.hidden = !state.isLastStep;

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

    if (state.highlight && state.highlight.width > 0 && state.highlight.height > 0) {
      highlight.hidden = false;
      highlight.style.left = `${state.highlight.x}px`;
      highlight.style.top = `${state.highlight.y}px`;
      highlight.style.width = `${state.highlight.width}px`;
      highlight.style.height = `${state.highlight.height}px`;
      placeTooltip({
        top: state.highlight.y,
        left: state.highlight.x,
        bottom: state.highlight.y + state.highlight.height,
        width: state.highlight.width,
      });
    } else {
      highlight.hidden = true;
      placeTooltip(centerAnchor());
    }
  }

  if (state.error) {
    errorEl.hidden = false;
    errorEl.textContent = state.error;
  } else {
    errorEl.hidden = true;
  }
}

tooltip.addEventListener('mouseenter', () => {
  window.walkthroughAPI.setTooltipInteractive(true);
});
tooltip.addEventListener('mouseleave', () => {
  window.walkthroughAPI.setTooltipInteractive(false);
});

tooltip.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest(
    'button[data-action]',
  ) as HTMLButtonElement | null;
  if (!button || button.disabled) {
    return;
  }

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
      highlight.hidden = true;
    });
  }
});

window.walkthroughAPI.onState(render);
window.walkthroughAPI.notifyReady();

// Pull current state after listeners are attached in case a push raced load.
void window.walkthroughAPI.getState().then((state) => {
  if (state.status === 'playing' || state.status === 'finished') {
    render(state);
  }
});
