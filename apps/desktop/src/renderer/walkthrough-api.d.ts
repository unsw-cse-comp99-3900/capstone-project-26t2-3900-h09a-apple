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
  previousDisabled: boolean;
  isLastStep: boolean;
  navBusy: boolean;
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
  dismiss: () => Promise<void>;
  copyExport: () => Promise<{ ok: boolean; error?: string }>;
  saveExport: () => Promise<{ ok: boolean; path?: string; error?: string }>;
  setTooltipInteractive: (enabled: boolean) => void;
}

interface Window {
  walkthroughAPI: WalkthroughAPI;
}
