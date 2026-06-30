import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiUrl, getSop } from './api';

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
  });
});
