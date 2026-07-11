import { postExtensionLogout } from '@/lib/extension-bridge';

export async function broadcastExtensionLogout(): Promise<void> {
  await postExtensionLogout();
}
