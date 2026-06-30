import { notFound } from 'next/navigation';
import { ApiError, getSop } from '@/lib/api';
import { SopViewer } from './sop-viewer';

type Props = {
  params: Promise<{
    id: string;
  }>;
};

const NOT_FOUND_STATUSES = new Set([400, 404, 422]);

export default async function SopPage({ params }: Props) {
  const { id } = await params;
  let sop;

  try {
    sop = await getSop(id);
  } catch (error) {
    if (error instanceof ApiError && NOT_FOUND_STATUSES.has(error.status)) {
      notFound();
    }

    throw error;
  }

  return <SopViewer sop={sop} />;
}
