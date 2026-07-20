import { screen } from 'electron';
import type { ScreenRect } from './types';
import { getForegroundWindowBounds } from './foreground-window';

/**
 * Pick the single display to host the overlay (H09AAPPLE-78: one active display).
 * Prefer the monitor under the cursor; else the monitor holding the foreground window.
 */
export async function getActiveDisplayBounds(): Promise<ScreenRect> {
  const cursorPoint = screen.getCursorScreenPoint();
  const underCursor = screen.getDisplayNearestPoint(cursorPoint);
  if (underCursor?.bounds) {
    return { ...underCursor.bounds };
  }

  const foreground = await getForegroundWindowBounds();
  if (foreground?.bounds) {
    const cx = foreground.bounds.x + foreground.bounds.width / 2;
    const cy = foreground.bounds.y + foreground.bounds.height / 2;
    return { ...screen.getDisplayNearestPoint({ x: cx, y: cy }).bounds };
  }

  return { ...screen.getPrimaryDisplay().bounds };
}

export function displayForBounds(bounds: ScreenRect) {
  return screen.getDisplayMatching({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  });
}
