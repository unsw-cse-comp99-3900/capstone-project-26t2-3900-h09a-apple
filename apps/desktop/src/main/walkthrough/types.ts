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

export interface ResolvedTarget {
  rect: ScreenRect | null;
  source: 'accessibility_api' | 'ocr' | 'vision_model' | 'recorded_hint' | 'unidentified';
  fallbackNote: string | null;
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
  previousDisabled: boolean;
  isLastStep: boolean;
  exportAvailable: boolean;
  exportPreview: string | null;
  error: string | null;
}
