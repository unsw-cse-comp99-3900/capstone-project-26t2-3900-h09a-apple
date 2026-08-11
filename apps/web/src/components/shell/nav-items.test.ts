/**
 * Tests for role-filtered sidebar navigation.
 */

import { describe, expect, it } from 'vitest';

import { canAccessPath, roleAtLeast, visibleNav, visibleNavGroups } from './nav-items';

describe('roleAtLeast', () => {
  it('ranks EMPLOYEE < REVIEWER < MANAGER', () => {
    expect(roleAtLeast('EMPLOYEE', 'EMPLOYEE')).toBe(true);
    expect(roleAtLeast('EMPLOYEE', 'REVIEWER')).toBe(false);
    expect(roleAtLeast('REVIEWER', 'EMPLOYEE')).toBe(true);
    expect(roleAtLeast('MANAGER', 'REVIEWER')).toBe(true);
  });
});

describe('visibleNav', () => {
  it('hides review and analytics from employees', () => {
    const ids = visibleNav('EMPLOYEE').map((item) => item.id);
    expect(ids).toEqual(['dashboard', 'library']);
  });

  it('shows review for reviewers but not analytics children', () => {
    const ids = visibleNav('REVIEWER').map((item) => item.id);
    expect(ids).toContain('review');
    expect(ids).not.toContain('analytics');
  });

  it('shows analytics children for managers', () => {
    const analytics = visibleNav('MANAGER').find((item) => item.id === 'analytics');
    expect(analytics?.children?.map((child) => child.id)).toEqual([
      'variance-list',
      'clustering',
      'voice-feedback',
    ]);
    expect(visibleNavGroups('MANAGER')).toHaveLength(1);
  });
});

describe('canAccessPath', () => {
  it('defers to protected-path role checks', () => {
    expect(canAccessPath('EMPLOYEE', '/library')).toBe(true);
    expect(canAccessPath('EMPLOYEE', '/dashboard/variance')).toBe(false);
    expect(canAccessPath('MANAGER', '/dashboard/variance/clustering')).toBe(true);
  });
});
