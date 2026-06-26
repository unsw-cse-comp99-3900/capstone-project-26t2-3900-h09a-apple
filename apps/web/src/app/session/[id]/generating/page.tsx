import { GeneratingClient } from './generating-client';

type Props = {
  params: Promise<{
    id: string;
  }>;
};

export default async function GeneratingPage({ params }: Props) {
  const { id } = await params;

  return <GeneratingClient sessionId={id} />;
}
