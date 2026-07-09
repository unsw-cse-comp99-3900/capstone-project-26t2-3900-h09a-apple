import { CONSENT_STORAGE_KEY, CONSENT_TERMS_VERSION } from '@/lib/consent/constants';

export type DataCaptureConsentRecord = {
  accepted: boolean;
  version: string;
  acceptedAt: string;
};

export function readDataCaptureConsent(): DataCaptureConsentRecord | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as DataCaptureConsentRecord;
  } catch {
    return null;
  }
}

export function isConsentCurrent(consent: DataCaptureConsentRecord | null): boolean {
  return consent?.accepted === true && consent.version === CONSENT_TERMS_VERSION;
}

export function needsDataCaptureConsent(): boolean {
  return !isConsentCurrent(readDataCaptureConsent());
}

export function acceptDataCaptureConsent(): DataCaptureConsentRecord {
  const record: DataCaptureConsentRecord = {
    accepted: true,
    version: CONSENT_TERMS_VERSION,
    acceptedAt: new Date().toISOString(),
  };

  window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record));
  return record;
}
