/**
 * Optional bridge stubs for the desktop capture shell.
 */

const DESKTOP_PING_URL = 'http://127.0.0.1:37891/ping';
/** Probe whether the optional desktop companion is reachable. */
export async function pingDesktop(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1000);

  try {
    const response = await fetch(DESKTOP_PING_URL, {
      signal: controller.signal,
    });

    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/** Open the desktop deep-link with a handoff code. */
export function launchDesktopHandoff(code: string): void {
  window.location.href = `worktrace://auth-callback?code=${encodeURIComponent(code)}`;
}
