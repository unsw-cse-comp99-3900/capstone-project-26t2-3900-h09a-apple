import type { WalkthroughStep } from './types';

export interface ApiWalkthroughStep {
  step_number?: number;
  instruction?: string;
  target_label?: string | null;
  css_selector?: string | null;
  xpath?: string | null;
  expected_url?: string | null;
  expected_action?: string | null;
  screenshot_url?: string | null;
  screenshot_highlight?: { x: number; y: number; width: number; height: number } | null;
  anchor_mode?: string | null;
  attrs?: Record<string, unknown> | null;
}

export function mapWalkthroughStep(step: ApiWalkthroughStep, index: number): WalkthroughStep {
  const attrs = step.attrs && typeof step.attrs === 'object' ? step.attrs : null;
  const coords = attrs?.raw_coordinates as { x?: number; y?: number } | undefined;

  return {
    step_number: step.step_number ?? index + 1,
    instruction: step.instruction ?? `Step ${index + 1}`,
    target_label: step.target_label ?? null,
    css_selector: step.css_selector ?? null,
    xpath: step.xpath ?? null,
    expected_url: step.expected_url ?? null,
    expected_action: step.expected_action ?? 'click',
    screenshot_url: step.screenshot_url ?? null,
    screenshot_highlight: step.screenshot_highlight ?? null,
    anchor_mode:
      step.anchor_mode === 'element' ||
      step.anchor_mode === 'screenshot' ||
      step.anchor_mode === 'none'
        ? step.anchor_mode
        : null,
    raw_coordinates:
      coords && Number.isFinite(coords.x) && Number.isFinite(coords.y)
        ? { x: Number(coords.x), y: Number(coords.y) }
        : null,
    attrs,
    field_kind: typeof attrs?.field_kind === 'string' ? attrs.field_kind : null,
  };
}
