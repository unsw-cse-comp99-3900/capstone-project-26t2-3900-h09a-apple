import { needleForStep } from './step-navigation';
import type { ScreenRect, WalkthroughStep } from './types';

/**
 * Only skip vision when a11y is extremely likely correct (~90%+).
 * Short/single-word needles and oversized "hits" (whole panes) must still
 * go through Clicky POINT / vision.
 */
export function canSkipVisionForExtremeA11y(
  step: WalkthroughStep,
  rect: ScreenRect,
  displayBounds: ScreenRect,
): boolean {
  const needle = needleForStep(step);
  if (!needle) {
    return false;
  }

  const words = needle.trim().split(/\s+/).filter(Boolean);
  const multiWord = words.length >= 2;
  // Single short labels ("Save", "OK") collide too often - never skip.
  if (!multiWord && needle.trim().length < 10) {
    return false;
  }
  if (multiWord && needle.trim().length < 8) {
    return false;
  }

  const displayArea = Math.max(1, displayBounds.width * displayBounds.height);
  const area = Math.max(0, rect.width) * Math.max(0, rect.height);
  if (area < 400 || area > displayArea * 0.06) {
    return false;
  }
  if (rect.width > displayBounds.width * 0.35) {
    return false;
  }
  if (rect.height > displayBounds.height * 0.12) {
    return false;
  }

  // Context-only steps should not skip on a stray name match.
  const action = typeof step.expected_action === 'string' ? step.expected_action : null;
  if (action === 'navigation' || action === 'scroll' || action === 'window_change') {
    return false;
  }

  return true;
}
