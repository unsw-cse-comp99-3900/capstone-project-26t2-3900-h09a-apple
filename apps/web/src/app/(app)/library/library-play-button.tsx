'use client';

import { useState, type MouseEvent } from 'react';

import {
  DataCaptureConsentModal,
  useDataCaptureConsent,
} from '@/components/consent/data-capture-consent-modal';
import { postExtensionStartWalkthrough } from '@/lib/extension-bridge';

import styles from './library.module.css';

type LibraryPlayButtonProps = {
  sopId: string;
  onError?: (message: string) => void;
  onSuccess?: () => void;
};

export function LibraryPlayButton({ sopId, onError, onSuccess }: LibraryPlayButtonProps) {
  const { ready, hasConsent, refresh } = useDataCaptureConsent('walkthrough');
  const [modalOpen, setModalOpen] = useState(false);
  const [launching, setLaunching] = useState(false);

  async function runLaunch() {
    setLaunching(true);
    try {
      await postExtensionStartWalkthrough(sopId);
      onSuccess?.();
    } catch (error) {
      onError?.(
        error instanceof Error
          ? error.message
          : 'Install or enable the WorkTrace extension to start walkthroughs.',
      );
    } finally {
      setLaunching(false);
    }
  }

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (!ready || launching) {
      return;
    }

    if (!hasConsent) {
      setModalOpen(true);
      return;
    }

    void runLaunch();
  }

  function handleAccepted() {
    refresh();
    setModalOpen(false);
    void runLaunch();
  }

  function handleDeclined() {
    setModalOpen(false);
    onError?.('Walkthrough capture stays disabled until you accept the data capture agreement.');
  }

  return (
    <>
      <button
        type="button"
        className={styles.playButton}
        title="Start Walkthrough"
        aria-label="Start Walkthrough"
        disabled={!ready || launching}
        onClick={handleClick}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M8.25 5.75v12.5a.75.75 0 0 0 1.14.64l9.5-6.25a.75.75 0 0 0 0-1.28l-9.5-6.25a.75.75 0 0 0-1.14.64Z"
          />
        </svg>
      </button>
      <DataCaptureConsentModal
        open={modalOpen}
        consentType="walkthrough"
        onAccepted={handleAccepted}
        onDeclined={handleDeclined}
        onDismiss={() => setModalOpen(false)}
      />
    </>
  );
}
