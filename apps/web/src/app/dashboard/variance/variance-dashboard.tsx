'use client';

import Link from 'next/link';
import { useCurrentUser } from '@/contexts/auth-context';
import {
  WORKFLOW_LIST,
  getWorkflowDetail,
  listSummary,
  type WorkflowDetail,
  type WorkflowListItem,
} from './mock-data';
import { displayNameFromEmail, frictionHeatColor, initialFromEmail } from './friction';
import styles from './variance.module.css';

function ManagerChrome({ title }: { title: string }) {
  const { user, logout } = useCurrentUser();
  if (!user) {
    return null;
  }
  const name = displayNameFromEmail(user.email);
  const initial = initialFromEmail(user.email);

  return (
    <header className={styles.topBar}>
      <div className={styles.brandBlock}>
        <span className={styles.brandMark} aria-hidden="true">
          W
        </span>
        <span className={styles.brandLabel}>{title}</span>
      </div>
      <div className={styles.profileBlock}>
        <span className={styles.avatar} aria-hidden="true">
          {initial}
        </span>
        <div className={styles.profileCopy}>
          <strong>{name}</strong>
          <span>{user.role}</span>
        </div>
        <button type="button" className={styles.logoutButton} onClick={() => void logout()}>
          Log out
        </button>
      </div>
    </header>
  );
}

function SummaryTiles({ list }: { list: WorkflowListItem[] }) {
  const summary = listSummary(list);
  const tiles = [
    { label: 'Workflows tracked', value: String(summary.workflowsTracked) },
    { label: 'Sessions analysed', value: String(summary.sessionsAnalysed) },
    { label: 'Avg friction', value: String(summary.avgFriction) },
    { label: 'High-variance workflows', value: String(summary.highVarianceWorkflows) },
  ];
  return (
    <section className={styles.tileGrid} aria-label="Summary">
      {tiles.map((tile) => (
        <article key={tile.label} className={styles.tile}>
          <p className={styles.tileLabel}>{tile.label}</p>
          <p className={styles.tileValue}>{tile.value}</p>
        </article>
      ))}
    </section>
  );
}

function RankingList({ list }: { list: WorkflowListItem[] }) {
  return (
    <section className={styles.ranking} aria-label="Workflow friction ranking">
      {list.map((item, index) => (
        <Link key={item.id} href={`/dashboard/variance/${item.id}`} className={styles.rankCard}>
          <span className={styles.rankIndex}>{index + 1}</span>
          <div className={styles.rankBody}>
            <div className={styles.rankTitleRow}>
              <h2>{item.title}</h2>
              {item.high_variance ? (
                <span className={styles.highVarBadge}>HIGH VARIANCE</span>
              ) : null}
            </div>
            {item.insight_teaser ? (
              <p className={styles.teaser}>
                <span className={styles.aiChip}>AI</span>
                {item.insight_teaser}
              </p>
            ) : (
              <p className={styles.teaserLoading} aria-live="polite">
                Generating insight…
              </p>
            )}
            <p className={styles.metaMuted}>{item.session_count} sessions analysed</p>
          </div>
          <div className={styles.frictionCol}>
            <p className={styles.frictionScore}>{item.aggregate_friction}</p>
            <div className={styles.frictionTrack} aria-hidden="true">
              <span
                className={styles.frictionFill}
                style={{
                  width: `${item.aggregate_friction}%`,
                  background: frictionHeatColor(item.aggregate_friction),
                }}
              />
            </div>
          </div>
        </Link>
      ))}
    </section>
  );
}

