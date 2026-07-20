import { normalizeWalkthroughSopId } from './sop-id';

const WALKTHROUGH_HOST = 'walkthrough';

/**
 * Parse `worktrace://walkthrough?sopId=...` (also accepts `id=`).
 * Returns a validated UUID or null when the URL is not a walkthrough launch.
 */
export function parseWalkthroughProtocolSopId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'worktrace:') {
    return null;
  }

  if (parsed.hostname !== WALKTHROUGH_HOST) {
    return null;
  }

  const raw = (parsed.searchParams.get('sopId') ?? parsed.searchParams.get('id') ?? '').trim();
  if (!raw) {
    return null;
  }

  try {
    return normalizeWalkthroughSopId(raw);
  } catch {
    return null;
  }
}
