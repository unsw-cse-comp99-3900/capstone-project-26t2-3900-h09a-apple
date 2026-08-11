/**
 * Route entry for the reviewer queue and feedback tabs.
 */

import { Suspense } from 'react';

import { ReviewQueueClient } from './review-queue-client';

export default function ReviewPage() {
  return (
    <Suspense fallback={<main>Loading review workspace...</main>}>
      <ReviewQueueClient />
    </Suspense>
  );
}
