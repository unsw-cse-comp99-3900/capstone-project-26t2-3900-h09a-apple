'use client';

/**
 * Role-aware dashboard page that mounts employee, reviewer, or manager panels.
 */

import { useCurrentUser } from '@/contexts/auth-context';

import { EmployeePanel } from './employee-panel';
import { ManagerPanel } from './manager-panel';
import { ReviewerPanel } from './reviewer-panel';

export default function DashboardPage() {
  const { user, loading } = useCurrentUser();

  if (loading) {
    return <p>Loading dashboard...</p>;
  }

  if (!user) {
    return <p>Redirecting to sign in...</p>;
  }

  const displayName = user.display_name || user.email;

  if (user.role === 'MANAGER') {
    return <ManagerPanel displayName={displayName} />;
  }
  if (user.role === 'REVIEWER') {
    return <ReviewerPanel displayName={displayName} />;
  }
  return <EmployeePanel displayName={displayName} />;
}
