import {
  pingExtension,
  postExtensionHandoff,
} from '@/lib/extension-bridge';
import {
  pingDesktop,
  launchDesktopHandoff,
} from '@/lib/desktop-bridge';

type HandoffResponse = {
  code?: string;
};

export async function broadcastExtensionHandoff(): Promise<void> {
  // Check which clients are available before requesting a handoff code.
  const [extensionPresent, desktopPresent] = await Promise.all([
    pingExtension(),
    pingDesktop(),
  ]);

  // Nothing is listening.
  if (!extensionPresent && !desktopPresent) {
    return;
  }

  const response = await fetch('/api/auth/extension-handoff', {
    method: 'POST',
    cache: 'no-store',
  });

  if (!response.ok) {
    return;
  }

  const payload = (await response.json()) as HandoffResponse;

  if (!payload.code) {
    return;
  }

  // Existing Chrome extension handoff.
  if (extensionPresent) {
    await postExtensionHandoff(payload.code);
  }

  // Desktop handoff.
  if (desktopPresent) {
    launchDesktopHandoff(payload.code);
  }
}