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
          <input type="password" id="pwd" />
          <input type="text" id="email" aria-label="Email" />
          <input type="text" id="plain" />
          <input type="text" id="cc" class="sensitive-data" />
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
        get: (keys, callback) => setTimeout(() => callback({
          recordingState: { status: 'recording' },
          piiSelectors: ['.sensitive-data']
        }), 0),
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
  assert.equal(sentMessages[0].payload.selector, 'button[data-testid="cancel-btn"]');

  // 10. Verification: Password field produces no event
  sentMessages.length = 0;
  const pwdInput = document.getElementById('pwd');
  pwdInput.value = 'secret123';
  pwdInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 350)); // wait for debounce
  assert.equal(sentMessages.length, 0); 

  // 11. Verification: Input captured with 300ms debounce
  const plainInput = document.getElementById('plain');
  plainInput.value = 'hello';
  plainInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  plainInput.value = 'hello world';
  plainInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 100));
  assert.equal(sentMessages.length, 0); // Not triggered yet
  await new Promise(r => setTimeout(r, 250)); // Total > 300ms
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, 'INPUT');
  assert.equal(sentMessages[0].payload.value, 'hello world');

  // Simulate a 'change' event (e.g. from input blur) with the same value
  plainInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 350));
  // The length should STILL be 1 because the value hasn't changed (deduplication works!)
  assert.equal(sentMessages.length, 1);

  // 12. Verification: Email, Numeric ID and Date masking
  sentMessages.length = 0;
  const emailInput = document.getElementById('email');
  emailInput.value = 'My email is test@example.com and ID is 123456 born on 1990-01-01';
  emailInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 350));
  assert.equal(sentMessages[0].payload.value, 'My email is [MASKED] and ID is [MASKED] born on [MASKED]');

  // 13. Verification: Configurable PII selector masking
  sentMessages.length = 0;
  const ccInput = document.getElementById('cc');
  ccInput.value = 'Some harmless text but in a sensitive field';
  ccInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 350));
  assert.equal(sentMessages[0].payload.value, '[MASKED]');

  // 14. Verification: State-gated capture (stops recording when state changes to 'ready')
  sentMessages.length = 0;
  storageChangeCallback({ recordingState: { newValue: { status: 'ready' } } }, 'local');
  button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  window.history.pushState({}, '', '/ignored-route');
  assert.equal(sentMessages.length, 0); // Events should be ignored because isRecording is now false
});
