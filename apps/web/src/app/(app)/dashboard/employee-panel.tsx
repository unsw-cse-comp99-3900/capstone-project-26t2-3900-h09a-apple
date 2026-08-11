'use client';

/**
 * Employee home: recent drafts, published SOPs, and next-action links.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { StatCard } from '@/components/ui/stat-card';
import { StateEmpty } from '@/components/ui/state-empty';
import { StateError } from '@/components/ui/state-error';
import { StateLoading } from '@/components/ui/state-loading';
import { ApiError, getDashboardSummary, type DashboardSummary } from '@/lib/api';

import styles from './dashboard.module.css';

function deltaTone(delta: number): 'up' | 'down' | 'flat' {
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';
  return 'flat';
}

function formatDelta(delta: number, suffix = ''): string {
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta}${suffix} vs prior period`;
}

export function EmployeePanel({ displayName }: { displayName: string }) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSummary(await getDashboardSummary());
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : 'Failed to load dashboard summary.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const kpis = summary?.kpis ?? [];

  return (
    <div className={styles.page}>
      <header className={styles.greeting}>
        <p className={styles.eyebrow}>Dashboard</p>
        <h1>Welcome back, {displayName}</h1>
        <p>
          {summary?.greeting ?? 'Your walkthrough activity and coaching signal for this period.'}
        </p>
      </header>

      <section className={styles.kpiGrid} aria-label="Employee KPIs">
        {loading ? (
          <>
            <StateLoading rows={2} />
            <StateLoading rows={2} />
            <StateLoading rows={2} />
            <StateLoading rows={2} />
          </>
        ) : error ? (
          <StateError message={error} code="DASH_EMP_KPI" onRetry={() => void load()} />
        ) : (
          kpis.map((kpi) => (
            <StatCard
              key={kpi.id}
              label={kpi.label}
              value={kpi.value}
              deltaLabel={formatDelta(kpi.delta, kpi.unit ? ` ${kpi.unit}` : '')}
              deltaTone={deltaTone(kpi.delta)}
              accent="#756eff"
            />
          ))
        )}
      </section>

      <div className={styles.columns}>
        <section className={styles.panel}>
          <h2>Recent walkthroughs</h2>
          {loading ? (
            <StateLoading rows={4} />
          ) : error ? (
            <StateError message={error} code="DASH_EMP_LIST" onRetry={() => void load()} />
          ) : !summary?.primary_items.length ? (
            <StateEmpty
              title="No walkthroughs yet"
              body="Find a procedure in the library to get started."
              actionLabel="Open library"
              actionHref="/library"
            />
          ) : (
            <ul className={styles.list}>
              {summary.primary_items.map((item) => (
                <li key={item.id}>
                  <span>{item.title}</span>
                  <span className={styles.muted}>{item.meta}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className={styles.rail}>
          <h2>Quick actions</h2>
          <div className={styles.actions}>
            <Link className={styles.actionLink} href="/library">
              Search the library
            </Link>
            <Link className={styles.actionLinkSecondary} href="/library">
              Start a walkthrough
            </Link>
          </div>
          <p className={styles.muted} style={{ marginTop: '1rem' }}>
            Recent SOPs also appear in the sidebar as you open them.
          </p>
        </aside>
      </div>
    </div>
  );
}
