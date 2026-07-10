import { pingExtension, postExtensionHandoff } from '@/lib/extension-bridge';

export async function broadcastExtensionHandoff(): Promise<void> {
  const extensionPresent = await pingExtension();
  if (!extensionPresent) {
    return;
  }

  const response = await fetch('/api/auth/extension-handoff', {
    method: 'POST',
    cache: 'no-store',
  });

  if (!response.ok) {
    return;
  }

  const payload = (await response.json()) as { code?: string };
  if (!payload.code) {
    return;
  }

  await postExtensionHandoff(payload.code);
}
