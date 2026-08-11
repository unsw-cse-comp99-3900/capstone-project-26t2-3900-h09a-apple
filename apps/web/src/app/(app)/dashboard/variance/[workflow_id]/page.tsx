/**
 * Server/client entry for a single workflow friction detail page.
 */

import { WorkflowFrictionDetailClient } from './workflow-friction-detail-client';

type WorkflowFrictionDetailPageProps = {
  params: Promise<{ workflow_id: string }>;
};

export default async function WorkflowFrictionDetailPage({
  params,
}: WorkflowFrictionDetailPageProps) {
  const { workflow_id: workflowId } = await params;
  return <WorkflowFrictionDetailClient workflowId={workflowId} />;
}
