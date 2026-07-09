'use client';

import type { SopDetailPayload } from '@h09a/types';
import { notFound } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, getSop } from '@/lib/api';
import { SopViewer } from './sop-viewer';
import styles from './sop-viewer.module.css';

type SopViewerClientProps = {
  sopId: string;
};

const NOT_FOUND_STATUSES = new Set([400, 404, 422]);

export function SopViewerClient({ sopId }: SopViewerClientProps) {
  const [sop, setSop] = useState<SopDetailPayload | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSop() {
      setErrorMessage(null);

      try {
        const nextSop = await getSop(sopId);

        if (cancelled) {
          return;
        }

        setSop(nextSop);
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (error instanceof ApiError && NOT_FOUND_STATUSES.has(error.status)) {
          notFound();
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : 'Unable to load SOP draft.');
      }
    }

    void loadSop();

    return () => {
      cancelled = true;
    };
  }, [sopId]);

  if (errorMessage) {
    return (
      <main className={styles.pageShell}>
        <section className={styles.notFoundCard} role="alert">
          <p className={styles.eyebrow}>SOP draft</p>
          <h1>Unable to load SOP draft</h1>
          <p>{errorMessage}</p>
        </section>
      </main>
    );
  }

  if (!sop) {
    return (
      <main className={styles.pageShell}>
        <section className={styles.notFoundCard} aria-busy="true" aria-live="polite">
          <p className={styles.eyebrow}>SOP draft</p>
          <h1>Loading SOP draft...</h1>
          <p>Fetching the generated procedure steps.</p>
        </section>
      </main>
    );
  }

  return <SopViewer sop={sop} />;
}
