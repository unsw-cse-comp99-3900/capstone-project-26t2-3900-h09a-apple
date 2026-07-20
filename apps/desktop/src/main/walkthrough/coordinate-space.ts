import type { ScreenRect, WalkthroughStep } from './types';

export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Browser-recorded coords (css/xpath target_rect, page clicks) are not screen
 * space. Only trust raw_coordinates when the step was captured as desktop
 * screen input.
 */
export function hasScreenSpaceCoordinates(step: WalkthroughStep): boolean {
  if (!step.raw_coordinates) {
    return false;
  }

  const attrs = step.attrs;
  if (!attrs || typeof attrs !== 'object') {
    return false;
  }

  if (attrs.coordinate_space === 'screen' || attrs.layer === 'desktop') {
    return true;
  }

  // Desktop recorder writes these; browser extension steps do not.
  if (typeof attrs.foreground_app === 'string' || typeof attrs.platform === 'string') {
    return true;
  }

  return false;
}

/**
 * Map a viewport/CSS (or image-pixel) rect into screen space.
 *
 * `contentBounds` must be the on-screen rectangle of the same surface the
 * viewport coords were measured against (browser content area, or a full
 * display capture). Using primary `display.bounds` for a browser-recorded
 * `screenshot_highlight` is incorrect unless that browser filled the display.
 */
export function mapViewportRectToScreen(
  viewportRect: ViewportRect,
  contentBounds: ScreenRect,
  viewportWidth: number,
  viewportHeight: number,
): ScreenRect | null {
  if (
    !(viewportWidth > 0) ||
    !(viewportHeight > 0) ||
    !(viewportRect.width > 0) ||
    !(viewportRect.height > 0) ||
    !(contentBounds.width > 0) ||
    !(contentBounds.height > 0)
  ) {
    return null;
  }

  const scaleX = contentBounds.width / viewportWidth;
  const scaleY = contentBounds.height / viewportHeight;

  return {
    x: contentBounds.x + viewportRect.x * scaleX,
    y: contentBounds.y + viewportRect.y * scaleY,
    width: viewportRect.width * scaleX,
    height: viewportRect.height * scaleY,
  };
}

/**
 * Naive misuse: treat viewport pixels as if they were already screen pixels.
 * Kept for tests documenting the H09AAPPLE-78 coordinate trap.
 */
export function misuseViewportAsScreen(viewportRect: ViewportRect): ScreenRect {
  return {
    x: viewportRect.x,
    y: viewportRect.y,
    width: viewportRect.width,
    height: viewportRect.height,
  };
}
