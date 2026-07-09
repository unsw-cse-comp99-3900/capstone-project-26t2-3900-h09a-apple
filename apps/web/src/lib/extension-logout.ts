import { postExtensionLogout } from '@/lib/extension-bridge';

export function broadcastExtensionLogout(): void {
  postExtensionLogout();
}
