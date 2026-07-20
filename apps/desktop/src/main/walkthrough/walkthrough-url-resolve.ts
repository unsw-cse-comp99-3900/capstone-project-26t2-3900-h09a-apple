/**
 * Resolve dynamic resource URLs during walkthrough playback.
 *
 * Port of apps/extension/src/walkthrough-url-resolve.js. Keep behavior in sync:
 * recording stores absolute URLs (e.g. /issues/65); playback that creates a new
 * resource lands on a different id. Learn the live URL when the page changes
 * from a create/static path into an id-bearing path, then reuse it for later
 * steps that share the same path template.
 */

const ID_SEGMENT = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

const CREATE_SEGMENTS = new Set(['new', 'create', 'add']);

export type ResolveMode = 'none' | 'resolved' | 'live' | 'unresolved_dynamic' | 'recorded';

export function isIdSegment(segment: string): boolean {
  return typeof segment === 'string' && ID_SEGMENT.test(segment);
}

export function generalizePathname(pathname: string): string {
  if (typeof pathname !== 'string' || !pathname) {
    return '';
  }

  return pathname
    .split('/')
    .map((segment) => (isIdSegment(segment) ? '{id}' : segment))
    .join('/');
}

export function isDynamicPathname(pathname: string): boolean {
  if (typeof pathname !== 'string' || !pathname) {
    return false;
  }
  return pathname.split('/').some((segment) => isIdSegment(segment));
}

export function resolvedUrlKey(origin: string, pathname: string): string {
  return `${origin}${generalizePathname(pathname)}`;
}

/**
 * True when pathnames describe the same resource shape, allowing
 * new/create/id segments to differ in the same slot.
 */
export function pathsAreSameResourceShape(leftPath: string, rightPath: string): boolean {
  const left = String(leftPath || '').split('/');
  const right = String(rightPath || '').split('/');
  if (left.length !== right.length) {
    return false;
  }

  for (let i = 0; i < left.length; i += 1) {
    if (left[i] === right[i]) {
      continue;
    }

    const leftFlexible = CREATE_SEGMENTS.has(left[i]!) || isIdSegment(left[i]!);
    const rightFlexible = CREATE_SEGMENTS.has(right[i]!) || isIdSegment(right[i]!);
    if (leftFlexible && rightFlexible) {
      continue;
    }

    return false;
  }

  return true;
}

/** Learn a live resource URL after finishing a step (typically Create). */
export function learnFromStepTransition(
  resolvedUrls: Record<string, string>,
  recordedStepUrl: string | null | undefined,
  liveUrl: string,
): Record<string, string> {
  const base = resolvedUrls && typeof resolvedUrls === 'object' ? { ...resolvedUrls } : {};

  try {
    const live = new URL(liveUrl);
    if (!isDynamicPathname(live.pathname)) {
      return base;
    }

    let shouldLearn = false;

    if (typeof recordedStepUrl === 'string' && recordedStepUrl.trim()) {
      const recorded = new URL(recordedStepUrl, liveUrl);
      if (
        recorded.origin === live.origin &&
        recorded.pathname !== live.pathname &&
        pathsAreSameResourceShape(recorded.pathname, live.pathname)
      ) {
        shouldLearn = true;
      }
    }

    if (!shouldLearn) {
      return base;
    }

    const key = resolvedUrlKey(live.origin, live.pathname);
    base[key] = `${live.origin}${live.pathname}${live.search}`;
    return base;
  } catch {
    return base;
  }
}

/** Map a recorded step URL to the URL that playback should use. */
export function resolvePlaybackTargetUrl(
  recordedUrl: string | null | undefined,
  resolvedUrls: Record<string, string>,
  liveUrlFallback: string | null | undefined,
): { url: string | null; mode: ResolveMode } {
  if (typeof recordedUrl !== 'string' || !recordedUrl.trim()) {
    return { url: null, mode: 'none' };
  }

  const trimmed = recordedUrl.trim();
  const map = resolvedUrls && typeof resolvedUrls === 'object' ? resolvedUrls : {};

  try {
    const recorded = new URL(trimmed, liveUrlFallback || undefined);
    const key = resolvedUrlKey(recorded.origin, recorded.pathname);

    if (typeof map[key] === 'string' && map[key]) {
      return { url: map[key], mode: 'resolved' };
    }

    if (typeof liveUrlFallback === 'string' && liveUrlFallback.trim()) {
      const live = new URL(liveUrlFallback);
      if (
        live.origin === recorded.origin &&
        generalizePathname(live.pathname) === generalizePathname(recorded.pathname) &&
        isDynamicPathname(recorded.pathname)
      ) {
        return {
          url: `${live.origin}${live.pathname}${live.search}`,
          mode: 'live',
        };
      }
    }

    if (isDynamicPathname(recorded.pathname)) {
      // Do not navigate back to a stale recorded resource id.
      return { url: null, mode: 'unresolved_dynamic' };
    }

    return { url: trimmed, mode: 'recorded' };
  } catch {
    return { url: trimmed, mode: 'recorded' };
  }
}
