import type { FrictionEvent, StepTiming } from './types';

export function appendStepTiming(
  timings: StepTiming[],
  stepNumber: number,
  durationMs: number,
): StepTiming[] {
  return [
    ...timings,
    { step_number: stepNumber, duration_ms: Math.max(0, Math.round(durationMs)) },
  ];
}

/** Drop timings for destination and later steps so Previous can re-time the path. */
export function retractTimingsToStep(
  timings: StepTiming[],
  destinationStepNumber: number,
): StepTiming[] {
  return timings.filter((row) => row.step_number < destinationStepNumber);
}

export function retractFrictionToStep(
  events: FrictionEvent[],
  destinationStepNumber: number,
): FrictionEvent[] {
  return events.filter((event) => event.step_number <= destinationStepNumber);
}

export function totalDurationSeconds(timings: StepTiming[]): number {
  const ms = timings.reduce((sum, row) => sum + row.duration_ms, 0);
  return Math.max(0, Math.round(ms / 1000));
}
