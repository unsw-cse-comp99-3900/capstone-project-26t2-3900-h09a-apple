import activeWindow from 'active-win';

/**
 * Best-effort browser tab URL for the foreground window.
 * active-win exposes `url` on macOS for supported browsers; Windows/Linux
 * typically return null (no invented heuristics).
 */
export function readForegroundBrowserUrl(): string | null {
  try {
    const window = activeWindow.sync({
      accessibilityPermission: true,
      screenRecordingPermission: process.platform === 'darwin',
    });
    const url = (window as { url?: unknown } | undefined)?.url;
    if (typeof url === 'string' && url.trim()) {
      const trimmed = url.trim();
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        return trimmed;
      }
    }
  } catch (error) {
    console.warn(
      '[walkthrough] foreground URL read failed:',
      error instanceof Error ? error.message : String(error),
    );
  }
  return null;
}
