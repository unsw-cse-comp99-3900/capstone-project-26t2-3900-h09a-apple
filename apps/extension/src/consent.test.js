import assert from 'node:assert/strict';
import test from 'node:test';

import { CONSENT_TERMS_VERSION, isConsentCurrent } from './consent.js';

test('isConsentCurrent requires accepted flag and matching version', () => {
  assert.equal(isConsentCurrent(null), false);
  assert.equal(
    isConsentCurrent({
      accepted: true,
      version: CONSENT_TERMS_VERSION,
      acceptedAt: '2026-07-01T00:00:00.000Z',
    }),
    true,
  );
  assert.equal(
    isConsentCurrent({
      accepted: true,
      version: '2025-01-01',
      acceptedAt: '2026-07-01T00:00:00.000Z',
    }),
    false,
  );
});
