import { describe, expect, it } from 'vitest';

import { canRoleAccessPath, isProtectedPath } from '@/lib/auth/protected-paths';

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

describe('canRoleAccessPath', () => {
  it('blocks employees from manager analytics and review', () => {
    expect(canRoleAccessPath('EMPLOYEE', '/dashboard')).toBe(true);
    expect(canRoleAccessPath('EMPLOYEE', '/dashboard/variance')).toBe(false);
    expect(canRoleAccessPath('EMPLOYEE', '/review')).toBe(false);
  });

  it('allows reviewers into review but not analytics', () => {
    expect(canRoleAccessPath('REVIEWER', '/review')).toBe(true);
    expect(canRoleAccessPath('REVIEWER', '/dashboard/feedback')).toBe(false);
    expect(canRoleAccessPath('MANAGER', '/dashboard/variance/clustering')).toBe(true);
  });
});
