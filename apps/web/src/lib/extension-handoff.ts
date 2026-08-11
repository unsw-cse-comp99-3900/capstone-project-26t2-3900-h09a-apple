/**
 * Client helper to request an extension handoff code from the BFF.
 */

import { pingExtension, postExtensionHandoff } from '@/lib/extension-bridge';
import { pingDesktop, launchDesktopHandoff } from '@/lib/desktop-bridge';

type HandoffResponse = {
  code?: string;
};

async function mintHandoffCode(): Promise<string | null> {
  const response = await fetch('/api/auth/extension-handoff', {
    method: 'POST',
    cache: 'no-store',
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as HandoffResponse;
  return payload.code ?? null;
}

/** Mint a handoff code via API and push it to the extension. */
export async function broadcastExtensionHandoff(): Promise<void> {
  // Check which clients are available before requesting a handoff code.
  const [extensionPresent, desktopPresent] = await Promise.all([pingExtension(), pingDesktop()]);

  // Nothing is listening.
  if (!extensionPresent && !desktopPresent) {
    return;
  }

  if (extensionPresent) {
    const code = await mintHandoffCode();
    if (code) {
      await postExtensionHandoff(code);
    }
  }

  if (desktopPresent) {
    const code = await mintHandoffCode();
    if (code) {
      launchDesktopHandoff(code);
    }
  }
}
