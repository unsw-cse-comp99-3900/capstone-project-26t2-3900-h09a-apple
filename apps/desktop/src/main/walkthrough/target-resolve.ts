import {
  isAppFocusStep,
  isPlausibleTaskbarHit,
  isTypingStep,
  targetAppNameFromStep,
  taskbarIconHintRect,
  tightenTaskbarHighlight,
  tightenVisionHighlight,
} from './app-focus';
import { resolveAnchorMode } from './anchor-mode';
import { hasScreenSpaceCoordinates } from './coordinate-space';
import { canSkipVisionForExtremeA11y } from './resolve-confidence';
import { needleForStep } from './step-navigation';
import type { ResolvedTarget, ScreenRect, WalkthroughStep } from './types';

export { hasScreenSpaceCoordinates, mapViewportRectToScreen } from './coordinate-space';
export { canSkipVisionForExtremeA11y } from './resolve-confidence';
export {
  isAppFocusStep,
  isTypingStep,
  targetAppNameFromStep,
  taskbarIconHintRect,
  tightenVisionHighlight,
} from './app-focus';

export type MissFallbackOptions = {
  /** When false, append an explicit Windows-only a11y degrade note. */
  a11yAvailable?: boolean;
  a11yDegradeNote?: string | null;
};

export function buildMissFallbackNote(
  step: WalkthroughStep,
  options: MissFallbackOptions = {},
): string {
  const base =
    step.step_number > 1
      ? 'No live target on the current screen. If you advanced too far or opened the wrong page, ' +
        'press Previous to go back, bring the target app to the front, then re-check. ' +
        'Showing captured preview.'
      : 'No live target on the current screen. Bring the target app to the front (not the SOP page), ' +
        'then use Next to re-check. Showing captured preview.';

  if (options.a11yAvailable === false) {
    const degrade =
      options.a11yDegradeNote?.trim() ||
      'Accessibility (a11y) lookup is Windows-only; this session uses OCR + vision only.';
    return `${base} ${degrade}`;
  }

  return base;
}

function hasSelectorHint(step: WalkthroughStep): boolean {
  return (
    (typeof step.css_selector === 'string' && step.css_selector.trim().length > 0) ||
    (typeof step.xpath === 'string' && step.xpath.trim().length > 0)
  );
}

/**
 * Backend "screenshot" means no DOM selector, not "skip re-identification".
 * On desktop, Clicky-style vision must run even when recording left target_label
 * empty (common for Claude) — otherwise input/keydown steps skip LLM entirely.
 */
export function shouldAttemptLiveResolve(step: WalkthroughStep): boolean {
  const instruction = typeof step.instruction === 'string' ? step.instruction.trim() : '';
  // Any coaching text is enough to attempt a11y/OCR/vision on desktop.
  if (instruction.length > 0) {
    return true;
  }

  const mode = resolveAnchorMode(step);
  const hasNeedle = Boolean(needleForStep(step)) || hasSelectorHint(step);
  const hasDesktopCoords = hasScreenSpaceCoordinates(step);

  if (mode === 'element') {
    return true;
  }
  if (mode === 'screenshot') {
    return hasNeedle || hasDesktopCoords;
  }
  return hasNeedle || hasDesktopCoords;
}

export function clampHintRect(hint: ScreenRect, displayBounds: ScreenRect): ScreenRect {
  const width = Math.max(40, Math.min(hint.width || 160, displayBounds.width));
  const height = Math.max(40, Math.min(hint.height || 80, displayBounds.height));
  const x = Math.min(
    Math.max(displayBounds.x, hint.x),
    displayBounds.x + displayBounds.width - width,
  );
  const y = Math.min(
    Math.max(displayBounds.y, hint.y),
    displayBounds.y + displayBounds.height - height,
  );
  return { x, y, width, height };
}

export type VisionResolveResult = {
  rect: ScreenRect;
  coachingHint?: string | null;
  liveTargetLabel?: string | null;
};

