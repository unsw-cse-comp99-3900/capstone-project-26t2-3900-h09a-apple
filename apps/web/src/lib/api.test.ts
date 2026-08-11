/**
 * Unit tests for the browser API client helpers.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  apiUrl,
  approveSop,
  getKmeansAnalysis,
  getMyPublishedSops,
  getPublishedSops,
  getSop,
  getSopsByStatus,
  publishSop,
  runKmeansAnalysis,
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

describe('getMyPublishedSops', () => {
  it('requests published SOPs owned by the current user', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ sops: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(getMyPublishedSops()).resolves.toEqual({ sops: [] });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/backend/sops?mine=true&status=published',
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

describe('K-means analytics API helpers', () => {
  const result = {
    workflow_id: 'workflow/one',
    k: 3,
    clusters: [],
    assignments: [],
    outliers: [],
    silhouette_score: null,
    metadata: {
      session_count: 5,
      feature_count: 2,
      feature_names: ['duration', 'clicks'],
      algorithm_version: '1.0',
      computed_at: '2026-07-28T00:00:00Z',
      computation_time_ms: 42,
      cached: false,
    },
  };

  it('posts analysis settings as JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(
      runKmeansAnalysis({ workflow_id: 'workflow/one', k: 3, min_sessions: 5 }),
    ).resolves.toEqual(result);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/backend/analytics/kmeans',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow_id: 'workflow/one', k: 3, min_sessions: 5 }),
        cache: 'no-store',
      }),
    );
  });

  it('encodes the workflow id when loading cached results', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(getKmeansAnalysis('workflow/one')).resolves.toEqual(result);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/backend/analytics/kmeans/workflow%2Fone',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('preserves the response status in analytics errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Not enough sessions' }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(
      runKmeansAnalysis({ workflow_id: 'workflow/one', k: 3, min_sessions: 5 }),
    ).rejects.toMatchObject({
      name: 'ApiError',
      status: 422,
      message: 'Failed to run K-means analysis: Not enough sessions',
    } satisfies Partial<ApiError>);
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
