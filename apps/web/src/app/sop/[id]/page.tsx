/**
 * Route entry that loads SOP detail for the viewer.
 */

import { SopViewerClient } from './sop-viewer-client';

type Props = {
  params: Promise<{
    id: string;
  }>;
};

export default async function SopPage({ params }: Props) {
  const { id } = await params;

  return <SopViewerClient sopId={id} />;
}
