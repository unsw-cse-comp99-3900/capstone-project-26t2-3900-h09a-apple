'use client';

/**
 * Manager home cards: summary KPIs and links into friction analytics.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { StatCard } from '@/components/ui/stat-card';
import { StateEmpty } from '@/components/ui/state-empty';
import { StateError } from '@/components/ui/state-error';
import { StateLoading } from '@/components/ui/state-loading';
import {
  ApiError,
  getDashboardSummary,
  getFrictionWorkflowList,
  type DashboardSummary,
} from '@/lib/api';
import type { FrictionWorkflowSummary } from '@h09a/types';

import { WorkflowFrictionCard } from './variance/workflow-friction-card';
import styles from './dashboard.module.css';

function deltaTone(delta: number): 'up' | 'down' | 'flat' {
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';
  return 'flat';
}

export function ManagerPanel({ displayName }: { displayName: string }) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [workflows, setWorkflows] = useState<FrictionWorkflowSummary[]>([]);
  const [kpiLoading, setKpiLoading] = useState(true);
  const [listLoading, setListLoading] = useState(true);
  const [kpiError, setKpiError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const loadKpis = useCallback(async () => {
    setKpiLoading(true);
    setKpiError(null);
    try {
      setSummary(await getDashboardSummary());
    } catch (err: unknown) {
      setKpiError(err instanceof ApiError ? err.message : 'Failed to load manager KPIs.');
    } finally {
      setKpiLoading(false);
    }
  }, []);

  const loadList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const friction = await getFrictionWorkflowList();
      setWorkflows(friction.workflows.slice(0, 5));
    } catch (err: unknown) {
      setListError(err instanceof ApiError ? err.message : 'Failed to load friction rankings.');
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadKpis();
    void loadList();
  }, [loadKpis, loadList]);

  return (
    <div className={styles.page}>
      <header className={styles.greeting}>
        <p className={styles.eyebrow}>Dashboard</p>
        <h1>{displayName}</h1>
        <p>
          {summary?.greeting ??
            'Start here, then open Analytics for rankings, clustering, and voice feedback.'}
        </p>
      </header>

      <section className={styles.kpiGrid} aria-label="Manager KPIs">
        {kpiLoading ? (
          <>
            <StateLoading rows={2} />
            <StateLoading rows={2} />
            <StateLoading rows={2} />
            <StateLoading rows={2} />
          </>
        ) : kpiError ? (
          <StateError message={kpiError} code="DASH_MGR_KPI" onRetry={() => void loadKpis()} />
        ) : (
          (summary?.kpis ?? []).map((kpi) => (
            <StatCard
              key={kpi.id}
              label={kpi.label}
              value={kpi.value}
              deltaLabel={`${kpi.delta >= 0 ? '+' : ''}${kpi.delta} vs prior period`}
              deltaTone={deltaTone(kpi.delta)}
              accent="#756eff"
            />
          ))
        )}
      </section>

      <div className={styles.columns}>
        <section className={styles.panel}>
          <h2>Highest friction workflows</h2>
          <p className={styles.muted}>
            Ranked list from Analytics. Open a card for step-level charts; no individual employee
            names in this aggregate view.
          </p>
          {listLoading ? (
            <StateLoading rows={5} />
          ) : listError ? (
            <StateError message={listError} code="DASH_MGR_LIST" onRetry={() => void loadList()} />
          ) : workflows.length === 0 ? (
            <StateEmpty
              title="No published workflows"
              body="Publish an SOP to start tracking friction across walkthrough sessions."
              actionLabel="Open analytics"
              actionHref="/dashboard/variance"
            />
          ) : (
            <div className={styles.cardStack}>
              {workflows.map((workflow) => (
                <WorkflowFrictionCard key={workflow.workflow_id} workflow={workflow} />
              ))}
            </div>
          )}
          <div className={styles.actions} style={{ marginTop: '1rem' }}>
            <Link className={styles.actionLink} href="/dashboard/variance">
              Open full analytics
            </Link>
          </div>
        </section>

        <aside className={styles.rail}>
          <h2>Quick actions</h2>
          <div className={styles.actions}>
            <Link className={styles.actionLink} href="/dashboard/variance">
              Workflow rankings
            </Link>
            <Link className={styles.actionLinkSecondary} href="/dashboard/variance/clustering">
              Clustering
            </Link>
            <Link className={styles.actionLinkSecondary} href="/dashboard/feedback">
              Voice feedback
            </Link>
            <Link className={styles.actionLinkSecondary} href="/review">
              Review queue
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
