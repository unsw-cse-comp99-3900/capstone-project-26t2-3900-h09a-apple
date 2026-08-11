/**
 * Broadcasts logout to the extension when the web session ends.
 */

import { postExtensionLogout } from '@/lib/extension-bridge';

export async function broadcastExtensionLogout(): Promise<void> {
  await postExtensionLogout();
}
