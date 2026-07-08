'use client';

import { useState } from 'react';

import {
  DataCaptureConsentModal,
  useDataCaptureConsent,
} from '@/components/consent/data-capture-consent-modal';

import styles from './walkthrough-consent-button.module.css';

type WalkthroughConsentButtonProps = {
  onReady?: () => void;
};

export function WalkthroughConsentButton({ onReady }: WalkthroughConsentButtonProps) {
  const { ready, hasConsent, refresh } = useDataCaptureConsent();
  const [modalOpen, setModalOpen] = useState(false);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);

  function handleLaunchClick() {
    setBlockedMessage(null);
    if (!hasConsent) {
      setModalOpen(true);
      return;
    }

    onReady?.();
  }

  function handleAccepted() {
    refresh();
    setModalOpen(false);
    setBlockedMessage(null);
    onReady?.();
  }

  function handleDeclined() {
    setModalOpen(false);
    setBlockedMessage('Walkthrough capture stays disabled until you accept the data capture agreement.');
  }

  return (
    <>
      <button
        type="button"
        className={styles.button}
        disabled={!ready}
        onClick={handleLaunchClick}
      >
        Start walkthrough capture
      </button>
      {blockedMessage ? <p className={styles.blocked}>{blockedMessage}</p> : null}
      <DataCaptureConsentModal
        open={modalOpen}
        onAccepted={handleAccepted}
        onDeclined={handleDeclined}
      />
    </>
  );
}
