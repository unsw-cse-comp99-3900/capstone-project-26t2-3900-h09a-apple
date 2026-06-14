// Placeholder for page event capture in later recorder tickets.
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
  const label =
    element.innerText ||
    element.getAttribute('aria-label') ||
    element.getAttribute('placeholder') ||
    element.getAttribute('title') ||
    element.getAttribute('alt') ||
    element.value ||
    '';
  return String(label).trim().replace(/\s+/g, ' ').substring(0, 100);
}

let isRecording = false;

// Synchronize the recording status in the local storage
if (chrome.storage?.local) {
  chrome.storage.local.get(['recordingState'], (result) => {
    isRecording = result.recordingState?.status === 'recording';
    if (isRecording) {
      recordNavigation(); // Only when in the recording state will the loading navigation of the initial page be captured
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.recordingState) {
      isRecording = changes.recordingState.newValue?.status === 'recording';
    }
  });
}

function sendEvent(type, payload) {
  if (!isRecording) return; // In the non-recording state, events are directly discarded and not sent to the background

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

// 2. Capture navigation events
let lastUrl = '';

function recordNavigation() {
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
window.addEventListener('load', recordNavigation);
