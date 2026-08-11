/**
 * Tests for auth cookie helpers used by Next route handlers.
 */

import { describe, expect, it, vi } from 'vitest';

import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '@/lib/auth/constants';
import {
  clearAccessCookie,
  clearAuthCookies,
  setAccessCookie,
  setAuthCookies,
} from '@/lib/auth/cookies';

function mockResponse() {
  const set = vi.fn();
  return {
    cookies: { set },
    set,
  } as unknown as Parameters<typeof setAuthCookies>[0] & { set: typeof set };
}

describe('auth cookies', () => {
  it('sets access and refresh cookies', () => {
    const response = mockResponse();
    setAuthCookies(response, 'access', 'refresh', 3600);
    expect(response.cookies.set).toHaveBeenCalledWith(
      ACCESS_TOKEN_COOKIE,
      'access',
      expect.objectContaining({ httpOnly: true, maxAge: 3600, path: '/' }),
    );
    expect(response.cookies.set).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE,
      'refresh',
      expect.objectContaining({ httpOnly: true, maxAge: 60 * 60 * 24 * 7 }),
    );
  });

  it('sets and clears the access cookie alone', () => {
    const response = mockResponse();
    setAccessCookie(response, 'access', 120);
    clearAccessCookie(response);
    expect(response.cookies.set).toHaveBeenNthCalledWith(
      1,
      ACCESS_TOKEN_COOKIE,
      'access',
      expect.objectContaining({ maxAge: 120 }),
    );
    expect(response.cookies.set).toHaveBeenNthCalledWith(
      2,
      ACCESS_TOKEN_COOKIE,
      '',
      expect.objectContaining({ maxAge: 0 }),
    );
  });

  it('clears both auth cookies', () => {
    const response = mockResponse();
    clearAuthCookies(response);
    expect(response.cookies.set).toHaveBeenCalledWith(
      ACCESS_TOKEN_COOKIE,
      '',
      expect.objectContaining({ maxAge: 0 }),
    );
    expect(response.cookies.set).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE,
      '',
      expect.objectContaining({ maxAge: 0 }),
    );
  });
});
