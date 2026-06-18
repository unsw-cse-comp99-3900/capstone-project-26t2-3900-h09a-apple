import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// Builds a popup-like DOM and stubs the Chrome extension APIs used by popup.js
function setupPopupDom(recordingState = { status: 'ready', workflowName: '' }) {
  const popupHtml = readFileSync(new URL('./popup.html', import.meta.url), 'utf-8');
  const dom = new JSDOM(popupHtml, {
    url: 'chrome-extension://worktrace/popup.html',
  });
  const openedTabs = [];
  let persistedRecordingState = recordingState;

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.chrome = {
    storage: {
      local: {
        get: (_keys, callback) => callback({ recordingState: persistedRecordingState }),
        set: (value) => {
          persistedRecordingState = value.recordingState;
        },
      },
      session: {
        get: (_keys, callback) => callback({ eventBuffer: [] }),
        set: () => Promise.resolve(),
      },
      onChanged: {
        addListener: () => {},
      },
    },
    tabs: {
      create: (options) => openedTabs.push(options),
    },
  };

  return { dom, openedTabs };
}

async function loadPopupScript() {
  // Cache-bust the dynamic import so each test gets a fresh popup.js module.
  await import(`./popup.js?test=${crypto.randomUUID()}`);
}

async function flushPromises() {
  // Start Recording awaits chrome.storage.session.set(), so let that promise settle.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('review session button is only available after recording is completed', async () => {
  const { dom, openedTabs } = setupPopupDom();
  await loadPopupScript();

  const workflowNameInput = dom.window.document.querySelector('#workflowName');
  const startButton = dom.window.document.querySelector('#startButton');
  const stopButton = dom.window.document.querySelector('#stopButton');
  const reviewButton = dom.window.document.querySelector('#reviewButton');
  const statusText = dom.window.document.querySelector('#statusText');
  const form = dom.window.document.querySelector('#recordingForm');

  assert.equal(statusText.textContent, 'Ready');
  assert.equal(reviewButton.hidden, true);
  assert.equal(reviewButton.disabled, true);

  // Entering a workflow name enables Start, at the same time Review remains unavailable.
  workflowNameInput.value = 'Refund workflow';
  workflowNameInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(startButton.disabled, false);
  assert.equal(reviewButton.hidden, true);

  // Recording: Stop is enabled, Review is still unavailable
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await flushPromises();
  assert.equal(statusText.textContent, 'Recording');
  assert.equal(stopButton.disabled, false);
  assert.equal(reviewButton.hidden, true);

  // Completed: Review becomes visible and enabled
  stopButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(statusText.textContent, 'Completed');
  assert.equal(reviewButton.hidden, false);
  assert.equal(reviewButton.disabled, false);

  // Clicking Review opens the session review route with the generated session id
  reviewButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(openedTabs.length, 1);
  assert.match(openedTabs[0].url, /\/session\/review\?id=/);
});
