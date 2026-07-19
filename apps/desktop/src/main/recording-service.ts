import activeWindow from 'active-win';
import { uIOhook } from 'uiohook-napi';
import {
  DesktopSessionStore,
  type CompletedLocalSession,
} from './desktop-session-store';

export type RecorderState = 'idle' | 'recording' | 'paused' | 'error';

interface ForegroundContext {
  foreground_app: string;
  window_title: string | null;
  active_win_error?: string;
}

export class RecordingService {
  private state: RecorderState = 'idle';
  private eventCount = 0;
  private hooksRegistered = false;

  constructor(private readonly sessionStore: DesktopSessionStore) {}

  start(): void {
    if (this.state === 'recording') return;

    if (this.state === 'paused') {
      this.resume();
      return;
    }

    this.registerHooks();

    try {
      this.eventCount = 0;
      const sessionId = this.sessionStore.startSession();
      this.state = 'recording';
      uIOhook.start();
      console.log(`[desktop] Global recording started (session ${sessionId})`);
    } catch (error) {
      this.state = 'error';

      if (this.sessionStore.hasActiveSession()) {
        try {
          this.sessionStore.completeSession('failed');
        } catch (finalizeError) {
          console.error('[desktop] Failed to finalize the failed session:', finalizeError);
        }
      }

      console.error('[desktop] Failed to start global recording:', error);
      throw error;
    }
  }

  pause(): void {
    if (this.state !== 'recording') return;

    this.state = 'paused';
  }

  resume(): void {
    if (this.state !== 'paused') return;

    this.state = 'recording';
  }

  stop(): CompletedLocalSession | null {
    if (this.state === 'idle') return null;
    let completedSession: CompletedLocalSession | null = null;

    try {
      uIOhook.stop();
    } finally {
      try {
        if (this.sessionStore.hasActiveSession()) {
          completedSession = this.sessionStore.completeSession();

          console.log(
            `[desktop] Session saved: ${completedSession.artifactPath}`,
          );
        }

        this.state = 'idle';
        console.log(
          `[desktop] Global recording stopped (${this.eventCount} events)`,
        );
      } catch (error) {
        this.state = 'error';
        console.error(
          '[desktop] Failed to finalize the recording session:',
          error,
        );
      }
    }

    return completedSession;
  }

  getState(): RecorderState {
    return this.state;
  }

  getEventCount(): number {
    return this.eventCount;
  }

  private registerHooks(): void {
    if (this.hooksRegistered) return;

    uIOhook.on('click', (event) => {
      if (this.state !== 'recording') return;

      const foregroundContext = this.getForegroundContext();

      if (this.isRecorderWindow(foregroundContext)) return;

      this.recordEvent({
        event_type: 'CLICK',
        timestamp: Date.now(),
        x: event.x,
        y: event.y,
        button: event.button,
        platform: process.platform,
        ...foregroundContext,
      });
    });

    uIOhook.on('keydown', (event) => {
      if (this.state !== 'recording') return;

      const foregroundContext = this.getForegroundContext();

      if (this.isRecorderWindow(foregroundContext)) return;

      this.recordEvent({
        event_type: 'KEYDOWN',
        timestamp: Date.now(),
        keycode: event.keycode,
        platform: process.platform,
        ...foregroundContext,
      });
    });

    this.hooksRegistered = true;
  }

  private recordEvent(event: Record<string, unknown>): void {
    try {
      const isClick = event.event_type === 'CLICK';
      const attrs: Record<string, unknown> = {
        platform: event.platform,
        foreground_app: event.foreground_app,
        window_title: event.window_title,
      };

      if (isClick) {
        attrs.button = event.button;
      } else {
        attrs.keycode = event.keycode;
      }

      if (event.active_win_error) {
        attrs.active_win_error = event.active_win_error;
      }

      this.sessionStore.saveCapturedEvent({
        category: isClick ? 'mouse' : 'keyboard',
        type: isClick ? 'click' : 'input',
        timestamp_ms: event.timestamp as number,
        raw_x: isClick ? (event.x as number) : null,
        raw_y: isClick ? (event.y as number) : null,
        attrs,
      });

      this.eventCount += 1;
      console.log(JSON.stringify(event));
    } catch (error) {
      this.state = 'error';
      console.error('[desktop] Failed to persist captured event:', error);
    }
  }

  private getForegroundContext(): ForegroundContext {
    try {
      const window = activeWindow.sync({
        accessibilityPermission: true,
        screenRecordingPermission: process.platform === 'darwin',
      });

      if (!window) {
        return {
          foreground_app: 'unknown',
          window_title: null,
        };
      }

      return {
        foreground_app: window.owner.name || window.owner.path || 'unknown',
        window_title: window.title || null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[desktop] Failed to read the foreground window:', message);

      return {
        foreground_app: 'unknown',
        window_title: null,
        active_win_error: message,
      };
    }
  }

  private isRecorderWindow(context: ForegroundContext): boolean {
    const appName = context.foreground_app.toLowerCase();
    const windowTitle = context.window_title?.toLowerCase() ?? '';

    return (
      windowTitle.includes('worktrace desktop') &&
      (appName === 'electron' || appName.includes('worktrace'))
    );
  }
}
