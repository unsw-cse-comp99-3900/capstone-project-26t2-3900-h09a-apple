import type { AnchorMode, WalkthroughStep } from './types';

export function resolveAnchorMode(step: WalkthroughStep | null | undefined): AnchorMode {
  if (
    step?.anchor_mode === 'element' ||
    step?.anchor_mode === 'screenshot' ||
    step?.anchor_mode === 'none'
  ) {
    return step.anchor_mode;
  }

  const hasSelector =
    (typeof step?.css_selector === 'string' && step.css_selector.trim().length > 0) ||
    (typeof step?.xpath === 'string' && step.xpath.trim().length > 0);
  // screenshot_highlight alone is browser viewport space, not a live desktop
  // target. Still treat target_label / selectors / screen raw coords as element.
  const hasLiveHint = Boolean(step?.raw_coordinates) || Boolean(step?.target_label?.trim());

  if (hasSelector || hasLiveHint) {
    return 'element';
  }

  if (typeof step?.screenshot_url === 'string' && step.screenshot_url) {
    return 'screenshot';
  }

  return 'none';
}
