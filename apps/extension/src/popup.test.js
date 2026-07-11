import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { CONSENT_STORAGE_KEY, CONSENT_TERMS_VERSION } from './consent.js';
import 'fake-indexeddb/auto';
import { saveSessionPayload } from './session-store.js';
import { AUTH_STORAGE_KEYS } from './auth.js';

const acceptedConsent = {
  accepted: true,
  version: CONSENT_TERMS_VERSION,
  acceptedAt: '2026-07-01T00:00:00.000Z',
};

const authenticatedStorage = {
  [AUTH_STORAGE_KEYS.accessToken]: 'access-token',
  [AUTH_STORAGE_KEYS.refreshToken]: 'refresh-token',
  [AUTH_STORAGE_KEYS.expiresAt]: Date.now() + 60_000,
};

function mockConsentApiFetch({
  statusAccepted = true,
  acceptedAt = '2026-07-01T00:00:00.000Z',
} = {}) {
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);

    if (href.includes('/api/v1/consent/status')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          accepted: statusAccepted,
          accepted_at: statusAccepted ? acceptedAt : null,
          consent_type: 'recording',
          version: CONSENT_TERMS_VERSION,
        }),
      };
    }

    if (href.includes('/api/v1/consent/accept') && init.method === 'POST') {
      return {
        ok: true,
        status: 201,
        json: async () => ({
          consent_type: 'recording',
          version: CONSENT_TERMS_VERSION,
          accepted_at: acceptedAt,
        }),
      };
    }

    return {
      ok: false,
      status: 404,
      json: async () => ({ detail: 'not found' }),
    };
  };
}

function setupPopupDom(recordingState = { status: 'ready', workflowName: '' }) {
  const popupHtml = readFileSync(new URL('./popup.html', import.meta.url), 'utf-8');
  const dom = new JSDOM(popupHtml, {
    url: 'chrome-extension://worktrace/popup.html',
  });
  const openedTabs = [];
  let persistedRecordingState = recordingState;
  let localStorageValues = {
    [CONSENT_STORAGE_KEY]: acceptedConsent,
    ...authenticatedStorage,
  };
  let storageChangeCallback = () => {};

  mockConsentApiFetch({ statusAccepted: true });
  let runtimeMessageCallback = () => {};

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.chrome = {
    storage: {
      local: {
        get: (keys, callback) => {
          const result = { recordingState: persistedRecordingState };

          for (const key of keys) {
            if (key in localStorageValues) {
              result[key] = localStorageValues[key];
            }
          }

          callback(result);
        },
        set: (value, callback = () => {}) => {
          if (value.recordingState) {
            persistedRecordingState = value.recordingState;
          }
          localStorageValues = { ...localStorageValues, ...value };
          callback();
        },
        remove: (keys, callback = () => {}) => {
          for (const key of keys) {
            delete localStorageValues[key];
          }
          callback();
        },
      },
      session: {
        get: (_keys, callback) => callback({ eventBuffer: [] }),
        set: () => Promise.resolve(),
      },
      onChanged: {
        addListener: (callback) => {
          storageChangeCallback = callback;
        },
      },
    },
    runtime: {
      onMessage: {
        addListener: (callback) => {
          runtimeMessageCallback = callback;
        },
      },
    },
    tabs: {
      create: (options) => openedTabs.push(options),
    },
  };

  return {
    dom,
    openedTabs,
    getLocalStorageValues() {
      return localStorageValues;
    },
    getRecordingState() {
      return persistedRecordingState;
    },
    async markSessionPayloadReady(sessionId) {
      const storageKey = `session_${sessionId}`;
      localStorageValues[storageKey] = { client_session_id: sessionId };

      await saveSessionPayload({
        client_session_id: sessionId,
        workflow_name: 'Refund workflow',
        started_at: new Date(1000).toISOString(),
        stopped_at: new Date(2000).toISOString(),
        event_count: 0,
        events: [],
        screenshots: [],
      });

      storageChangeCallback(
        { [storageKey]: { newValue: localStorageValues[storageKey] } },
        'local',
      );

      runtimeMessageCallback({
        type: 'SESSION_PAYLOAD_READY',
        sessionId,
      });
    },
    async simulateLogout() {
      delete localStorageValues[AUTH_STORAGE_KEYS.accessToken];
      delete localStorageValues[AUTH_STORAGE_KEYS.refreshToken];
      delete localStorageValues[AUTH_STORAGE_KEYS.expiresAt];
      storageChangeCallback(
        {
          [AUTH_STORAGE_KEYS.accessToken]: { oldValue: 'access-token', newValue: undefined },
          [AUTH_STORAGE_KEYS.refreshToken]: { oldValue: 'refresh-token', newValue: undefined },
          [AUTH_STORAGE_KEYS.expiresAt]: { oldValue: Date.now(), newValue: undefined },
        },
        'local',
      );
      await flushPromises();
    },
    async simulateLogin({ statusAccepted = false } = {}) {
      mockConsentApiFetch({ statusAccepted });
      Object.assign(localStorageValues, authenticatedStorage);
      storageChangeCallback(
        {
          [AUTH_STORAGE_KEYS.accessToken]: {
            newValue: authenticatedStorage[AUTH_STORAGE_KEYS.accessToken],
          },
          [AUTH_STORAGE_KEYS.refreshToken]: {
            newValue: authenticatedStorage[AUTH_STORAGE_KEYS.refreshToken],
          },
          [AUTH_STORAGE_KEYS.expiresAt]: {
            newValue: authenticatedStorage[AUTH_STORAGE_KEYS.expiresAt],
          },
        },
        'local',
      );
      await flushPromises();
    },
  };
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
  const { dom, openedTabs, getRecordingState, markSessionPayloadReady } = setupPopupDom();
  await loadPopupScript();
  await flushPromises();

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

  // Completed: Review becomes visible, but it stays disabled until the assembled payload exists.
  stopButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await flushPromises();

  assert.equal(statusText.textContent, 'Completed');
  assert.equal(reviewButton.hidden, false);
  assert.equal(reviewButton.disabled, true);

  reviewButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(openedTabs.length, 0);

  // Once the service worker writes session_<id>, Review becomes enabled.
  const sessionId = getRecordingState().client_session_id;
  await markSessionPayloadReady(sessionId);
  await flushPromises();
  assert.equal(reviewButton.disabled, false);

  // Clicking Review opens the session review route with the generated session id
  reviewButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(openedTabs.length, 1);
  assert.match(openedTabs[0].url, /\/session\/review\?id=/);
});

