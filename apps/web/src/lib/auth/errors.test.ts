/**
 * Tests for mapping backend auth errors to UI messages.
 */

import { describe, expect, it } from 'vitest';

import { formatApiDetail } from '@/lib/auth/errors';

describe('formatApiDetail', () => {
  it('returns string detail as-is', () => {
    expect(formatApiDetail('Email already registered', 'Registration failed')).toBe(
      'Email already registered',
    );
  });

  it('formats FastAPI validation arrays', () => {
    expect(
      formatApiDetail(
        [{ type: 'value_error', loc: ['body', 'password'], msg: 'Password too short', input: 'a' }],
        'Registration failed',
      ),
    ).toBe('password: Password too short');
  });

  it('falls back when detail is missing', () => {
    expect(formatApiDetail(undefined, 'Registration failed')).toBe('Registration failed');
  });
});
