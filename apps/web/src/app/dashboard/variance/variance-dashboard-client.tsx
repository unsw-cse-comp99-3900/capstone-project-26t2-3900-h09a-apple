'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { KmeansAnalysisResponse, SopLibraryItem } from '@h09a/types';

import { useCurrentUser } from '@/contexts/auth-context';
import { ApiError, getKmeansAnalysis, getPublishedSops, runKmeansAnalysis } from '@/lib/api';

import styles from './variance.module.css';

const DEFAULT_K = 3;
const DEFAULT_MIN_SESSIONS = 5;

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: 3 }).format(value);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function VarianceDashboardClient() {
  const { user, loading: loadingUser, logout } = useCurrentUser();
  const [sops, setSops] = useState<SopLibraryItem[]>([]);
  const [workflowId, setWorkflowId] = useState('');
  const [k, setK] = useState(DEFAULT_K);
  const [minSessions, setMinSessions] = useState(DEFAULT_MIN_SESSIONS);
  const [analysis, setAnalysis] = useState<KmeansAnalysisResponse | null>(null);
  const [loadingSops, setLoadingSops] = useState(false);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const analysisRequestId = useRef(0);

  useEffect(() => {
    if (loadingUser || user?.role !== 'MANAGER') return;

    let active = true;
    setLoadingSops(true);
    setError(null);

    void getPublishedSops()
      .then(({ sops: publishedSops }) => {
        if (!active) return;
        const sorted = [...publishedSops].sort((left, right) =>
          left.title.localeCompare(right.title),
        );
        setSops(sorted);
        setWorkflowId((current) => current || sorted[0]?.id || '');
      })
      .catch((loadError: unknown) => {
        if (active) setError(errorText(loadError, 'Failed to load published SOPs.'));
      })
      .finally(() => {
        if (active) setLoadingSops(false);
      });

    return () => {
      active = false;
    };
  }, [loadingUser, user?.role]);

  useEffect(() => {
    if (!workflowId || user?.role !== 'MANAGER') {
      setAnalysis(null);
      return;
    }

    let active = true;
    const requestId = ++analysisRequestId.current;
    setLoadingAnalysis(true);
    setRefreshing(false);
    setError(null);
    setAnalysis(null);

    void getKmeansAnalysis(workflowId)
      .then((result) => {
        if (active && requestId === analysisRequestId.current) {
          setAnalysis(result);
          setK(result.k);
        }
      })
      .catch((loadError: unknown) => {
        if (!active || requestId !== analysisRequestId.current) return;
        if (loadError instanceof ApiError && loadError.status === 404) {
          setAnalysis(null);
          return;
        }
        setError(errorText(loadError, 'Failed to load the cached analysis.'));
      })
      .finally(() => {
        if (active && requestId === analysisRequestId.current) setLoadingAnalysis(false);
      });

    return () => {
      active = false;
    };
  }, [user?.role, workflowId]);

  async function handleRefresh(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workflowId) return;

    const requestId = ++analysisRequestId.current;
    setLoadingAnalysis(false);
    setRefreshing(true);
    setError(null);

    try {
      const result = await runKmeansAnalysis({
        workflow_id: workflowId,
        k,
        min_sessions: minSessions,
      });
      if (requestId === analysisRequestId.current) setAnalysis(result);
    } catch (refreshError) {
      if (requestId === analysisRequestId.current) {
        setError(errorText(refreshError, 'Failed to refresh the analysis.'));
      }
    } finally {
      if (requestId === analysisRequestId.current) setRefreshing(false);
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
        <h1 className={styles.title}>Variance dashboard</h1>
        <p className={styles.state}>This dashboard is available to manager accounts only.</p>
        <button className={styles.secondaryButton} type="button" onClick={() => void logout()}>
          Log out
        </button>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Manager analytics</p>
          <h1 className={styles.title}>Variance dashboard</h1>
          <p className={styles.lead}>
            Compare employee workflow sessions, identify behavioural clusters, and review unusual
            executions.
          </p>
        </div>
        <div className={styles.account}>
          <span>{user.email}</span>
          <button className={styles.secondaryButton} type="button" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </header>

      <form className={styles.controls} onSubmit={(event) => void handleRefresh(event)}>
        <label className={styles.workflowField}>
          Published SOP
          <select
            value={workflowId}
            disabled={loadingSops || refreshing}
            onChange={(event) => setWorkflowId(event.target.value)}
          >
            {sops.length === 0 ? <option value="">No published SOPs</option> : null}
            {sops.map((sop) => (
              <option key={sop.id} value={sop.id}>
                {sop.title} ({sop.id})
              </option>
            ))}
          </select>
        </label>
        <label>
          Clusters (k)
          <input
            type="number"
            min={2}
            max={4}
            step={1}
            value={k}
            disabled={refreshing}
            onChange={(event) => setK(event.target.valueAsNumber)}
          />
        </label>
        <label>
          Minimum sessions
          <input
            type="number"
            min={1}
            step={1}
            value={minSessions}
            disabled={refreshing}
            onChange={(event) => setMinSessions(event.target.valueAsNumber)}
          />
        </label>
        <button
          className={styles.primaryButton}
          type="submit"
          disabled={
            !workflowId ||
            loadingAnalysis ||
            refreshing ||
            !Number.isFinite(k) ||
            k < 2 ||
            k > 4 ||
            !Number.isFinite(minSessions) ||
            minSessions < 1
          }
        >
          {refreshing ? 'Refreshing...' : 'Run fresh analysis'}
        </button>
      </form>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {loadingSops || loadingAnalysis ? (
        <section className={styles.stateCard} aria-live="polite">
          <h2>Loading analytics...</h2>
          <p>Checking published workflows and their cached K-means results.</p>
        </section>
      ) : sops.length === 0 ? (
        <section className={styles.stateCard}>
          <h2>No published SOPs</h2>
          <p>Publish an SOP before running workflow variance analysis.</p>
        </section>
      ) : !analysis ? (
        <section className={styles.stateCard}>
          <h2>No cached analysis</h2>
          <p>Choose the cluster settings above and run a fresh analysis for this workflow.</p>
        </section>
      ) : (
        <AnalysisResults analysis={analysis} />
      )}
    </main>
  );
}

