import type { ResolveMode } from './walkthrough-url-resolve';
import type { HighlightStyle, ResolvedTarget, ScreenRect, WalkthroughStep } from './types';

/** Live matches and honest approximate recorded positions may paint a hole. */
export const PAINTABLE_RESOLVE_SOURCES = new Set<ResolvedTarget['source']>([
  'accessibility_api',
  'ocr',
  'vision_model',
  'recorded_approximate',
]);

export function isPaintableResolveSource(source: ResolvedTarget['source']): boolean {
  return PAINTABLE_RESOLVE_SOURCES.has(source);
}

export function highlightStyleForSource(source: ResolvedTarget['source']): HighlightStyle | null {
  if (source === 'accessibility_api' || source === 'ocr' || source === 'vision_model') {
    return 'live';
  }
  if (source === 'recorded_approximate') {
    return 'approximate';
  }
  return null;
}

/** Recorded window bounds from step attrs (screen space), if present. */
export function windowBoundsFromStep(step: WalkthroughStep | null): ScreenRect | null {
  if (!step?.attrs || typeof step.attrs !== 'object') {
    return null;
  }
  const raw = step.attrs.window_bounds;
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const bounds = raw as Record<string, unknown>;
  const x = Number(bounds.x);
  const y = Number(bounds.y);
  const width = Number(bounds.width);
  const height = Number(bounds.height);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !(width > 0) ||
    !(height > 0)
  ) {
    return null;
  }
  return { x, y, width, height };
}

export function pointInRect(x: number, y: number, rect: ScreenRect, paddingPx = 12): boolean {
  return (
    x >= rect.x - paddingPx &&
    y >= rect.y - paddingPx &&
    x <= rect.x + rect.width + paddingPx &&
    y <= rect.y + rect.height + paddingPx
  );
}

export interface StepContextInfo {
  app: string | null;
  windowTitle: string | null;
  targetLabel: string | null;
  recordedUrl: string | null;
}

/**
 * Context taken only from recorded step fields (never invented).
 * Missing values stay null so the UI can show Unknown honestly.
 */
export function buildStepContext(
  step: WalkthroughStep | null,
  recordedUrl: string | null,
): StepContextInfo {
  if (!step) {
    return { app: null, windowTitle: null, targetLabel: null, recordedUrl: null };
  }

  const attrs = step.attrs && typeof step.attrs === 'object' ? step.attrs : null;
  const appRaw = attrs?.foreground_app;
  const titleRaw = attrs?.window_title;
  const labelRaw = step.target_label;

  return {
    app: typeof appRaw === 'string' && appRaw.trim() ? appRaw.trim() : null,
    windowTitle: typeof titleRaw === 'string' && titleRaw.trim() ? titleRaw.trim() : null,
    targetLabel: typeof labelRaw === 'string' && labelRaw.trim() ? labelRaw.trim() : null,
    recordedUrl: recordedUrl && recordedUrl.trim() ? recordedUrl.trim() : null,
  };
}

/**
 * Auto openExternal policy (honest, not site-hardcoded):
 * - Never open unresolved_dynamic or live (stay on current page).
 * - Auto-open only on the first step of a walkthrough when URL is navigable.
 * - Later steps never auto-open; user may use Open page manually.
 */
export function shouldAutoOpenStepUrl(options: {
  mode: ResolveMode;
  url: string | null;
  stepIndex: number;
}): boolean {
  const { mode, url, stepIndex } = options;
  if (!url) {
    return false;
  }
  if (mode === 'unresolved_dynamic' || mode === 'live' || mode === 'none') {
    return false;
  }
  // recorded | resolved — only the starting step may auto-open.
  return stepIndex === 0;
}
