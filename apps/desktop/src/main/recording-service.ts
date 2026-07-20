import {
  loadSensitiveAppConfig,
  matchSensitiveForeground,
  recordWindowSkip,
} from '@h09a/desktop-storage';
import activeWindow from 'active-win';
import { clipboard, screen } from 'electron';
import { uIOhook, UiohookKey } from 'uiohook-napi';
import { DesktopSessionStore, type CompletedLocalSession } from './desktop-session-store';
import { captureDisplayRegionPng } from './walkthrough/screen-capture';
import type { ScreenRect } from './walkthrough/types';

export type RecorderState = 'idle' | 'recording' | 'paused' | 'error';

interface ForegroundContext {
  foreground_app: string;
  window_title: string | null;
  url: string | null;
  bounds: ScreenRect | null;
  active_win_error?: string;
}

interface TypingBuffer {
  chars: string;
  startedAtMs: number;
  lastAtMs: number;
  target_label: string | null;
  url: string | null;
  foreground_app: string;
  window_title: string | null;
}

const SKIP_LOG_THROTTLE_MS = 2_000;
const TYPING_IDLE_FLUSH_MS = 900;
const MAX_INPUT_VALUE_CHARS = 10_000;

export class RecordingService {
  private state: RecorderState = 'idle';
  private eventCount = 0;
  private hooksRegistered = false;
  private sensitivePatterns: string[];
  private lastSkipLogKey: string | null = null;
  private lastSkipLogAtMs = 0;
  private typingBuffer: TypingBuffer | null = null;
  private typingFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingCaptureJobs = new Set<Promise<void>>();

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
      this.typingBuffer = null;
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

