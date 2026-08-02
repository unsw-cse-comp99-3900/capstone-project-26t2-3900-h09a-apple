'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { canAccessPath } from '@/components/shell/nav-items';
import { useCurrentUser } from '@/contexts/auth-context';
import { roleLandingPath } from '@/lib/auth/constants';

import { AccessDenied } from './access-denied';
import { Sidebar } from './sidebar';
import styles from './sidebar.module.css';

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading } = useCurrentUser();
  const pathname = usePathname() || '/dashboard';

  if (loading) {
    return (
      <div className={styles.shell}>
        <div className={styles.main}>
          <p>Loading workspace...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className={styles.shell}>
        <div className={styles.main}>
          <p>Redirecting to sign in...</p>
        </div>
      </div>
    );
  }

  if (!canAccessPath(user.role, pathname)) {
    return (
      <div className={styles.shell}>
        <Sidebar />
        <div className={styles.main}>
          <AccessDenied role={user.role} backHref={roleLandingPath(user.role)} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.main}>{children}</div>
    </div>
  );
}
