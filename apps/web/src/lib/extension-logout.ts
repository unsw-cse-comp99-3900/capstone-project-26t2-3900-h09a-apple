/**
 * Broadcasts logout to the extension when the web session ends.
 */

import { postExtensionLogout } from '@/lib/extension-bridge';

/** Best-effort logout broadcast to the Chrome extension. */
export async function broadcastExtensionLogout(): Promise<void> {
  await postExtensionLogout();
}
