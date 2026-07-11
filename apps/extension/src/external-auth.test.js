import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALLOWED_EXTERNAL_ORIGINS,
  handleExternalAuthMessage,
  isAllowedExternalOrigin,
} from './external-auth.js';

test('isAllowedExternalOrigin accepts configured local web origins', () => {
  assert.equal(isAllowedExternalOrigin('http://localhost:3000'), true);
  assert.equal(isAllowedExternalOrigin('http://127.0.0.1:3000'), true);
  assert.equal(isAllowedExternalOrigin('https://evil.example'), false);
  assert.equal(ALLOWED_EXTERNAL_ORIGINS.has('http://localhost:3000'), true);
});

test('handleExternalAuthMessage responds to ping requests from allowed origins', () => {
  let response = null;

  handleExternalAuthMessage(
    { type: 'EXTENSION_PING', requestId: 'ping-1' },
    { origin: 'http://localhost:3000' },
    (payload) => {
      response = payload;
    },
    {
      redeemHandoffCode: async () => {},
      clearStoredAuthTokens: async () => {},
    },
  );

  assert.deepEqual(response, {
    ok: true,
    present: true,
    requestId: 'ping-1',
  });
});

test('handleExternalAuthMessage rejects requests from untrusted origins', () => {
  let response = null;

  handleExternalAuthMessage(
    { type: 'EXTENSION_PING', requestId: 'ping-1' },
    { origin: 'https://evil.example' },
    (payload) => {
      response = payload;
    },
    {
      redeemHandoffCode: async () => {},
      clearStoredAuthTokens: async () => {},
    },
  );

  assert.deepEqual(response, {
    ok: false,
    error: 'Unauthorized origin',
  });
});

test('handleExternalAuthMessage redeems handoff codes for allowed origins', async () => {
  let response = null;
  const redeemedCodes = [];

  const keepChannelOpen = handleExternalAuthMessage(
    { type: 'EXTENSION_HANDOFF', code: 'handoff-code' },
    { origin: 'http://localhost:3000' },
    (payload) => {
      response = payload;
    },
    {
      redeemHandoffCode: async (code) => {
        redeemedCodes.push(code);
      },
      clearStoredAuthTokens: async () => {},
    },
  );

  assert.equal(keepChannelOpen, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(redeemedCodes, ['handoff-code']);
  assert.deepEqual(response, { ok: true });
});
