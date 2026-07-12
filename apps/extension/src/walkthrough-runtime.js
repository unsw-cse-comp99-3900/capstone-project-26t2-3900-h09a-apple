/**
 * Walkthrough overlay runtime for the content script world (classic script).
 * Loaded before content.js via manifest content_scripts order.
 *
 * Primary mode is LIVE overlay: resolve target on the page, anchor tooltip via
 * getBoundingClientRect. Screenshots are preview + fallback only (H09AAPPLE-28).
 * Full CSS → XPath → text+role → vision chain lands in H09AAPPLE-29.
 */
(() => {
  const STORAGE_STATE_KEY = 'walkthroughState';
  const STORAGE_PAYLOAD_KEY = 'walkthroughPayload';
  const HOST_ID = 'worktrace-walkthrough-host';

  /** @type {{ status: string, sopId: string | null, stepIndex: number, tabId?: number | null } | null} */
  let activeState = null;
  /** @type {{ steps: Array<Record<string, unknown>> } | null} */
  let activePayload = null;
  /** @type {ShadowRoot | null} */
  let shadowRoot = null;
  /** @type {HTMLElement | null} */
  let hostEl = null;
  /** @type {Element | null} */
  let currentTarget = null;
  /** @type {MutationObserver | null} */
  let mutationObserver = null;
  /** @type {number | null} */
  let currentVisitEnteredAt = null;
  let currentVisitStepNumber = null;
  /** @type {number | null} */
  let lastEnteredStepIndex = null;
  let repositionScheduled = false;
  /** @type {number | null} */
  let myTabId = null;

  function getSteps() {
    return Array.isArray(activePayload?.steps) ? activePayload.steps : [];
  }

  function getCurrentStep() {
    const steps = getSteps();
    if (!activeState || activeState.status !== 'playing' || steps.length === 0) {
      return null;
    }
    return steps[activeState.stepIndex] ?? null;
  }

  /**
   * Stub resolver for H09AAPPLE-28. H09AAPPLE-29 owns the full strategy chain.
   */
  function resolveTarget(step, doc = document) {
    if (!step || !doc) {
      return { element: null, mode: 'fallback' };
    }

    if (typeof step.css_selector === 'string' && step.css_selector.trim()) {
      try {
        const el = doc.querySelector(step.css_selector);
        if (el) {
          return { element: el, mode: 'css' };
        }
      } catch {
        // Invalid selector - fall through.
      }
    }

    if (typeof step.xpath === 'string' && step.xpath.trim()) {
      try {
        const result = doc.evaluate(
          step.xpath,
          doc,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null,
        );
        const node = result.singleNodeValue;
        if (node && node.nodeType === Node.ELEMENT_NODE) {
          return { element: node, mode: 'xpath' };
        }
      } catch {
        // Invalid xpath - fall through.
      }
    }

    return { element: null, mode: 'fallback' };
  }

  function resolveAnchorMode(step) {
    if (
      step?.anchor_mode === 'element' ||
      step?.anchor_mode === 'screenshot' ||
      step?.anchor_mode === 'none'
    ) {
      return step.anchor_mode;
    }
    const hasSelector =
      (typeof step?.css_selector === 'string' && step.css_selector.trim()) ||
      (typeof step?.xpath === 'string' && step.xpath.trim());
    if (hasSelector) {
      return 'element';
    }
    if (typeof step?.screenshot_url === 'string' && step.screenshot_url) {
      return 'screenshot';
    }
    return 'none';
  }

  function viewportCenterRect() {
    return {
      top: window.innerHeight / 2 - 40,
      bottom: window.innerHeight / 2 + 40,
      left: window.innerWidth / 2 - 80,
      right: window.innerWidth / 2 + 80,
      width: 160,
      height: 80,
    };
  }

  function ensureHost() {
    if (hostEl && shadowRoot) {
      return shadowRoot;
    }

    const existing = document.getElementById(HOST_ID);
    if (existing) {
      existing.remove();
    }

    hostEl = document.createElement('div');
    hostEl.id = HOST_ID;
    hostEl.setAttribute('data-worktrace', 'walkthrough');
    Object.assign(hostEl.style, {
      all: 'initial',
      position: 'fixed',
      inset: '0',
      zIndex: '2147483646',
      pointerEvents: 'none',
    });

    shadowRoot = hostEl.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = `
      <style>
        :host, * { box-sizing: border-box; }
        .backdrop {
          position: fixed;
          inset: 0;
          pointer-events: none;
        }
        .highlight {
          position: fixed;
          border: 2px solid #4f6bed;
          border-radius: 8px;
          box-shadow: 0 0 0 9999px rgb(15 23 42 / 28%);
          pointer-events: none;
          transition: top 0.12s ease, left 0.12s ease, width 0.12s ease, height 0.12s ease;
        }
        .highlight[hidden], .tooltip[hidden] { display: none !important; }
        .tooltip {
          position: fixed;
          width: min(320px, calc(100vw - 24px));
          max-width: 320px;
          padding: 14px;
          border-radius: 12px;
          background: #0f172a;
          color: #f8fafc;
          font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
          box-shadow: 0 18px 40px rgb(15 23 42 / 35%);
          pointer-events: auto;
        }
        .eyebrow {
          margin: 0 0 6px;
          color: #93c5fd;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .instruction {
          margin: 0 0 10px;
          font-size: 14px;
          font-weight: 600;
        }
        .preview {
          display: block;
          width: 100%;
          max-height: 120px;
          margin: 0 0 10px;
          object-fit: cover;
          border-radius: 8px;
          background: #1e293b;
        }
        .preview[hidden] { display: none !important; }
        .fallback-note {
          margin: 0 0 10px;
          color: #cbd5e1;
          font-size: 12px;
        }
        .fallback-note[hidden] { display: none !important; }
        .actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          justify-content: flex-end;
        }
        button {
          appearance: none;
          border: 0;
          border-radius: 8px;
          padding: 8px 12px;
          font: inherit;
          font-weight: 600;
          cursor: pointer;
        }
        button:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .btn-secondary {
          background: #334155;
          color: #f8fafc;
        }
        .btn-primary {
          background: #4f6bed;
          color: #fff;
        }
      </style>
      <div class="backdrop" aria-hidden="true"></div>
      <div class="highlight" hidden></div>
      <div class="tooltip" role="dialog" aria-live="polite" hidden>
        <p class="eyebrow"></p>
        <p class="instruction"></p>
        <img class="preview" alt="Step screenshot preview" hidden />
        <p class="fallback-note" hidden></p>
        <div class="actions">
          <button type="button" class="btn-secondary" data-action="previous">Previous</button>
          <button type="button" class="btn-primary" data-action="next">Next</button>
          <button type="button" class="btn-primary" data-action="finish" hidden>Finish</button>
        </div>
      </div>
    `;

    const tooltip = shadowRoot.querySelector('.tooltip');
    tooltip.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button || button.disabled) {
        return;
      }
      const action = button.getAttribute('data-action');
      if (action === 'previous') {
        handlePrevious();
      } else if (action === 'next') {
        handleNext();
      } else if (action === 'finish') {
        handleFinish();
      }
    });

    document.documentElement.appendChild(hostEl);
    return shadowRoot;
  }

  function teardownHost() {
    tearDownObservers();
    if (hostEl) {
      hostEl.remove();
    }
    hostEl = null;
    shadowRoot = null;
    currentTarget = null;
    currentVisitEnteredAt = null;
    currentVisitStepNumber = null;
    lastEnteredStepIndex = null;
  }

  function isTargetTab(state) {
    // Legacy / tests without tabId keep previous broadcast behaviour.
    if (state?.tabId == null) {
      return true;
    }
    if (myTabId == null) {
      return false;
    }
    return Number(state.tabId) === Number(myTabId);
  }

  function ensureObservers() {
    if (mutationObserver) {
      return;
    }
    window.addEventListener('scroll', scheduleReposition, true);
    window.addEventListener('resize', scheduleReposition);
    mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (hostEl && (mutation.target === hostEl || hostEl.contains(mutation.target))) {
          continue;
        }
        scheduleReposition();
        return;
      }
    });
    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
    });
  }

  function tearDownObservers() {
    window.removeEventListener('scroll', scheduleReposition, true);
    window.removeEventListener('resize', scheduleReposition);
    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }
  }

  function scheduleReposition() {
    if (repositionScheduled) {
      return;
    }
    repositionScheduled = true;
    requestAnimationFrame(() => {
      repositionScheduled = false;
      reposition();
    });
  }

  function placeTooltip(tooltip, anchorRect) {
    const gap = 12;
    const tooltipRect = tooltip.getBoundingClientRect();
    const width = tooltipRect.width || 320;
    const height = tooltipRect.height || 160;

    let top = anchorRect.bottom + gap;
    let left = anchorRect.left;

    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, anchorRect.top - height - gap);
    }
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - width - 8);
    }
    left = Math.max(8, left);

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
  }

  function reposition() {
    if (!shadowRoot || !activeState || activeState.status !== 'playing') {
      return;
    }

    const step = getCurrentStep();
    const highlight = shadowRoot.querySelector('.highlight');
    const tooltip = shadowRoot.querySelector('.tooltip');
    if (!step || !highlight || !tooltip) {
      return;
    }

    const anchorMode = resolveAnchorMode(step);
    const resolved = resolveTarget(step);
    currentTarget = resolved.element;

    const fallbackNote = shadowRoot.querySelector('.fallback-note');
    const preview = shadowRoot.querySelector('.preview');
    const hasScreenshot = typeof step.screenshot_url === 'string' && Boolean(step.screenshot_url);
    const showPreview = hasScreenshot && anchorMode !== 'none';

    if (resolved.element) {
      const rect = resolved.element.getBoundingClientRect();
      highlight.hidden = false;
      highlight.style.top = `${Math.max(0, rect.top - 4)}px`;
      highlight.style.left = `${Math.max(0, rect.left - 4)}px`;
      highlight.style.width = `${Math.max(0, rect.width + 8)}px`;
      highlight.style.height = `${Math.max(0, rect.height + 8)}px`;
      fallbackNote.hidden = true;
      fallbackNote.textContent = '';
      placeTooltip(tooltip, rect);
    } else {
      highlight.hidden = true;
      placeTooltip(tooltip, viewportCenterRect());

      if (showPreview) {
        fallbackNote.hidden = false;
        fallbackNote.textContent =
          anchorMode === 'screenshot'
            ? 'No on-page target for this step. Showing captured preview.'
            : 'Target element not found on this page. Showing captured preview.';
      } else {
        fallbackNote.hidden = false;
        fallbackNote.textContent = 'No on-page target available for this step.';
      }
    }

    if (showPreview) {
      preview.hidden = false;
      preview.src = step.screenshot_url;
    } else {
      preview.hidden = true;
      preview.removeAttribute('src');
    }

    tooltip.dataset.anchorMode = resolved.element ? 'element' : showPreview ? 'screenshot' : 'none';
  }

  function enterCurrentStep() {
    const step = getCurrentStep();
    if (!step || !activeState) {
      return;
    }

    // Only emit when the step index changes. Leaving and returning (Previous → Next)
    // clears lastEnteredStepIndex via the index change, so a new entered_at is issued
    // for H09AAPPLE-30 without duplicating the open visit.
    if (lastEnteredStepIndex === activeState.stepIndex) {
      return;
    }

    const stepNumber = step.step_number ?? activeState.stepIndex + 1;
    lastEnteredStepIndex = activeState.stepIndex;
    currentVisitStepNumber = stepNumber;
    currentVisitEnteredAt = Date.now();
    try {
      chrome.runtime?.sendMessage?.({
        type: 'WALKTHROUGH_STEP_ENTERED',
        sopId: activeState.sopId,
        step_number: stepNumber,
        entered_at: currentVisitEnteredAt,
      });
    } catch {
      // Background may be unavailable; player still works offline of analytics.
    }
  }

  function render() {
    if (!activeState || activeState.status !== 'playing' || !isTargetTab(activeState)) {
      teardownHost();
      return;
    }

    const steps = getSteps();
    const step = getCurrentStep();
    if (!step || steps.length === 0) {
      teardownHost();
      return;
    }

    const root = ensureHost();
    ensureObservers();

    const tooltip = root.querySelector('.tooltip');
    const eyebrow = root.querySelector('.eyebrow');
    const instruction = root.querySelector('.instruction');
    const previousBtn = root.querySelector('[data-action="previous"]');
    const nextBtn = root.querySelector('[data-action="next"]');
    const finishBtn = root.querySelector('[data-action="finish"]');

    const stepNumber = step.step_number ?? activeState.stepIndex + 1;
    eyebrow.textContent = `Step ${activeState.stepIndex + 1} / ${steps.length}`;
    instruction.textContent = String(step.instruction ?? '');

    const isFirst = activeState.stepIndex <= 0;
    const isLast = activeState.stepIndex >= steps.length - 1;

    previousBtn.disabled = isFirst;
    previousBtn.hidden = false;
    nextBtn.hidden = isLast;
    finishBtn.hidden = !isLast;

    tooltip.hidden = false;
    enterCurrentStep();
    reposition();

    tooltip.dataset.stepNumber = String(stepNumber);
  }

  function persistState(nextState) {
    // Storage onChanged drives render so we do not double-enter a step.
    chrome.storage?.session?.set({ [STORAGE_STATE_KEY]: nextState });
  }

  function handlePrevious() {
    if (!activeState || activeState.stepIndex <= 0) {
      return;
    }
    persistState({
      ...activeState,
      stepIndex: activeState.stepIndex - 1,
    });
  }

  function handleNext() {
    const steps = getSteps();
    if (!activeState || activeState.stepIndex >= steps.length - 1) {
      return;
    }
    persistState({
      ...activeState,
      stepIndex: activeState.stepIndex + 1,
    });
  }

  function handleFinish() {
    // H09AAPPLE-30 owns the completion POST; emit a hook then clear local state.
    try {
      chrome.runtime?.sendMessage?.({
        type: 'WALKTHROUGH_FINISHED',
        sopId: activeState?.sopId ?? null,
        step_number: currentVisitStepNumber,
        entered_at: currentVisitEnteredAt,
      });
    } catch {
      // ignore
    }

    activeState = {
      status: 'idle',
      sopId: null,
      stepIndex: 0,
      tabId: null,
    };
    activePayload = null;
    chrome.storage?.session?.set({
      [STORAGE_STATE_KEY]: activeState,
      [STORAGE_PAYLOAD_KEY]: null,
    });
    teardownHost();
  }

  function syncFromStorage(result) {
    const state = result?.[STORAGE_STATE_KEY] ?? null;
    const payload = result?.[STORAGE_PAYLOAD_KEY] ?? null;

    activeState = state;
    activePayload = payload;

    if (
      state?.status === 'playing' &&
      Array.isArray(payload?.steps) &&
      payload.steps.length > 0 &&
      isTargetTab(state)
    ) {
      render();
    } else {
      teardownHost();
    }
  }

  function readAndSync() {
    if (!chrome.storage?.session) {
      return;
    }
    chrome.storage.session.get([STORAGE_STATE_KEY, STORAGE_PAYLOAD_KEY], (result) => {
      syncFromStorage(result);
    });
  }

  function resolveMyTabId(done) {
    try {
      chrome.runtime?.sendMessage?.({ type: 'GET_TAB_ID' }, (response) => {
        myTabId = response?.tabId ?? null;
        done?.();
      });
    } catch {
      myTabId = null;
      done?.();
    }
  }

  if (chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'session') {
        return;
      }
      if (!changes[STORAGE_STATE_KEY] && !changes[STORAGE_PAYLOAD_KEY]) {
        return;
      }

      const nextState = changes[STORAGE_STATE_KEY]
        ? changes[STORAGE_STATE_KEY].newValue
        : activeState;
      const nextPayload = changes[STORAGE_PAYLOAD_KEY]
        ? changes[STORAGE_PAYLOAD_KEY].newValue
        : activePayload;

      syncFromStorage({
        [STORAGE_STATE_KEY]: nextState,
        [STORAGE_PAYLOAD_KEY]: nextPayload,
      });
    });
  }

  resolveMyTabId(() => {
    readAndSync();
  });

  globalThis.WorkTraceWalkthrough = {
    resolveTarget,
    resolveAnchorMode,
    isTargetTab,
    readAndSync,
    teardownHost,
    getActiveState: () => activeState,
    getMyTabId: () => myTabId,
    getCurrentVisit: () => ({
      step_number: currentVisitStepNumber,
      entered_at: currentVisitEnteredAt,
    }),
  };
})();
