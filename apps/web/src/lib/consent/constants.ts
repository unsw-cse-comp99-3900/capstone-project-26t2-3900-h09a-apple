/** Keep in sync with apps/extension/src/consent.js and apps/api/app/consent_constants.py */
export const CONSENT_TERMS_VERSION = '2026-07-01';

export const CONSENT_STORAGE_KEY_PREFIX = 'worktrace:dataCaptureConsent';

/** Legacy single-flag key from H09AAPPLE-44 (treated as walkthrough). */
export const CONSENT_STORAGE_KEY_LEGACY = 'worktrace:dataCaptureConsent';

export type ConsentType = 'recording' | 'walkthrough';

export function consentStorageKey(consentType: ConsentType): string {
  return `${CONSENT_STORAGE_KEY_PREFIX}:${consentType}`;
}

export const CONSENT_COPY = {
  title: 'Data capture and privacy agreement',
  intro:
    'Before WorkTrace records your screen or browser actions, review what we capture and how it is handled.',
  bullets: [
    'We capture clicks, navigation, form interactions, and screenshots of pages you visit during a session.',
    'Sensitive fields such as passwords are never recorded. Other values are masked before storage when possible.',
    'Captured data stays within your tenant workspace and is used to generate editable SOP drafts.',
  ],
  declineTitle: 'Recording stays disabled',
  declineBody:
    'WorkTrace cannot start recording or walkthrough capture without your consent. You can reopen this agreement any time before starting a session.',
  acceptLabel: 'I agree and allow capture',
  declineLabel: 'Decline',
  versionLabel: 'Terms version',
} as const;
