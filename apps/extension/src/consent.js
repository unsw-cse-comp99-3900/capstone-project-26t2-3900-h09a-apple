import { authenticatedFetch } from './auth.js';

export const CONSENT_STORAGE_KEY = 'dataCaptureConsent';
export const CONSENT_TYPE = 'recording';

/** Keep in sync with apps/web/src/lib/consent/constants.ts and apps/api/app/consent_constants.py */
export const CONSENT_TERMS_VERSION = '2026-07-01';

export function isConsentCurrent(consent) {
  return consent?.accepted === true && consent.version === CONSENT_TERMS_VERSION;
}

export function readDataCaptureConsent(callback) {
  chrome.storage?.local.get([CONSENT_STORAGE_KEY], (result) => {
    callback(result[CONSENT_STORAGE_KEY] ?? null);
  });
}

export function saveDataCaptureConsent(acceptedAt, callback) {
  const record = {
    accepted: true,
    version: CONSENT_TERMS_VERSION,
    acceptedAt: acceptedAt ?? new Date().toISOString(),
  };

  chrome.storage?.local.set({ [CONSENT_STORAGE_KEY]: record }, () => {
    callback(record);
  });
}

export function clearDataCaptureConsent(callback = () => {}) {
  chrome.storage?.local.remove([CONSENT_STORAGE_KEY], callback);
}

export async function fetchConsentStatus() {
  const response = await authenticatedFetch(
    `/api/v1/consent/status?consent_type=${encodeURIComponent(CONSENT_TYPE)}`,
  );

  if (!response.ok) {
    throw new Error('Failed to load consent status');
  }

  return response.json();
}

export async function postConsentAccept() {
  const response = await authenticatedFetch('/api/v1/consent/accept', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      consent_type: CONSENT_TYPE,
      version: CONSENT_TERMS_VERSION,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to record consent');
  }

  return response.json();
}

export async function syncConsentFromServer() {
  const status = await fetchConsentStatus();

  if (status.accepted && status.accepted_at) {
    return new Promise((resolve) => {
      saveDataCaptureConsent(status.accepted_at, resolve);
    });
  }

  return new Promise((resolve) => {
    clearDataCaptureConsent(() => resolve(null));
  });
}