    this.flushTypingBuffer();
    this.state = 'paused';
  }

  resume(): void {
    if (this.state !== 'paused') return;

    this.state = 'recording';
  }

  async stop(): Promise<CompletedLocalSession | null> {
    if (this.state === 'idle') return null;
    let completedSession: CompletedLocalSession | null = null;

    try {
      this.flushTypingBuffer();
      uIOhook.stop();
    } finally {
      try {
        if (this.pendingCaptureJobs.size > 0) {
          await Promise.allSettled([...this.pendingCaptureJobs]);
          this.pendingCaptureJobs.clear();
        }

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

      this.flushTypingBuffer();

      const clickTimestamp = Date.now();
      const screenshotId = this.sessionStore.allocateScreenshotId();
      const baseAttrs = this.buildCommonAttrs(foregroundContext, {
        button: event.button,
        coordinate_space: 'screen',
      });

      // Persist the click immediately so seq/order stays correct. Capture the
      // PNG asynchronously into the pre-allocated screenshot id; assembly drops
      // the reference if the file never lands before stop.
      this.persistEvent({
        category: 'mouse',
        type: 'click',
        timestamp_ms: clickTimestamp,
        raw_x: event.x,
        raw_y: event.y,
        target_label: this.labelFromContext(foregroundContext),
        url: foregroundContext.url,
        screenshot_id: screenshotId,
        attrs: baseAttrs,
      });

      if (!screenshotId) {
        return;
      }

      const job = this.captureClickWithScreenshot(
        event.x,
        event.y,
        foregroundContext,
        screenshotId,
      );
      this.pendingCaptureJobs.add(job);
      void job.finally(() => {
        this.pendingCaptureJobs.delete(job);
      });
    });

    uIOhook.on('keydown', (event) => {
      if (this.state !== 'recording') return;

      const foregroundContext = this.getForegroundContext();

      if (this.shouldSuppressCapture(foregroundContext)) return;

      const keycode = event.keycode;
      // uiohook-napi typings omit keychar; runtime still provides a code point on many platforms.
      const keycharRaw = (event as { keychar?: unknown }).keychar;
      const keychar = typeof keycharRaw === 'number' ? keycharRaw : 0;
      const ctrlOrMeta = Boolean(event.ctrlKey || event.metaKey);

      this.persistEvent({
        category: 'keyboard',
        type: 'keydown',
        timestamp_ms: Date.now(),
        raw_x: null,
        raw_y: null,
        target_label: this.labelFromContext(foregroundContext),
        url: foregroundContext.url,
        attrs: this.buildCommonAttrs(foregroundContext, {
          keycode,
          keychar: keychar || null,
          altKey: Boolean(event.altKey),
          ctrlKey: Boolean(event.ctrlKey),
          metaKey: Boolean(event.metaKey),
          shiftKey: Boolean(event.shiftKey),
        }),
      });

      if (ctrlOrMeta && !event.altKey && keycode === UiohookKey.C) {
        this.persistClipboardEvent('clipboard_copy', foregroundContext);
        this.flushTypingBuffer();
        return;
      }

      if (ctrlOrMeta && !event.altKey && keycode === UiohookKey.V) {
        this.persistClipboardEvent('clipboard_paste', foregroundContext);
        this.flushTypingBuffer();
        return;
      }

      if (ctrlOrMeta || event.altKey) {
        this.flushTypingBuffer();
        return;
      }

      if (keycode === UiohookKey.Backspace) {
        if (this.typingBuffer && this.typingBuffer.chars.length > 0) {
          this.typingBuffer.chars = this.typingBuffer.chars.slice(0, -1);
          this.typingBuffer.lastAtMs = Date.now();
          this.scheduleTypingFlush();
        }
        return;
      }

      if (
        keycode === UiohookKey.Enter ||
        keycode === UiohookKey.Tab ||
        keycode === UiohookKey.Escape
      ) {
        this.flushTypingBuffer();
        return;
      }

      const printable = this.printableFromKeychar(keychar);
      if (printable) {
        this.appendTyping(printable, foregroundContext);
      }
    });

    this.hooksRegistered = true;
  }

  private async captureClickWithScreenshot(
    x: number,
    y: number,
    context: ForegroundContext,
    screenshotId: string,
  ): Promise<void> {
    try {
      const display = screen.getDisplayNearestPoint({ x, y });
      const crop = context.bounds
        ? {
            x: context.bounds.x,
            y: context.bounds.y,
            width: context.bounds.width,
            height: context.bounds.height,
          }
        : null;
      const captured = await captureDisplayRegionPng(display.bounds, crop);
      if (!captured) {
        return;
      }
      this.sessionStore.saveScreenshotPng(Buffer.from(captured.base64, 'base64'), {
        id: screenshotId,
        width: captured.width,
        height: captured.height,
      });
    } catch (error) {
      console.warn('[desktop] click screenshot capture failed:', error);
    }
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

  private persistEvent(event: {
    category: string;
    type: string;
    timestamp_ms: number;
    raw_x: number | null;
    raw_y: number | null;
    value?: string | null;
    target_label?: string | null;
    url?: string | null;
    screenshot_id?: string | null;
    attrs: Record<string, unknown>;
  }): boolean {
    try {
      const saved = this.sessionStore.saveCapturedEvent(event);
      if (!saved) {
        return false;
      }
      this.eventCount += 1;
      console.log(
        `[desktop] captured ${event.type} app=${String(event.attrs.foreground_app ?? '')}`,
      );
      return true;
    } catch (error) {
      this.state = 'error';
      console.error('[desktop] Failed to persist captured event:', error);
      return false;
    }
  }

  private persistClipboardEvent(
    type: 'clipboard_copy' | 'clipboard_paste',
    context: ForegroundContext,
  ): void {
    let text = '';
    try {
      text = clipboard.readText() || '';
    } catch (error) {
      console.warn('[desktop] clipboard read failed:', error);
    }

    this.persistEvent({
      category: 'clipboard',
      type,
      timestamp_ms: Date.now(),
      raw_x: null,
      raw_y: null,
      value: text.slice(0, MAX_INPUT_VALUE_CHARS) || null,
      target_label: this.labelFromContext(context),
      url: context.url,
      attrs: this.buildCommonAttrs(context, {
        clipboard_length: text.length,
      }),
    });
  }

  private appendTyping(char: string, context: ForegroundContext): void {
    const now = Date.now();
    if (!this.typingBuffer) {
      this.typingBuffer = {
        chars: char,
        startedAtMs: now,
        lastAtMs: now,
        target_label: this.labelFromContext(context),
        url: context.url,
        foreground_app: context.foreground_app,
        window_title: context.window_title,
      };
    } else {
      this.typingBuffer.chars = `${this.typingBuffer.chars}${char}`.slice(0, MAX_INPUT_VALUE_CHARS);
      this.typingBuffer.lastAtMs = now;
    }
    this.scheduleTypingFlush();
  }

  private scheduleTypingFlush(): void {
    if (this.typingFlushTimer) {
      clearTimeout(this.typingFlushTimer);
    }
    this.typingFlushTimer = setTimeout(() => {
      this.flushTypingBuffer();
    }, TYPING_IDLE_FLUSH_MS);
  }

  private flushTypingBuffer(): void {
    if (this.typingFlushTimer) {
      clearTimeout(this.typingFlushTimer);
      this.typingFlushTimer = null;
    }

    const buffer = this.typingBuffer;
    this.typingBuffer = null;
    if (!buffer || !buffer.chars) {
      return;
    }

    this.persistEvent({
      category: 'keyboard',
      type: 'input',
      timestamp_ms: buffer.lastAtMs,
      raw_x: null,
      raw_y: null,
      value: buffer.chars,
      target_label: buffer.target_label,
      url: buffer.url,
      attrs: {
        layer: 'desktop',
        coordinate_space: 'screen',
        foreground_app: buffer.foreground_app,
        window_title: buffer.window_title,
        platform: process.platform,
        typing_started_at_ms: buffer.startedAtMs,
      },
    });
  }

  private printableFromKeychar(keychar: number): string | null {
    if (!keychar || keychar < 32) {
      return null;
    }
    // uiohook may report BMP code units; skip control/delete.
    if (keychar === 127) {
      return null;
    }
    try {
      return String.fromCodePoint(keychar);
    } catch {
      return null;
    }
  }

  private labelFromContext(context: ForegroundContext): string | null {
    const title = context.window_title?.trim();
    if (title) {
      return title;
    }
    const app = context.foreground_app?.trim();
    return app || null;
  }

  private buildCommonAttrs(
    context: ForegroundContext,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    const attrs: Record<string, unknown> = {
      platform: process.platform,
      layer: 'desktop',
      coordinate_space: 'screen',
      foreground_app: context.foreground_app,
      window_title: context.window_title,
      ...extra,
    };

    if (context.url) {
      attrs.page_url = context.url;
    }

    if (context.bounds) {
      attrs.window_bounds = context.bounds;
    }

    if (context.active_win_error) {
      attrs.active_win_error = context.active_win_error;
    }

    return attrs;
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
          url: null,
          bounds: null,
        };
      }

      const bounds =
        window.bounds &&
        Number.isFinite(window.bounds.x) &&
        Number.isFinite(window.bounds.y) &&
        Number.isFinite(window.bounds.width) &&
        Number.isFinite(window.bounds.height)
          ? {
              x: window.bounds.x,
              y: window.bounds.y,
              width: window.bounds.width,
              height: window.bounds.height,
            }
          : null;

      const url =
        typeof (window as { url?: unknown }).url === 'string' &&
        (window as { url: string }).url.trim()
          ? (window as { url: string }).url.trim()
          : null;

      return {
        foreground_app: window.owner.name || window.owner.path || 'unknown',
        window_title: window.title || null,
        url,
        bounds,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[desktop] Failed to read the foreground window:', message);

      return {
        foreground_app: 'unknown',
        window_title: null,
        url: null,
        bounds: null,
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
