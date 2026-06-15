import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

test('content script captures clicks and navigations when recording', async () => {
  // 1. Initialize the JSDOM virtual browser environment
  const dom = new JSDOM(
    `
    <!DOCTYPE html>
    <html>
      <head><title>Test Page</title></head>
      <body>
        <div>
          <button id="submit-btn" aria-label="Submit Form">Submit</button>
          <button data-testid="cancel-btn">Cancel</button>
          <p>Not interactive</p>
        </div>
      </body>
    </html>
    `,
    {
      url: 'https://example.com/initial',
      runScripts: 'dangerously',
    },
  );

  const window = dom.window;
  const document = window.document;

  // Polyfill: JSDOM does not support CSS.escape
  window.CSS = { escape: (str) => str };

  // 2. Mock Chrome Extension API
  const sentMessages = [];
  let storageChangeCallback = null;

  window.chrome = {
    runtime: {
      sendMessage: (message) => sentMessages.push(message),
    },
    storage: {
      local: {
        // The initial state is simulated as being recorded
        get: (keys, callback) => callback({ recordingState: { status: 'recording' } }),
      },
      onChanged: {
        addListener: (callback) => {
          storageChangeCallback = callback;
        },
      },
    },
  };

  // 3. Read out the content.js we wrote and inject it into the virtual DOM for execution
  const contentScriptCode = readFileSync(new URL('./content.js', import.meta.url), 'utf-8');
  const scriptEl = document.createElement('script');
  scriptEl.textContent = contentScriptCode;
  document.head.appendChild(scriptEl);

  // a slight delay to ensure that the asynchronous chrome.storage.local.get is completed
  await new Promise((resolve) => setTimeout(resolve, 10));

  // 4. Verification: The Navigation during the initial loading should be captured
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, 'NAVIGATION');
  assert.equal(sentMessages[0].payload.url, 'https://example.com/initial');

  sentMessages.length = 0; // Clear the array, prepare for subsequent tests

  // 5. Verification: Clicking on the interactive element (<button>) should be captured
  const button = document.getElementById('submit-btn');
  button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, 'CLICK');
  assert.equal(sentMessages[0].payload.selector, 'button#submit-btn');
  assert.equal(sentMessages[0].payload.label, 'Submit Form');

  sentMessages.length = 0;

  // 6. Verification: Clicking on non-interactive elements (<p>) should be filtered out
  const paragraph = document.querySelector('p');
  paragraph.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(sentMessages.length, 0); // No new events sent

  // 7. Verification: The SPA route jump (History API) should be captured
  window.history.pushState({}, '', '/new-route');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, 'NAVIGATION');

  // 8. Verification: Deduplication of navigation events
  sentMessages.length = 0;
  window.history.pushState({}, '', '/duplicate-route');
  window.history.replaceState({}, '', '/duplicate-route');
  window.dispatchEvent(new window.Event('popstate'));
  assert.equal(sentMessages.length, 1); // Multiple triggers for the same URL should only send 1 event
  assert.equal(sentMessages[0].type, 'NAVIGATION');
  assert.equal(sentMessages[0].payload.url, 'https://example.com/duplicate-route');

  // 9. Verification: CSS selector respects data-testid
  sentMessages.length = 0;
  const cancelBtn = document.querySelector('[data-testid="cancel-btn"]');
  cancelBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].payload.selector, '[data-testid="cancel-btn"]');

  // 10. Verification: State-gated capture (stops recording when state changes to 'ready')
  sentMessages.length = 0;
  storageChangeCallback({ recordingState: { newValue: { status: 'ready' } } }, 'local');
  button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  window.history.pushState({}, '', '/ignored-route');
  assert.equal(sentMessages.length, 0); // Events should be ignored because isRecording is now false
});
