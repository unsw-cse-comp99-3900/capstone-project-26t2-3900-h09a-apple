'use client';

import type {
  FrictionWorkflowSummary,
  WorkflowClusterTimingsResponse,
  WorkflowInsightSummaryResponse,
} from '@h09a/types';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { useCurrentUser } from '@/contexts/auth-context';
import {
  ApiError,
  clusterWorkflowByName,
  getFrictionWorkflowList,
  getWorkflowClusterTimings,
  getWorkflowInsightSummary,
} from '@/lib/api';

import { BestVsAverageChart } from '../best-vs-average-chart';
import { FrictionHeatmap } from '../friction-heatmap';
import { PathComparisonChart } from '../path-comparison-chart';
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
  const [timings, setTimings] = useState<WorkflowClusterTimingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateSuccess, setGenerateSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (loadingUser || user?.role !== 'MANAGER') {
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    void Promise.all([
      getFrictionWorkflowList(),
      getWorkflowInsightSummary(workflowId),
      getWorkflowClusterTimings(workflowId),
    ])
      .then(([list, insightSummary, clusterTimings]) => {
        if (!active) return;
        const match = list.workflows.find((item) => item.workflow_id === workflowId) ?? null;
        setWorkflow(match);
        setInsight(insightSummary);
        setTimings(clusterTimings);
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

  useEffect(() => {
    if (!generateSuccess) return;
    const timer = window.setTimeout(() => setGenerateSuccess(null), 3500);
    return () => window.clearTimeout(timer);
  }, [generateSuccess]);

  const workflowName = timings?.workflow_name?.trim() || workflow?.title?.trim() || '';
  const hasClusters = Boolean(timings?.clusters.length);

  async function handleGeneratePathComparison() {
    if (!workflowName || generating) return;

    setGenerating(true);
    setGenerateError(null);
    setGenerateSuccess(null);

    try {
      const result = await clusterWorkflowByName(workflowName);
      const nextTimings = await getWorkflowClusterTimings(workflowId);
      setTimings(nextTimings);
      setGenerateSuccess(
        `Clustering complete (k=${result.chosen_k}, ${result.session_count} sessions). Charts refreshed.`,
      );
    } catch (generateErr: unknown) {
      setGenerateError(
        errorText(generateErr, 'Failed to generate path comparison. Need ≥3 published sessions.'),
      );
    } finally {
      setGenerating(false);
    }
  }

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

  const insightText =
    insight?.summary?.trim() ||
    insight?.teaser?.trim() ||
    workflow?.insight_teaser ||
    'Executive insight not generated yet.';

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Step-level breakdown</p>
          <h1 className={styles.title}>{workflow?.title ?? 'Workflow friction'}</h1>
          <p className={styles.lead}>
            Heatmap, path timelines, and best-vs-average overlays for SOP coaching. Employee
            identifiers are intentionally omitted.
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
                {workflowName ? ` · ${workflowName}` : ''}
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

          <article className={styles.insightPanelTop}>
            <h2>Executive insight</h2>
            <p>{insightText}</p>
          </article>

          <section className={styles.chartSection}>
            <div className={styles.sectionHeading}>
              <div>
                <span className={styles.eyebrow}>At a glance</span>
                <h2 className={styles.sectionTitle}>Friction heatmap</h2>
              </div>
            </div>
            <FrictionHeatmap steps={workflow.steps} />
          </section>

          <section className={styles.chartSection}>
            <div className={styles.sectionHeading}>
              <div>
                <span className={styles.eyebrow}>Execution clusters</span>
                <h2 className={styles.sectionTitle}>Path comparison timeline</h2>
              </div>
              <span>
                {hasClusters
                  ? `${timings?.clusters.length} cluster${timings?.clusters.length === 1 ? '' : 's'}`
                  : 'No clusters'}
              </span>
            </div>

            <div className={styles.generateRow}>
              <button
                className={styles.primaryButton}
                type="button"
                disabled={generating || !workflowName}
                onClick={() => void handleGeneratePathComparison()}
              >
                {generating
                  ? 'Generating...'
                  : hasClusters
                    ? 'Regenerate Path Comparison'
                    : 'Generate Path Comparison'}
              </button>
              {!hasClusters ? (
                <p className={styles.chartHint}>
                  Generate path comparison timeline and best-path overlay. Requires ≥3 published
                  sessions with complete embeddings
                  {workflow.session_count > 0 ? ` (friction list shows ${workflow.session_count})` : ''}.
                </p>
              ) : (
                <p className={styles.chartHint}>
                  Clusters already exist. Regenerate to refresh path grouping after new recordings.
                </p>
              )}
            </div>

            {generateSuccess ? (
              <p className={styles.successToast} role="status">
                {generateSuccess}
              </p>
            ) : null}
            {generateError ? (
              <div className={styles.generateError} role="alert">
                <p>{generateError}</p>
                <button
                  className={styles.secondaryButton}
                  type="button"
                  disabled={generating || !workflowName}
                  onClick={() => void handleGeneratePathComparison()}
                >
                  Retry
                </button>
              </div>
            ) : null}

            {timings ? (
              <PathComparisonChart steps={workflow.steps} timings={timings} />
            ) : (
              <p className={styles.chartEmpty}>Cluster timings unavailable.</p>
            )}
          </section>

          <section className={styles.chartSection}>
            <div className={styles.sectionHeading}>
              <div>
                <span className={styles.eyebrow}>Coaching focus</span>
                <h2 className={styles.sectionTitle}>Best path vs average</h2>
              </div>
            </div>
            {timings ? (
              <BestVsAverageChart steps={workflow.steps} timings={timings} />
            ) : (
              <p className={styles.chartEmpty}>Cluster timings unavailable.</p>
            )}
          </section>

          <section>
            <h2 className={styles.sectionTitle}>Steps</h2>
            <ul className={styles.stepList}>
              {workflow.steps.map((step) => (
                <li
                  key={step.step_number}
                  className={step.variance_flag ? styles.stepListFlagged : undefined}
                >
                  <span>
                    {step.step_title?.trim() || `Step ${step.step_number}`}
                    {step.variance_flag ? ' · HIGH VARIANCE' : ''}
                    {step.instruction?.trim() ? (
                      <small className={styles.stepInstruction}>{step.instruction}</small>
                    ) : null}
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
