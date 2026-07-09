export const CONSENT_STORAGE_KEY = 'dataCaptureConsent';

/** Keep in sync with apps/web/src/lib/consent/constants.ts */
export const CONSENT_TERMS_VERSION = '2026-07-01';

export function isConsentCurrent(consent) {
  return consent?.accepted === true && consent.version === CONSENT_TERMS_VERSION;
}

export function readDataCaptureConsent(callback) {
  chrome.storage?.local.get([CONSENT_STORAGE_KEY], (result) => {
    callback(result[CONSENT_STORAGE_KEY] ?? null);
  });
}

export function saveDataCaptureConsent(callback) {
  const record = {
    accepted: true,
    version: CONSENT_TERMS_VERSION,
    acceptedAt: new Date().toISOString(),
  };

  chrome.storage?.local.set({ [CONSENT_STORAGE_KEY]: record }, () => {
    callback(record);
  });
}
