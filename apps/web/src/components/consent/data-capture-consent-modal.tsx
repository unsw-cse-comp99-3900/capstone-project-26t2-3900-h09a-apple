'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { acceptConsent, getConsentStatus } from '@/lib/api';
import { CONSENT_COPY, CONSENT_TERMS_VERSION, type ConsentType } from '@/lib/consent/constants';
import {
  acceptDataCaptureConsent,
  clearDataCaptureConsent,
  isConsentCurrent,
  readDataCaptureConsent,
  writeDataCaptureConsent,
  type DataCaptureConsentRecord,
} from '@/lib/consent/storage';

import styles from './data-capture-consent.module.css';

type DataCaptureConsentModalProps = {
  open: boolean;
  consentType: ConsentType;
  onAccepted: () => void;
  onDeclined: () => void;
  /** Close without accepting (X, Escape, overlay). Defaults to onDeclined. */
  onDismiss?: () => void;
};

export function DataCaptureConsentModal({
  open,
  consentType,
  onAccepted,
  onDeclined,
  onDismiss,
}: DataCaptureConsentModalProps) {
  const dismiss = onDismiss ?? onDeclined;
  const [declined, setDeclined] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (open) {
      setDeclined(false);
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        dismiss();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, dismiss]);

  if (!open || !mounted) {
    return null;
  }

  async function handleAccept() {
    setSubmitting(true);
    setError(null);

    try {
      const result = await acceptConsent({
        consent_type: consentType,
        version: CONSENT_TERMS_VERSION,
      });
      acceptDataCaptureConsent(consentType, result.accepted_at);
      onAccepted();
    } catch {
      setError('Could not record consent. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleDecline() {
    setDeclined(true);
    onDeclined();
  }

  return createPortal(
    <div
      className={styles.overlay}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          dismiss();
        }
      }}
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-title"
        aria-describedby="consent-description"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className={styles.closeButton} aria-label="Close" onClick={dismiss}>
          <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" focusable="false">
            <path
              d="M5 5l10 10M15 5L5 15"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
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
            {error ? <p className={styles.body}>{error}</p> : null}
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={handleDecline}
                disabled={submitting}
              >
                {CONSENT_COPY.declineLabel}
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => void handleAccept()}
                disabled={submitting}
              >
                {submitting ? 'Saving…' : CONSENT_COPY.acceptLabel}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function useDataCaptureConsent(consentType: ConsentType) {
  const [consent, setConsent] = useState<DataCaptureConsentRecord | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function syncFromServer() {
      const local = readDataCaptureConsent(consentType);
      if (!cancelled) {
        setConsent(local);
      }

      try {
        const status = await getConsentStatus(consentType);
        if (cancelled) {
          return;
        }

        if (status.accepted && status.accepted_at) {
          const record = writeDataCaptureConsent(consentType, {
            accepted: true,
            version: status.version,
            acceptedAt: status.accepted_at,
          });
          setConsent(record);
        } else {
          clearDataCaptureConsent(consentType);
          setConsent(null);
        }
      } catch {
        // Keep the local cache when the status endpoint is unreachable.
      } finally {
        if (!cancelled) {
          setReady(true);
        }
      }
    }

    void syncFromServer();

    return () => {
      cancelled = true;
    };
  }, [consentType]);

  return {
    ready,
    consent,
    hasConsent: isConsentCurrent(consent),
    refresh: () => setConsent(readDataCaptureConsent(consentType)),
  };
}
