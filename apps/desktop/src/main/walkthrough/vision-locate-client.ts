import { authenticatedFetch, getCurrentAuth } from '../auth/auth-service';
import { displayForBounds } from './active-display';
import { resolveCaptureCrop, isUntrustedCaptureApp } from './capture-crop';
import { mapViewportRectToScreen } from './coordinate-space';
import { findWindowBoundsByAppName } from './find-app-window';
import { getForegroundWindowBounds } from './foreground-window';
import {
  formatVisionFailureLog,
  type VisionFailureReason,
  type VisionLocateOutcome,
} from './resolve-failure';
import { appFocusVisionDescription, isAppFocusStep, isTypingStep } from './app-focus';
import { captureDisplayRegionPngDetailed } from './screen-capture';
import { visionDescriptionForStep } from './step-navigation';
import type { ScreenRect, WalkthroughStep } from './types';

async function captureForVision(
  displayBounds: ScreenRect,
  cropTo: ScreenRect | null,
  maxEdge?: number,
): Promise<
  { ok: true; capture: import('./screen-capture').CapturedPng } | { ok: false; detail: string }
> {
  const primary = await captureDisplayRegionPngDetailed(displayBounds, cropTo, { maxEdge });
  if (primary.ok) {
    return primary;
  }

  // Crop miss / empty crop (wrong monitor, bad active-win bounds): full display.
  if (cropTo) {
    console.warn(
      `[walkthrough] vision crop capture failed (${primary.reason}: ${primary.detail ?? ''}); ` +
        'retrying full display (Clicky-style)',
    );
    const full = await captureDisplayRegionPngDetailed(displayBounds, null, { maxEdge });
    if (full.ok) {
      return full;
    }
    return {
      ok: false,
      detail: `crop=${primary.reason}/${primary.detail ?? ''}; full=${full.reason}/${full.detail ?? ''}`,
    };
  }

  return {
    ok: false,
    detail: `${primary.reason}: ${primary.detail ?? ''}`,
  };
}

function describeStepForVision(step: WalkthroughStep): string {
  if (isAppFocusStep(step)) {
    return appFocusVisionDescription(step);
  }

  if (isTypingStep(step)) {
    const label = visionDescriptionForStep(step);
    const target = label || 'the text input field for this step';
    return (
      `${target}. Locate the editable text field / input box the user should type into ` +
      `(not the Windows taskbar, not a Send button, not a sidebar item). ` +
      `Prefer a Name / placeholder field inside a dialog or the main content area.`
    );
  }

  const label = visionDescriptionForStep(step);
  if (!label) {
    return '';
  }
  // Disambiguate duplicate on-screen text: prefer the control to click.
  return (
    `${label}. Locate the interactive control (link, button, or menu item) ` +
    `the user should activate INSIDE the application window. ` +
    `If the same text also appears as a large page heading, choose the smaller ` +
    `interactive control, not the heading. ` +
    `Do NOT point at the Windows taskbar, Start button, or system tray — ` +
    `this step is not about switching apps. ` +
    `Do not select the application window chrome alone.`
  );
}

function logVisionFailure(reason: VisionFailureReason, detail?: string): void {
  console.warn(`[walkthrough] ${formatVisionFailureLog(reason, detail)}`);
}

/** After a config/auth failure, skip further vision calls for this process. */
let visionDisabledReason: VisionFailureReason | null = null;

export function resetVisionSessionGate(): void {
  visionDisabledReason = null;
}

function disableVisionForSession(reason: VisionFailureReason): void {
  if (reason === 'not_authenticated' || reason === 'config_missing') {
    visionDisabledReason = reason;
  }
}

/**
 * Conditional vision fallback: crop to foreground window, call locate-element,
 * map image rect onto that window's screen bounds.
 */
export async function resolveVisionGridOnScreen(
  step: WalkthroughStep,
  displayBounds: ScreenRect,
  options?: {
    beforeCapture?: () => void | Promise<void>;
    afterCapture?: () => void | Promise<void>;
  },
): Promise<ScreenRect | null> {
  const outcome = await resolveVisionGridOnScreenDetailed(step, displayBounds, options);
  return outcome.ok ? outcome.rect : null;
}

/** Coarse-to-fine refine: OFF by default — Pass 2 was almost always 422/no_match
 * and only added latency while we fell back to a wrong coarse point. Set
 * VISION_REFINE=1 to re-enable. */
const VISION_REFINE = process.env.VISION_REFINE === '1' || process.env.VISION_REFINE === 'true';
/** Ceiling for the native-resolution pre-crop grab used by the refine pass. */
const REFINE_GRAB_MAX_EDGE = 4096;
/** Minimum focus-crop size (DIP) so the refine crop always contains context. */
const REFINE_FOCUS_MIN_W = 420;
const REFINE_FOCUS_MIN_H = 300;

