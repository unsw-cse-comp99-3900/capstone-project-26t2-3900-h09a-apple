import { resolveAnchorMode } from './anchor-mode';
import type { ResolvedTarget, ScreenRect, WalkthroughStep } from './types';

const FALLBACK_NOTE = 'No live target for this step. Showing captured preview.';

function clampHintRect(hint: ScreenRect, displayBounds: ScreenRect): ScreenRect {
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

function centerRect(displayBounds: ScreenRect): ScreenRect {
  const width = 160;
  const height = 80;
  return {
    x: displayBounds.x + displayBounds.width / 2 - width / 2,
    y: displayBounds.y + displayBounds.height / 2 - height / 2,
    width,
    height,
  };
}

export async function resolvePlaybackTarget(
  step: WalkthroughStep,
  displayBounds: ScreenRect,
  options?: {
    resolveAccessibility?: (step: WalkthroughStep) => Promise<ScreenRect | null>;
    resolveOcr?: (step: WalkthroughStep) => Promise<ScreenRect | null>;
    resolveVisionGrid?: (step: WalkthroughStep) => Promise<ScreenRect | null>;
  },
): Promise<ResolvedTarget> {
  const mode = resolveAnchorMode(step);

  if (mode === 'none' || mode === 'screenshot') {
    return { rect: null, source: 'unidentified', fallbackNote: FALLBACK_NOTE };
  }

  if (options?.resolveAccessibility) {
    const rect = await options.resolveAccessibility(step);
    if (rect) {
      return {
        rect: clampHintRect(rect, displayBounds),
        source: 'accessibility_api',
        fallbackNote: null,
      };
    }
  }

  if (options?.resolveOcr) {
    const rect = await options.resolveOcr(step);
    if (rect) {
      return { rect: clampHintRect(rect, displayBounds), source: 'ocr', fallbackNote: null };
    }
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

  if (step.screenshot_highlight) {
    return {
      rect: clampHintRect(step.screenshot_highlight, displayBounds),
      source: 'recorded_hint',
      fallbackNote: null,
    };
  }

  if (step.raw_coordinates) {
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

  return {
    rect: centerRect(displayBounds),
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
