'use client';

/**
 * Line chart comparing cluster path timings against the workflow average.
 */

import type { FrictionStepChartPoint, WorkflowClusterTimingsResponse } from '@h09a/types';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  CLUSTER_LINE_COLORS,
  HIGH_VARIANCE_COLOR,
  allStepNumbers,
  formatDurationMs,
  stepLabel,
  timingsByStep,
} from './chart-utils';
import styles from './variance.module.css';

type PathComparisonChartProps = {
  steps: FrictionStepChartPoint[];
  timings: WorkflowClusterTimingsResponse;
  height?: number;
};

export function PathComparisonChart({ steps, timings, height = 260 }: PathComparisonChartProps) {
  const clusters = timings.clusters.slice(0, 4);
  if (clusters.length === 0) {
    return (
      <p className={styles.chartEmpty}>
        No execution clusters yet. Run workflow clustering to compare paths.
      </p>
    );
  }

  const stepMeta = new Map(steps.map((step) => [step.step_number, step]));
  const stepNumbers = allStepNumbers(
    steps,
    clusters.map((cluster) => cluster.steps),
  );
  if (stepNumbers.length === 0) {
    return <p className={styles.chartEmpty}>Clusters exist, but no step timings were found.</p>;
  }

  const clusterMaps = clusters.map((cluster) => ({
    cluster,
    values: timingsByStep(cluster.steps),
  }));

  const data = stepNumbers.map((stepNumber) => {
    const meta = stepMeta.get(stepNumber);
    const row: Record<string, string | number | boolean> = {
      step: `S${stepNumber}`,
      stepNumber,
      label: meta ? stepLabel(meta) : `Step ${stepNumber}`,
      instruction: meta?.instruction?.trim() || '',
      variance: Boolean(meta?.variance_flag),
    };
    for (const { cluster, values } of clusterMaps) {
      const value = values.get(stepNumber);
      if (value !== undefined) {
        row[`c${cluster.cluster_id}`] = Number(value.toFixed(1));
      }
    }
    return row;
  });

  return (
    <div className={styles.chartBlock} aria-label="Path comparison timeline">
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="step" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} />
            <YAxis
              width={44}
              tick={{ fontSize: 11, fill: '#64748b' }}
              axisLine={false}
              tickFormatter={(value: number) => formatDurationMs(value)}
            />
            <Tooltip
              formatter={(value: number, name: string) => [formatDurationMs(value), name]}
              labelFormatter={(_, payload) => {
                const point = payload?.[0]?.payload as
                  | { label?: string; instruction?: string; variance?: boolean }
                  | undefined;
                if (!point) return '';
                const instruction = point.instruction ? ` - ${point.instruction}` : '';
                const variance = point.variance ? ' (HIGH VARIANCE)' : '';
                return `${point.label ?? ''}${variance}${instruction}`;
              }}
            />
            <Legend />
            {clusters.map((cluster, index) => {
              const stroke = CLUSTER_LINE_COLORS[index % CLUSTER_LINE_COLORS.length];
              const isBest = timings.best_cluster_id === cluster.cluster_id;
              return (
                <Line
                  key={cluster.cluster_id}
                  type="monotone"
                  dataKey={`c${cluster.cluster_id}`}
                  name={`Cluster ${cluster.cluster_id}${isBest ? ' (best)' : ''}`}
                  stroke={stroke}
                  strokeWidth={isBest ? 2.75 : 2}
                  dot={(props) => {
                    const { cx, cy, payload, dataKey } = props;
                    if (cx == null || cy == null || payload?.[dataKey as string] == null) {
                      return <g key={`empty-${cluster.cluster_id}-${payload?.stepNumber}`} />;
                    }
                    const flagged = Boolean(payload?.variance);
                    return (
                      <circle
                        key={`${cluster.cluster_id}-${payload.stepNumber}`}
                        cx={cx}
                        cy={cy}
                        r={flagged ? 5 : 3.5}
                        fill={flagged ? HIGH_VARIANCE_COLOR : stroke}
                        stroke="#fff"
                        strokeWidth={1}
                      />
                    );
                  }}
                  connectNulls
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className={styles.chartHint}>
        Red markers flag HIGH_VARIANCE steps. Best path is the lowest total mean-time cluster.
      </p>
    </div>
  );
}
