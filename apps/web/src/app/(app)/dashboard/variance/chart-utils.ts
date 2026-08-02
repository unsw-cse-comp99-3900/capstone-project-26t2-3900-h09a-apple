import type { ClusterStepTiming, FrictionStepChartPoint } from '@h09a/types';

export const HIGH_VARIANCE_COLOR = '#EF4444';

export const CLUSTER_LINE_COLORS = ['#4f46e5', '#0d9488', '#d97706', '#7c3aed'] as const;

export function stepLabel(
  step: Pick<FrictionStepChartPoint, 'step_number' | 'step_title'>,
): string {
  return step.step_title?.trim() || `Step ${step.step_number}`;
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

function mixRgb(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  t: number,
): string {
  const clamped = Math.max(0, Math.min(1, t));
  return `rgb(${Math.round(lerp(from[0], to[0], clamped))}, ${Math.round(
    lerp(from[1], to[1], clamped),
  )}, ${Math.round(lerp(from[2], to[2], clamped))})`;
}

/** Higher-contrast green → amber → red scale for at-a-glance friction. */
export function frictionHeatColor(score: number, varianceFlag: boolean): string {
  if (varianceFlag) {
    return HIGH_VARIANCE_COLOR;
  }
  const clamped = Math.max(0, Math.min(100, score));
  // Discrete-feeling bands so nearby scores stay visually distinct.
  const low: readonly [number, number, number] = [22, 163, 74]; // green-600
  const mid: readonly [number, number, number] = [245, 158, 11]; // amber-500
  const high: readonly [number, number, number] = [185, 28, 28]; // red-700
  if (clamped <= 50) {
    return mixRgb(low, mid, clamped / 50);
  }
  return mixRgb(mid, high, (clamped - 50) / 50);
}

/** Dark text on light/mid cells; white on deep red / HIGH_VARIANCE. */
export function frictionHeatTextColor(score: number, varianceFlag: boolean): string {
  if (varianceFlag || score >= 55) {
    return '#ffffff';
  }
  return '#14532d';
}

export function formatDurationMs(ms: number): string {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${Math.round(ms)}ms`;
}

export function timingsByStep(steps: ClusterStepTiming[]): Map<number, number> {
  return new Map(steps.map((step) => [step.step_number, step.mean_duration_ms]));
}

export function allStepNumbers(
  frictionSteps: FrictionStepChartPoint[],
  clusterSteps: ClusterStepTiming[][],
): number[] {
  const numbers = new Set<number>();
  for (const step of frictionSteps) {
    numbers.add(step.step_number);
  }
  for (const steps of clusterSteps) {
    for (const step of steps) {
      numbers.add(step.step_number);
    }
  }
  return [...numbers].sort((a, b) => a - b);
}
