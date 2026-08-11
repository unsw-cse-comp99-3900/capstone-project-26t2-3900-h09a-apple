/**
 * Route entry for post-capture session review before submit.
 */

import { SessionReviewClient } from './session-review-client';

type Props = {
  searchParams: Promise<{
    id?: string;
  }>;
};

export default async function SessionReviewPage({ searchParams }: Props) {
  const { id } = await searchParams;

  return <SessionReviewClient sessionId={id ?? ''} />;
}
