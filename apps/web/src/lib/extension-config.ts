/**
 * Build-time Chrome extension ID from NEXT_PUBLIC_EXTENSION_ID.
 */

/** Fixed Chrome extension id used for external messaging in local/dev. */
export function getExtensionId(): string | null {
  const extensionId = process.env.NEXT_PUBLIC_EXTENSION_ID?.trim();
  return extensionId || null;
}
