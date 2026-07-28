/**
 * Walkthrough overlay runtime for the content script world (classic script).
 * Loaded before content.js via manifest content_scripts order.
 *
 * Primary mode is LIVE overlay: resolve target on the page, anchor tooltip via
 * getBoundingClientRect. Screenshots are preview + fallback only (H09AAPPLE-28).
 * Resolution chain: CSS → XPath → label, then H09AAPPLE-53 vision grid locate
 * on selector_miss (pixel overlay; manual Next). Full text+role is H09AAPPLE-29.
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
  /** @type {{ element: Element, outline: string, outlineOffset: string } | null} */
  let currentHighlightRestore = null;
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
  /** @type {AbortController | null} */
  let currentStepListener = null;
  /** @type {Array<{
   *   step_number: number,
   *   event_type: 'wrong_target' | 'wrong_page' | 'empty_input' | 'selector_miss',
   *   occurred_at: number,
   * }>} */
  let frictionEvents = [];

  /** @type {Array<{
   *   step_number: number,
   *   entered_at: number,
   *   left_at: number,
   *   duration_ms: number,
   * }>} */
  let stepTimings = [];
  /** @type {number[]} Complete visit path; intentionally independent of timing retraction. */
  let stepSequence = [];

  function persistAnalyticsState() {
    if (!activeState) {
      return;
    }
    activeState = {
      ...activeState,
      stepSequence: [...stepSequence],
      stepTimings: stepTimings.map((timing) => ({ ...timing })),
      frictionEvents: frictionEvents.map((event) => ({ ...event })),
      activeVisit:
        currentVisitEnteredAt != null && currentVisitStepNumber != null
          ? {
              stepIndex: lastEnteredStepIndex,
              step_number: currentVisitStepNumber,
              entered_at: currentVisitEnteredAt,
            }
          : null,
    };
    chrome.storage?.session?.set({ [STORAGE_STATE_KEY]: activeState });
  }

  // Guards against re-recording selector_miss/wrong_page on every scroll,
  // resize, or DOM mutation while the same step's target stays unresolved.
  // Reset whenever the active step actually changes (see enterCurrentStep).
  /** @type {number | null} */
  let missFrictionStepIndex = null;

  // H09AAPPLE-53: pixel rect from vision grid locate (no DOM handle).
  /** @type {{ x: number, y: number, width: number, height: number } | null} */
  let visionRect = null;
  /** @type {number | null} */
  let visionLocateStepIndex = null;
  /** @type {number | null} */
  let visionLocateFailedStepIndex = null;
  let visionLocateInFlight = false;

  function describeStepForVision(step) {
    if (typeof step?.target_label === 'string' && step.target_label.trim()) {
      return step.target_label.trim();
    }
    if (typeof step?.instruction === 'string' && step.instruction.trim()) {
      return step.instruction.trim().slice(0, 500);
    }
    return '';
  }

  function resetVisionLocateLocal() {
    visionRect = null;
    visionLocateStepIndex = null;
    visionLocateFailedStepIndex = null;
    visionLocateInFlight = false;
  }

  function asAnchorRect(rect) {
    if (!rect) {
      return viewportCenterRect();
    }
    if (Number.isFinite(rect.left) && Number.isFinite(rect.top)) {
      return rect;
    }
    const x = Number(rect.x) || 0;
    const y = Number(rect.y) || 0;
    const width = Number(rect.width) || 0;
    const height = Number(rect.height) || 0;
    return {
      left: x,
      top: y,
      right: x + width,
      bottom: y + height,
      width,
      height,
    };
  }

  function applyPixelHighlight(highlightEl, rect) {
    if (!highlightEl || !rect) {
      return;
    }
    const anchor = asAnchorRect(rect);
    highlightEl.hidden = false;
    highlightEl.style.top = `${anchor.top}px`;
    highlightEl.style.left = `${anchor.left}px`;
    highlightEl.style.width = `${anchor.width}px`;
    highlightEl.style.height = `${anchor.height}px`;
  }

  function requestVisionLocateIfNeeded(step, anchorMode) {
    if (anchorMode !== 'element' || !activeState || !step) {
      return;
    }
    if (visionLocateInFlight) {
      return;
    }
    if (visionLocateStepIndex === activeState.stepIndex && visionRect) {
      return;
    }
    if (visionLocateFailedStepIndex === activeState.stepIndex) {
      return;
    }

    const description = describeStepForVision(step);
    if (!description) {
      visionLocateFailedStepIndex = activeState.stepIndex;
      return;
    }

    const stepIndex = activeState.stepIndex;
    visionLocateInFlight = true;

    try {
      chrome.runtime?.sendMessage?.(
        {
          type: 'WALKTHROUGH_VISION_LOCATE',
          sopId: activeState.sopId,
          stepNumber: step.step_number ?? stepIndex + 1,
          tabId: activeState.tabId ?? myTabId ?? null,
          pageKey: `${window.location.origin}${window.location.pathname}${window.location.search}`,
          description,
          instruction:
            typeof step.instruction === 'string' ? step.instruction.slice(0, 2000) : null,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        },
        (response) => {
          visionLocateInFlight = false;
          if (!activeState || activeState.stepIndex !== stepIndex) {
            return;
          }
          if (
            response?.ok &&
            response.rect &&
            Number.isFinite(response.rect.x) &&
            Number.isFinite(response.rect.y) &&
            Number.isFinite(response.rect.width) &&
            Number.isFinite(response.rect.height) &&
            response.rect.width > 0 &&
            response.rect.height > 0
          ) {
            visionLocateStepIndex = stepIndex;
            visionRect = {
              x: response.rect.x,
              y: response.rect.y,
              width: response.rect.width,
              height: response.rect.height,
            };
          } else {
            visionLocateFailedStepIndex = stepIndex;
          }
          // Re-render tooltip / pixel highlight without re-entering the step.
          if (shadowRoot && activeState?.status === 'playing') {
            reposition();
          }
        },
      );
    } catch {
      visionLocateInFlight = false;
      visionLocateFailedStepIndex = stepIndex;
    }
  }

  // Keep in sync with walkthrough-url-resolve.js (classic content script cannot import ESM).
  const ID_SEGMENT = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
  const CREATE_SEGMENTS = new Set(['new', 'create', 'add']);

  function isIdSegment(segment) {
    return typeof segment === 'string' && ID_SEGMENT.test(segment);
  }

  function generalizePathname(pathname) {
    if (typeof pathname !== 'string' || !pathname) {
      return '';
    }
    return pathname
      .split('/')
      .map((segment) => (isIdSegment(segment) ? '{id}' : segment))
      .join('/');
  }

  function isDynamicPathname(pathname) {
    if (typeof pathname !== 'string' || !pathname) {
      return false;
    }
    return pathname.split('/').some((segment) => isIdSegment(segment));
  }

  function resolvedUrlKey(origin, pathname) {
    return `${origin}${generalizePathname(pathname)}`;
  }

  function pathsAreSameResourceShape(leftPath, rightPath) {
    const left = String(leftPath || '').split('/');
    const right = String(rightPath || '').split('/');
    if (left.length !== right.length) {
      return false;
    }
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] === right[i]) {
        continue;
      }
      const leftFlexible = CREATE_SEGMENTS.has(left[i]) || isIdSegment(left[i]);
      const rightFlexible = CREATE_SEGMENTS.has(right[i]) || isIdSegment(right[i]);
      if (leftFlexible && rightFlexible) {
        continue;
      }
      return false;
    }
    return true;
  }

  function learnFromStepTransition(resolvedUrls, recordedStepUrl, liveUrl) {
    const base = resolvedUrls && typeof resolvedUrls === 'object' ? { ...resolvedUrls } : {};
    try {
      const live = new URL(liveUrl);
      if (!isDynamicPathname(live.pathname)) {
        return base;
      }
      if (typeof recordedStepUrl === 'string' && recordedStepUrl.trim()) {
        const recorded = new URL(recordedStepUrl, liveUrl);
        if (
          recorded.origin === live.origin &&
          recorded.pathname !== live.pathname &&
          pathsAreSameResourceShape(recorded.pathname, live.pathname)
        ) {
          const key = resolvedUrlKey(live.origin, live.pathname);
          base[key] = `${live.origin}${live.pathname}${live.search}`;
        }
      }
      return base;
    } catch {
      return base;
    }
  }

  function resolvePlaybackTargetUrl(recordedUrl, resolvedUrls, liveUrlFallback) {
    if (typeof recordedUrl !== 'string' || !recordedUrl.trim()) {
      return { url: null, mode: 'none' };
    }
    const trimmed = recordedUrl.trim();
    const map = resolvedUrls && typeof resolvedUrls === 'object' ? resolvedUrls : {};
    try {
      const recorded = new URL(trimmed, liveUrlFallback || undefined);
      const key = resolvedUrlKey(recorded.origin, recorded.pathname);
      if (typeof map[key] === 'string' && map[key]) {
        return { url: map[key], mode: 'resolved' };
      }
      if (typeof liveUrlFallback === 'string' && liveUrlFallback.trim()) {
        const live = new URL(liveUrlFallback);
        if (
          live.origin === recorded.origin &&
          generalizePathname(live.pathname) === generalizePathname(recorded.pathname) &&
          isDynamicPathname(recorded.pathname)
        ) {
          return {
            url: `${live.origin}${live.pathname}${live.search}`,
            mode: 'live',
          };
        }
      }
      if (isDynamicPathname(recorded.pathname)) {
        return { url: null, mode: 'unresolved_dynamic' };
      }
      return { url: trimmed, mode: 'recorded' };
    } catch {
      return { url: trimmed, mode: 'recorded' };
    }
  }

  function getResolvedUrls() {
    return activeState?.resolvedUrls && typeof activeState.resolvedUrls === 'object'
      ? activeState.resolvedUrls
      : {};
  }

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

    // CSS selector
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

    // XPath
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

    // Basic label fallback.
    if (typeof step.target_label === 'string' && step.target_label.trim()) {
      const label = step.target_label.trim().toLowerCase();

      const candidates = doc.querySelectorAll('input, textarea, select, button, a, label');

      for (const element of candidates) {
        const values = [
          element.textContent,
          element.getAttribute('aria-label'),
          element.getAttribute('placeholder'),
          element.getAttribute('title'),
        ];

        if (
          values.some((value) => typeof value === 'string' && value.trim().toLowerCase() === label)
        ) {
          // If we matched a <label for="...">, return the associated control.
          if (element.tagName === 'LABEL') {
            const htmlFor = element.getAttribute('for');
            if (htmlFor) {
              const control = doc.getElementById(htmlFor);
              if (control) {
                return { element: control, mode: 'label' };
              }
            }
          }

          return { element, mode: 'label' };
        }
      }
    }

    return { element: null, mode: 'fallback' };
  }

  function removeHighlight() {
    if (!currentHighlightRestore) {
      return;
    }

    const { element, outline, outlineOffset } = currentHighlightRestore;

    element.style.outline = outline;
    element.style.outlineOffset = outlineOffset;

    currentHighlightRestore = null;
    currentTarget = null;
  }

  function applyHighlight(element) {
    if (!element) {
      return;
    }

    if (currentHighlightRestore?.element === element) {
      return;
    }

    removeHighlight();

    currentHighlightRestore = {
      element,
      outline: element.style.outline,
      outlineOffset: element.style.outlineOffset,
    };

    element.style.outline = '3px solid #756eff';
    element.style.outlineOffset = '2px';

    currentTarget = element;
  }

  function detachStepListener() {
    if (!currentStepListener) {
      return;
    }

    currentStepListener.abort();
    currentStepListener = null;
  }

  /**
   * Records a `wrong_target` friction event when the person clicks somewhere
   * on the page other than the step's resolved target (or one of its
   * descendants) while a click/submit step is active. Bound with the same
   * AbortController signal as the step's own advance listener, so it is torn
   * down automatically whenever detachStepListener() runs - no separate
   * cleanup path to remember.
   */
  function attachWrongTargetListener(targetElement, signal) {
    const handler = (event) => {
      if (
        event.target instanceof Node &&
        (event.target === targetElement || targetElement.contains(event.target))
      ) {
        return;
      }
      // Ignore clicks on our own tooltip/overlay (Previous/Next/Finish etc.).
      if (
        hostEl &&
        event.target instanceof Node &&
        (event.target === hostEl || hostEl.contains(event.target))
      ) {
        return;
      }
      recordFriction('wrong_target');
    };

    document.addEventListener('click', handler, { capture: true, signal });
  }

  function attachStepListener(step, element) {
    if (!step || !element || !step.expected_action) {
      detachStepListener();
      return;
    }

    // Already listening on this element.
    if (currentStepListener && currentHighlightRestore?.element === element) {
      return;
    }

    detachStepListener();

    currentStepListener = new AbortController();
    const { signal } = currentStepListener;

    const advance = () => {
      detachStepListener();
      handleNext();
    };

    switch (step.expected_action) {
      case 'click':
        element.addEventListener('click', advance, {
          once: true,
          signal,
        });
        attachWrongTargetListener(element, signal);
        break;

      case 'input': {
        const handler = (event) => {
          const target = /** @type {HTMLInputElement | HTMLTextAreaElement | null} */ (
            event.target
          );
          const value = typeof target?.value === 'string' ? target.value.trim() : '';

          if (!value) {
            recordFriction('empty_input');
            return;
          }

          advance();
        };

        element.addEventListener('input', handler, {
          signal,
        });

        break;
      }
      case 'submit':
        if (element instanceof HTMLFormElement) {
          element.addEventListener('submit', advance, {
            once: true,
            signal,
          });
        } else {
          // Submit buttons normally emit click; the form emits submit.
          element.addEventListener('click', advance, {
            once: true,
            signal,
          });
        }
        attachWrongTargetListener(element, signal);
        break;

      default:
        break;
    }
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

    // Intentionally does NOT call leaveCurrentStep(): teardown is DOM/observer
    // cleanup, not a walkthrough lifecycle event. Step-visit boundaries are
    // owned by handlePrevious/handleNext/handleFinish, which already call
    // leaveCurrentStep() before any state transition that leads here.
    detachStepListener();
    removeHighlight();

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

        refreshHighlight();
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

  function isWrongPage(step) {
    const recorded = stepPageUrl(step);
    if (!recorded) {
      return false;
    }

    try {
      const current = new URL(window.location.href);
      const expected = new URL(recorded, window.location.href);
      const resolved = resolvePlaybackTargetUrl(recorded, getResolvedUrls(), window.location.href);

      if (resolved.mode === 'resolved' || resolved.mode === 'live') {
        const target = new URL(resolved.url);
        return current.origin !== target.origin || current.pathname !== target.pathname;
      }

      if (resolved.mode === 'unresolved_dynamic') {
        return (
          current.origin !== expected.origin ||
          generalizePathname(current.pathname) !== generalizePathname(expected.pathname)
        );
      }

      return current.origin !== expected.origin || current.pathname !== expected.pathname;
    } catch {
      return false;
    }
  }

  // Records selector_miss/wrong_page at most once per step visit, so scroll/
  // resize/mutation-driven re-checks (refreshHighlight, reposition) don't
  // flood frictionEvents with duplicates for the same unresolved target.
  function recordSelectorMissOnce(step, anchorMode) {
    if (anchorMode !== 'element') {
      return;
    }
    if (!activeState) {
      return;
    }
    if (missFrictionStepIndex === activeState.stepIndex) {
      return;
    }
    missFrictionStepIndex = activeState.stepIndex;
    recordFriction('selector_miss');

    if (isWrongPage(step)) {
      recordFriction('wrong_page');
    }
  }

  function refreshHighlight() {
    const step = getCurrentStep();
    if (!step) {
      detachStepListener();
      removeHighlight();
      return;
    }

    const anchorMode = resolveAnchorMode(step);
    const resolved = resolveTarget(step);

    if (resolved.element) {
      applyHighlight(resolved.element);
      attachStepListener(step, resolved.element);
    } else {
      recordSelectorMissOnce(step, anchorMode);

      detachStepListener();
      removeHighlight();
    }
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

    const fallbackNote = shadowRoot.querySelector('.fallback-note');
    const preview = shadowRoot.querySelector('.preview');
    const hasScreenshot = typeof step.screenshot_url === 'string' && Boolean(step.screenshot_url);
    const showPreview = hasScreenshot && anchorMode !== 'none';

    if (resolved.element) {
      const rect = resolved.element.getBoundingClientRect();

      applyHighlight(resolved.element);
      attachStepListener(step, resolved.element);

      // DOM outline is primary; hide pixel overlay when a real element exists.
      highlight.hidden = true;

      fallbackNote.hidden = true;
      fallbackNote.textContent = '';

      placeTooltip(tooltip, rect);
      tooltip.dataset.anchorMode = 'element';
    } else {
      recordSelectorMissOnce(step, anchorMode);

      removeHighlight();
      detachStepListener();

      const hasVisionRect =
        visionRect &&
        visionLocateStepIndex === activeState.stepIndex &&
        visionRect.width > 0 &&
        visionRect.height > 0;

      if (hasVisionRect) {
        applyPixelHighlight(highlight, visionRect);
        placeTooltip(tooltip, asAnchorRect(visionRect));
        fallbackNote.hidden = false;
        fallbackNote.textContent =
          'Target located visually (DOM unavailable). Use Next to continue.';
        tooltip.dataset.anchorMode = 'vision';
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

        tooltip.dataset.anchorMode = showPreview ? 'screenshot' : 'none';
        requestVisionLocateIfNeeded(step, anchorMode);
      }
    }

    if (showPreview && tooltip.dataset.anchorMode !== 'vision') {
      preview.hidden = false;
      preview.src = step.screenshot_url;
    } else if (showPreview && tooltip.dataset.anchorMode === 'vision') {
      // Prefer live vision highlight; keep screenshot available but collapsed.
      preview.hidden = true;
      preview.removeAttribute('src');
    } else {
      preview.hidden = true;
      preview.removeAttribute('src');
    }
  }

  function enterCurrentStep() {
    const step = getCurrentStep();
    if (!step || !activeState) {
      return;
    }

    // Only emit when the step index changes. Previous abandons the forward step
    // and retracts its timing; re-entering the destination issues a fresh
    // entered_at without keeping a duplicate open visit.
    if (lastEnteredStepIndex === activeState.stepIndex) {
      return;
    }

    // New step visit: allow a fresh selector_miss/wrong_page recording for it.
    missFrictionStepIndex = null;
    resetVisionLocateLocal();

    const stepNumber = step.step_number ?? activeState.stepIndex + 1;
    lastEnteredStepIndex = activeState.stepIndex;
    currentVisitStepNumber = stepNumber;
    currentVisitEnteredAt = Date.now();
    stepSequence.push(stepNumber);
    // Keep all analytics across page navigations, which reload this content script.
    persistAnalyticsState();
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

  function clearCurrentVisit() {
    currentVisitEnteredAt = null;
    currentVisitStepNumber = null;
  }

  /**
   * Finalize the open visit into stepTimings (Next / Finish).
   * Previous uses abandonCurrentStep() instead so a retreat does not keep
   * the step being left.
   */
  function leaveCurrentStep() {
    if (currentVisitEnteredAt == null || currentVisitStepNumber == null) {
      return;
    }

    const leftAt = Date.now();
    const durationMs = leftAt - currentVisitEnteredAt;

    const stepNumber = currentVisitStepNumber;
    const enteredAt = currentVisitEnteredAt;
    stepTimings.push({
      step_number: stepNumber,
      entered_at: enteredAt,
      left_at: leftAt,
      duration_ms: durationMs,
    });
    clearCurrentVisit();
    persistAnalyticsState();

    try {
      chrome.runtime?.sendMessage?.({
        type: 'WALKTHROUGH_STEP_LEFT',
        step_number: stepNumber,
        entered_at: enteredAt,
        left_at: leftAt,
        duration_ms: durationMs,
      });
    } catch {}
  }

  /** Drop the open visit without recording it (Previous retreat). */
  function abandonCurrentStep() {
    clearCurrentVisit();
  }

  /**
   * After Previous to destinationStepNumber, drop timings for that step and
   * any later ones so the destination can be re-timed, and drop friction that
   * only happened on abandoned forward steps.
   */
  function retractPathToStep(destinationStepNumber) {
    stepTimings = stepTimings.filter((t) => t.step_number < destinationStepNumber);
    frictionEvents = frictionEvents.filter((e) => e.step_number <= destinationStepNumber);
    persistAnalyticsState();
  }

  // Single source of truth for tearing down an in-progress run's bookkeeping,
  // whether that happens via Finish or via an external stop (e.g. popup Stop
  // clearing storage out from under us). Always finalizes the open step's
  // left_at/duration first, then clears listeners/highlight/friction/timings
  // so a subsequent walkthrough on the same page starts from a clean slate.
  function resetWalkthroughState() {
    leaveCurrentStep();

    detachStepListener();
    removeHighlight();

    frictionEvents = [];
    stepTimings = [];
    stepSequence = [];
    missFrictionStepIndex = null;

    currentVisitEnteredAt = null;
    currentVisitStepNumber = null;
    lastEnteredStepIndex = null;

    if (activeState?.status !== 'playing') {
      persistAnalyticsState();
    }
  }

  function recordFriction(eventType) {
    frictionEvents.push({
      step_number: currentVisitStepNumber,
      event_type: eventType,
      occurred_at: Date.now(),
    });
    persistAnalyticsState();
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

  function stepPageUrl(step) {
    if (typeof step?.expected_url === 'string' && step.expected_url.trim()) {
      return step.expected_url.trim();
    }
    if (typeof step?.page_url === 'string' && step.page_url.trim()) {
      return step.page_url.trim();
    }
    return null;
  }

  function needsNavigation(targetUrl) {
    if (!targetUrl) {
      return false;
    }

    try {
      const current = new URL(window.location.href);
      const target = new URL(targetUrl, window.location.href);
      return (
        current.origin !== target.origin ||
        current.pathname !== target.pathname ||
        current.search !== target.search
      );
    } catch {
      return false;
    }
  }

  function requestStepPage(targetUrl) {
    try {
      chrome.runtime?.sendMessage?.({
        type: 'WALKTHROUGH_ENSURE_PAGE',
        url: targetUrl,
        tabId: activeState?.tabId ?? myTabId ?? null,
      });
    } catch {
      // Background may be unavailable; overlay stays on the current page.
    }
  }

  function navigateForStep(step, resolvedUrls, liveUrl) {
    const recorded = stepPageUrl(step);
    const resolved = resolvePlaybackTargetUrl(recorded, resolvedUrls, liveUrl);
    if (!resolved.url) {
      return resolved;
    }
    if (needsNavigation(resolved.url)) {
      requestStepPage(resolved.url);
    }
    return resolved;
  }

  function handlePrevious() {
    if (!activeState || activeState.stepIndex <= 0) {
      return;
    }

    const destinationIndex = activeState.stepIndex - 1;
    const destinationStep = getSteps()[destinationIndex];
    const destinationStepNumber = destinationStep?.step_number ?? destinationIndex + 1;
    const liveUrl = window.location.href;
    const leavingRecorded = stepPageUrl(getCurrentStep());
    const resolvedUrls = learnFromStepTransition(getResolvedUrls(), leavingRecorded, liveUrl);

    // Retreat: discard the step being left (e.g. 8) and reopen the destination
    // (e.g. 7) so completion keeps one timing row per step on the final path.
    abandonCurrentStep();
    retractPathToStep(destinationStepNumber);
    detachStepListener();
    removeHighlight();

    persistState({
      ...activeState,
      stepIndex: destinationIndex,
      resolvedUrls,
    });

    navigateForStep(destinationStep, resolvedUrls, liveUrl);
  }

  function handleNext() {
    const steps = getSteps();
    if (!activeState || activeState.stepIndex >= steps.length - 1) {
      return;
    }

    const nextIndex = activeState.stepIndex + 1;
    const liveUrl = window.location.href;
    const leavingRecorded = stepPageUrl(getCurrentStep());
    const resolvedUrls = learnFromStepTransition(getResolvedUrls(), leavingRecorded, liveUrl);

    leaveCurrentStep();
    detachStepListener();
    removeHighlight();

    persistState({
      ...activeState,
      stepIndex: nextIndex,
      resolvedUrls,
    });

    navigateForStep(steps[nextIndex], resolvedUrls, liveUrl);
  }

  function handleFinish() {
    detachStepListener();
    removeHighlight();

    try {
      // Push the final step's timing entry before we read frictionEvents/stepTimings
      // for the completion message.
      leaveCurrentStep();

      // H09AAPPLE-30 owns the completion POST; emit a hook with the full
      // friction/timing history collected during this run.
      chrome.runtime?.sendMessage?.({
        type: 'WALKTHROUGH_FINISHED',
        sopId: activeState?.sopId ?? null,
        friction_events: frictionEvents,
        step_timings: stepTimings,
        step_sequence: stepSequence,
      });
    } catch {
      // ignore
    } finally {
      // resetWalkthroughState() calls leaveCurrentStep() again internally;
      // that second call is a guarded no-op (currentVisitEnteredAt is already
      // null from the call above) but keeps this the single place that clears
      // frictionEvents/stepTimings/lastEnteredStepIndex, rather than
      // duplicating that list here too.
      resetWalkthroughState();
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

    const wasPlaying = activeState?.status === 'playing';

    activeState = state;
    activePayload = payload;
    stepSequence = Array.isArray(state?.stepSequence)
      ? [...state.stepSequence]
      : wasPlaying
        ? stepSequence
        : [];
    stepTimings = Array.isArray(state?.stepTimings)
      ? state.stepTimings.map((timing) => ({ ...timing }))
      : wasPlaying
        ? stepTimings
        : [];
    frictionEvents = Array.isArray(state?.frictionEvents)
      ? state.frictionEvents.map((event) => ({ ...event }))
      : wasPlaying
        ? frictionEvents
        : [];
    if (
      state?.status === 'playing' &&
      state.activeVisit?.stepIndex === state.stepIndex &&
      Number.isFinite(state.activeVisit.entered_at) &&
      Number.isFinite(state.activeVisit.step_number)
    ) {
      currentVisitEnteredAt = state.activeVisit.entered_at;
      currentVisitStepNumber = state.activeVisit.step_number;
      lastEnteredStepIndex = state.activeVisit.stepIndex;
    } else if (!wasPlaying) {
      clearCurrentVisit();
      lastEnteredStepIndex = null;
    }

    // Walkthrough stopped externally (e.g. popup Stop clearing storage out
    // from under this content script, rather than going through handleFinish).
    // Finalize the open step's timing and clear frictionEvents/stepTimings/
    // lastEnteredStepIndex so a subsequent run on this page doesn't inherit
    // leftover data from the aborted one.
    if (wasPlaying && state?.status !== 'playing') {
      resetWalkthroughState();
    }

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

  if (chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== 'WALKTHROUGH_SYNC') {
        return false;
      }

      readAndSync();
      sendResponse({ ok: true });
      return false;
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
    learnFromStepTransition,
    resolvePlaybackTargetUrl,
    generalizePathname,
  };
})();
