/**
 * Route entry for the manager friction rankings list.
 */

import { VarianceDashboardClient } from './variance-dashboard-client';
import { loadFrictionWorkflowList } from '@/lib/server-api';

export default async function VarianceDashboardPage() {
  const initialList = await loadFrictionWorkflowList();
  return <VarianceDashboardClient initialList={initialList} />;
}
