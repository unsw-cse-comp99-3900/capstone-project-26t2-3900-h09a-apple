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
  const hasDesktopHint =
    Boolean(step?.raw_coordinates) ||
    Boolean(step?.screenshot_highlight) ||
    Boolean(step?.target_label?.trim());

  if (hasSelector || hasDesktopHint) {
    return 'element';
  }

  if (typeof step?.screenshot_url === 'string' && step.screenshot_url) {
    return 'screenshot';
  }

  return 'none';
}
