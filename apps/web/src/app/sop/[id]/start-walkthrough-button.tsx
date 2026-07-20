'use client';

import React from 'react';
import { WalkthroughConsentButton } from '@/components/consent/walkthrough-consent-button';
import { pingDesktop, startDesktopWalkthrough } from '@/lib/desktop-bridge';
import { pingExtension, postExtensionStartWalkthrough } from '@/lib/extension-bridge';

type StartWalkthroughButtonProps = {
  sopId: string;
};

export function StartWalkthroughButton({ sopId }: StartWalkthroughButtonProps) {
  return (
    <WalkthroughConsentButton
      label="Start walkthrough"
      readyLabel="Starting walkthrough..."
      onReady={async () => {
        const [desktopPresent, extensionPresent] = await Promise.all([
          pingDesktop(),
          pingExtension(),
        ]);

        // Prefer desktop when it is running (desktop-recorded SOPs / overlay player).
        // If desktop start fails, fall back to the Chrome extension when available.
        if (desktopPresent) {
          try {
            await startDesktopWalkthrough(sopId);
            return;
          } catch (error) {
            if (!extensionPresent) {
              throw error;
            }
            console.warn('Desktop walkthrough start failed; falling back to extension', error);
          }
        }

        if (extensionPresent) {
          await postExtensionStartWalkthrough(sopId);
          return;
        }

        throw new Error(
          'Neither WorkTrace Desktop nor the Chrome extension is available. Start Desktop (signed in) or install the extension, then try again.',
        );
      }}
    />
  );
}