export type PlaybackResolveOptions = {
  resolveAccessibility?: (step: WalkthroughStep) => Promise<ScreenRect | null>;
  resolveOcr?: (step: WalkthroughStep) => Promise<ScreenRect | null>;
  /** Windows taskbar icon lookup for app-focus / switch-app steps. */
  resolveTaskbarIcon?: (appName: string) => Promise<ScreenRect | null>;
  /**
   * Vision / Clicky POINT. May return a coaching sentence from the same model call.
   * Called unless a11y is extreme-confidence (see canSkipVisionForExtremeA11y).
   */
  resolveVisionGrid?: (step: WalkthroughStep) => Promise<ScreenRect | VisionResolveResult | null>;
  /** When false, miss notes explicitly say a11y is unavailable (Mac OCR+vision-only). */
  a11yAvailable?: boolean;
  a11yDegradeNote?: string | null;
};

function normalizeVisionResult(
  value: ScreenRect | VisionResolveResult | null,
): VisionResolveResult | null {
  if (!value) {
    return null;
  }
  if ('rect' in value) {
    return value;
  }
  return { rect: value, coachingHint: null };
}

/** Model sometimes labels / coaches "claude taskbar" on in-app navigate steps. */
function looksLikeTaskbarTarget(vision: VisionResolveResult): boolean {
  const blob = `${vision.coachingHint || ''} ${vision.liveTargetLabel || ''}`.toLowerCase();
  return /\btaskbar\b|\bdock\b/.test(blob);
}

/**
 * Playback re-identification (H09AAPPLE-78):
 * 1) a11y + OCR in parallel
 * 2) skip vision only on extreme-confidence a11y
 * 3) otherwise always try vision (Clicky POINT)
 * 4) fallbacks: OCR -> non-extreme a11y -> recorded_approximate -> unidentified
 */
