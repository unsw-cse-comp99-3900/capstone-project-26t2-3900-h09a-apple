import { afterEach, describe, expect, it, vi } from 'vitest';

import { getPublishedSops } from './api';
import { resetSilentRefreshLatch } from './auth/session-refresh';

afterEach(() => {
  vi.restoreAllMocks();
  resetSilentRefreshLatch();
});

describe('authedFetch refresh-and-retry', () => {
  it('retries once after a successful silent refresh on 401', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'Not authenticated' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sops: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    await expect(getPublishedSops()).resolves.toEqual({ sops: [] });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/backend/sops?status=published');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/auth/refresh');
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/backend/sops?status=published');
  });

  it('redirects to login when refresh also fails', async () => {
    const location = { href: '' };
    vi.stubGlobal('window', { location });

    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));

    await expect(getPublishedSops()).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
    });

    expect(location.href).toBe('/login');
  });
});
