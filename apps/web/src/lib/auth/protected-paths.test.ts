import { describe, expect, it } from 'vitest';

import { isProtectedPath } from '@/lib/auth/protected-paths';

describe('protected paths', () => {
  it('marks app routes that require authentication', () => {
    expect(isProtectedPath('/library')).toBe(true);
    expect(isProtectedPath('/session/review')).toBe(true);
    expect(isProtectedPath('/sop/123')).toBe(true);
  });

  it('allows public auth pages', () => {
    expect(isProtectedPath('/login')).toBe(false);
    expect(isProtectedPath('/register')).toBe(false);
    expect(isProtectedPath('/privacy')).toBe(false);
  });
});
