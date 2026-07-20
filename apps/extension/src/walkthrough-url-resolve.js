/**
 * Resolve dynamic resource URLs during walkthrough playback.
 *
 * Recording stores absolute URLs (e.g. /issues/65). Playback that creates a
 * new resource lands on a different id (e.g. /issues/70). We learn the live
 * URL when the page changes from a create/static path into an id-bearing path,
 * then reuse that live URL for later steps that share the same path template.
 */

const ID_SEGMENT = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

const CREATE_SEGMENTS = new Set(['new', 'create', 'add']);

/**
 * @param {string} segment
 * @returns {boolean}
 */
export function isIdSegment(segment) {
  return typeof segment === 'string' && ID_SEGMENT.test(segment);
}

/**
 * @param {string} pathname
 * @returns {string}
 */
export function generalizePathname(pathname) {
  if (typeof pathname !== 'string' || !pathname) {
    return '';
  }

  return pathname
    .split('/')
    .map((segment) => (isIdSegment(segment) ? '{id}' : segment))
    .join('/');
}

/**
 * @param {string} pathname
 * @returns {boolean}
 */
export function isDynamicPathname(pathname) {
  if (typeof pathname !== 'string' || !pathname) {
    return false;
  }
  return pathname.split('/').some((segment) => isIdSegment(segment));
}

/**
 * @param {string} origin
 * @param {string} pathname
 * @returns {string}
 */
export function resolvedUrlKey(origin, pathname) {
  return `${origin}${generalizePathname(pathname)}`;
}

/**
 * True when pathnames describe the same resource shape, allowing
 * new/create/id segments to differ in the same slot.
 *
 * @param {string} leftPath
 * @param {string} rightPath
 * @returns {boolean}
 */
export function pathsAreSameResourceShape(leftPath, rightPath) {
  const left = String(leftPath || '').split('/');
  const right = String(rightPath || '').split('/');
  if (left.length !== right.length) {
    return false;
  }

  for (let i = 0; i < left.length; i += 1) {
    if (left[i] === right[i]) {
      continue;
    }

    const leftFlexible = CREATE_SEGMENTS.has(left[i]) || isIdSegment(left[i]);
    const rightFlexible = CREATE_SEGMENTS.has(right[i]) || isIdSegment(right[i]);
    if (leftFlexible && rightFlexible) {
      continue;
    }

    return false;
  }

  return true;
}

/**
 * Learn a live resource URL after finishing a step (typically Create).
 *
 * @param {Record<string, string>} resolvedUrls
 * @param {string | null | undefined} recordedStepUrl
 * @param {string} liveUrl
 * @returns {Record<string, string>}
 */
export function learnFromStepTransition(resolvedUrls, recordedStepUrl, liveUrl) {
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

/**
 * @typedef {'none' | 'resolved' | 'live' | 'unresolved_dynamic' | 'recorded'} ResolveMode
 */

/**
 * Map a recorded step URL to the URL that playback should use.
 *
 * @param {string | null | undefined} recordedUrl
 * @param {Record<string, string>} resolvedUrls
 * @param {string | null | undefined} liveUrlFallback current page URL
 * @returns {{ url: string | null, mode: ResolveMode }}
 */
export function resolvePlaybackTargetUrl(recordedUrl, resolvedUrls, liveUrlFallback) {
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
