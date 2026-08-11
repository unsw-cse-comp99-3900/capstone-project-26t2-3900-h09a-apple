/**
 * Tests for server-component friction list helper.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

import { cookies } from 'next/headers';

import { ACCESS_TOKEN_COOKIE } from '@/lib/auth/constants';

import { loadFrictionWorkflowList } from './server-api';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadFrictionWorkflowList', () => {
  it('returns null when no access cookie is present', async () => {
    vi.mocked(cookies).mockResolvedValue({
      get: () => undefined,
    } as never);
    await expect(loadFrictionWorkflowList()).resolves.toBeNull();
  });

  it('returns the friction list when authenticated', async () => {
    vi.mocked(cookies).mockResolvedValue({
      get: (name: string) => (name === ACCESS_TOKEN_COOKIE ? { value: 'token-1' } : undefined),
    } as never);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ workflows: [{ workflow_id: 'w1' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(loadFrictionWorkflowList()).resolves.toEqual({
      workflows: [{ workflow_id: 'w1' }],
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/analytics/friction'),
      expect.objectContaining({
        headers: { Authorization: 'Bearer token-1' },
        cache: 'no-store',
      }),
    );
  });

  it('returns null when the API fails', async () => {
    vi.mocked(cookies).mockResolvedValue({
      get: () => ({ value: 'token-1' }),
    } as never);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    await expect(loadFrictionWorkflowList()).resolves.toBeNull();
  });
});