/**
 * Build a focus rectangle centered on the coarse hit, clamped to `bound`
 * (the window crop, else the display). Big enough to survive coarse jitter,
 * small enough that the target fills a large fraction of the refine image.
 */
function focusRectAround(hit: ScreenRect, bound: ScreenRect): ScreenRect {
  const width = Math.min(bound.width, Math.max(hit.width * 3, REFINE_FOCUS_MIN_W));
  const height = Math.min(bound.height, Math.max(hit.height * 3, REFINE_FOCUS_MIN_H));
  const cx = hit.x + hit.width / 2;
  const cy = hit.y + hit.height / 2;
  const x = Math.min(Math.max(bound.x, cx - width / 2), bound.x + bound.width - width);
  const y = Math.min(Math.max(bound.y, cy - height / 2), bound.y + bound.height - height);
  return { x, y, width, height };
}

/** POST one already-captured image to locate-element and map the hit to screen. */
async function locateOnCapture(
  capture: import('./screen-capture').CapturedPng,
  step: WalkthroughStep,
  description: string,
): Promise<VisionLocateOutcome> {
  try {
    const response = await authenticatedFetch('/api/v1/walkthroughs/locate-element', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_base64: capture.base64,
        content_type: 'image/png',
        description,
        instruction: typeof step.instruction === 'string' ? step.instruction.slice(0, 2000) : null,
        viewport_width: capture.width,
        viewport_height: capture.height,
        step_number: step.step_number,
      }),
    });

    if (response.status === 401 || response.status === 403) {
      disableVisionForSession('not_authenticated');
      return { ok: false, reason: 'not_authenticated', detail: `HTTP ${response.status}` };
    }
    if (response.status === 503) {
      disableVisionForSession('config_missing');
      return { ok: false, reason: 'config_missing', detail: `HTTP ${response.status}` };
    }
    if (response.status === 422) {
      let detail = `HTTP ${response.status}`;
      try {
        const errBody = (await response.json()) as { detail?: unknown };
        if (typeof errBody.detail === 'string' && errBody.detail.trim()) {
          detail = `HTTP 422: ${errBody.detail.trim().slice(0, 160)}`;
        }
      } catch {
        // keep status-only detail
      }
      return { ok: false, reason: 'no_match', detail };
    }
    if (!response.ok) {
      return { ok: false, reason: 'http_error', detail: `HTTP ${response.status}` };
    }

    const body = (await response.json()) as {
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      viewport_width?: number;
      viewport_height?: number;
      coaching_hint?: string | null;
      method?: string | null;
      coarse_cell?: string | null;
    };

    if (
      !Number.isFinite(body.x) ||
      !Number.isFinite(body.y) ||
      !Number.isFinite(body.width) ||
      !Number.isFinite(body.height) ||
      !(Number(body.width) > 0) ||
      !(Number(body.height) > 0)
    ) {
      return { ok: false, reason: 'invalid_response' };
    }

    const rect = mapViewportRectToScreen(
      {
        x: Number(body.x),
        y: Number(body.y),
        width: Number(body.width),
        height: Number(body.height),
      },
      capture.contentBounds,
      Number(body.viewport_width) || capture.width,
      Number(body.viewport_height) || capture.height,
    );

    if (!rect) {
      return { ok: false, reason: 'invalid_response', detail: 'coordinate map failed' };
    }

    const coachingHint =
      typeof body.coaching_hint === 'string' && body.coaching_hint.trim()
        ? body.coaching_hint.trim()
        : null;
    if (body.method) {
      console.info(
        `[walkthrough] vision locate method=${body.method}` +
          (coachingHint ? ` coach=${JSON.stringify(coachingHint.slice(0, 80))}` : ''),
      );
    }

    const liveTargetLabel =
      typeof body.coarse_cell === 'string' &&
      body.coarse_cell.trim() &&
      body.coarse_cell.trim().toLowerCase() !== 'point' &&
      !/^[A-Z]\d+$/i.test(body.coarse_cell.trim())
        ? body.coarse_cell.trim()
        : null;

    return { ok: true, rect, coachingHint, liveTargetLabel };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: 'network_error', detail: message };
  }
}

