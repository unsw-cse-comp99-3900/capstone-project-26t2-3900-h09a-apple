'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { CONSENT_COPY, CONSENT_TERMS_VERSION } from '@/lib/consent/constants';
import {
  acceptDataCaptureConsent,
  isConsentCurrent,
  readDataCaptureConsent,
  type DataCaptureConsentRecord,
} from '@/lib/consent/storage';

import styles from './data-capture-consent.module.css';

type DataCaptureConsentModalProps = {
  open: boolean;
  onAccepted: () => void;
  onDeclined: () => void;
};

export function DataCaptureConsentModal({
  open,
  onAccepted,
  onDeclined,
}: DataCaptureConsentModalProps) {
  const [declined, setDeclined] = useState(false);

  useEffect(() => {
    if (open) {
      setDeclined(false);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  function handleAccept() {
    acceptDataCaptureConsent();
    onAccepted();
  }

  function handleDecline() {
    setDeclined(true);
    onDeclined();
  }

  return (
    <div className={styles.overlay} role="presentation">
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-title"
        aria-describedby="consent-description"
      >
        {declined ? (
          <>
            <h2 id="consent-title">{CONSENT_COPY.declineTitle}</h2>
            <p id="consent-description" className={styles.body}>
              {CONSENT_COPY.declineBody}
            </p>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setDeclined(false)}
              >
                Review agreement
              </button>
              <button type="button" className={styles.primaryButton} onClick={onDeclined}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <p className={styles.eyebrow}>
              {CONSENT_COPY.versionLabel} {CONSENT_TERMS_VERSION}
            </p>
            <h2 id="consent-title">{CONSENT_COPY.title}</h2>
            <p id="consent-description" className={styles.body}>
              {CONSENT_COPY.intro}
            </p>
            <ul className={styles.list}>
              {CONSENT_COPY.bullets.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className={styles.meta}>
              Read the full <Link href="/privacy">Privacy and data capture terms</Link>.
            </p>
            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} onClick={handleDecline}>
                {CONSENT_COPY.declineLabel}
              </button>
              <button type="button" className={styles.primaryButton} onClick={handleAccept}>
                {CONSENT_COPY.acceptLabel}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function useDataCaptureConsent() {
  const [consent, setConsent] = useState<DataCaptureConsentRecord | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setConsent(readDataCaptureConsent());
    setReady(true);
  }, []);

  return {
    ready,
    consent,
    hasConsent: isConsentCurrent(consent),
    refresh: () => setConsent(readDataCaptureConsent()),
  };
}