test('accepting consent does not auto-start recording', async () => {
  const popupHtml = readFileSync(new URL('./popup.html', import.meta.url), 'utf-8');
  const dom = new JSDOM(popupHtml, {
    url: 'chrome-extension://worktrace/popup.html',
  });
  let persistedRecordingState = { status: 'ready', workflowName: '' };
  let localStorageValues = {
    ...authenticatedStorage,
  };

  mockConsentApiFetch({ statusAccepted: false });

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.chrome = {
    storage: {
      local: {
        get: (keys, callback) => {
          const result = { recordingState: persistedRecordingState };
          for (const key of keys) {
            if (key in localStorageValues) {
              result[key] = localStorageValues[key];
            }
          }
          callback(result);
        },
        set: (value, callback = () => {}) => {
          if (value.recordingState) {
            persistedRecordingState = value.recordingState;
          }
          localStorageValues = { ...localStorageValues, ...value };
          callback();
        },
        remove: (keys, callback = () => {}) => {
          for (const key of keys) {
            delete localStorageValues[key];
          }
          callback();
        },
      },
      session: {
        get: (_keys, callback) => callback({ eventBuffer: [] }),
        set: () => Promise.resolve(),
      },
      onChanged: { addListener: () => {} },
    },
    tabs: { create: () => {} },
  };

  await import(`./popup.js?test=${crypto.randomUUID()}`);
  await flushPromises();

  const workflowNameInput = dom.window.document.querySelector('#workflowName');
  const startButton = dom.window.document.querySelector('#startButton');
  const consentOverlay = dom.window.document.querySelector('#consentOverlay');
  const consentAcceptButton = dom.window.document.querySelector('#consentAcceptButton');
  const statusText = dom.window.document.querySelector('#statusText');
  const form = dom.window.document.querySelector('#recordingForm');

  workflowNameInput.value = 'Refund workflow';
  workflowNameInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(startButton.disabled, false);

  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await flushPromises();
  assert.equal(consentOverlay.hidden, false);
  assert.equal(statusText.textContent, 'Ready');

  mockConsentApiFetch({
    statusAccepted: true,
    acceptedAt: '2026-07-01T12:00:00.000Z',
  });
  consentAcceptButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await flushPromises();
  assert.equal(consentOverlay.hidden, true);
  assert.equal(statusText.textContent, 'Ready');
  assert.equal(persistedRecordingState.status, 'ready');
  assert.equal(localStorageValues[CONSENT_STORAGE_KEY]?.accepted, true);
});

test('logout clears consent so a new account cannot reuse the local cache', async () => {
  const { dom, getLocalStorageValues, simulateLogout, simulateLogin } = setupPopupDom();
  await loadPopupScript();
  await flushPromises();

  assert.equal(getLocalStorageValues()[CONSENT_STORAGE_KEY]?.accepted, true);

  await simulateLogout();
  assert.equal(getLocalStorageValues()[CONSENT_STORAGE_KEY], undefined);

  const form = dom.window.document.querySelector('#recordingForm');
  const consentOverlay = dom.window.document.querySelector('#consentOverlay');
  const workflowNameInput = dom.window.document.querySelector('#workflowName');

  await simulateLogin({ statusAccepted: false });
  assert.equal(getLocalStorageValues()[CONSENT_STORAGE_KEY], undefined);

  workflowNameInput.value = 'Refund workflow';
  workflowNameInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await flushPromises();
  assert.equal(consentOverlay.hidden, false);
});

test('shows sign-in state when extension auth tokens are missing', async () => {
  const popupHtml = readFileSync(new URL('./popup.html', import.meta.url), 'utf-8');
  const dom = new JSDOM(popupHtml, {
    url: 'chrome-extension://worktrace/popup.html',
  });
  const openedTabs = [];

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.chrome = {
    storage: {
      local: {
        get: (keys, callback) => {
          callback({ recordingState: { status: 'ready', workflowName: '' } });
        },
        set: (_value, callback = () => {}) => callback(),
        remove: (_keys, callback = () => {}) => callback(),
      },
      session: {
        get: (_keys, callback) => callback({ eventBuffer: [] }),
        set: () => Promise.resolve(),
      },
      onChanged: { addListener: () => {} },
    },
    tabs: {
      create: (options) => openedTabs.push(options),
    },
  };

  await import(`./popup.js?test=${crypto.randomUUID()}`);
  await flushPromises();

  const authSection = dom.window.document.querySelector('#authSection');
  const recordingSection = dom.window.document.querySelector('#recordingSection');
  const signInButton = dom.window.document.querySelector('#signInButton');

  assert.equal(authSection.hidden, false);
  assert.equal(recordingSection.hidden, true);

  signInButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(openedTabs.length, 1);
  assert.match(openedTabs[0].url, /\/login$/);
});
