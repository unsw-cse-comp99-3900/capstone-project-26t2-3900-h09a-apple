import {
  loadSensitiveAppConfig,
  matchSensitiveForeground,
  recordWindowSkip,
} from '@h09a/desktop-storage';
import activeWindow from 'active-win';
import { uIOhook } from 'uiohook-napi';
import { DesktopSessionStore, type CompletedLocalSession } from './desktop-session-store';

export type RecorderState = 'idle' | 'recording' | 'paused' | 'error';

interface ForegroundContext {
  foreground_app: string;
  window_title: string | null;
  active_win_error?: string;
}

const SKIP_LOG_THROTTLE_MS = 2_000;

export class RecordingService {
  private state: RecorderState = 'idle';
  private eventCount = 0;
  private hooksRegistered = false;
  private sensitivePatterns: string[];
  private lastSkipLogKey: string | null = null;
  private lastSkipLogAtMs = 0;

  constructor(
    private readonly sessionStore: DesktopSessionStore,
    sensitiveAppsConfigPath?: string,
  ) {
    const loaded = loadSensitiveAppConfig(sensitiveAppsConfigPath);
    this.sensitivePatterns = loaded.patterns;
  }

  reloadSensitiveAppConfig(configPath?: string): void {
    const loaded = loadSensitiveAppConfig(configPath);
    this.sensitivePatterns = loaded.patterns;
  }

  getSensitiveAppPatterns(): string[] {
    return [...this.sensitivePatterns];
  }

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

          console.log(`[desktop] Session saved: ${completedSession.artifactPath}`);
        }

        this.state = 'idle';
        console.log(`[desktop] Global recording stopped (${this.eventCount} events)`);
      } catch (error) {
        this.state = 'error';
        console.error('[desktop] Failed to finalize the recording session:', error);
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

      if (this.shouldSuppressCapture(foregroundContext)) return;

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

      if (this.shouldSuppressCapture(foregroundContext)) return;

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

  private shouldSuppressCapture(context: ForegroundContext): boolean {
    if (this.isRecorderWindow(context)) {
      return true;
    }

    const matched = matchSensitiveForeground(
      context.foreground_app,
      context.window_title,
      this.sensitivePatterns,
    );

    if (!matched) {
      return false;
    }

    const sessionId = this.sessionStore.getActiveSessionId();
    if (sessionId) {
      recordWindowSkip(sessionId, matched);
    }

    this.logSkipThrottled(matched, context.foreground_app);
    return true;
  }

  private logSkipThrottled(pattern: string, foregroundApp: string): void {
    const now = Date.now();
    const key = `${pattern}|${foregroundApp}`;

    if (key === this.lastSkipLogKey && now - this.lastSkipLogAtMs < SKIP_LOG_THROTTLE_MS) {
      return;
    }

    this.lastSkipLogKey = key;
    this.lastSkipLogAtMs = now;
    console.warn(
      `[desktop] capture suppressed by sensitive-app skip list (pattern=${pattern}, app=${foregroundApp})`,
    );
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

      const saved = this.sessionStore.saveCapturedEvent({
        category: isClick ? 'mouse' : 'keyboard',
        type: isClick ? 'click' : 'keydown',
        timestamp_ms: event.timestamp as number,
        raw_x: isClick ? (event.x as number) : null,
        raw_y: isClick ? (event.y as number) : null,
        attrs,
      });

      if (!saved) {
        return;
      }

      this.eventCount += 1;
      console.log(
        `[desktop] captured ${isClick ? 'click' : 'keydown'} app=${String(event.foreground_app)}`,
      );
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
