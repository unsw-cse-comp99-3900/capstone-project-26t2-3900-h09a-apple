const CONSENT_STORAGE_KEY = 'dataCaptureConsent';
const CONSENT_TERMS_VERSION = '2026-07-01';

function isConsentCurrent(consent) {
  return consent?.accepted === true && consent.version === CONSENT_TERMS_VERSION;
}

// Placeholder for page event capture in later recorder tickets.
const WORKTRACE_PAGE_MESSAGE_SOURCE = 'worktrace-web';
const WORKTRACE_EXTENSION_MESSAGE_SOURCE = 'worktrace-extension';

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.source !== WORKTRACE_PAGE_MESSAGE_SOURCE) {
    return;
  }

  if (event.data.type !== 'GET_SESSION_PAYLOAD') {
    return;
  }

  chrome.runtime.sendMessage(
    {
      type: 'GET_SESSION_PAYLOAD',
      sessionId: event.data.sessionId,
    },
    (response) => {
      window.postMessage(
        {
          source: WORKTRACE_EXTENSION_MESSAGE_SOURCE,
          type: 'GET_SESSION_PAYLOAD_RESULT',
          requestId: event.data.requestId,
          response,
        },
        window.location.origin,
      );
    },
  );
});

/**
 * Generates a stable CSS selector for a given element.
 */
function getCssSelector(el) {
  if (!(el instanceof Element)) return '';
  const path = [];
  while (el.nodeType === Node.ELEMENT_NODE) {
    let selector = el.nodeName.toLowerCase();
    if (el.id) {
      selector += '#' + CSS.escape(el.id);
      path.unshift(selector);
      break; // IDs are expected to be unique, we can stop here
    } else if (el.hasAttribute('data-testid')) {
      selector += `[data-testid="${CSS.escape(el.getAttribute('data-testid'))}"]`;
      path.unshift(selector);
      break; // data-testid is also a unique and stable identifier
    } else if (el.hasAttribute('data-id')) {
      selector += `[data-id="${CSS.escape(el.getAttribute('data-id'))}"]`;
      path.unshift(selector);
      break;
    } else {
      let sib = el,
        nth = 1;
      while ((sib = sib.previousElementSibling)) {
        if (sib.nodeName.toLowerCase() === selector) nth++;
      }
      let hasNext = false;
      let nextSib = el;
      while ((nextSib = nextSib.nextElementSibling)) {
        if (nextSib.nodeName.toLowerCase() === selector) {
          hasNext = true;
          break;
        }
      }
      // Attach the :nth-of-type() pseudo-class only if there are sibling elements of the same type
      if (nth !== 1 || hasNext) {
        selector += `:nth-of-type(${nth})`;
      }
    }
    path.unshift(selector);
    el = el.parentNode;
  }
  return path.join(' > ');
}

/**
 * Extracts visible label or aria-label for a given element.
 */
function getElementLabel(element) {
  let label = '';

  // 1. Try to get the text from the associated <label> element
  if (element.labels && element.labels.length > 0) {
    label = Array.from(element.labels)
      .map((l) => l.innerText || l.textContent)
      .join(' ');
  }

  // 2. Try standard attributes and content
  if (!label) {
    label =
      element.innerText ||
      element.getAttribute('aria-label') ||
      element.getAttribute('placeholder') ||
      element.getAttribute('title') ||
      element.getAttribute('alt') ||
      '';
  }

  // 3. Fallback for buttons ONLY (prevent PII leakage from text input values)
  if (!label && ['button', 'submit', 'reset'].includes(element.type)) {
    label = element.value || '';
  }

  // 4. Fallback to name attribute
  if (!label) {
    label = element.name || '';
  }

  return String(label).trim().replace(/\s+/g, ' ').substring(0, 100);
}

let isRecording = null; // null means 'initializing', true/false mean resolved
let pendingEvents = []; // Queue for events fired before state resolves
let piiSelectors = [];

// Synchronize the recording status in the local storage
if (chrome.storage?.local) {
  chrome.storage.local.get(['recordingState', 'piiSelectors'], (result) => {
    piiSelectors = result.piiSelectors || []; // Always load PII config, even if recording state resolves early
    if (isRecording !== null) return; // Prevent stale state overwrite during rapid start
    isRecording = result.recordingState?.status === 'recording';
    if (isRecording) {
      pendingEvents.forEach((evt) => sendEvent(evt.type, evt.payload));
      recordNavigation(); // Only when in the recording state will the loading navigation of the initial page be captured
    }
    pendingEvents = []; // Flush the queue
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.recordingState) {
        const newStatus = changes.recordingState.newValue?.status === 'recording';
        if (newStatus && !isRecording) {
          chrome.storage.local.get([CONSENT_STORAGE_KEY], (result) => {
            const consent = result[CONSENT_STORAGE_KEY] ?? null;
            if (!isConsentCurrent(consent)) {
              isRecording = false;
              chrome.storage?.local.set({
                recordingState: {
                  ...changes.recordingState.newValue,
                  status: 'ready',
                },
              });
              return;
            }

            isRecording = true;
            lastUrl = '';
            recordNavigation();
          });
        } else {
          isRecording = newStatus;
        }
      }
      if (changes.piiSelectors) {
        piiSelectors = changes.piiSelectors.newValue || [];
      }
    }
  });
}

