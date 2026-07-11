export function getExtensionId(): string | null {
  const extensionId = process.env.NEXT_PUBLIC_EXTENSION_ID?.trim();
  return extensionId || null;
}
