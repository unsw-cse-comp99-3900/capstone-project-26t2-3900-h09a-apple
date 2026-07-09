import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

test('content script responds to extension ping and forwards handoff codes', async () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost:3000/library',
    runScripts: 'dangerously',
  });

  const window = dom.window;
  const sentMessages = [];
  const postedMessages = [];

  window.chrome = {
    runtime: {
      sendMessage: (message) => sentMessages.push(message),
    },
    storage: {
      local: {
        get: (_keys, callback) =>
          setTimeout(() => callback({ recordingState: { status: 'ready' } }), 0),
      },
      onChanged: {
        addListener: () => {},
      },
    },
  };

  const originalPostMessage = window.postMessage.bind(window);
  window.postMessage = (data, targetOrigin) => {
    postedMessages.push({ data, targetOrigin });
    originalPostMessage(data, targetOrigin);
  };

  const contentScriptCode = readFileSync(new URL('./content.js', import.meta.url), 'utf-8');
  const scriptEl = window.document.createElement('script');
  scriptEl.textContent = contentScriptCode;
  window.document.head.appendChild(scriptEl);
  await new Promise((resolve) => setTimeout(resolve, 10));

  window.dispatchEvent(
    new window.MessageEvent('message', {
      data: {
        source: 'worktrace-web',
        type: 'EXTENSION_PING',
        requestId: 'ping-1',
      },
      source: window,
    }),
  );

  assert.equal(postedMessages.length, 1);
  assert.equal(postedMessages[0].data.source, 'worktrace-extension');
  assert.equal(postedMessages[0].data.type, 'EXTENSION_PING_RESULT');
  assert.equal(postedMessages[0].data.requestId, 'ping-1');
  assert.equal(postedMessages[0].data.present, true);

  window.dispatchEvent(
    new window.MessageEvent('message', {
      data: {
        source: 'worktrace-web',
        type: 'EXTENSION_HANDOFF',
        code: 'handoff-code',
      },
      source: window,
    }),
  );

  const handoffMessages = sentMessages.filter((message) => message.type === 'EXTENSION_HANDOFF');
  assert.equal(handoffMessages.length, 1);
  assert.equal(handoffMessages[0].type, 'EXTENSION_HANDOFF');
  assert.equal(handoffMessages[0].code, 'handoff-code');
});

test('content script forwards logout messages to the background worker', async () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost:3000/library',
    runScripts: 'dangerously',
  });

  const window = dom.window;
  const sentMessages = [];

  window.chrome = {
    runtime: {
      sendMessage: (message) => sentMessages.push(message),
    },
    storage: {
      local: {
        get: (_keys, callback) =>
          setTimeout(() => callback({ recordingState: { status: 'ready' } }), 0),
      },
      onChanged: {
        addListener: () => {},
      },
    },
  };

  const contentScriptCode = readFileSync(new URL('./content.js', import.meta.url), 'utf-8');
  const scriptEl = window.document.createElement('script');
  scriptEl.textContent = contentScriptCode;
  window.document.head.appendChild(scriptEl);
  await new Promise((resolve) => setTimeout(resolve, 10));

  window.dispatchEvent(
    new window.MessageEvent('message', {
      data: {
        source: 'worktrace-web',
        type: 'EXTENSION_LOGOUT',
      },
      source: window,
    }),
  );

  const logoutMessages = sentMessages.filter((message) => message.type === 'EXTENSION_LOGOUT');
  assert.equal(logoutMessages.length, 1);
});
