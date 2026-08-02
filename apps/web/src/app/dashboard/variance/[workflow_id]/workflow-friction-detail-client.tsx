'use client';

import type { FrictionWorkflowSummary, WorkflowInsightSummaryResponse } from '@h09a/types';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { useCurrentUser } from '@/contexts/auth-context';
import { ApiError, getFrictionWorkflowList, getWorkflowInsightSummary } from '@/lib/api';

import { FrictionBarChart } from '../friction-bar-chart';
import styles from '../variance.module.css';

type WorkflowFrictionDetailClientProps = {
  workflowId: string;
};

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function WorkflowFrictionDetailClient({ workflowId }: WorkflowFrictionDetailClientProps) {
  const { user, loading: loadingUser, logout } = useCurrentUser();
  const [workflow, setWorkflow] = useState<FrictionWorkflowSummary | null>(null);
  const [insight, setInsight] = useState<WorkflowInsightSummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (loadingUser || user?.role !== 'MANAGER') {
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    void Promise.all([getFrictionWorkflowList(), getWorkflowInsightSummary(workflowId)])
      .then(([list, insightSummary]) => {
        if (!active) return;
        const match = list.workflows.find((item) => item.workflow_id === workflowId) ?? null;
        setWorkflow(match);
        setInsight(insightSummary);
        if (!match) {
          setError('Workflow not found in published friction rankings.');
        }
      })
      .catch((loadError: unknown) => {
        if (active) setError(errorText(loadError, 'Failed to load workflow friction detail.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [loadingUser, user?.role, workflowId]);

  if (loadingUser) {
    return (
      <main className={styles.page}>
        <p className={styles.state}>Loading session...</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className={styles.page}>
        <p className={styles.state}>Redirecting to sign in...</p>
      </main>
    );
  }

  if (user.role !== 'MANAGER') {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>Workflow friction</h1>
        <p className={styles.state}>This view is available to manager accounts only.</p>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Step-level breakdown</p>
          <h1 className={styles.title}>{workflow?.title ?? 'Workflow friction'}</h1>
          <p className={styles.lead}>
            Aggregate step friction for coaching focus. Employee identifiers are intentionally
            omitted from this view.
          </p>
        </div>
        <div className={styles.account}>
          <Link className={styles.secondaryButton} href="/dashboard/variance">
            Back to rankings
          </Link>
          <button className={styles.secondaryButton} type="button" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </header>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <section className={styles.stateCard}>
          <h2>Loading step friction...</h2>
        </section>
      ) : workflow ? (
        <section className={styles.detailPanel}>
          <div className={styles.cardTop}>
            <div>
              <p className={styles.cardMeta}>
                {workflow.session_count} session{workflow.session_count === 1 ? '' : 's'}
                {workflow.status ? ` · ${workflow.status}` : ''}
              </p>
            </div>
            <div className={styles.cardScoreBlock}>
              {workflow.high_variance ? (
                <span className={styles.highVarianceBadge}>HIGH VARIANCE</span>
              ) : null}
              <p className={styles.cardScore}>
                {workflow.overall_score === null ? '-' : workflow.overall_score.toFixed(0)}
              </p>
            </div>
          </div>

          <FrictionBarChart steps={workflow.steps} height={220} />

          <article className={styles.insightPanel}>
            <h2>Executive insight</h2>
            <p>
              {insight?.summary?.trim() ||
                insight?.teaser?.trim() ||
                workflow.insight_teaser ||
                'Executive insight not generated yet.'}
            </p>
          </article>

          <section>
            <h2 className={styles.sectionTitle}>Steps</h2>
            <ul className={styles.stepList}>
              {workflow.steps.map((step) => (
                <li key={step.step_number}>
                  <span>
                    {step.step_title?.trim() || `Step ${step.step_number}`}
                    {step.variance_flag ? ' · flagged' : ''}
                  </span>
                  <strong>{step.average_score.toFixed(0)}</strong>
                </li>
              ))}
            </ul>
          </section>
        </section>
      ) : null}
    </main>
  );
}