function AnalysisResults({ analysis }: { analysis: KmeansAnalysisResponse }) {
  const { metadata } = analysis;

  return (
    <div className={styles.results}>
      <section className={styles.metrics} aria-label="Analysis metadata">
        <article className={styles.metric}>
          <span>Sessions</span>
          <strong>{metadata.session_count}</strong>
        </article>
        <article className={styles.metric}>
          <span>Features</span>
          <strong>{metadata.feature_count}</strong>
        </article>
        <article className={styles.metric}>
          <span>Silhouette score</span>
          <strong>
            {analysis.silhouette_score === null
              ? 'Not available'
              : formatNumber(analysis.silhouette_score)}
          </strong>
        </article>
        <article className={styles.metric}>
          <span>Result source</span>
          <strong>{metadata.cached ? 'Cached' : 'Fresh'}</strong>
        </article>
      </section>

      <section className={styles.metadata}>
        <div>
          <span>Computed</span>
          <strong>{formatDate(metadata.computed_at)}</strong>
        </div>
        <div>
          <span>Duration</span>
          <strong>{formatNumber(metadata.computation_time_ms)} ms</strong>
        </div>
        <div>
          <span>Algorithm</span>
          <strong>{metadata.algorithm_version}</strong>
        </div>
        <div>
          <span>Features</span>
          <strong>{metadata.feature_names.join(', ') || 'None'}</strong>
        </div>
      </section>

      <section>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Cluster profile</p>
            <h2>{analysis.clusters.length} clusters</h2>
          </div>
        </div>
        <div className={styles.clusterGrid}>
          {analysis.clusters.map((cluster) => (
            <article key={cluster.cluster_id} className={styles.clusterCard}>
              <header>
                <h3>Cluster {cluster.cluster_id}</h3>
                <span>{cluster.size} sessions</span>
              </header>
              <h4>Characteristics</h4>
              {cluster.characteristics.length > 0 ? (
                <ul>
                  {cluster.characteristics.map((characteristic) => (
                    <li key={characteristic}>{characteristic}</li>
                  ))}
                </ul>
              ) : (
                <p className={styles.muted}>No characteristics reported.</p>
              )}
              <h4>Employees</h4>
              <div className={styles.chips}>
                {cluster.member_employee_ids.length > 0 ? (
                  cluster.member_employee_ids.map((employeeId) => (
                    <span key={employeeId}>{employeeId}</span>
                  ))
                ) : (
                  <span>None</span>
                )}
              </div>
              <h4>Centroid values</h4>
              <dl className={styles.centroids}>
                {Object.entries(cluster.centroid_values).map(([feature, value]) => (
                  <div key={feature}>
                    <dt>{feature}</dt>
                    <dd>{formatNumber(value)}</dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.tableSection}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Session allocation</p>
            <h2>Assignments</h2>
          </div>
          <span>{analysis.assignments.length} sessions</span>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Session</th>
                <th>Employee</th>
                <th>Cluster</th>
                <th>Distance to centre</th>
              </tr>
            </thead>
            <tbody>
              {analysis.assignments.map((assignment) => (
                <tr key={assignment.session_id}>
                  <td>{assignment.session_id}</td>
                  <td>{assignment.employee_id}</td>
                  <td>{assignment.cluster_id}</td>
                  <td>{formatNumber(assignment.distance_to_center)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.tableSection}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Exceptions</p>
            <h2>Outliers</h2>
          </div>
          <span>{analysis.outliers.length} detected</span>
        </div>
        {analysis.outliers.length === 0 ? (
          <p className={styles.stateInline}>No outliers were detected in this analysis.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Session / employee</th>
                  <th>Cluster</th>
                  <th>Distance / threshold</th>
                  <th>Deviation</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {analysis.outliers.map((outlier) => (
                  <tr key={outlier.session_id}>
                    <td>
                      <strong>{outlier.session_id}</strong>
                      <small>{outlier.employee_id}</small>
                    </td>
                    <td>{outlier.cluster_id}</td>
                    <td>
                      {formatNumber(outlier.distance_to_center)} / {formatNumber(outlier.threshold)}
                    </td>
                    <td>
                      <strong>{outlier.deviating_feature}</strong>
                      <small>
                        {formatNumber(outlier.feature_value)} vs{' '}
                        {formatNumber(outlier.centroid_value)} (Δ {formatNumber(outlier.deviation)})
                      </small>
                    </td>
                    <td>{outlier.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
