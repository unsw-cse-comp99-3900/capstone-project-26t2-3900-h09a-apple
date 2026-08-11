'use client';

/**
 * Manager voice-feedback stats dashboard (severity and classification tiles).
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { FeedbackStatsResponse } from '@h09a/types';

import { useCurrentUser } from '@/contexts/auth-context';
import { ApiError, getFeedbackStats } from '@/lib/api';

import styles from './feedback-dashboard.module.css';

export function FeedbackDashboardClient() {
  const { user, loading } = useCurrentUser();
  const [stats, setStats] = useState<FeedbackStatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    if (loading || user?.role !== 'MANAGER') {
      return;
    }
    void (async () => {
      setLoadingStats(true);
      setError(null);
      try {
        setStats(await getFeedbackStats());
      } catch (loadError) {
        setError(
          loadError instanceof ApiError ? loadError.message : 'Failed to load feedback stats.',
        );
      } finally {
        setLoadingStats(false);
      }
    })();
  }, [loading, user?.role]);

  if (loading) {
    return (
      <main className={styles.page}>
        <p className={styles.muted}>Loading session...</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className={styles.page}>
        <p className={styles.muted}>Redirecting to sign in...</p>
      </main>
    );
  }

  if (user.role !== 'MANAGER') {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>Feedback dashboard</h1>
        <p className={styles.muted}>
          This page is for MANAGER accounts. Signed in as {user.email} ({user.role}).
        </p>
      </main>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Analytics</p>
          <h1 className={styles.title}>Voice feedback</h1>
          <p className={styles.lead}>
            Aggregated feedback by type and severity. Use the sidebar for rankings and clustering in
            the same analytics family.
          </p>
        </div>
      </header>

      {error ? <p className={styles.error}>{error}</p> : null}
      {loadingStats ? <p className={styles.muted}>Loading feedback stats...</p> : null}

      {stats ? (
        <>
          <section className={styles.tiles}>
            <article className={styles.tile}>
              <p className={styles.tileLabel}>Total</p>
              <p className={styles.tileValue}>{stats.total}</p>
            </article>
            {Object.entries(stats.by_classification).map(([key, value]) => (
              <article key={key} className={styles.tile}>
                <p className={styles.tileLabel}>{key}</p>
                <p className={styles.tileValue}>{value}</p>
              </article>
            ))}
            {Object.entries(stats.by_severity).map(([key, value]) => (
              <article key={key} className={styles.tile}>
                <p className={styles.tileLabel}>{key} severity</p>
                <p className={styles.tileValue}>{value}</p>
              </article>
            ))}
          </section>

          <section className={styles.panel}>
            <h2>High-severity open</h2>
            {stats.high_severity_open.length === 0 ? (
              <p className={styles.muted}>No open high-severity feedback.</p>
            ) : (
              <ul className={styles.list}>
                {stats.high_severity_open.map((item) => (
                  <li key={item.id} className={styles.card}>
                    <div>
                      <p className={styles.cardTitle}>{item.sop_title}</p>
                      <p className={styles.meta}>
                        {item.employee_email} · {item.classification}
                      </p>
                      <p className={styles.transcript}>{item.transcript}</p>
                    </div>
                    <Link
                      href={`/review?tab=feedback&feedbackId=${item.id}`}
                      className={styles.linkButton}
                    >
                      Open review
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
