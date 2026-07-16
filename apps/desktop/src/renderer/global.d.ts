type RecorderState = 'idle' | 'recording' | 'paused' | 'error';

interface RecordingStatus {
  ok: boolean;
  state: RecorderState;
  eventCount: number;
  sessionPath: string | null;
  error: string | null;
}

interface DesktopAPI {
  platform: NodeJS.Platform;
  versions: {
    electron: string;
    chrome: string;
    node: string;
  };
  getRecordingStatus(): Promise<RecordingStatus>;
  startRecording(): Promise<RecordingStatus>;
  stopRecording(): Promise<RecordingStatus>;
  reviewSession(): Promise<RecordingStatus>;
  setWindowMode(mode: 'compact' | 'expanded'): Promise<'compact' | 'expanded'>;
  beginWindowDrag(): void;
  updateWindowDrag(): void;
  endWindowDrag(): void;
  closeWindow(): Promise<void>;
}

interface Window {
  desktopAPI: DesktopAPI;
}