function sendEvent(type, payload) {
  if (isRecording === false) return; // Discard if definitely not recording

  // if the content.js is still in the process of initializing, all the events
  // happens will be add to pending queue.
  if (isRecording === null) {
    pendingEvents.push({ type, payload }); // Queue if state is still loading
    return;
  }

  try {
    chrome.runtime.sendMessage({ type, payload });
  } catch (error) {
    console.warn('Failed to send event to extension background:', error);
  }
}

/**
 * Finds the closest interactive element starting from the given node.
 */
function getClosestInteractiveElement(el) {
  const interactiveTags = new Set([
    'button',
    'a',
    'input',
    'select',
    'textarea',
    'details',
    'summary',
  ]);
  while (el && el instanceof Element) {
    if (
      interactiveTags.has(el.nodeName.toLowerCase()) ||
      el.getAttribute('role') === 'button' ||
      el.getAttribute('role') === 'link' ||
      el.hasAttribute('onclick')
    ) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

/**
 * Masks PII data from text values.
 */
function maskValue(value, element) {
  if (!value) return value;

  // 1. Fully mask if element matches configurable PII selectors
  if (
    piiSelectors.some((selector) => {
      try {
        return element.matches(selector);
      } catch (e) {
        console.warn('[WorkTrace] Invalid PII selector, masking by default:', selector);
        return true; // fail-closed: a bad config must still mask
      }
    })
  ) {
    return '[MASKED]';
  }

  // 2. Regex-based masking for general text
  let maskedValue = String(value);
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const idRegex = /\b\d{5,}\b/g; // Assuming IDs are 5+ digits
  const dateRegex = /\b\d{1,4}[-/]\d{1,2}[-/]\d{1,4}\b/g; // Matches formats like YYYY-MM-DD or DD/MM/YYYY

  maskedValue = maskedValue.replace(emailRegex, '[MASKED]');
  maskedValue = maskedValue.replace(idRegex, '[MASKED]');
  maskedValue = maskedValue.replace(dateRegex, '[MASKED]');
  return maskedValue;
}

// 1. Capture click events
document.addEventListener(
  'click',
  (event) => {
    const interactiveTarget = getClosestInteractiveElement(event.target);
    if (interactiveTarget) {
      const payload = {
        selector: getCssSelector(interactiveTarget),
        label: getElementLabel(interactiveTarget),
        url: window.location.href,
        title: document.title,
        timestamp: Date.now(),
      };
      sendEvent('CLICK', payload);
    }
  },
  true, // Capture phase: capture the click early before any page code stops its propagation
);

// 1.5 Capture input/change events with debounce and masking
const inputTimers = new WeakMap();
const lastSentValues = new WeakMap();

function handleInput(event) {
  const target = event.target;
  const interactiveTags = new Set(['input', 'textarea', 'select']);

  if (!interactiveTags.has(target.nodeName.toLowerCase())) return;
  if (target.type === 'password') return; // Totally ignore password fields

  if (inputTimers.has(target)) {
    clearTimeout(inputTimers.get(target));
  }

  const timer = setTimeout(() => {
    if (isRecording === false) return;

    // Deduplicate: Don't send if the value hasn't changed since the last recorded event
    const currentValue = target.value;
    if (lastSentValues.get(target) === currentValue) return;
    lastSentValues.set(target, currentValue);

    const payload = {
      selector: getCssSelector(target),
      label: getElementLabel(target),
      value: maskValue(currentValue, target),
      url: window.location.href,
      title: document.title,
      timestamp: Date.now(),
    };
    sendEvent('INPUT', payload);
  }, 300);

  inputTimers.set(target, timer);
}

document.addEventListener('input', handleInput, true);
document.addEventListener('change', handleInput, true);

// 2. Capture navigation events
let lastUrl = '';

function recordNavigation() {
  if (isRecording === false) return; // Prevent mutating lastUrl when recording is off

  const currentUrl = window.location.href;
  if (currentUrl === lastUrl) return; // Deduplicate concurrent navigation triggers
  lastUrl = currentUrl;

  sendEvent('NAVIGATION', {
    url: currentUrl,
    title: document.title,
    timestamp: Date.now(),
  });
}

const originalPushState = history.pushState;
history.pushState = function (...args) {
  const result = originalPushState.apply(this, args);
  recordNavigation();
  return result;
};

const originalReplaceState = history.replaceState;
history.replaceState = function (...args) {
  const result = originalReplaceState.apply(this, args);
  recordNavigation();
  return result;
};

window.addEventListener('popstate', recordNavigation);
window.addEventListener('hashchange', recordNavigation);

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  recordNavigation();
} else {
  window.addEventListener('load', recordNavigation, { once: true });
}
