import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTH_STORAGE_KEYS,
  authenticatedFetch,
  clearStoredAuthTokens,
  getStoredAuthTokens,
  redeemHandoffCode,
  setStoredAuthTokens,
} from './auth.js';

function mockChromeStorage() {
  const values = {};

  globalThis.chrome = {
    storage: {
      local: {
        get: (keys, callback) => {
          const result = {};
          for (const key of keys) {
            if (key in values) {
              result[key] = values[key];
            }
          }
          callback(result);
        },
        set: (items, callback = () => {}) => {
          Object.assign(values, items);
          callback();
        },
        remove: (keys, callback = () => {}) => {
          for (const key of keys) {
            delete values[key];
          }
          callback();
        },
      },
    },
  };

  return values;
}

test('setStoredAuthTokens persists access and refresh tokens', async () => {
  mockChromeStorage();

  await setStoredAuthTokens('access-token', 'refresh-token', 3600);
  const tokens = await getStoredAuthTokens();

  assert.equal(tokens.accessToken, 'access-token');
  assert.equal(tokens.refreshToken, 'refresh-token');
  assert.ok(tokens.expiresAt > Date.now());
});

test('redeemHandoffCode stores tokens from the API response', async () => {
  mockChromeStorage();

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        access_token: 'redeemed-access',
        refresh_token: 'redeemed-refresh',
        expires_in: 3600,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

  await redeemHandoffCode('one-time-code');
  const tokens = await getStoredAuthTokens();

  assert.equal(tokens.accessToken, 'redeemed-access');
  assert.equal(tokens.refreshToken, 'redeemed-refresh');
});

test('authenticatedFetch refreshes once on 401 and retries', async () => {
  mockChromeStorage();
  await setStoredAuthTokens('expired-access', 'refresh-token', 3600);

  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({
      url,
      authorization: init?.headers?.get?.('Authorization') ?? init?.headers?.Authorization,
    });

    if (String(url).endsWith('/api/v1/auth/refresh')) {
      return new Response(JSON.stringify({ access_token: 'fresh-access', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (calls.length === 1) {
      return new Response('', { status: 401 });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const response = await authenticatedFetch('/api/v1/sops/123/walkthrough');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(calls.length, 3);
  assert.match(String(calls[0].url), /walkthrough$/);
  assert.match(String(calls[1].url), /auth\/refresh$/);
  assert.equal(calls[2].authorization, 'Bearer fresh-access');

  const tokens = await getStoredAuthTokens();
  assert.equal(tokens.accessToken, 'fresh-access');

  await clearStoredAuthTokens();
});
