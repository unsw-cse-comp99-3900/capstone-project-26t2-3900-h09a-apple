import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

function loadRuntime({ walkthroughState = null, walkthroughPayload = null, tabId = 1 } = {}) {
  const dom = new JSDOM(
    `
    <!DOCTYPE html>
    <html>
      <body>
        <button id="save-btn">Save</button>
        <input id="name-field" />
      </body>
    </html>
    `,
    { url: 'https://example.com/app', runScripts: 'dangerously', pretendToBeVisual: true },
  );

  const window = dom.window;
  const document = window.document;
  const sentMessages = [];
  let sessionValues = {
    walkthroughState,
    walkthroughPayload,
  };
  const changeListeners = [];

  window.chrome = {
    runtime: {
      sendMessage: (message, callback) => {
        sentMessages.push(message);
        if (message.type === 'GET_TAB_ID') {
          callback?.({ ok: true, tabId });
        }
      },
    },
    storage: {
      session: {
        get: (keys, callback) => {
          const result = {};
          for (const key of keys) {
            result[key] = sessionValues[key] ?? null;
          }
          callback(result);
        },
        set: (values, callback = () => {}) => {
          sessionValues = { ...sessionValues, ...values };
          const changes = {};
          for (const [key, value] of Object.entries(values)) {
            changes[key] = { newValue: value };
          }
          for (const listener of changeListeners) {
            listener(changes, 'session');
          }
          callback();
        },
      },
      onChanged: {
        addListener: (callback) => {
          changeListeners.push(callback);
        },
      },
    },
  };

  // JSDOM lacks requestAnimationFrame by default in some versions.
  window.requestAnimationFrame = (cb) => setTimeout(cb, 0);

  const code = readFileSync(new URL('./walkthrough-runtime.js', import.meta.url), 'utf-8');
  const scriptEl = document.createElement('script');
  scriptEl.textContent = code;
  document.head.appendChild(scriptEl);

  return {
    window,
    document,
    sentMessages,
    sessionValues: () => sessionValues,
    async flush() {
      await new Promise((resolve) => setTimeout(resolve, 20));
    },
  };
}

test('resolveTarget prefers css_selector then xpath then fallback', async () => {
  const { window, document, flush } = loadRuntime();
  await flush();

  const api = window.WorkTraceWalkthrough;
  assert.ok(api);

  const byCss = api.resolveTarget({ css_selector: '#save-btn' }, document);
  assert.equal(byCss.mode, 'css');
  assert.equal(byCss.element.id, 'save-btn');

  const byXpath = api.resolveTarget(
    { css_selector: '#missing', xpath: "//*[@id='name-field']" },
    document,
  );
  assert.equal(byXpath.mode, 'xpath');
  assert.equal(byXpath.element.id, 'name-field');

  const fallback = api.resolveTarget({ css_selector: '#nope', xpath: '//*[@id="nope"]' }, document);
  assert.equal(fallback.mode, 'fallback');
  assert.equal(fallback.element, null);

  assert.equal(api.resolveAnchorMode({ css_selector: '#x' }), 'element');
  assert.equal(
    api.resolveAnchorMode({ screenshot_url: 'https://example.com/a.png' }),
    'screenshot',
  );
  assert.equal(api.resolveAnchorMode({ instruction: 'Go' }), 'none');
  assert.equal(api.resolveAnchorMode({ anchor_mode: 'none', css_selector: '#x' }), 'none');
});

test('screenshot anchor mode shows preview without element highlight', async () => {
  const payload = {
    steps: [
      {
        step_number: 1,
        instruction: 'Open the home page.',
        anchor_mode: 'screenshot',
        screenshot_url: 'https://example.com/nav.png',
      },
    ],
  };

  const { document, flush } = loadRuntime({
    walkthroughState: { status: 'playing', sopId: 'sop-1', stepIndex: 0 },
    walkthroughPayload: payload,
  });
  await flush();

  const host = document.getElementById('worktrace-walkthrough-host');
  const root = host.shadowRoot;
  assert.equal(root.querySelector('.highlight').hidden, true);
  assert.equal(root.querySelector('.preview').hidden, false);
  assert.equal(root.querySelector('.preview').src, 'https://example.com/nav.png');
  assert.match(root.querySelector('.fallback-note').textContent, /captured preview/i);
  assert.equal(root.querySelector('.tooltip').dataset.anchorMode, 'screenshot');
});

