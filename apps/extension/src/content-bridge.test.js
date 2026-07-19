import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

test('content script forwards GET_SESSION_PAYLOAD requests to the background worker', async () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost:3000/session/review',
    runScripts: 'dangerously',
  });

  const window = dom.window;
  const sentMessages = [];
  const postedMessages = [];

  window.chrome = {
    runtime: {
      sendMessage: (message, callback) => {
        sentMessages.push(message);
        callback?.({
          ok: true,
          session: { client_session_id: 'session-1' },
        });
      },
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
        type: 'GET_SESSION_PAYLOAD',
        requestId: 'session-request-1',
        sessionId: 'session-1',
      },
      source: window,
    }),
  );

  await new Promise((resolve) => setTimeout(resolve, 10));

  const payloadMessages = sentMessages.filter((message) => message.type === 'GET_SESSION_PAYLOAD');
  assert.equal(payloadMessages.length, 1);
  assert.equal(payloadMessages[0].sessionId, 'session-1');
  assert.equal(postedMessages.length, 1);
  assert.equal(postedMessages[0].data.type, 'GET_SESSION_PAYLOAD_RESULT');
  assert.equal(postedMessages[0].data.requestId, 'session-request-1');
});

test('content script ignores auth handoff postMessage events', async () => {
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
        type: 'EXTENSION_HANDOFF',
        code: 'handoff-code',
      },
      source: window,
    }),
  );

  assert.equal(sentMessages.length, 0);
});
