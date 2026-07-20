import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inferLaunchUrl,
  inferStepPageUrl,
  normalizeLaunchUrl,
  syncWalkthroughToTab,
  urlsRequireNavigation,
  waitForTabComplete,
} from './walkthrough-launch.js';

test('inferStepPageUrl prefers expected_url over instruction text', () => {
  assert.equal(
    inferStepPageUrl({
      expected_url: 'https://app.example.com/settings',
      instruction: 'Open https://other.example.com first',
    }),
    'https://app.example.com/settings',
  );
});

test('inferStepPageUrl falls back to URL inside instruction', () => {
  assert.equal(
    inferStepPageUrl({
      instruction: 'Go to https://example.com/login and sign in.',
    }),
    'https://example.com/login',
  );
});

test('inferLaunchUrl returns the first step page URL', () => {
  assert.equal(
    inferLaunchUrl({
      steps: [
        { instruction: 'Click continue.' },
        { expected_url: 'https://example.com/step-2', instruction: 'Fill the form.' },
      ],
    }),
    'https://example.com/step-2',
  );
});

test('inferLaunchUrl returns null when no page URL exists', () => {
  assert.equal(
    inferLaunchUrl({
      steps: [{ instruction: 'Click the save button.' }],
    }),
    null,
  );
});

test('normalizeLaunchUrl adds https when scheme is missing', () => {
  assert.equal(normalizeLaunchUrl('www.example.com/path'), 'https://www.example.com/path');
});

test('urlsRequireNavigation compares origin pathname and search', () => {
  assert.equal(urlsRequireNavigation('https://example.com/a', 'https://example.com/a'), false);
  assert.equal(urlsRequireNavigation('https://example.com/a', 'https://example.com/b'), true);
  assert.equal(urlsRequireNavigation('https://example.com/a', 'https://other.example.com/a'), true);
});

test('waitForTabComplete resolves immediately when tab is already complete', async () => {
  const tab = { id: 7, status: 'complete', url: 'https://example.com' };
  const tabsApi = {
    get: async () => tab,
    onUpdated: {
      addListener() {},
      removeListener() {},
    },
  };

  assert.equal(await waitForTabComplete(tabsApi, 7), tab);
});

test('syncWalkthroughToTab retries until content script answers', async () => {
  let attempts = 0;
  const tabsApi = {
    sendMessage(_tabId, _message, callback) {
      attempts += 1;
      if (attempts < 3) {
        globalThis.chrome = {
          runtime: { lastError: { message: 'Receiving end does not exist' } },
        };
        callback(undefined);
        return;
      }
      globalThis.chrome = { runtime: {} };
      callback({ ok: true });
    },
  };

  assert.equal(await syncWalkthroughToTab(tabsApi, 3, 5), true);
  assert.equal(attempts, 3);
});
