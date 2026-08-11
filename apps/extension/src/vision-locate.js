/**
 * Client helpers for H09AAPPLE-53 vision locate fallback.
 * API keys never live here; the service worker proxies to the API.
 */

/** Cache key for a vision locate result scoped to SOP step + tab + page. */
export function buildVisionCacheKey({ sopId, stepNumber, tabId, pageKey }) {
  return `${sopId ?? ''}:${stepNumber ?? ''}:${tabId ?? ''}:${pageKey ?? ''}`;
}

/** Stable page key from origin + pathname + search (ignores hash). */
export function pageKeyFromUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch {
    return String(url || '');
  }
}

/**
 * Prefer a short element description; fall back to the step instruction.
 */
export function describeStepForVision(step) {
  if (typeof step?.target_label === 'string' && step.target_label.trim()) {
    return step.target_label.trim();
  }
  if (typeof step?.instruction === 'string' && step.instruction.trim()) {
    return step.instruction.trim().slice(0, 500);
  }
  return '';
}

/** True when rect has finite positive width/height suitable for overlay placement. */
export function isUsableLocateRect(rect) {
  return (
    rect &&
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}
