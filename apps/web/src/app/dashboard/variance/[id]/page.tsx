import { VarianceDetailPage } from '../variance-dashboard';

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function VarianceWorkflowPage({ params }: PageProps) {
  const { id } = await params;
  return <VarianceDetailPage workflowId={id} />;
}
