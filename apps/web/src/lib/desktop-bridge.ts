const DESKTOP_BASE_URL = 'http://127.0.0.1:37891';
const DESKTOP_PING_URL = `${DESKTOP_BASE_URL}/ping`;
const DESKTOP_START_URL = `${DESKTOP_BASE_URL}/walkthrough/start`;
const DESKTOP_APP_NAME = 'worktrace-desktop';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isDesktopSopId(value: string): boolean {
  return UUID_RE.test(value.trim());
}

export async function pingDesktop(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1000);

  try {
    const response = await fetch(DESKTOP_PING_URL, {
      signal: controller.signal,
    });
    if (!response.ok) {
      return false;
    }
    const body = (await response.json()) as { ok?: boolean; app?: string };
    return body.ok === true && body.app === DESKTOP_APP_NAME;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export function launchDesktopHandoff(code: string): void {
  window.location.href = `worktrace://auth-callback?code=${encodeURIComponent(code)}`;
}

/** Prefer local HTTP start (Origin-checked). Protocol is a fallback only. */
export async function startDesktopWalkthrough(sopId: string): Promise<void> {
  const id = sopId.trim();
  if (!id) {
    throw new Error('Missing SOP id for desktop walkthrough');
  }
  if (!isDesktopSopId(id)) {
    throw new Error('SOP id must be a valid UUID');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(DESKTOP_START_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sopId: id }),
      signal: controller.signal,
    });

    const body = (await response.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
    } | null;

    if (response.ok && body?.ok) {
      return;
    }

    const detail = body?.error?.trim();
    // Protocol may still work when HTTP is blocked by browser policy.
    if (response.status === 0 || response.type === 'opaque') {
      launchDesktopWalkthroughProtocol(id);
      return;
    }

    if (detail) {
      throw new Error(detail);
    }
    throw new Error(`Desktop walkthrough start failed (${response.status})`);
  } catch (error) {
    if (error instanceof Error && /Failed to fetch|NetworkError|aborted/i.test(error.message)) {
      launchDesktopWalkthroughProtocol(id);
      return;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/** @deprecated prefer startDesktopWalkthrough */
export function launchDesktopWalkthrough(sopId: string): void {
  launchDesktopWalkthroughProtocol(sopId);
}

function launchDesktopWalkthroughProtocol(sopId: string): void {
  const id = sopId.trim();
  if (!id) {
    throw new Error('Missing SOP id for desktop walkthrough');
  }
  window.location.href = `worktrace://walkthrough?sopId=${encodeURIComponent(id)}`;
}
