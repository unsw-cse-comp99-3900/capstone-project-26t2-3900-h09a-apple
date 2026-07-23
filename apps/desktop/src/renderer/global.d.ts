type RecorderState = 'idle' | 'recording' | 'paused' | 'error';

interface ReviewSessionData {
  workflowName: string;
  durationSeconds: number;
  eventCount: number;
}

interface RecordingStatus {
  ok: boolean;
  state: RecorderState;
  eventCount: number;
  sessionPath: string | null;
  error: string | null;
}

interface SubmissionResult {
  success: boolean;
  sessionId: string;
  jobId: string;
  sopId: string;
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
  logout(): Promise<LogoutResult>;

  // Recording
  getRecordingStatus(): Promise<RecordingStatus>;
  startRecording(workflowName?: string): Promise<RecordingStatus>;
  stopRecording(): Promise<RecordingStatus>;
  getReviewSession(): Promise<ReviewSessionData>;
  reviewSession(): Promise<RecordingStatus>;
  submitSession(): Promise<SubmissionResult>;

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
