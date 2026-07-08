import { describe, expect, it } from 'vitest';

import { roleLandingPath, roleFromAccessToken } from '@/lib/auth/constants';

describe('auth constants', () => {
  it('maps roles to landing pages', () => {
    expect(roleLandingPath('EMPLOYEE')).toBe('/library');
    expect(roleLandingPath('REVIEWER')).toBe('/review');
    expect(roleLandingPath('MANAGER')).toBe('/dashboard/variance');
  });

  it('extracts role from jwt payload', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ role: 'REVIEWER' })).toString('base64url');
    const token = `${header}.${payload}.signature`;

    expect(roleFromAccessToken(token)).toBe('REVIEWER');
  });
});
