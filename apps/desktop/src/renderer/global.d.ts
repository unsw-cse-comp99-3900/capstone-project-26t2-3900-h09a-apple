type RecorderState = 'idle' | 'recording' | 'paused' | 'error';

interface RecordingStatus {
  ok: boolean;
  state: RecorderState;
  eventCount: number;
  sessionPath: string | null;
  error: string | null;
}

interface AuthStatus {
  authenticated: boolean;
}

interface ConsentStatus {
  authenticated: boolean;
  accepted: boolean;
}

interface ConsentAcceptResult {
  accepted: boolean;
}


interface DesktopAPI {
  platform: NodeJS.Platform;
  versions: {
    electron: string;
    chrome: string;
    node: string;
  };

  // Authentication
  launchHandoff(): Promise<{ ok: boolean; error?: string }>;
  getAuthStatus(): Promise<AuthStatus>;
  getConsentStatus(): Promise<ConsentStatus>;
  acceptConsent(): Promise<ConsentAcceptResult>;

  // Recording
  getRecordingStatus(): Promise<RecordingStatus>;
  startRecording(): Promise<RecordingStatus>;
  stopRecording(): Promise<RecordingStatus>;
  reviewSession(): Promise<RecordingStatus>;

  // Window
  setWindowMode(mode: 'compact' | 'expanded'): Promise<'compact' | 'expanded'>;
  beginWindowDrag(): void;
  updateWindowDrag(): void;
  endWindowDrag(): void;
  closeWindow(): Promise<void>;
}

interface Window {
  desktopAPI: DesktopAPI;
}
