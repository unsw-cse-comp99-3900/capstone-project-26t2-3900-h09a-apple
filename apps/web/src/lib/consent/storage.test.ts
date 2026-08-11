/**
 * Tests for local consent record read/write helpers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CONSENT_STORAGE_KEY_LEGACY,
  CONSENT_TERMS_VERSION,
  consentStorageKey,
} from '@/lib/consent/constants';
import {
  acceptDataCaptureConsent,
  clearDataCaptureConsent,
  isConsentCurrent,
  needsDataCaptureConsent,
  readDataCaptureConsent,
  writeDataCaptureConsent,
} from '@/lib/consent/storage';

function installLocalStorage() {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
  };
  vi.stubGlobal('window', { localStorage });
  vi.stubGlobal('localStorage', localStorage);
  return store;
}

describe('data capture consent', () => {
  beforeEach(() => {
    installLocalStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it('writes and reads typed consent records', () => {
    const record = acceptDataCaptureConsent('recording', '2026-08-11T00:00:00.000Z');
    expect(record).toEqual({
      accepted: true,
      version: CONSENT_TERMS_VERSION,
      acceptedAt: '2026-08-11T00:00:00.000Z',
    });
    expect(readDataCaptureConsent('recording')).toEqual(record);
    expect(needsDataCaptureConsent('recording')).toBe(false);
    expect(needsDataCaptureConsent('walkthrough')).toBe(true);
  });

  it('falls back to the legacy walkthrough key', () => {
    window.localStorage.setItem(
      CONSENT_STORAGE_KEY_LEGACY,
      JSON.stringify({
        accepted: true,
        version: CONSENT_TERMS_VERSION,
        acceptedAt: '2026-07-01T00:00:00.000Z',
      }),
    );
    expect(readDataCaptureConsent('walkthrough')?.accepted).toBe(true);
    expect(readDataCaptureConsent('recording')).toBeNull();
  });

  it('ignores invalid JSON in storage', () => {
    window.localStorage.setItem(consentStorageKey('recording'), '{not-json');
    expect(readDataCaptureConsent('recording')).toBeNull();
  });

  it('clears typed and legacy walkthrough keys', () => {
    writeDataCaptureConsent('walkthrough', {
      accepted: true,
      version: CONSENT_TERMS_VERSION,
      acceptedAt: '2026-07-01T00:00:00.000Z',
    });
    window.localStorage.setItem(CONSENT_STORAGE_KEY_LEGACY, '{"accepted":true}');
    clearDataCaptureConsent('walkthrough');
    expect(window.localStorage.getItem(consentStorageKey('walkthrough'))).toBeNull();
    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY_LEGACY)).toBeNull();
  });
});
