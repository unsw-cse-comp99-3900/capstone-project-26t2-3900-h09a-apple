import {
  loadSensitiveAppConfig,
  matchSensitiveForeground,
  recordWindowSkip,
} from '@h09a/desktop-storage';
import activeWindow from 'active-win';
import { clipboard, screen } from 'electron';
import { uIOhook, UiohookKey } from 'uiohook-napi';
import { DesktopSessionStore, type CompletedLocalSession } from './desktop-session-store';
import {
  EventCollector,
  VisionDiffEventSource,
  type NormalizedDesktopEvent,
} from './recording/event-collector';
import { lookupUiaFocusedElement } from './recording/uia-focus';
import { lookupUiaLabelAtPoint } from './recording/uia-at-point';
import { ocrLabelAtPoint } from './recording/ocr-at-point';
import { pickControlLabel } from './recording/control-label';
import { captureDisplayRegionPng } from './walkthrough/screen-capture';
import type { ScreenRect } from './walkthrough/types';

/** Record-time OCR fallback for clicks UIA cannot name (set to '0' to disable). */
const RECORD_OCR_LABEL =
  process.env.RECORD_OCR_LABEL !== '0' && process.env.RECORD_OCR_LABEL !== 'false';

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
const WINDOW_POLL_MS = 400;
const FOCUS_POLL_MS = 1200;