export async function resolveVisionGridOnScreenDetailed(
  step: WalkthroughStep,
  displayBounds: ScreenRect,
  options?: {
    beforeCapture?: () => void | Promise<void>;
    afterCapture?: () => void | Promise<void>;
  },
): Promise<VisionLocateOutcome> {
  if (visionDisabledReason) {
    logVisionFailure(visionDisabledReason, 'skipped for rest of session');
    return { ok: false, reason: visionDisabledReason, detail: 'skipped for rest of session' };
  }

  const description = describeStepForVision(step);
  if (!description) {
    logVisionFailure('no_description');
    return { ok: false, reason: 'no_description' };
  }

  if (!getCurrentAuth()) {
    logVisionFailure('not_authenticated');
    disableVisionForSession('not_authenticated');
    return { ok: false, reason: 'not_authenticated' };
  }

  // Prefer a trusted live window. When the overlay steals focus (Electron),
  // look up the recorded app's real window — never reuse stale recorded_window_bounds
  // (those caused highlight drift that looked like a shifting offset).
  const foreground = await getForegroundWindowBounds();
  const recordedApp =
    typeof step.attrs?.foreground_app === 'string' ? step.attrs.foreground_app.trim() : '';
  const needTargetLookup =
    recordedApp.length > 0 && (!foreground?.appName || isUntrustedCaptureApp(foreground.appName));
  const targetApp = needTargetLookup ? await findWindowBoundsByAppName(recordedApp) : null;
  const cropDecision = resolveCaptureCrop(displayBounds, {
    liveAppName: foreground?.appName,
    liveBounds: foreground?.bounds ?? null,
    step,
    targetAppName: targetApp?.appName ?? (recordedApp || null),
    targetAppBounds: targetApp?.bounds ?? null,
  });
  const cropTo = cropDecision.crop;
  console.info(`[walkthrough] vision: ${cropDecision.reason}`);

  // Pass 1 (coarse): window crop (or full display) at standard resolution.
  // Keep the overlay cloaked through Pass 2 as well — otherwise the refine
  // screenshot includes our own highlight/panel and the model aims at us.
  await options?.beforeCapture?.();
  await new Promise((r) => setTimeout(r, 80));

  let coarseCapture: Awaited<ReturnType<typeof captureForVision>>;
  try {
    coarseCapture = await captureForVision(displayBounds, cropTo);
  } catch (error) {
    await options?.afterCapture?.();
    throw error;
  }

  if (!coarseCapture.ok) {
    await options?.afterCapture?.();
    logVisionFailure('capture_failed', coarseCapture.detail);
    return { ok: false, reason: 'capture_failed', detail: coarseCapture.detail };
  }

  const coarse = await locateOnCapture(coarseCapture.capture, step, description);
  if (!coarse.ok) {
    await options?.afterCapture?.();
    logVisionFailure(coarse.reason, coarse.detail);
    return coarse;
  }

  if (!VISION_REFINE) {
    await options?.afterCapture?.();
    return coarse;
  }

  // Pass 2 (fine): re-crop tightly around the coarse hit and grab that region
  // at native resolution, so the model sees the target much larger. This is the
  // fix for "highlight lands near but not on" — downscaling the whole window
  // first throws away the pixels the model needs to be precise.
  const bound = cropTo ?? displayBounds;
  const focus = focusRectAround(coarse.rect, bound);
  const nativeEdge = Math.round(
    Math.max(displayBounds.width, displayBounds.height) * displayScaleFactor(displayBounds),
  );
  const refineEdge = Math.min(REFINE_GRAB_MAX_EDGE, Math.max(nativeEdge, 1));

  let fineCapture: Awaited<ReturnType<typeof captureForVision>>;
  try {
    fineCapture = await captureForVision(displayBounds, focus, refineEdge);
  } finally {
    await options?.afterCapture?.();
  }

  if (!fineCapture.ok) {
    console.info(
      `[walkthrough] vision refine capture failed (${fineCapture.detail}); using coarse`,
    );
    return coarse;
  }

  const fine = await locateOnCapture(fineCapture.capture, step, description);
  if (!fine.ok) {
    console.info(`[walkthrough] vision refine locate failed (${fine.reason}); using coarse`);
    return coarse;
  }

  // If refine drifted outside the focus window, trust coarse instead.
  const fineCenterX = fine.rect.x + fine.rect.width / 2;
  const fineCenterY = fine.rect.y + fine.rect.height / 2;
  const insideFocus =
    fineCenterX >= focus.x &&
    fineCenterX <= focus.x + focus.width &&
    fineCenterY >= focus.y &&
    fineCenterY <= focus.y + focus.height;
  if (!insideFocus) {
    console.info('[walkthrough] vision refine drifted outside focus crop; using coarse');
    return coarse;
  }

  console.info(
    `[walkthrough] vision refined rect=${Math.round(fine.rect.x)},${Math.round(fine.rect.y)} ` +
      `${Math.round(fine.rect.width)}x${Math.round(fine.rect.height)} ` +
      `(coarse ${Math.round(coarse.rect.x)},${Math.round(coarse.rect.y)})`,
  );

  // Keep the coarse coaching / label when the fine pass omits them.
  return {
    ok: true,
    rect: fine.rect,
    coachingHint: fine.coachingHint ?? coarse.coachingHint ?? null,
    liveTargetLabel: fine.liveTargetLabel ?? coarse.liveTargetLabel ?? null,
  };
}

/** Scale factor for the display that owns the given bounds. */
export function displayScaleFactor(bounds: ScreenRect): number {
  return displayForBounds(bounds).scaleFactor || 1;
}
