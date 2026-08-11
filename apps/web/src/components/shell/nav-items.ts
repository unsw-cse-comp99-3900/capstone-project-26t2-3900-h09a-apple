/**
 * Sidebar nav model and role-rank helpers aligned with API RBAC.
 */

import type { UserRole } from '@h09a/types';

import { canRoleAccessPath } from '@/lib/auth/protected-paths';

/** Mirror apps/api/app/auth/deps.py _ROLE_RANK. */
export const ROLE_RANK: Record<UserRole, number> = {
  EMPLOYEE: 0,
  REVIEWER: 1,
  MANAGER: 2,
};

export type NavItem = {
  id: string;
  label: string;
  href: string;
  minRole: UserRole;
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
  children?: NavItem[];
};

export type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

/**
 * Workspace nav mirrors the card: Dashboard / Library / Review / Analytics.
 * Manager Analytics keeps child pages so rankings, clustering, and voice
 * feedback stay clearly subordinated under one analytics family.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      {
        id: 'dashboard',
        label: 'Dashboard',
        href: '/dashboard',
        minRole: 'EMPLOYEE',
        description: 'Role home',
      },
      {
        id: 'library',
        label: 'Library',
        href: '/library',
        minRole: 'EMPLOYEE',
        description: 'Browse SOPs',
      },
      {
        id: 'review',
        label: 'Review',
        href: '/review',
        minRole: 'REVIEWER',
        description: 'Queue and feedback',
      },
      {
        id: 'analytics',
        label: 'Analytics',
        href: '/dashboard/variance',
        minRole: 'MANAGER',
        description: 'Friction insights',
        children: [
          {
            id: 'variance-list',
            label: 'Workflow rankings',
            href: '/dashboard/variance',
            minRole: 'MANAGER',
            description: 'Highest friction first',
          },
          {
            id: 'clustering',
            label: 'Clustering',
            href: '/dashboard/variance/clustering',
            minRole: 'MANAGER',
            description: 'Path clusters',
          },
          {
            id: 'voice-feedback',
            label: 'Voice feedback',
            href: '/dashboard/feedback',
            minRole: 'MANAGER',
            description: 'Severity inbox',
          },
        ],
      },
    ],
  },
];

export function roleAtLeast(role: UserRole, minimum: UserRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

function filterItem(item: NavItem, role: UserRole): NavItem | null {
  if (!roleAtLeast(role, item.minRole)) {
    return null;
  }
  const children = item.children
    ?.map((child) => filterItem(child, role))
    .filter((child): child is NavItem => child !== null);
  return { ...item, children };
}

export function visibleNavGroups(role: UserRole): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items
      .map((item) => filterItem(item, role))
      .filter((item): item is NavItem => item !== null),
  })).filter((group) => group.items.length > 0);
}

export function visibleNav(role: UserRole): NavItem[] {
  return visibleNavGroups(role).flatMap((group) => group.items);
}

export function canAccessPath(role: UserRole, pathname: string): boolean {
  return canRoleAccessPath(role, pathname);
}