/** Types accepted by API session ingest (pointer_sample stays local-only / dropped). */
const PERSISTABLE_TYPES = new Set([
  'click',
  'keydown',
  'input',
  'clipboard_copy',
  'clipboard_paste',
  'window_change',
  'scroll',
  'focus_change',
]);

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
  /** Serialize record-time OCR so a burst of unnamed clicks cannot thrash CPU. */
  private ocrLabelInFlight = false;
  private readonly collector: EventCollector;
  private readonly visionDiffSource = new VisionDiffEventSource();
  private windowPollTimer: ReturnType<typeof setInterval> | null = null;
  private focusPollTimer: ReturnType<typeof setInterval> | null = null;
  private lastWindowApp: string | null = null;
  private lastWindowTitle: string | null = null;

  constructor(
    private readonly sessionStore: DesktopSessionStore,
    sensitiveAppsConfigPath?: string,
  ) {
    const loaded = loadSensitiveAppConfig(sensitiveAppsConfigPath);
    this.sensitivePatterns = loaded.patterns;
    this.collector = new EventCollector((event) => {
      this.persistNormalized(event);
    });
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
      this.collector.reset();
      this.lastWindowApp = null;
      this.lastWindowTitle = null;
      const sessionId = this.sessionStore.startSession();
      this.state = 'recording';
      uIOhook.start();
      this.startContextPollers();
      // Vision diff source reserved; start() is a no-op until wired.
      this.visionDiffSource.start();
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
    this.collector.flush();
    this.stopContextPollers();
    this.state = 'paused';
  }

  resume(): void {
    if (this.state !== 'paused') return;

    this.state = 'recording';
    this.startContextPollers();
  }

  async stop(): Promise<CompletedLocalSession | null> {
    if (this.state === 'idle') return null;
    let completedSession: CompletedLocalSession | null = null;

    try {
      this.flushTypingBuffer();
      this.collector.flush();
      this.stopContextPollers();
      this.visionDiffSource.stop();
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
      const clickX = event.x;
      const clickY = event.y;
      const button = event.button;

      // Resolve control Name at the click point before persisting so seq stays
      // ordered and target_label is never the window/app chrome.
      const job = (async () => {
        const hit = await lookupUiaLabelAtPoint(clickX, clickY, {
          foregroundApp: foregroundContext.foreground_app,
          windowTitle: foregroundContext.window_title,
        });
        const baseAttrs = this.buildCommonAttrs(foregroundContext, {
          button,
          coordinate_space: 'screen',
          ...(hit?.controlType ? { uia_control_type: hit.controlType } : {}),
          ...(hit?.helpText ? { uia_help_text: hit.helpText } : {}),
          ...(hit?.labeledBy ? { uia_labeled_by: hit.labeledBy } : {}),
          ...(hit?.automationId ? { uia_automation_id: hit.automationId } : {}),
          ...(hit?.bounds ? { uia_bounds: hit.bounds } : {}),
          ...(hit?.alternateLabels?.length ? { uia_name_candidates: hit.alternateLabels } : {}),
        });

        let targetLabel = hit?.name ?? null;
        let identificationSource: 'accessibility_api' | 'ocr' | 'unidentified' = hit?.name
          ? 'accessibility_api'
          : 'unidentified';

        // UIA gave no Name (common for Claude / Electron): read the on-screen
        // text at the click so text controls stop landing as "unidentified".
        if (!targetLabel && RECORD_OCR_LABEL && !this.ocrLabelInFlight) {
          this.ocrLabelInFlight = true;
          try {
            const display = screen.getDisplayNearestPoint({ x: clickX, y: clickY });
            const ocrText = await ocrLabelAtPoint(clickX, clickY, display.bounds);
            const picked = pickControlLabel(
              ocrText,
              foregroundContext.foreground_app,
              foregroundContext.window_title,
            );
            if (picked) {
              targetLabel = picked;
              identificationSource = 'ocr';
              baseAttrs.ocr_label = picked;
            }
          } catch (error) {
            console.warn(
              '[desktop] click ocr fallback failed:',
              error instanceof Error ? error.message : String(error),
            );
          } finally {
            this.ocrLabelInFlight = false;
          }
        }

        this.collector.emitImmediate({
          category: 'mouse',
          type: 'click',
          timestamp_ms: clickTimestamp,
          raw_x: clickX,
          raw_y: clickY,
          target_label: targetLabel,
          url: foregroundContext.url,
          screenshot_id: screenshotId,
          is_identified: Boolean(targetLabel),
          identification_source: identificationSource,
          attrs: baseAttrs,
        });

        void this.sampleFocusChange(foregroundContext);

        if (!screenshotId) {
          return;
        }

        await this.captureClickWithScreenshot(clickX, clickY, foregroundContext, screenshotId);
      })();

      this.pendingCaptureJobs.add(job);
      void job.finally(() => {
        this.pendingCaptureJobs.delete(job);
      });
    });

    uIOhook.on('wheel', (event) => {
      if (this.state !== 'recording') return;

      const foregroundContext = this.getForegroundContext();
      if (this.shouldSuppressCapture(foregroundContext)) return;

      const rotation = Number((event as { rotation?: number }).rotation ?? 0) || 0;
      const amount = Number((event as { amount?: number }).amount ?? 1) || 1;
      const direction = Number((event as { direction?: number }).direction ?? 3);
      // uiohook: direction 3 ≈ vertical, 4 ≈ horizontal (libuiohook conventions).
      const deltaY = direction === 4 ? 0 : rotation * amount;
      const deltaX = direction === 4 ? rotation * amount : 0;

      this.collector.emitScroll({
        category: 'mouse',
        type: 'scroll',
        timestamp_ms: Date.now(),
        raw_x: Number(event.x) || null,
        raw_y: Number(event.y) || null,
        target_label: null,
        url: foregroundContext.url,
        is_identified: false,
        identification_source: 'unidentified',
        attrs: this.buildCommonAttrs(foregroundContext, {
          delta_x: deltaX,
          delta_y: deltaY,
          wheel_direction: direction,
        }),
      });
    });

    uIOhook.on('mousemove', (event) => {
      if (this.state !== 'recording') return;
      if (!this.collector.getConfig().enablePointerSample) return;

      const foregroundContext = this.getForegroundContext();
      if (this.shouldSuppressCapture(foregroundContext)) return;

      this.collector.emitPointerSample({
        category: 'mouse',
        type: 'pointer_sample',
        timestamp_ms: Date.now(),
        raw_x: Number(event.x) || null,
        raw_y: Number(event.y) || null,
        target_label: null,
        url: foregroundContext.url,
        is_identified: false,
        identification_source: 'unidentified',
        attrs: this.buildCommonAttrs(foregroundContext),
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

      this.collector.emitImmediate({
        category: 'keyboard',
        type: 'keydown',
        timestamp_ms: Date.now(),
        raw_x: null,
        raw_y: null,
        // Key events have no control-at-point; never invent app/window as label.
        target_label: null,
        url: foregroundContext.url,
        is_identified: false,
        identification_source: 'unidentified',
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

  private persistNormalized(event: NormalizedDesktopEvent): boolean {
    if (!PERSISTABLE_TYPES.has(event.type)) {
      // pointer_sample and other reserved local types are not API-ingestible yet.
      return false;
    }

    try {
      const saved = this.sessionStore.saveCapturedEvent({
        category: event.category,
        type: event.type,
        timestamp_ms: event.timestamp_ms,
        raw_x: event.raw_x,
        raw_y: event.raw_y,
        value: event.value,
        target_label: event.target_label,
        url: event.url,
        screenshot_id: event.screenshot_id,
        is_identified: event.is_identified,
        identification_source: event.identification_source,
        attrs: event.attrs,
      });
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

    this.collector.emitImmediate({
      category: 'clipboard',
      type,
      timestamp_ms: Date.now(),
      raw_x: null,
      raw_y: null,
      value: text.slice(0, MAX_INPUT_VALUE_CHARS) || null,
      target_label: null,
      url: context.url,
      is_identified: false,
      identification_source: 'unidentified',
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
        target_label: null,
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

    this.collector.emitImmediate({
      category: 'keyboard',
      type: 'input',
      timestamp_ms: buffer.lastAtMs,
      raw_x: null,
      raw_y: null,
      value: buffer.chars,
      target_label: buffer.target_label,
      url: buffer.url,
      is_identified: false,
      identification_source: 'unidentified',
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

  private startContextPollers(): void {
    this.stopContextPollers();
    this.pollWindowChange();
    this.windowPollTimer = setInterval(() => {
      if (this.state === 'recording') {
        this.pollWindowChange();
      }
    }, WINDOW_POLL_MS);

    if (process.platform === 'win32' && this.collector.getConfig().enableFocusChange) {
      this.focusPollTimer = setInterval(() => {
        if (this.state === 'recording') {
          void this.sampleFocusChange(this.getForegroundContext());
        }
      }, FOCUS_POLL_MS);
    } else if (process.platform !== 'win32') {
      console.info(`[desktop] focus_change unavailable on ${process.platform}; Windows UIA only`);
    }
  }

  private stopContextPollers(): void {
    if (this.windowPollTimer) {
      clearInterval(this.windowPollTimer);
      this.windowPollTimer = null;
    }
    if (this.focusPollTimer) {
      clearInterval(this.focusPollTimer);
      this.focusPollTimer = null;
    }
  }

  private pollWindowChange(): void {
    const context = this.getForegroundContext();
    if (this.shouldSuppressCapture(context)) {
      return;
    }

    const app = context.foreground_app;
    const title = context.window_title;
    if (this.lastWindowApp === null && this.lastWindowTitle === null) {
      this.lastWindowApp = app;
      this.lastWindowTitle = title;
      return;
    }

    if (app === this.lastWindowApp && title === this.lastWindowTitle) {
      return;
    }

    const fromApp = this.lastWindowApp;
    const fromTitle = this.lastWindowTitle;
    this.lastWindowApp = app;
    this.lastWindowTitle = title;

    this.collector.emitWindowChange({
      category: 'system',
      type: 'window_change',
      timestamp_ms: Date.now(),
      raw_x: null,
      raw_y: null,
      target_label: null,
      url: context.url,
      is_identified: false,
      identification_source: 'unidentified',
      attrs: this.buildCommonAttrs(context, {
        from_app: fromApp,
        from_title: fromTitle,
        to_app: app,
        to_title: title,
      }),
    });
  }

  private async sampleFocusChange(context: ForegroundContext): Promise<void> {
    if (!this.collector.getConfig().enableFocusChange || process.platform !== 'win32') {
      return;
    }
    if (this.shouldSuppressCapture(context)) {
      return;
    }

    try {
      const hit = await lookupUiaFocusedElement();
      if (!hit?.name) {
        return;
      }
      const label = pickControlLabel(hit.name, context.foreground_app, context.window_title);
      if (!label) {
        return;
      }
      this.collector.emitFocusChange({
        category: 'a11y',
        type: 'focus_change',
        timestamp_ms: Date.now(),
        raw_x: null,
        raw_y: null,
        target_label: label,
        url: context.url,
        is_identified: true,
        identification_source: 'accessibility_api',
        attrs: this.buildCommonAttrs(context, {
          to_name: label,
          uia_control_type: hit.controlType,
        }),
      });
    } catch (error) {
      console.warn('[desktop] focus_change sample failed:', error);
    }
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
