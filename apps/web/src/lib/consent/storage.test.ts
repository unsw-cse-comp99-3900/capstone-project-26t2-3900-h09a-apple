/**
 * Tests for local consent record read/write helpers.
 */

import { describe, expect, it } from 'vitest';

import { CONSENT_TERMS_VERSION } from '@/lib/consent/constants';
import { isConsentCurrent } from '@/lib/consent/storage';

describe('data capture consent', () => {
  it('requires accepted flag and matching version', () => {
    expect(isConsentCurrent(null)).toBe(false);
    expect(
      isConsentCurrent({
        accepted: true,
        version: CONSENT_TERMS_VERSION,
        acceptedAt: '2026-07-01T00:00:00.000Z',
      }),
    ).toBe(true);
    expect(
      isConsentCurrent({
        accepted: true,
        version: '2025-01-01',
        acceptedAt: '2026-07-01T00:00:00.000Z',
      }),
    ).toBe(false);
  });
});
