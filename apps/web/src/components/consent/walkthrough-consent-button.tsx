'use client';

/**
 * Button that gates an action behind current walkthrough consent.
 */

import React, { useState } from 'react';

import {
  DataCaptureConsentModal,
  useDataCaptureConsent,
} from '@/components/consent/data-capture-consent-modal';

import styles from './walkthrough-consent-button.module.css';

type WalkthroughConsentButtonProps = {
  label?: string;
  readyLabel?: string;
  onReady?: () => void | Promise<void>;
};

export function WalkthroughConsentButton({
  label = 'Start walkthrough capture',
  readyLabel = label,
  onReady,
}: WalkthroughConsentButtonProps) {
  const { ready, hasConsent, refresh } = useDataCaptureConsent('walkthrough');
  const [modalOpen, setModalOpen] = useState(false);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);

  async function runReadyAction() {
    setBlockedMessage(null);
    setLaunching(true);

    try {
      await onReady?.();
    } catch (error) {
      setBlockedMessage(
        error instanceof Error
          ? error.message
          : 'The WorkTrace extension could not start this walkthrough.',
      );
    } finally {
      setLaunching(false);
    }
  }

  function handleLaunchClick() {
    setBlockedMessage(null);
    if (!hasConsent) {
      setModalOpen(true);
      return;
    }

    void runReadyAction();
  }

  function handleAccepted() {
    refresh();
    setModalOpen(false);
    setBlockedMessage(null);
    void runReadyAction();
  }

  function handleDeclined() {
    setModalOpen(false);
    setBlockedMessage(
      'Walkthrough capture stays disabled until you accept the data capture agreement.',
    );
  }

  return (
    <>
      <button
        type="button"
        className={styles.button}
        disabled={!ready || launching}
        onClick={handleLaunchClick}
      >
        {launching ? readyLabel : label}
      </button>
      {blockedMessage ? <p className={styles.blocked}>{blockedMessage}</p> : null}
      <DataCaptureConsentModal
        open={modalOpen}
        consentType="walkthrough"
        onAccepted={handleAccepted}
        onDeclined={handleDeclined}
      />
    </>
  );
}
