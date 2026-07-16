import activeWindow from 'active-win';
import { uIOhook } from 'uiohook-napi';

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

  start(): void {
    if (this.state === 'recording') return;

    if (this.state === 'paused') {
      this.resume();
      return;
    }

    this.registerHooks();

    try {
      this.eventCount = 0;
      this.state = 'recording';
      uIOhook.start();
      console.log('[desktop] Global recording started');
    } catch (error) {
      this.state = 'error';
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

  stop(): void {
    if (this.state === 'idle') return;

    try {
      uIOhook.stop();
    } finally {
      this.state = 'idle';
      console.log(`[desktop] Global recording stopped (${this.eventCount} events)`);
    }
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
    this.eventCount += 1;
    console.log(JSON.stringify(event));
  }

  private getForegroundContext(): ForegroundContext {
    try {
      const window = activeWindow.sync({
        accessibilityPermission: true,
        screenRecordingPermission: false,
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
}
