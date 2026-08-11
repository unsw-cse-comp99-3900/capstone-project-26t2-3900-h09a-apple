/**
 * Tests for the in-flight silent refresh latch.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { resetSilentRefreshLatch, silentRefreshAccessToken } from './session-refresh';

afterEach(() => {
  vi.restoreAllMocks();
  resetSilentRefreshLatch();
});

describe('silentRefreshAccessToken', () => {
  it('returns ok with expires_in from the BFF', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(silentRefreshAccessToken()).resolves.toEqual({
      ok: true,
      expires_in: 3600,
    });
  });

  it('coalesces concurrent refresh calls into one request', async () => {
    let resolveFetch!: (value: Response) => void;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const first = silentRefreshAccessToken();
    const second = silentRefreshAccessToken();

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    resolveFetch(
      new Response(JSON.stringify({ ok: true, expires_in: 120 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(first).resolves.toEqual({ ok: true, expires_in: 120 });
    await expect(second).resolves.toEqual({ ok: true, expires_in: 120 });
  });

  it('returns ok false when refresh fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 401 }));

    await expect(silentRefreshAccessToken()).resolves.toEqual({
      ok: false,
      expires_in: null,
    });
  });
});
