import { resolveAnchorMode } from './anchor-mode';
import { hasScreenSpaceCoordinates } from './coordinate-space';
import type { ResolvedTarget, ScreenRect, WalkthroughStep } from './types';

export { hasScreenSpaceCoordinates, mapViewportRectToScreen } from './coordinate-space';

const FALLBACK_NOTE = 'No live target for this step. Showing captured preview.';

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
  const mode = resolveAnchorMode(step);

  if (mode === 'none' || mode === 'screenshot') {
    return { rect: null, source: 'unidentified', fallbackNote: FALLBACK_NOTE };
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
    fallbackNote: FALLBACK_NOTE,
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