test('none anchor mode shows instruction-only minimal UI', async () => {
  const payload = {
    steps: [
      {
        step_number: 1,
        instruction: 'Open the home page.',
        anchor_mode: 'none',
      },
    ],
  };

  const { document, flush } = loadRuntime({
    walkthroughState: { status: 'playing', sopId: 'sop-1', stepIndex: 0 },
    walkthroughPayload: payload,
  });
  await flush();

  const host = document.getElementById('worktrace-walkthrough-host');
  const root = host.shadowRoot;
  assert.equal(root.querySelector('.highlight').hidden, true);
  assert.equal(root.querySelector('.preview').hidden, true);
  assert.equal(
    root.querySelector('.fallback-note').textContent,
    'No on-page target available for this step.',
  );
  assert.equal(root.querySelector('.instruction').textContent, 'Open the home page.');
  assert.equal(root.querySelector('.tooltip').dataset.anchorMode, 'none');
  assert.equal(root.querySelector('[data-action="finish"]').hidden, false);
});

test('playing walkthrough mounts overlay with previous disabled on step 1', async () => {
  const payload = {
    steps: [
      {
        step_number: 1,
        instruction: 'Click Save',
        css_selector: '#save-btn',
        screenshot_url: 'https://example.com/shot1.png',
      },
      {
        step_number: 2,
        instruction: 'Enter name',
        css_selector: '#name-field',
      },
    ],
  };

  const { document, flush, window, sentMessages } = loadRuntime({
    walkthroughState: { status: 'playing', sopId: 'sop-1', stepIndex: 0 },
    walkthroughPayload: payload,
  });
  await flush();

  const host = document.getElementById('worktrace-walkthrough-host');
  assert.ok(host);
  assert.equal(host.style.pointerEvents, 'none');

  const tooltip = host.shadowRoot.querySelector('.tooltip');
  assert.equal(tooltip.hidden, false);
  assert.match(host.shadowRoot.querySelector('.eyebrow').textContent, /Step 1 \/ 2/);
  assert.equal(host.shadowRoot.querySelector('.instruction').textContent, 'Click Save');

  const previous = host.shadowRoot.querySelector('[data-action="previous"]');
  const next = host.shadowRoot.querySelector('[data-action="next"]');
  const finish = host.shadowRoot.querySelector('[data-action="finish"]');
  assert.equal(previous.disabled, true);
  assert.equal(next.hidden, false);
  assert.equal(finish.hidden, true);

  assert.equal(
    sentMessages.filter((m) => m.type === 'WALKTHROUGH_STEP_ENTERED')[0]?.step_number,
    1,
  );

  // Host is non-blocking; tooltip buttons opt back into pointer events via CSS.
  assert.match(host.shadowRoot.innerHTML, /\.backdrop\s*\{[^}]*pointer-events:\s*none/);
  assert.match(host.shadowRoot.innerHTML, /\.tooltip\s*\{[^}]*pointer-events:\s*auto/);
});

