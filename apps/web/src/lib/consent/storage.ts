import {
  CONSENT_STORAGE_KEY_LEGACY,
  CONSENT_TERMS_VERSION,
  consentStorageKey,
  type ConsentType,
} from '@/lib/consent/constants';

export type DataCaptureConsentRecord = {
  accepted: boolean;
  version: string;
  acceptedAt: string;
};

function parseConsentRecord(raw: string | null): DataCaptureConsentRecord | null {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as DataCaptureConsentRecord;
  } catch {
    return null;
  }
}

export function readDataCaptureConsent(consentType: ConsentType): DataCaptureConsentRecord | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const typed = parseConsentRecord(window.localStorage.getItem(consentStorageKey(consentType)));
  if (typed) {
    return typed;
  }

  // Walkthrough previously used a single shared key before consent types split.
  if (consentType === 'walkthrough') {
    return parseConsentRecord(window.localStorage.getItem(CONSENT_STORAGE_KEY_LEGACY));
  }

  return null;
}

export function isConsentCurrent(consent: DataCaptureConsentRecord | null): boolean {
  return consent?.accepted === true && consent.version === CONSENT_TERMS_VERSION;
}

export function needsDataCaptureConsent(consentType: ConsentType): boolean {
  return !isConsentCurrent(readDataCaptureConsent(consentType));
}

export function writeDataCaptureConsent(
  consentType: ConsentType,
  record: DataCaptureConsentRecord,
): DataCaptureConsentRecord {
  window.localStorage.setItem(consentStorageKey(consentType), JSON.stringify(record));
  return record;
}

export function clearDataCaptureConsent(consentType: ConsentType): void {
  window.localStorage.removeItem(consentStorageKey(consentType));
  if (consentType === 'walkthrough') {
    window.localStorage.removeItem(CONSENT_STORAGE_KEY_LEGACY);
  }
}

export function acceptDataCaptureConsent(
  consentType: ConsentType,
  acceptedAt: string = new Date().toISOString(),
): DataCaptureConsentRecord {
  return writeDataCaptureConsent(consentType, {
    accepted: true,
    version: CONSENT_TERMS_VERSION,
    acceptedAt,
  });
}
