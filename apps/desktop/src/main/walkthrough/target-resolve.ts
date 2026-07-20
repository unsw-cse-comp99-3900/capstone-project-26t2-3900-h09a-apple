import { resolveAnchorMode } from './anchor-mode';
import { hasScreenSpaceCoordinates } from './coordinate-space';
import { needleForStep } from './step-navigation';
import type { ResolvedTarget, ScreenRect, WalkthroughStep } from './types';

export { hasScreenSpaceCoordinates, mapViewportRectToScreen } from './coordinate-space';

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
 * On desktop there is no content-script injection, so still attempt a11y/OCR/vision
 * whenever the step has a UI needle or selector hint.
 */
export function shouldAttemptLiveResolve(step: WalkthroughStep): boolean {
  const mode = resolveAnchorMode(step);
  const hasNeedle = Boolean(needleForStep(step)) || hasSelectorHint(step);
  const hasDesktopCoords = hasScreenSpaceCoordinates(step);

  if (mode === 'element') {
    return true;
  }
  if (mode === 'screenshot') {
    // Desktop has no DOM injection; still attempt a11y/OCR/vision or recorded coords.
    return hasNeedle || hasDesktopCoords;
  }
  // anchor_mode=none: instruction-only on web, but desktop may still have screen coords.
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

export type PlaybackResolveOptions = {
  resolveAccessibility?: (step: WalkthroughStep) => Promise<ScreenRect | null>;
  resolveOcr?: (step: WalkthroughStep) => Promise<ScreenRect | null>;
  resolveVisionGrid?: (step: WalkthroughStep) => Promise<ScreenRect | null>;
  /** When false, miss notes explicitly say a11y is unavailable (Mac OCR+vision-only). */
  a11yAvailable?: boolean;
  a11yDegradeNote?: string | null;
};

/**
 * Playback re-identification per H09AAPPLE-78 / spike §5.2:
 * Accessibility + OCR concurrently, then vision as conditional fallback.
 * Recorded browser viewport highlights are never treated as screen rects.
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
    return { rect: null, source: 'unidentified', fallbackNote: missNote };
  }

  const accessibilityPromise = options?.resolveAccessibility
    ? options.resolveAccessibility(step)
    : Promise.resolve(null);
  const ocrPromise = options?.resolveOcr ? options.resolveOcr(step) : Promise.resolve(null);

  const [accessibilityRect, ocrRect] = await Promise.all([accessibilityPromise, ocrPromise]);

  if (accessibilityRect) {
    return {
      rect: clampHintRect(accessibilityRect, displayBounds),
      source: 'accessibility_api',
      fallbackNote: null,
    };
  }

  if (ocrRect) {
    return {
      rect: clampHintRect(ocrRect, displayBounds),
      source: 'ocr',
      fallbackNote: null,
    };
  }

  if (options?.resolveVisionGrid) {
    const rect = await options.resolveVisionGrid(step);
    if (rect) {
      return {
        rect: clampHintRect(rect, displayBounds),
        source: 'vision_model',
        fallbackNote: null,
      };
    }
  }

  if (hasScreenSpaceCoordinates(step) && step.raw_coordinates) {
    return {
      rect: clampHintRect(
        {
          x: step.raw_coordinates.x - 40,
          y: step.raw_coordinates.y - 20,
          width: 160,
          height: 80,
        },
        displayBounds,
      ),
      source: 'recorded_hint',
      fallbackNote: null,
    };
  }

  // screenshot_highlight stays unused here: it is viewport/CSS space from the
  // extension. Without the browser content bounds on screen, mapping it onto
  // display.bounds invents a wrong spotlight (the mid-page "fake hole" bug).

  return {
    rect: null,
    source: 'unidentified',
    fallbackNote: missNote,
  };
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
