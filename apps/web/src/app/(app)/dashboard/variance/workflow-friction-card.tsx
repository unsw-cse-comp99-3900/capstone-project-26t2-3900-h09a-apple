'use client';

/**
 * Summary card for one workflow on the friction rankings list.
 */

import type { FrictionWorkflowSummary } from '@h09a/types';
import Link from 'next/link';

import { FrictionBarChart } from './friction-bar-chart';
import styles from './variance.module.css';

type WorkflowFrictionCardProps = {
  workflow: FrictionWorkflowSummary;
};

function insightText(workflow: FrictionWorkflowSummary): string {
  if (workflow.insight_teaser?.trim()) {
    return workflow.insight_teaser.trim();
  }
  if (workflow.insight_status === 'failed') {
    return 'Insight unavailable because friction analysis failed.';
  }
  if (workflow.status === 'processing' || workflow.status === 'pending') {
    return 'Generating executive insight...';
  }
  return 'Executive insight not generated yet.';
}

export function WorkflowFrictionCard({ workflow }: WorkflowFrictionCardProps) {
  const score =
    workflow.overall_score === null || workflow.overall_score === undefined
      ? '-'
      : workflow.overall_score.toFixed(0);

  return (
    <Link
      href={`/dashboard/variance/${workflow.workflow_id}`}
      className={styles.workflowCard}
      data-testid="workflow-friction-card"
    >
      <div className={styles.cardTop}>
        <div>
          <h2 className={styles.cardTitle}>{workflow.title}</h2>
          <p className={styles.cardMeta}>
            {workflow.session_count} session{workflow.session_count === 1 ? '' : 's'}
            {workflow.status ? ` · ${workflow.status}` : ''}
          </p>
        </div>
        <div className={styles.cardScoreBlock}>
          {workflow.high_variance ? (
            <span className={styles.highVarianceBadge} data-testid="high-variance-badge">
              HIGH VARIANCE
            </span>
          ) : null}
          <p className={styles.cardScore} aria-label="Aggregate friction score">
            {score}
          </p>
        </div>
      </div>

      <FrictionBarChart steps={workflow.steps} />

      <p className={styles.insightTeaser} data-testid="insight-teaser">
        {insightText(workflow)}
      </p>
    </Link>
  );
}
