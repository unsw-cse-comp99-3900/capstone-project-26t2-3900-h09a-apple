'use client';

import { useState } from 'react';

import { WalkthroughConsentButton } from '@/components/consent/walkthrough-consent-button';

import styles from './walkthrough-consent-gate.module.css';

export function WalkthroughConsentGate() {
  const [readyMessage, setReadyMessage] = useState<string | null>(null);

  return (
    <section className={styles.section}>
      <h2>Walkthrough capture</h2>
      <p>
        Launch a guided walkthrough from the web app once consent is accepted. Recording still starts
        from the WorkTrace extension popup.
      </p>
      <WalkthroughConsentButton
        onReady={() =>
          setReadyMessage('Consent recorded. Walkthrough capture entry will connect here in H09AAPPLE-58.')
        }
      />
      {readyMessage ? <p className={styles.ready}>{readyMessage}</p> : null}
    </section>
  );
}