export async function resolvePlaybackTarget(
  step: WalkthroughStep,
  displayBounds: ScreenRect,
  options?: PlaybackResolveOptions,
): Promise<ResolvedTarget> {
  const missNote = buildMissFallbackNote(step, {
    a11yAvailable: options?.a11yAvailable,
    a11yDegradeNote: options?.a11yDegradeNote,
  });

  if (!shouldAttemptLiveResolve(step)) {
    return { rect: null, source: 'unidentified', fallbackNote: missNote, coachingHint: null };
  }

  const strongNeedle = needleForStep(step) || null;
  const appFocus = isAppFocusStep(step);
  const typing = isTypingStep(step);
  const appName = targetAppNameFromStep(step);

  // App-focus: taskbar icon first (never sidebar / page chrome).
  if (appFocus && appName && options?.resolveTaskbarIcon) {
    const taskbarRect = await options.resolveTaskbarIcon(appName);
    if (taskbarRect) {
      return {
        rect: tightenTaskbarHighlight(clampHintRect(taskbarRect, displayBounds), displayBounds),
        source: 'accessibility_api',
        fallbackNote: null,
        coachingHint: `Click the ${appName} icon on the Windows taskbar at the bottom.`,
        liveTargetLabel: `${appName} (taskbar)`,
      };
    }
  }

  // a11y is cheap — await it first so extreme hits skip the LLM entirely.
  // Skip generic Name search for app-focus (would match window title chrome).
  const accessibilityRect =
    !appFocus && options?.resolveAccessibility ? await options.resolveAccessibility(step) : null;

  if (accessibilityRect && canSkipVisionForExtremeA11y(step, accessibilityRect, displayBounds)) {
    return {
      rect: clampHintRect(accessibilityRect, displayBounds),
      source: 'accessibility_api',
      fallbackNote: null,
      coachingHint: null,
      liveTargetLabel: strongNeedle,
    };
  }

  // OCR is useless for taskbar icons; skip it on app-focus to save time.
  const ocrPromise =
    !appFocus && options?.resolveOcr ? options.resolveOcr(step) : Promise.resolve(null);
  const visionPromise = options?.resolveVisionGrid
    ? options.resolveVisionGrid(step).then(normalizeVisionResult)
    : Promise.resolve(null);
  const [ocrRect, vision] = await Promise.all([ocrPromise, visionPromise]);

  // Exact on-screen labels ("Chat", "Create project"): OCR beats Clicky POINT.
  // Vision often drifts to nearby helper text (seen on Claude Chat step).
  if (ocrRect && strongNeedle && strongNeedle.trim().length >= 3) {
    return {
      rect: clampHintRect(ocrRect, displayBounds),
      source: 'ocr',
      fallbackNote: null,
      coachingHint: vision?.coachingHint?.trim() || null,
      liveTargetLabel: strongNeedle,
    };
  }

  if (vision) {
    let rect = clampHintRect(vision.rect, displayBounds);
    if (appFocus) {
      if (!isPlausibleTaskbarHit(rect, displayBounds)) {
        console.warn(
          '[walkthrough] vision hit rejected for app-focus (not on taskbar band); using taskbar hint',
        );
        rect = taskbarIconHintRect(displayBounds);
        return {
          rect,
          source: 'recorded_approximate',
          fallbackNote:
            `Click the ${appName || 'app'} icon on the bottom Windows taskbar. ` +
            'Live vision did not land on the taskbar; showing the taskbar band.',
          coachingHint: `Click the ${appName || 'app'} icon on the Windows taskbar.`,
          liveTargetLabel: appName ? `${appName} (taskbar)` : 'taskbar',
        };
      }
      rect = tightenTaskbarHighlight(rect, displayBounds);
      return {
        rect,
        source: 'vision_model',
        fallbackNote: null,
        coachingHint: vision.coachingHint?.trim() || null,
        liveTargetLabel:
          vision.liveTargetLabel?.trim() || (appName ? `${appName} (taskbar)` : strongNeedle),
      };
    }

    // Typing / navigate steps: model often invents the taskbar — reject and fall through.
    if (isPlausibleTaskbarHit(rect, displayBounds) || looksLikeTaskbarTarget(vision)) {
      console.warn(
        `[walkthrough] vision hit rejected (taskbar on ${typing ? 'typing' : 'non-app-focus'} step); trying other fallbacks`,
      );
    } else {
      return {
        rect: tightenVisionHighlight(rect, displayBounds),
        source: 'vision_model',
        fallbackNote: null,
        coachingHint: vision.coachingHint?.trim() || null,
        liveTargetLabel: vision.liveTargetLabel?.trim() || strongNeedle,
      };
    }
  }

  // Vision miss / unavailable: keep weaker live hits rather than giving up.
  if (ocrRect) {
    return {
      rect: clampHintRect(ocrRect, displayBounds),
      source: 'ocr',
      fallbackNote: null,
      coachingHint: null,
      liveTargetLabel: strongNeedle,
    };
  }

  if (accessibilityRect) {
    return {
      rect: clampHintRect(accessibilityRect, displayBounds),
      source: 'accessibility_api',
      fallbackNote: null,
      coachingHint: null,
      liveTargetLabel: strongNeedle,
    };
  }

  // App-focus miss: always point at the taskbar band — never a mid-page recorded click.
  if (appFocus) {
    const hint = taskbarIconHintRect(displayBounds);
    return {
      rect: hint,
      source: 'recorded_approximate',
      fallbackNote:
        `Click the ${appName || 'app'} icon on the bottom Windows taskbar to focus that app. ` +
        'Showing the taskbar area (not a mid-page guess).',
      coachingHint: `Click the ${appName || 'app'} icon on the Windows taskbar at the bottom.`,
      liveTargetLabel: appName ? `${appName} (taskbar)` : 'taskbar',
    };
  }

  // Typing / input: paint a field-sized approximate box so the user sees WHERE to type.
  if (typing) {
    const fieldApprox = typingFieldApproximateRect(step, displayBounds);
    if (fieldApprox) {
      return {
        rect: fieldApprox,
        source: 'recorded_approximate',
        fallbackNote:
          `${missNote} Showing the recorded text field area (dashed). ` +
          'Click the field, type, then press Next.',
        coachingHint: strongNeedle
          ? `Type in the "${strongNeedle}" field.`
          : 'Click the text field and type, then press Next.',
        liveTargetLabel: strongNeedle || 'text field',
      };
    }
  }

  // Live miss: paint an honest approximate hole from recorded screen coords
  // (dashed UI), not a silent "live lock" claim.
  if (hasScreenSpaceCoordinates(step) && step.raw_coordinates) {
    const cx = Number(step.raw_coordinates.x);
    const cy = Number(step.raw_coordinates.y);
    if (Number.isFinite(cx) && Number.isFinite(cy)) {
      const approx = clampHintRect(
        { x: cx - 40, y: cy - 20, width: 80, height: 40 },
        displayBounds,
      );
      return {
        rect: approx,
        source: 'recorded_approximate',
        fallbackNote:
          `${missNote} Showing Approximate (recorded) click position ` +
          '(dashed highlight; not a live match). Complete the action, then press Next ' +
          'or click near the dashed highlight.',
        coachingHint: null,
      };
    }
  }

  // screenshot_highlight stays unused here: it is viewport/CSS space from the
  // extension. Without the browser content bounds on screen, mapping it onto
  // display.bounds invents a wrong spotlight (the mid-page "fake hole" bug).

  return {
    rect: null,
    source: 'unidentified',
    fallbackNote: missNote,
    coachingHint: null,
  };
}

