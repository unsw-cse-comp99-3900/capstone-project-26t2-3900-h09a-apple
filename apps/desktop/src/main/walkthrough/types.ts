export type AnchorMode = 'element' | 'screenshot' | 'none';

export type WalkthroughStatus = 'idle' | 'playing' | 'finished';

export type VoiceCommand = 'next' | 'continue' | 'previous' | 'repeat' | 'stop';

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WalkthroughStep {
  step_number: number;
  instruction: string;
  target_label?: string | null;
  css_selector?: string | null;
  xpath?: string | null;
  expected_url?: string | null;
  expected_action?: 'click' | 'input' | 'navigation' | string | null;
  screenshot_url?: string | null;
  screenshot_highlight?: ScreenRect | null;
  anchor_mode?: AnchorMode | null;
  raw_coordinates?: { x: number; y: number } | null;
  attrs?: Record<string, unknown> | null;
  field_kind?: string | null;
}

export interface CoachingSections {
  identity: string;
  context: string;
  steps: string;
  output: string;
  guardrails: string;
}

export interface WalkthroughPayload {
  sop_id: string;
  title?: string;
  steps: WalkthroughStep[];
  coaching_sections?: CoachingSections | null;
}

export interface FrictionEvent {
  step_number: number;
  event_type: 'selector_miss' | 'wrong_page' | 'hesitation' | 'backtrack';
  occurred_at: string;
}

export interface StepTiming {
  step_number: number;
  duration_ms: number;
}

export type ResolveSource =
  | 'accessibility_api'
  | 'ocr'
  | 'vision_model'
  | 'recorded_approximate'
  | 'recorded_hint'
  | 'unidentified';

export interface ResolvedTarget {
  rect: ScreenRect | null;
  source: ResolveSource;
  fallbackNote: string | null;
  /** One-line Clicky coach sentence from vision (optional). */
  coachingHint?: string | null;
  /** Live-resolved control name (vision label / needle), not recorded metadata. */
  liveTargetLabel?: string | null;
}

/** Spotlight styling: live match vs honest approximate recorded position. */
export type HighlightStyle = 'live' | 'approximate';

export interface WalkthroughStepContext {
  app: string | null;
  windowTitle: string | null;
  targetLabel: string | null;
  recordedUrl: string | null;
}

export interface WalkthroughUiState {
  status: WalkthroughStatus;
  sopId: string | null;
  stepIndex: number;
  stepCount: number;
  instruction: string;
  eyebrow: string;
  screenshotUrl: string | null;
  fallbackNote: string | null;
  highlight: ScreenRect | null;
  /** How the spotlight should look; null when no highlight. */
  highlightStyle: HighlightStyle | null;
  /**
   * Spotlight window DIP size (same as coverDisplay bounds). Renderer compares
   * to innerWidth to correct Windows transparent-window DPI skew.
   */
  displaySize?: { width: number; height: number } | null;
  previousDisabled: boolean;
  isLastStep: boolean;
  /** True while Previous/Next is waiting on openExternal / resolve (navInFlight). */
  navBusy: boolean;
  /** Persistent platform capability note (e.g. Mac OCR+vision-only). */
  platformBanner: string | null;
  /** Recorded step context only; null fields mean unknown (not invented). */
  stepContext: WalkthroughStepContext | null;
  /** Navigable URL for manual Open page (after dynamic-URL resolution). */
  openPageUrl: string | null;
  exportAvailable: boolean;
  exportPreview: string | null;
  error: string | null;
}