export function VarianceListPage() {
  const { user, loading } = useCurrentUser();

  if (loading) {
    return (
      <main className={styles.page}>
        <p className={styles.loading}>Loading session…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className={styles.page}>
        <p className={styles.loading}>Redirecting to sign in…</p>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <ManagerChrome title="Variance" />
      <section className={styles.hero}>
        <p className={styles.eyebrow}>Workforce intelligence</p>
        <h1>Workflow friction</h1>
        <p className={styles.lead}>
          Rank workflows by timing friction so managers can coach the steps that slow teams down,
          without exposing any individual employee.
        </p>
      </section>
      <SummaryTiles list={WORKFLOW_LIST} />
      <RankingList list={WORKFLOW_LIST} />
    </main>
  );
}

function HeatStrip({ detail }: { detail: WorkflowDetail }) {
  return (
    <section className={styles.panel}>
      <h2>Friction heat strip</h2>
      <p className={styles.panelLead}>Each cell is a step, coloured by timing friction.</p>
      <div className={styles.heatRow} role="list">
        {detail.steps.map((step) => (
          <div
            key={step.step_number}
            role="listitem"
            className={`${styles.heatCell} ${step.variance_flag ? styles.heatHighVar : ''}`}
            style={{ background: frictionHeatColor(step.friction_score) }}
            title={`Step ${step.step_number}: ${step.instruction} (${step.friction_score})`}
          >
            <span className={styles.heatStep}>S{step.step_number}</span>
            {step.variance_flag ? <span className={styles.heatCorner}>HIGH VAR</span> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function PathChart({ detail }: { detail: WorkflowDetail }) {
  const width = 640;
  const height = 220;
  const pad = { top: 16, right: 16, bottom: 28, left: 40 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const stepCount = detail.steps.length;
  const allTimes = [
    ...detail.clusters.flatMap((cluster) => cluster.mean_time_per_step),
    ...detail.workflow_average,
  ];
  const maxY = Math.max(...allTimes, 1);
  const xAt = (index: number) =>
    pad.left + (stepCount <= 1 ? innerW / 2 : (index / (stepCount - 1)) * innerW);
  const yAt = (ms: number) => pad.top + innerH - (ms / maxY) * innerH;
  const palette = ['#6882e8', '#45c7a7', '#e8b23a', '#756eff'];

  return (
    <section className={styles.panel}>
      <h2>Path comparison</h2>
      <p className={styles.panelLead}>Mean time per step across discovered paths.</p>
      <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} role="img">
        <title>Path comparison timeline</title>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = pad.top + innerH * (1 - t);
          return (
            <g key={t}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={y}
                y2={y}
                stroke="#e2e6f6"
                strokeWidth="1"
              />
            </g>
          );
        })}
        {detail.clusters.map((cluster, clusterIndex) => {
          const points = cluster.mean_time_per_step
            .map((ms, index) => `${xAt(index)},${yAt(ms)}`)
            .join(' ');
          return (
            <polyline
              key={cluster.cluster_id}
              fill="none"
              stroke={palette[clusterIndex % palette.length]}
              strokeWidth="2.5"
              points={points}
            />
          );
        })}
        {detail.steps.map((step, index) =>
          step.variance_flag ? (
            <circle
              key={`dot-${step.step_number}`}
              cx={xAt(index)}
              cy={yAt(detail.workflow_average[index] ?? step.mean_time_ms)}
              r="5"
              fill="#ef4444"
            >
              <title>{step.instruction}</title>
            </circle>
          ) : null,
        )}
      </svg>
      <ul className={styles.legend}>
        {detail.clusters.map((cluster, index) => (
          <li key={cluster.cluster_id}>
            <span
              className={styles.legendSwatch}
              style={{ background: palette[index % palette.length] }}
            />
            {cluster.label}
          </li>
        ))}
      </ul>
    </section>
  );
}

function BestVsAverage({ detail }: { detail: WorkflowDetail }) {
  const width = 640;
  const height = 220;
  const pad = { top: 16, right: 16, bottom: 28, left: 40 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const stepCount = detail.steps.length;
  const best = detail.clusters.find((cluster) => cluster.cluster_id === detail.best_cluster_id);
  const series = best?.mean_time_per_step ?? detail.workflow_average;
  const allTimes = [...series, ...detail.workflow_average];
  const maxY = Math.max(...allTimes, 1);
  const xAt = (index: number) =>
    pad.left + (stepCount <= 1 ? innerW / 2 : (index / (stepCount - 1)) * innerW);
  const yAt = (ms: number) => pad.top + innerH - (ms / maxY) * innerH;
  const bestPoints = series.map((ms, index) => `${xAt(index)},${yAt(ms)}`).join(' ');
  const avgPoints = detail.workflow_average
    .map((ms, index) => `${xAt(index)},${yAt(ms)}`)
    .join(' ');

  return (
    <section className={styles.panel}>
      <h2>Best path vs average</h2>
      <p className={styles.panelLead}>
        Solid = lowest-total-time cluster · Dashed = workflow average.
      </p>
      <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} role="img">
        <title>Best cluster versus workflow average</title>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = pad.top + innerH * (1 - t);
          return (
            <line
              key={t}
              x1={pad.left}
              x2={width - pad.right}
              y1={y}
              y2={y}
              stroke="#e2e6f6"
              strokeWidth="1"
            />
          );
        })}
        <polyline
          fill="none"
          stroke="#66708f"
          strokeWidth="2"
          strokeDasharray="6 5"
          points={avgPoints}
        />
        <polyline fill="none" stroke="#756eff" strokeWidth="2.75" points={bestPoints} />
        {detail.steps.map((step, index) =>
          step.variance_flag ? (
            <circle
              key={`best-dot-${step.step_number}`}
              cx={xAt(index)}
              cy={yAt(detail.workflow_average[index] ?? step.mean_time_ms)}
              r="5"
              fill="#ef4444"
            >
              <title>{step.instruction}</title>
            </circle>
          ) : null,
        )}
      </svg>
    </section>
  );
}

export function VarianceDetailPage({ workflowId }: { workflowId: string }) {
  const { user, loading } = useCurrentUser();
  const detail = getWorkflowDetail(workflowId);

  if (loading) {
    return (
      <main className={styles.page}>
        <p className={styles.loading}>Loading session…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className={styles.page}>
        <p className={styles.loading}>Redirecting to sign in…</p>
      </main>
    );
  }

  if (!detail) {
    return (
      <main className={styles.page}>
        <ManagerChrome title="Variance" />
        <p className={styles.loading}>Workflow not found.</p>
        <Link href="/dashboard/variance" className={styles.backLink}>
          ← Back to ranking
        </Link>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <ManagerChrome title="Variance" />
      <Link href="/dashboard/variance" className={styles.backLink}>
        ← Back to ranking
      </Link>
      <header className={styles.detailHeader}>
        <div>
          <div className={styles.rankTitleRow}>
            <h1>{detail.title}</h1>
            {detail.high_variance ? (
              <span className={styles.highVarBadge}>HIGH VARIANCE</span>
            ) : null}
          </div>
          <p className={styles.metaMuted}>
            {detail.session_count} sessions · {detail.path_count} paths · aggregate friction{' '}
            <span className={styles.inlineScore}>{detail.aggregate_friction}</span>
          </p>
        </div>
      </header>

      <aside className={styles.insightCallout} aria-label="AI insight summary">
        <span className={styles.aiChip}>AI</span>
        <ol>
          {detail.insight_summary.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      </aside>

      <HeatStrip detail={detail} />
      <PathChart detail={detail} />
      <BestVsAverage detail={detail} />
    </main>
  );
}
