import { authenticatedFetch, getCurrentAuth } from '../auth/auth-service';
import { displayForBounds } from './active-display';
import { mapViewportRectToScreen } from './coordinate-space';
import { getForegroundWindowBounds } from './foreground-window';
import {
  formatVisionFailureLog,
  type VisionFailureReason,
  type VisionLocateOutcome,
} from './resolve-failure';
import { captureDisplayRegionPng } from './screen-capture';
import type { ScreenRect, WalkthroughStep } from './types';

function describeStepForVision(step: WalkthroughStep): string {
  let label = '';
  if (typeof step.target_label === 'string' && step.target_label.trim()) {
    label = step.target_label.trim();
  } else if (typeof step.instruction === 'string' && step.instruction.trim()) {
    label = step.instruction.trim().slice(0, 500);
  }
  if (!label) {
    return '';
  }
  // Disambiguate duplicate on-screen text: prefer the control to click.
  return (
    `${label}. Locate the interactive control (link, button, or menu item) ` +
    `the user should activate. If the same text also appears as a large page ` +
    `heading, choose the smaller interactive control, not the heading.`
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

  const foreground = await getForegroundWindowBounds();
  const cropBounds = foreground?.bounds ?? null;
  if (!cropBounds) {
    console.info(
      '[walkthrough] vision: no foreground window bounds; refusing full-screen upload for privacy',
    );
    logVisionFailure('capture_failed', 'no foreground window bounds');
    return { ok: false, reason: 'capture_failed', detail: 'no foreground window bounds' };
  }

  const capture = await (async () => {
    await options?.beforeCapture?.();
    try {
      return await captureDisplayRegionPng(displayBounds, cropBounds);
    } finally {
      await options?.afterCapture?.();
    }
  })();

  if (!capture) {
    logVisionFailure('capture_failed');
    return { ok: false, reason: 'capture_failed' };
  }

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
      logVisionFailure('not_authenticated', `HTTP ${response.status}`);
      disableVisionForSession('not_authenticated');
      return { ok: false, reason: 'not_authenticated', detail: `HTTP ${response.status}` };
    }

    if (response.status === 503) {
      logVisionFailure('config_missing', `HTTP ${response.status}`);
      disableVisionForSession('config_missing');
      return { ok: false, reason: 'config_missing', detail: `HTTP ${response.status}` };
    }

    if (response.status === 422) {
      logVisionFailure('no_match', `HTTP ${response.status}`);
      return { ok: false, reason: 'no_match', detail: `HTTP ${response.status}` };
    }

    if (!response.ok) {
      logVisionFailure('http_error', `HTTP ${response.status}`);
      return { ok: false, reason: 'http_error', detail: `HTTP ${response.status}` };
    }

    const body = (await response.json()) as {
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      viewport_width?: number;
      viewport_height?: number;
    };

    if (
      !Number.isFinite(body.x) ||
      !Number.isFinite(body.y) ||
      !Number.isFinite(body.width) ||
      !Number.isFinite(body.height) ||
      !(Number(body.width) > 0) ||
      !(Number(body.height) > 0)
    ) {
      logVisionFailure('invalid_response');
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
      logVisionFailure('invalid_response', 'coordinate map failed');
      return { ok: false, reason: 'invalid_response', detail: 'coordinate map failed' };
    }

    return { ok: true, rect };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logVisionFailure('network_error', message);
    return { ok: false, reason: 'network_error', detail: message };
  }
}

/** Scale factor for the display that owns the given bounds. */
export function displayScaleFactor(bounds: ScreenRect): number {
  return displayForBounds(bounds).scaleFactor || 1;
}
