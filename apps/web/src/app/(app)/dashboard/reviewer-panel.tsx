'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useState } from 'react';

import { StatCard } from '@/components/ui/stat-card';
import { StateError } from '@/components/ui/state-error';
import { StateLoading } from '@/components/ui/state-loading';
import { ApiError, getDashboardSummary, type DashboardSummary } from '@/lib/api';

import { ReviewQueueClient } from '../review/review-queue-client';
import styles from './dashboard.module.css';

function deltaTone(delta: number): 'up' | 'down' | 'flat' {
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';
  return 'flat';
}

export function ReviewerPanel({ displayName }: { displayName: string }) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSummary(await getDashboardSummary());
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : 'Failed to load reviewer dashboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className={styles.page}>
      <header className={styles.greeting}>
        <p className={styles.eyebrow}>Dashboard</p>
        <h1>{displayName}</h1>
        <p>{summary?.greeting ?? 'Review queue health and feedback awaiting action.'}</p>
      </header>

      <section className={styles.kpiGrid} aria-label="Reviewer KPIs">
        {loading ? (
          <>
            <StateLoading rows={2} />
            <StateLoading rows={2} />
            <StateLoading rows={2} />
            <StateLoading rows={2} />
          </>
        ) : error ? (
          <StateError message={error} code="DASH_REV_KPI" onRetry={() => void load()} />
        ) : (
          (summary?.kpis ?? []).map((kpi) => (
            <StatCard
              key={kpi.id}
              label={kpi.label}
              value={kpi.value}
              deltaLabel={`${kpi.delta >= 0 ? '+' : ''}${kpi.delta} vs prior period`}
              deltaTone={deltaTone(kpi.delta)}
              accent="#6882e8"
            />
          ))
        )}
      </section>

      <div className={styles.columns}>
        <section className={styles.panel}>
          <h2>Review queue</h2>
          <p className={styles.muted}>
            Same queue as /review: approve SOPs, edit step descriptions immediately, and review
            voice feedback.
          </p>
          <Suspense fallback={<StateLoading rows={4} />}>
            <ReviewQueueClient embedded />
          </Suspense>
        </section>

        <aside className={styles.rail}>
          <h2>Quick actions</h2>
          <div className={styles.actions}>
            <Link className={styles.actionLink} href="/review">
              Open full review page
            </Link>
            <Link className={styles.actionLinkSecondary} href="/review?tab=feedback">
              Voice feedback panel
            </Link>
            <Link className={styles.actionLinkSecondary} href="/library">
              Browse library
            </Link>
          </div>
          <p className={styles.muted} style={{ marginTop: '1rem' }}>
            Use Edit steps on any queue item to change descriptions. Every save is audited.
          </p>
        </aside>
      </div>
    </div>
  );
}