function typingFieldApproximateRect(
  step: WalkthroughStep,
  displayBounds: ScreenRect,
): ScreenRect | null {
  const fieldW = 280;
  const fieldH = 44;
  if (hasScreenSpaceCoordinates(step) && step.raw_coordinates) {
    const cx = Number(step.raw_coordinates.x);
    const cy = Number(step.raw_coordinates.y);
    if (Number.isFinite(cx) && Number.isFinite(cy)) {
      return clampHintRect(
        { x: cx - fieldW / 2, y: cy - fieldH / 2, width: fieldW, height: fieldH },
        displayBounds,
      );
    }
  }
  const attrs = step.attrs && typeof step.attrs === 'object' ? step.attrs : null;
  const raw = attrs?.window_bounds;
  if (raw && typeof raw === 'object') {
    const b = raw as Record<string, unknown>;
    const x = Number(b.x);
    const y = Number(b.y);
    const w = Number(b.width);
    const h = Number(b.height);
    if (Number.isFinite(x) && Number.isFinite(y) && w > 0 && h > 0) {
      // Modal fields usually sit in the upper-middle of the app window.
      return clampHintRect(
        {
          x: x + w * 0.5 - fieldW / 2,
          y: y + h * 0.38 - fieldH / 2,
          width: fieldW,
          height: fieldH,
        },
        displayBounds,
      );
    }
  }
  return null;
}

export function refineGridCell(
  full: ScreenRect,
  coarseCol: number,
  coarseRow: number,
  coarseCols: number,
  coarseRows: number,
  fineCol: number,
  fineRow: number,
  fineCols: number,
  fineRows: number,
): ScreenRect {
  const cellW = full.width / coarseCols;
  const cellH = full.height / coarseRows;
  const region: ScreenRect = {
    x: full.x + coarseCol * cellW,
    y: full.y + coarseRow * cellH,
    width: cellW,
    height: cellH,
  };
  const fineW = region.width / fineCols;
  const fineH = region.height / fineRows;
  return {
    x: region.x + fineCol * fineW,
    y: region.y + fineRow * fineH,
    width: fineW,
    height: fineH,
  };
}
