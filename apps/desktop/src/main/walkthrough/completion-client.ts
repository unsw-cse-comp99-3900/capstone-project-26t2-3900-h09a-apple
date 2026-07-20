import { authenticatedFetch } from '../auth/auth-service';
import type { FrictionEvent, StepTiming } from './types';

export interface CompletionRequest {
  sop_id: string;
  completed_at: string;
  duration_seconds: number;
  friction_events: FrictionEvent[];
  step_timings: StepTiming[];
}

export interface CompletionResult {
  ok: boolean;
  completionId?: string;
  error?: string;
}

export async function postWalkthroughCompletion(
  payload: CompletionRequest,
): Promise<CompletionResult> {
  try {
    const response = await authenticatedFetch('/api/v1/walkthroughs/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return {
        ok: false,
        error: detail || `Walkthrough completion failed (${response.status})`,
      };
    }

    const body = (await response.json()) as { completion_id?: string };
    return { ok: true, completionId: body.completion_id };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
