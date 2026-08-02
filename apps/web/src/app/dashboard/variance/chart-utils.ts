import type { ClusterStepTiming, FrictionStepChartPoint } from '@h09a/types';

export const HIGH_VARIANCE_COLOR = '#EF4444';

export const CLUSTER_LINE_COLORS = ['#4f46e5', '#0d9488', '#d97706', '#7c3aed'] as const;

export function stepLabel(
  step: Pick<FrictionStepChartPoint, 'step_number' | 'step_title'>,
): string {
  return step.step_title?.trim() || `Step ${step.step_number}`;
}

export function frictionHeatColor(score: number, varianceFlag: boolean): string {
  if (varianceFlag) {
    return HIGH_VARIANCE_COLOR;
  }
  const clamped = Math.max(0, Math.min(100, score)) / 100;
  // Light green → amber → deep red by friction intensity.
  const r = Math.round(34 + clamped * (220 - 34));
  const g = Math.round(197 - clamped * (197 - 38));
  const b = Math.round(94 - clamped * (94 - 38));
  return `rgb(${r}, ${g}, ${b})`;
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
