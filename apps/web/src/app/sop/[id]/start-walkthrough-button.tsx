'use client';

/**
 * Starts an on-page walkthrough via the extension after consent is current.
 */

import React from 'react';
import { WalkthroughConsentButton } from '@/components/consent/walkthrough-consent-button';
import { postExtensionStartWalkthrough } from '@/lib/extension-bridge';

type StartWalkthroughButtonProps = {
  sopId: string;
};

export function StartWalkthroughButton({ sopId }: StartWalkthroughButtonProps) {
  return (
    <WalkthroughConsentButton
      label="Start walkthrough"
      readyLabel="Starting walkthrough..."
      onReady={() => postExtensionStartWalkthrough(sopId)}
    />
  );
}
