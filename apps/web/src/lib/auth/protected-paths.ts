/**
 * Path to minimum-role map for middleware and AppShell gates.
 */

import type { UserRole } from '@h09a/types';

const PROTECTED_PREFIXES = ['/library', '/review', '/dashboard', '/session', '/sop'] as const;

const ROLE_RANK: Record<UserRole, number> = {
  EMPLOYEE: 0,
  REVIEWER: 1,
  MANAGER: 2,
};

/** True when the path requires an authenticated session. */
export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function roleAtLeast(role: UserRole, minimum: UserRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/** Role required for a path, or null when any authenticated role may enter. */
export function requiredRoleForPath(pathname: string): UserRole | null {
  if (pathname.startsWith('/dashboard/variance') || pathname.startsWith('/dashboard/feedback')) {
    return 'MANAGER';
  }
  if (pathname === '/review' || pathname.startsWith('/review/')) {
    return 'REVIEWER';
  }
  if (
    pathname === '/dashboard' ||
    pathname.startsWith('/dashboard/') ||
    pathname === '/library' ||
    pathname.startsWith('/library/') ||
    pathname === '/session' ||
    pathname.startsWith('/session/') ||
    pathname === '/sop' ||
    pathname.startsWith('/sop/')
  ) {
    return 'EMPLOYEE';
  }
  return null;
}

/** Role gate for authenticated routes. Returns true when the role may enter. */
/** Whether the given role may access the pathname. */
export function canRoleAccessPath(role: UserRole, pathname: string): boolean {
  const minimum = requiredRoleForPath(pathname);
  if (minimum === null) {
    return true;
  }
  return roleAtLeast(role, minimum);
}
