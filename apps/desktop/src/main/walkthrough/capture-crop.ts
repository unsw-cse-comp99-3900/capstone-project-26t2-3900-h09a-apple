import type { ScreenRect, WalkthroughStep } from './types';
import { intersectRects } from './foreground-window';

/**
 * Overlay / IDE windows must not be used as the privacy crop target —
 * when the walkthrough panel steals focus, active-win reports Electron/Cursor.
 */
export function isUntrustedCaptureApp(appName: string | undefined): boolean {
  const name = (appName || '').trim().toLowerCase();
  if (!name) {
    return true;
  }
  return (
    name.includes('electron') ||
    name.includes('worktrace') ||
    name === 'cursor' ||
    name.includes('cursor.exe') ||
    name === 'code' ||
    name === 'visual studio code' ||
    name === 'windows terminal' ||
    name.includes('powershell')
  );
}

export type CaptureCropDecision = {
  /** null = full active display (Clicky-style). */
  crop: ScreenRect | null;
  /** Short reason for logs. */
  reason: string;
};

/**
 * Vision capture crop policy (Clicky-compatible):
 * 1) Trusted live foreground window
 * 2) Else full display — never stale recorded_window_bounds
 *
 * Recorded bounds were causing "highlight nowhere near the control": the model
 * pointed inside an old crop, then we mapped onto a window that had moved/resized.
 */
export function resolveCaptureCrop(
  displayBounds: ScreenRect,
  options: {
    liveAppName?: string | null;
    liveBounds?: ScreenRect | null;
    /** Accepted for API compat; intentionally unused for vision crops. */
    step?: WalkthroughStep | null;
    /**
     * Optional live window looked up by recorded app name (Claude, …)
     * while the overlay holds focus.
     */
    targetAppBounds?: ScreenRect | null;
    targetAppName?: string | null;
  },
): CaptureCropDecision {
  void options.step;
  const liveName = options.liveAppName ?? null;
  const liveBounds = options.liveBounds ?? null;

  if (liveBounds && liveName && !isUntrustedCaptureApp(liveName)) {
    const clipped = intersectRects(displayBounds, liveBounds);
    if (clipped) {
      return {
        crop: clipped,
        reason: `foreground=${liveName}`,
      };
    }
  }

  const targetBounds = options.targetAppBounds ?? null;
  const targetName = options.targetAppName ?? null;
  if (targetBounds && targetName && !isUntrustedCaptureApp(targetName)) {
    const clipped = intersectRects(displayBounds, targetBounds);
    if (clipped) {
      return {
        crop: clipped,
        reason: `target_app=${targetName}`,
      };
    }
  }

  return {
    crop: null,
    reason: liveName ? `full_display (Clicky); ignored live=${liveName}` : 'full_display (Clicky)',
  };
}
