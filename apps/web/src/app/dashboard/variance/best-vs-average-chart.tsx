'use client';

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
  HIGH_VARIANCE_COLOR,
  allStepNumbers,
  formatDurationMs,
  stepLabel,
  timingsByStep,
} from './chart-utils';
import styles from './variance.module.css';

type BestVsAverageChartProps = {
  steps: FrictionStepChartPoint[];
  timings: WorkflowClusterTimingsResponse;
  height?: number;
};

export function BestVsAverageChart({ steps, timings, height = 260 }: BestVsAverageChartProps) {
  const best =
    timings.best_cluster_id === null
      ? null
      : (timings.clusters.find((cluster) => cluster.cluster_id === timings.best_cluster_id) ??
        null);

  if (!best || best.steps.length === 0 || timings.workflow_average.length === 0) {
    return (
      <p className={styles.chartEmpty}>
        Best-path overlay needs cluster timings and a workflow average. Complete walkthroughs after
        clustering to populate this chart.
      </p>
    );
  }

  const stepMeta = new Map(steps.map((step) => [step.step_number, step]));
  const stepNumbers = allStepNumbers(steps, [best.steps, timings.workflow_average]);
  const bestMap = timingsByStep(best.steps);
  const averageMap = timingsByStep(timings.workflow_average);

  let maxGapStep: number | null = null;
  let maxGap = -1;
  for (const stepNumber of stepNumbers) {
    const bestValue = bestMap.get(stepNumber);
    const averageValue = averageMap.get(stepNumber);
    if (bestValue === undefined || averageValue === undefined) continue;
    const gap = Math.abs(averageValue - bestValue);
    if (gap > maxGap) {
      maxGap = gap;
      maxGapStep = stepNumber;
    }
  }

  const data = stepNumbers.map((stepNumber) => {
    const meta = stepMeta.get(stepNumber);
    const bestValue = bestMap.get(stepNumber);
    const averageValue = averageMap.get(stepNumber);
    return {
      step: `S${stepNumber}`,
      stepNumber,
      label: meta ? stepLabel(meta) : `Step ${stepNumber}`,
      instruction: meta?.instruction?.trim() || '',
      variance: Boolean(meta?.variance_flag) || stepNumber === maxGapStep,
      best: bestValue === undefined ? undefined : Number(bestValue.toFixed(1)),
      average: averageValue === undefined ? undefined : Number(averageValue.toFixed(1)),
      largestGap: stepNumber === maxGapStep,
    };
  });

  return (
    <div className={styles.chartBlock} aria-label="Best path versus average path">
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
                  | {
                      label?: string;
                      instruction?: string;
                      variance?: boolean;
                      largestGap?: boolean;
                    }
                  | undefined;
                if (!point) return '';
                const flags = [
                  point.largestGap ? 'largest gap' : null,
                  point.variance ? 'HIGH VARIANCE' : null,
                ]
                  .filter(Boolean)
                  .join(' · ');
                const instruction = point.instruction ? ` - ${point.instruction}` : '';
                return `${point.label ?? ''}${flags ? ` (${flags})` : ''}${instruction}`;
              }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="best"
              name={`Best path (Cluster ${best.cluster_id})`}
              stroke="#0d9488"
              strokeWidth={2.5}
              connectNulls
              dot={(props) => {
                const { cx, cy, payload } = props;
                if (cx == null || cy == null || payload?.best == null) {
                  return <g key={`best-empty-${payload?.stepNumber}`} />;
                }
                const highlight = Boolean(payload.variance || payload.largestGap);
                return (
                  <circle
                    key={`best-${payload.stepNumber}`}
                    cx={cx}
                    cy={cy}
                    r={highlight ? 5.5 : 3.5}
                    fill={highlight ? HIGH_VARIANCE_COLOR : '#0d9488'}
                    stroke="#fff"
                    strokeWidth={1}
                  />
                );
              }}
            />
            <Line
              type="monotone"
              dataKey="average"
              name="Workflow average"
              stroke="#64748b"
              strokeWidth={2}
              strokeDasharray="6 4"
              connectNulls
              dot={(props) => {
                const { cx, cy, payload } = props;
                if (cx == null || cy == null || payload?.average == null) {
                  return <g key={`avg-empty-${payload?.stepNumber}`} />;
                }
                const highlight = Boolean(payload.variance || payload.largestGap);
                return (
                  <circle
                    key={`avg-${payload.stepNumber}`}
                    cx={cx}
                    cy={cy}
                    r={highlight ? 5.5 : 3.5}
                    fill={highlight ? HIGH_VARIANCE_COLOR : '#64748b'}
                    stroke="#fff"
                    strokeWidth={1}
                  />
                );
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className={styles.chartHint}>
        {maxGapStep === null
          ? 'Overlay compares the lowest-total cluster against the workflow-wide mean.'
          : `Largest gap at Step ${maxGapStep} (${formatDurationMs(maxGap)}). Red markers = HIGH_VARIANCE or largest gap.`}
      </p>
    </div>
  );
}
