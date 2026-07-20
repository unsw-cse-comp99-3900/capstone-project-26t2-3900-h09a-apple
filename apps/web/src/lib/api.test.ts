import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  apiUrl,
  approveSop,
  getPublishedSops,
  getSop,
  getSopsByStatus,
  publishSop,
} from './api';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('apiUrl', () => {
  it('joins the base URL with a path', () => {
    expect(apiUrl('/health')).toMatch(/\/health$/);
  });

  it('adds a leading slash if missing', () => {
    expect(apiUrl('health')).toBe(apiUrl('/health'));
  });
});

describe('getSop', () => {
  it('throws an ApiError with the response status when the SOP is missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'SOP not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(getSop('00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      message: 'Failed to load SOP: SOP not found',
    } satisfies Partial<ApiError>);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/backend/sops/00000000-0000-0000-0000-000000000000',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });
});

describe('getPublishedSops', () => {
  it('requests only published SOPs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          sops: [],
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    );

    await expect(getPublishedSops()).resolves.toEqual({
      sops: [],
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/backend/sops?status=published',
      expect.objectContaining({
        cache: 'no-store',
      }),
    );
  });
});

describe('review queue API helpers', () => {
  it('requests SOPs by status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ sops: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(getSopsByStatus('draft')).resolves.toEqual({ sops: [] });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/backend/sops?status=draft',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('posts approve and publish actions', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'sop-1', status: 'approved' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'sop-1',
            status: 'published',
            published_at: '2026-07-20T00:00:00Z',
            library_url: '/library/sops/sop-1',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );

    await expect(approveSop('sop-1')).resolves.toEqual({ id: 'sop-1', status: 'approved' });
    await expect(publishSop('sop-1')).resolves.toMatchObject({ status: 'published' });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/backend/sops/sop-1/approve',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/backend/sops/sop-1/publish',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
