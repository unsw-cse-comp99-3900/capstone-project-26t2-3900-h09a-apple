interface WalkthroughStepContext {
  app: string | null;
  windowTitle: string | null;
  targetLabel: string | null;
  recordedUrl: string | null;
}

interface WalkthroughUiState {
  status: 'idle' | 'playing' | 'finished';
  sopId: string | null;
  stepIndex: number;
  stepCount: number;
  instruction: string;
  eyebrow: string;
  screenshotUrl: string | null;
  fallbackNote: string | null;
  highlight: { x: number; y: number; width: number; height: number } | null;
  highlightStyle: 'live' | 'approximate' | null;
  displaySize?: { width: number; height: number } | null;
  previousDisabled: boolean;
  isLastStep: boolean;
  navBusy: boolean;
  platformBanner: string | null;
  stepContext: WalkthroughStepContext | null;
  openPageUrl: string | null;
  exportAvailable: boolean;
  exportPreview: string | null;
  error: string | null;
}

interface WalkthroughAPI {
  onState: (handler: (state: WalkthroughUiState) => void) => () => void;
  onCaptureCloak: (handler: (cloaked: boolean) => void) => () => void;
  getState: () => Promise<WalkthroughUiState>;
  notifyReady: () => void;
  previous: () => Promise<WalkthroughUiState>;
  next: () => Promise<WalkthroughUiState>;
  finish: () => Promise<WalkthroughUiState>;
  openPage: () => Promise<WalkthroughUiState>;
  recheck: () => Promise<WalkthroughUiState>;
  dismiss: () => Promise<void>;
  copyExport: () => Promise<{ ok: boolean; error?: string }>;
  saveExport: () => Promise<{ ok: boolean; path?: string; error?: string }>;
  setTooltipInteractive: (enabled: boolean) => void;
}

interface Window {
  walkthroughAPI: WalkthroughAPI;
}
