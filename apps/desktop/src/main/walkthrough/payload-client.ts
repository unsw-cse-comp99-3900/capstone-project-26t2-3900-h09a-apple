import { authenticatedFetch } from '../auth/auth-service';
import { mapWalkthroughStep, type ApiWalkthroughStep } from './payload-map';
import type { CoachingSections, WalkthroughPayload } from './types';

interface ApiWalkthroughPayload {
  sop_id?: string;
  id?: string;
  title?: string;
  steps?: ApiWalkthroughStep[];
  coaching_sections?: CoachingSections | null;
}

export { mapWalkthroughStep } from './payload-map';

export async function fetchWalkthroughPayload(sopId: string): Promise<WalkthroughPayload> {
  const trimmed = sopId.trim();
  if (!trimmed) {
    throw new Error('Missing SOP id');
  }

  const response = await authenticatedFetch(
    `/api/v1/sops/${encodeURIComponent(trimmed)}/walkthrough`,
  );

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Sign in to the desktop app before starting a walkthrough');
    }
    if (response.status === 404) {
      throw new Error('Published SOP not found for this workspace');
    }
    throw new Error('Could not load walkthrough data');
  }

  const body = (await response.json()) as ApiWalkthroughPayload;
  const steps = Array.isArray(body.steps) ? body.steps.map(mapWalkthroughStep) : [];
  if (steps.length === 0) {
    throw new Error('This SOP has no walkthrough steps');
  }

  return {
    sop_id: body.sop_id ?? body.id ?? trimmed,
    title: body.title,
    steps,
    coaching_sections: body.coaching_sections ?? null,
  };
}
