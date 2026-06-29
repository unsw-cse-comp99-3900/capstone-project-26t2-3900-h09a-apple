import { getSop } from '@/lib/api';
import { SopViewer } from './sop-viewer';

type Props = {
  params: Promise<{
    id: string;
  }>;
};

export default async function SopPage({ params }: Props) {
  const { id } = await params;
  const sop = await getSop(id);

  return <SopViewer sop={sop} />;
}
