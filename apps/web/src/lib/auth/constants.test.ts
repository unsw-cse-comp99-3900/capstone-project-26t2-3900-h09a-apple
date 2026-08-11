/**
 * Tests for auth cookie names and JWT expiry helpers.
 */

import { describe, expect, it } from 'vitest';

import {
  decodeBase64Url,
  expiresInFromAccessToken,
  roleLandingPath,
  roleFromAccessToken,
} from '@/lib/auth/constants';

function encodeBase64Url(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function makeToken(role: string, exp?: number): string {
  const header = encodeBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = encodeBase64Url(JSON.stringify({ role, exp }));
  return `${header}.${payload}.signature`;
}

describe('auth constants', () => {
  it('maps roles to landing pages', () => {
    expect(roleLandingPath('EMPLOYEE')).toBe('/dashboard');
    expect(roleLandingPath('REVIEWER')).toBe('/dashboard');
    expect(roleLandingPath('MANAGER')).toBe('/dashboard');
  });

  it('decodes base64url jwt payload segments without Buffer', () => {
    const encoded = encodeBase64Url(JSON.stringify({ role: 'REVIEWER', sub: 'user-1' }));
    expect(JSON.parse(decodeBase64Url(encoded))).toEqual({ role: 'REVIEWER', sub: 'user-1' });
  });

  it('adds base64 padding when decoding base64url segments', () => {
    expect(decodeBase64Url('YQ')).toBe('a');
  });

  it('extracts supported roles from jwt payload', () => {
    expect(roleFromAccessToken(makeToken('REVIEWER'))).toBe('REVIEWER');
    expect(roleFromAccessToken(makeToken('EMPLOYEE'))).toBe('EMPLOYEE');
    expect(roleFromAccessToken(makeToken('MANAGER'))).toBe('MANAGER');
  });

  it('computes seconds until access token expiry', () => {
    const exp = Math.floor(Date.now() / 1000) + 120;
    const remaining = expiresInFromAccessToken(makeToken('EMPLOYEE', exp));
    expect(remaining).toBeGreaterThan(100);
    expect(remaining).toBeLessThanOrEqual(120);
  });

  it('returns null for missing or invalid jwt roles', () => {
    expect(roleFromAccessToken(undefined)).toBeNull();
    expect(roleFromAccessToken('')).toBeNull();
    expect(roleFromAccessToken('not-a-jwt')).toBeNull();
    expect(expiresInFromAccessToken(undefined)).toBeNull();
    expect(roleFromAccessToken(makeToken('ADMIN'))).toBeNull();
    expect(roleFromAccessToken(`${encodeBase64Url('{}')}.bad.${encodeBase64Url('{}')}`)).toBeNull();
  });
});