test('next and previous update step index and re-enter without duplicate open visits', async () => {
  const payload = {
    steps: [
      { step_number: 1, instruction: 'One', css_selector: '#save-btn' },
      { step_number: 2, instruction: 'Two', css_selector: '#name-field' },
    ],
  };

  const { document, flush, sentMessages, sessionValues } = loadRuntime({
    walkthroughState: { status: 'playing', sopId: 'sop-1', stepIndex: 0 },
    walkthroughPayload: payload,
  });
  await flush();

  const host = document.getElementById('worktrace-walkthrough-host');
  const next = host.shadowRoot.querySelector('[data-action="next"]');
  next.click();
  await flush();

  assert.equal(sessionValues().walkthroughState.stepIndex, 1);
  assert.match(host.shadowRoot.querySelector('.eyebrow').textContent, /Step 2 \/ 2/);
  assert.equal(host.shadowRoot.querySelector('[data-action="finish"]').hidden, false);

  const entered = sentMessages.filter((m) => m.type === 'WALKTHROUGH_STEP_ENTERED');
  assert.equal(entered.length, 2);
  assert.equal(entered[1].step_number, 2);

  const previous = host.shadowRoot.querySelector('[data-action="previous"]');
  assert.equal(previous.disabled, false);
  previous.click();
  await flush();

  assert.equal(sessionValues().walkthroughState.stepIndex, 0);
  const enteredAfterBack = sentMessages.filter((m) => m.type === 'WALKTHROUGH_STEP_ENTERED');
  assert.equal(enteredAfterBack.length, 3);
  assert.equal(enteredAfterBack[2].step_number, 1);
  assert.notEqual(enteredAfterBack[2].entered_at, enteredAfterBack[0].entered_at);

  next.click();
  await flush();
  const enteredAfterForward = sentMessages.filter((m) => m.type === 'WALKTHROUGH_STEP_ENTERED');
  assert.equal(enteredAfterForward.length, 4);
  assert.equal(enteredAfterForward[3].step_number, 2);
});

test('finish clears session walkthrough state and tears down overlay', async () => {
  const payload = {
    steps: [{ step_number: 1, instruction: 'Only step', css_selector: '#save-btn' }],
  };

  const { document, flush, sentMessages, sessionValues } = loadRuntime({
    walkthroughState: { status: 'playing', sopId: 'sop-1', stepIndex: 0 },
    walkthroughPayload: payload,
  });
  await flush();

  const host = document.getElementById('worktrace-walkthrough-host');
  host.shadowRoot.querySelector('[data-action="finish"]').click();
  await flush();

  assert.equal(
    sentMessages.some((m) => m.type === 'WALKTHROUGH_FINISHED'),
    true,
  );
  assert.equal(sessionValues().walkthroughState.status, 'idle');
  assert.equal(sessionValues().walkthroughPayload, null);
  assert.equal(document.getElementById('worktrace-walkthrough-host'), null);
});

test('mismatched tabId does not mount the overlay', async () => {
  const payload = {
    steps: [{ step_number: 1, instruction: 'Only step', css_selector: '#save-btn' }],
  };

  const { document, flush, window } = loadRuntime({
    walkthroughState: { status: 'playing', sopId: 'sop-1', stepIndex: 0, tabId: 99 },
    walkthroughPayload: payload,
    tabId: 1,
  });
  await flush();

  assert.equal(window.WorkTraceWalkthrough.getMyTabId(), 1);
  assert.equal(document.getElementById('worktrace-walkthrough-host'), null);
});

test('matching tabId mounts the overlay', async () => {
  const payload = {
    steps: [{ step_number: 1, instruction: 'Only step', css_selector: '#save-btn' }],
  };

  const { document, flush } = loadRuntime({
    walkthroughState: { status: 'playing', sopId: 'sop-1', stepIndex: 0, tabId: 7 },
    walkthroughPayload: payload,
    tabId: 7,
  });
  await flush();

  assert.ok(document.getElementById('worktrace-walkthrough-host'));
});

test('none anchor mode hides preview even if screenshot_url is present', async () => {
  const payload = {
    steps: [
      {
        step_number: 1,
        instruction: 'Open the home page.',
        anchor_mode: 'none',
        screenshot_url: 'https://example.com/should-hide.png',
      },
    ],
  };

  const { document, flush } = loadRuntime({
    walkthroughState: { status: 'playing', sopId: 'sop-1', stepIndex: 0 },
    walkthroughPayload: payload,
  });
  await flush();

  const root = document.getElementById('worktrace-walkthrough-host').shadowRoot;
  assert.equal(root.querySelector('.preview').hidden, true);
  assert.equal(
    root.querySelector('.fallback-note').textContent,
    'No on-page target available for this step.',
  );
});
