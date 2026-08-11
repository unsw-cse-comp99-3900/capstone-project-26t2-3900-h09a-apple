/**
 * Client silent refresh of the access token via /api/auth/refresh.
 */

export type RefreshResult = {
  ok: boolean;
  expires_in: number | null;
};

let refreshInFlight: Promise<RefreshResult> | null = null;

/**
 * Single-flight silent refresh against the BFF.
 * Returns expires_in seconds when the BFF provides it so callers can reschedule
 * proactive refresh.
 */
/** Refresh the access cookie once; latched to avoid parallel storms. */
export async function silentRefreshAccessToken(): Promise<RefreshResult> {
  if (!refreshInFlight) {
    refreshInFlight = (async (): Promise<RefreshResult> => {
      const response = await fetch('/api/auth/refresh', { method: 'POST' });
      if (!response.ok) {
        return { ok: false, expires_in: null };
      }
      const body = (await response.json().catch(() => null)) as { expires_in?: unknown } | null;
      if (typeof body?.expires_in === 'number' && Number.isFinite(body.expires_in)) {
        return { ok: true, expires_in: body.expires_in };
      }
      return { ok: true, expires_in: null };
    })().finally(() => {
      refreshInFlight = null;
    });
  }

  return refreshInFlight;
}

/** Test helper: clear in-flight latch between cases. */
/** Clear the silent-refresh latch (e.g. after logout). */
export function resetSilentRefreshLatch(): void {
  refreshInFlight = null;
}
