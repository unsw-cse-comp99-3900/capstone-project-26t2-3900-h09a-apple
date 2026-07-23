import {
  loadSensitiveAppConfig,
  matchSensitiveForeground,
  recordWindowSkip,
} from '@h09a/desktop-storage';
import activeWindow from 'active-win';
import { screen } from 'electron';
import {
  uIOhook,
  UiohookKey,
  type UiohookKeyboardEvent,
  type UiohookMouseEvent,
} from 'uiohook-napi';
import type {
  CapturedScreenshot,
  DesktopTargetSnapshot,
  ForegroundContext,
  UiaInspectionResult,
} from './capture/capture-types';
import { applyKeyboardEventText } from './capture/keyboard-text';
import { ScreenCaptureService } from './capture/screen-capture-service';
import { WindowsUiaClient } from './capture/windows-uia-client';
import { DesktopSessionStore, type CompletedLocalSession } from './desktop-session-store';

export type RecorderState = 'idle' | 'recording' | 'paused' | 'error';

const SKIP_LOG_THROTTLE_MS = 2_000;
const INPUT_IDLE_FLUSH_MS = 750;
const TARGET_LABEL_MAX_LENGTH = 120;

interface PreparedCapture {
  foreground: ForegroundContext;
  inspection: UiaInspectionResult;
  screenshot: CapturedScreenshot | null;
}

interface PendingInputCapture {
  identity: string;
  startedAtMs: number;
  lastAtMs: number;
  foreground: ForegroundContext;
  inspection: UiaInspectionResult;
  target: DesktopTargetSnapshot | null;
  value: string | null;
  valueSource: 'uia_value_pattern' | 'keystroke_fallback' | 'unavailable';
  reconstructedValue: string;
  keystrokeCount: number;
  specialKeys: string[];
}

export class RecordingService {
  private state: RecorderState = 'idle';
  private eventCount = 0;
  private hooksRegistered = false;
  private sensitivePatterns: string[];
  private lastSkipLogKey: string | null = null;
  private lastSkipLogAtMs = 0;
  private captureQueue: Promise<void> = Promise.resolve();
  private pendingInput: PendingInputCapture | null = null;
  private inputFlushTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sessionStore: DesktopSessionStore,
    sensitiveAppsConfigPath?: string,
    private readonly uiaClient = new WindowsUiaClient(),
    private readonly screenCaptureService = new ScreenCaptureService(),
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

  start(workflowName = 'Untitled desktop recording'): void {
    if (this.state === 'recording') return;

    if (this.state === 'paused') {
      this.resume();
      return;
    }

    this.registerHooks();

    try {
      this.eventCount = 0;
      this.captureQueue = Promise.resolve();
      this.clearInputFlushTimer();
      this.pendingInput = null;
      const normalizedWorkflowName =
        workflowName.replace(/\s+/g, ' ').trim().slice(0, 200) ||
        'Untitled desktop recording';
      const sessionId = this.sessionStore.startSession(normalizedWorkflowName);
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
    this.enqueueInputFlush('recording_paused');
  }

  resume(): void {
    if (this.state !== 'paused') return;

    this.state = 'recording';
  }

  async stop(): Promise<CompletedLocalSession | null> {
    if (this.state === 'idle') return null;

    uIOhook.stop();
    this.clearInputFlushTimer();
    const finalInputCapture = this.prepareFocusedCapture(this.getForegroundContext());

    try {
      await this.captureQueue;
      this.refreshPendingInput(await finalInputCapture);
      await this.flushPendingInput('recording_stopped');

      const completedSession = this.sessionStore.hasActiveSession()
        ? this.sessionStore.completeSession()
        : null;

      if (completedSession) {
        console.log(`[desktop] Session saved: ${completedSession.artifactPath}`);
      }

      this.state = 'idle';
      console.log(`[desktop] Global recording stopped (${this.eventCount} events)`);
      return completedSession;
    } catch (error) {
      this.state = 'error';
      console.error('[desktop] Failed to finalize the recording session:', error);
      return null;
    }
  }

  dispose(): void {
    this.uiaClient.dispose();
  }

  getState(): RecorderState {
    return this.state;
  }

  getEventCount(): number {
    return this.eventCount;
  }

  private registerHooks(): void {
    if (this.hooksRegistered) return;

    uIOhook.on('mousedown', (event) => {
      if (this.state !== 'recording') return;

      const capturedAtMs = Date.now();
      const foreground = this.getForegroundContext();
      if (this.shouldSuppressCapture(foreground)) return;

      const prepared = this.preparePointCapture(foreground, event.x, event.y);
      const focusedBeforeClick = this.prepareFocusedCapture(foreground);
      this.enqueueCapture(async () => {
        this.refreshPendingInput(await focusedBeforeClick);
        await this.flushPendingInput('pointer_down');
        await this.persistPointerCapture(event, capturedAtMs, prepared);
      });
    });

    uIOhook.on('keydown', (event) => {
      if (this.state !== 'recording') return;

      const capturedAtMs = Date.now();
      const foreground = this.getForegroundContext();
      if (this.shouldSuppressCapture(foreground)) return;

      const prepared = this.prepareFocusedCapture(
        foreground,
        this.specialKeyName(event.keycode) === 'Enter',
      );
      this.enqueueCapture(() => this.persistKeyActivity(event, capturedAtMs, prepared));
    });

    this.hooksRegistered = true;
  }

  private async preparePointCapture(
    foreground: ForegroundContext,
    x: number,
    y: number,
  ): Promise<PreparedCapture> {
    const inspection = await this.uiaClient.inspectPoint(x, y);
    const screenshot =
      inspection.target?.is_password === true
        ? null
        : await this.screenCaptureService
            .captureDisplayAtPhysicalPoint({ x, y })
            .catch((error: unknown) => {
              console.warn(
                '[desktop] Failed to capture desktop screenshot:',
                error instanceof Error ? error.message : String(error),
              );
              return null;
            });

    return {
      foreground,
      inspection,
      screenshot,
    };
  }

  private async prepareFocusedCapture(
    foreground: ForegroundContext,
    captureScreenshot = false,
  ): Promise<PreparedCapture> {
    const inspection = await this.uiaClient.inspectFocusedElement();
    const target = inspection.target;
    const targetRect = target?.bounding_rect_physical;
    const windowRect = foreground.window_bounds;
    const captureRect = targetRect ?? windowRect;
    const screenshot =
      captureScreenshot && target?.is_password !== true && captureRect
        ? await this.screenCaptureService
            .captureDisplayAtPhysicalPoint({
              x: Math.round(captureRect.x + captureRect.width / 2),
              y: Math.round(captureRect.y + captureRect.height / 2),
            })
            .catch((error: unknown) => {
              console.warn(
                '[desktop] Failed to capture keyboard screenshot:',
                error instanceof Error ? error.message : String(error),
              );
              return null;
            })
        : null;

    return {
      foreground,
      inspection,
      screenshot,
    };
  }

  private enqueueCapture(task: () => Promise<void>): void {
    this.captureQueue = this.captureQueue
      .then(task)
      .catch((error) => {
        this.state = 'error';
        console.error('[desktop] Failed to persist captured event:', error);
      });
  }

  private async persistPointerCapture(
    event: UiohookMouseEvent,
    capturedAtMs: number,
    preparedPromise: Promise<PreparedCapture>,
  ): Promise<void> {
    const { foreground, inspection, screenshot } = await preparedPromise;
    const target = inspection.target;
    const isPassword = target?.is_password === true;
    const screenshotId = screenshot
      ? this.sessionStore.saveCapturedScreenshot({
          data: screenshot.data,
          content_type: screenshot.contentType,
          width: screenshot.metadata.image_width,
          height: screenshot.metadata.image_height,
        })
      : null;
    const dipPoint =
      process.platform === 'win32'
        ? screen.screenToDipPoint({ x: event.x, y: event.y })
        : { x: event.x, y: event.y };
    const targetRectDip = this.toDipRectangle(target);

    const saved = this.sessionStore.saveCapturedEvent({
      category: 'mouse',
      type: 'click',
      timestamp_ms: capturedAtMs,
      raw_x: event.x,
      raw_y: event.y,
      target_selector: isPassword ? null : this.targetSelector(target),
      target_label: isPassword ? null : this.targetLabel(target),
      screenshot_id: screenshotId,
      is_identified: target !== null,
      identification_source: target ? 'accessibility_api' : 'unidentified',
      attrs: {
        ...this.foregroundAttrs(foreground),
        platform: process.platform,
        raw_event_type: 'pointer_down',
        native_event_time: event.time,
        button: event.button,
        clicks: event.clicks,
        modifiers: this.modifierAttrs(event),
        is_password: isPassword,
        desktop_target: isPassword
          ? this.redactPasswordTarget(target)
          : this.targetMetadata(target),
        target_bounding_rect_dip: targetRectDip,
        coordinates: {
          physical_screen: { x: event.x, y: event.y },
          electron_dip: dipPoint,
        },
        screenshot_capture: screenshot?.metadata ?? null,
        uia_error: inspection.error ?? null,
      },
    });

    this.recordSavedEvent(saved, 'pointer_down', foreground.foreground_app);
  }

  private async persistKeyActivity(
    event: UiohookKeyboardEvent,
    capturedAtMs: number,
    preparedPromise: Promise<PreparedCapture>,
  ): Promise<void> {
    const prepared = await preparedPromise;
    const { foreground, inspection } = prepared;
    const target = inspection.target;
    const isPassword = target?.is_password === true;
    const specialKey = this.specialKeyName(event.keycode);

    if (isPassword) {
      await this.flushPendingInput('password_target');
      return;
    }

    if (specialKey === 'Enter') {
      this.refreshPendingInput(prepared);
      await this.flushPendingInput('enter');
      this.persistSubmitEvent(event, capturedAtMs, foreground, inspection, prepared.screenshot);
      return;
    }

    if (specialKey === 'Tab' || specialKey === 'Escape') {
      this.refreshPendingInput({ foreground, inspection, screenshot: null });
      await this.flushPendingInput(specialKey.toLowerCase());
      return;
    }

    if (this.isModifierOnlyKey(event.keycode)) {
      return;
    }

    if (event.ctrlKey || event.metaKey || event.altKey) {
      await this.flushPendingInput('keyboard_shortcut');
      return;
    }

    const identity = this.inputIdentity(foreground, target);
    const exceedsIdleWindow =
      this.pendingInput !== null &&
      capturedAtMs - this.pendingInput.lastAtMs > INPUT_IDLE_FLUSH_MS;

    if (this.pendingInput && (this.pendingInput.identity !== identity || exceedsIdleWindow)) {
      await this.flushPendingInput(exceedsIdleWindow ? 'idle_timeout' : 'target_changed');
    }

    const currentReconstructedValue = this.pendingInput?.reconstructedValue ?? '';
    const reconstructedValue = applyKeyboardEventText(currentReconstructedValue, event);
    const resolvedValue = this.resolveInputValue(target, reconstructedValue);

    if (!this.pendingInput) {
      this.pendingInput = {
        identity,
        startedAtMs: capturedAtMs,
        lastAtMs: capturedAtMs,
        foreground,
        inspection,
        target,
        value: resolvedValue.value,
        valueSource: resolvedValue.source,
        reconstructedValue,
        keystrokeCount: 1,
        specialKeys: specialKey ? [specialKey] : [],
      };
    } else {
      this.pendingInput.lastAtMs = capturedAtMs;
      this.pendingInput.foreground = foreground;
      this.pendingInput.inspection = inspection;
      this.pendingInput.target = target;
      this.pendingInput.value = resolvedValue.value;
      this.pendingInput.valueSource = resolvedValue.source;
      this.pendingInput.reconstructedValue = reconstructedValue;
      this.pendingInput.keystrokeCount += 1;
      if (specialKey) {
        this.pendingInput.specialKeys.push(specialKey);
      }
    }

    this.scheduleInputFlush();
  }

  private persistSubmitEvent(
    event: UiohookKeyboardEvent,
    capturedAtMs: number,
    foreground: ForegroundContext,
    inspection: UiaInspectionResult,
    screenshot: CapturedScreenshot | null,
  ): void {
    const target = inspection.target;
    const screenshotId = screenshot
      ? this.sessionStore.saveCapturedScreenshot({
          data: screenshot.data,
          content_type: screenshot.contentType,
          width: screenshot.metadata.image_width,
          height: screenshot.metadata.image_height,
        })
      : null;
    const saved = this.sessionStore.saveCapturedEvent({
      category: 'keyboard',
      type: 'submit',
      timestamp_ms: capturedAtMs,
      raw_x: null,
      raw_y: null,
      target_selector: this.targetSelector(target),
      target_label: this.targetLabel(target),
      screenshot_id: screenshotId,
      is_identified: target !== null,
      identification_source: target ? 'accessibility_api' : 'unidentified',
      attrs: {
        ...this.foregroundAttrs(foreground),
        platform: process.platform,
        raw_event_type: 'input_commit',
        trigger: 'Enter',
        native_event_time: event.time,
        modifiers: this.modifierAttrs(event),
        is_password: false,
        desktop_target: this.targetMetadata(target),
        target_bounding_rect_dip: this.toDipRectangle(target),
        screenshot_capture: screenshot?.metadata ?? null,
        uia_error: inspection.error ?? null,
      },
    });

    this.recordSavedEvent(saved, 'submit', foreground.foreground_app);
  }

  private async flushPendingInput(reason: string): Promise<void> {
    this.clearInputFlushTimer();
    const pending = this.pendingInput;
    this.pendingInput = null;
    if (!pending) return;

    const target = pending.target;
    if (target?.is_password === true) return;

    const saved = this.sessionStore.saveCapturedEvent({
      category: 'keyboard',
      type: 'input',
      timestamp_ms: pending.startedAtMs,
      raw_x: null,
      raw_y: null,
      target_selector: this.targetSelector(target),
      target_label: this.targetLabel(target),
      value: pending.value,
      is_identified: target !== null,
      identification_source: target ? 'accessibility_api' : 'unidentified',
      attrs: {
        ...this.foregroundAttrs(pending.foreground),
        platform: process.platform,
        raw_event_type: 'input_transaction',
        input_value_source: pending.valueSource,
        keystroke_count: pending.keystrokeCount,
        special_keys: pending.specialKeys,
        input_started_at_ms: pending.startedAtMs,
        input_ended_at_ms: pending.lastAtMs,
        input_duration_ms: Math.max(0, pending.lastAtMs - pending.startedAtMs),
        flush_reason: reason,
        is_password: false,
        desktop_target: this.targetMetadata(target),
        target_bounding_rect_dip: this.toDipRectangle(target),
        uia_error: pending.inspection.error ?? null,
      },
    });

    this.recordSavedEvent(saved, 'input_transaction', pending.foreground.foreground_app);
  }

  private refreshPendingInput(prepared: PreparedCapture): void {
    if (!this.pendingInput) return;

    const target = prepared.inspection.target;
    if (
      target?.is_password === true ||
      this.inputIdentity(prepared.foreground, target) !== this.pendingInput.identity
    ) {
      return;
    }

    this.pendingInput.foreground = prepared.foreground;
    this.pendingInput.inspection = prepared.inspection;
    this.pendingInput.target = target;
    const resolvedValue = this.resolveInputValue(target, this.pendingInput.reconstructedValue);
    this.pendingInput.value = resolvedValue.value;
    this.pendingInput.valueSource = resolvedValue.source;
  }

  private scheduleInputFlush(): void {
    this.clearInputFlushTimer();
    this.inputFlushTimer = setTimeout(() => {
      this.inputFlushTimer = null;
      const foreground = this.getForegroundContext();
      const finalCapture = this.prepareFocusedCapture(foreground);
      this.enqueueCapture(async () => {
        this.refreshPendingInput(await finalCapture);
        await this.flushPendingInput('idle_timeout');
      });
    }, INPUT_IDLE_FLUSH_MS);
  }

  private enqueueInputFlush(reason: string): void {
    this.clearInputFlushTimer();
    const foreground = this.getForegroundContext();
    const finalCapture = this.prepareFocusedCapture(foreground);
    this.enqueueCapture(async () => {
      this.refreshPendingInput(await finalCapture);
      await this.flushPendingInput(reason);
    });
  }

  private clearInputFlushTimer(): void {
    if (!this.inputFlushTimer) return;

    clearTimeout(this.inputFlushTimer);
    this.inputFlushTimer = null;
  }

  private recordSavedEvent(saved: boolean, kind: string, foregroundApp: string): void {
    if (!saved) return;

    this.eventCount += 1;
    console.log(`[desktop] captured ${kind} app=${foregroundApp}`);
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

  private getForegroundContext(): ForegroundContext {
    try {
      const window = activeWindow.sync({
        accessibilityPermission: true,
        screenRecordingPermission: process.platform === 'darwin',
      });

      if (!window) {
        return this.unknownForegroundContext();
      }

      return {
        foreground_app: window.owner.name || window.owner.path || 'unknown',
        executable_path: window.owner.path || null,
        process_id: window.owner.processId || null,
        window_title: window.title || null,
        window_handle: window.id ? String(window.id) : null,
        window_bounds: window.bounds
          ? {
              x: window.bounds.x,
              y: window.bounds.y,
              width: window.bounds.width,
              height: window.bounds.height,
            }
          : null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[desktop] Failed to read the foreground window:', message);

      return {
        ...this.unknownForegroundContext(),
        active_win_error: message,
      };
    }
  }

  private unknownForegroundContext(): ForegroundContext {
    return {
      foreground_app: 'unknown',
      executable_path: null,
      process_id: null,
      window_title: null,
      window_handle: null,
      window_bounds: null,
    };
  }

  private foregroundAttrs(context: ForegroundContext): Record<string, unknown> {
    return {
      foreground_app: context.foreground_app,
      executable_path: context.executable_path,
      process_id: context.process_id,
      window_title: context.window_title,
      window_handle: context.window_handle,
      window_bounds: context.window_bounds,
      active_win_error: context.active_win_error,
    };
  }

  private modifierAttrs(
    event: UiohookKeyboardEvent | UiohookMouseEvent,
  ): Record<string, boolean> {
    return {
      alt: event.altKey,
      control: event.ctrlKey,
      meta: event.metaKey,
      shift: event.shiftKey,
    };
  }

  private specialKeyName(keycode: number): string | null {
    switch (keycode) {
      case UiohookKey.Enter:
      case UiohookKey.NumpadEnter:
        return 'Enter';
      case UiohookKey.Tab:
        return 'Tab';
      case UiohookKey.Escape:
        return 'Escape';
      case UiohookKey.Backspace:
        return 'Backspace';
      case UiohookKey.Delete:
        return 'Delete';
      case UiohookKey.ArrowUp:
        return 'ArrowUp';
      case UiohookKey.ArrowDown:
        return 'ArrowDown';
      case UiohookKey.ArrowLeft:
        return 'ArrowLeft';
      case UiohookKey.ArrowRight:
        return 'ArrowRight';
      case UiohookKey.Home:
        return 'Home';
      case UiohookKey.End:
        return 'End';
      case UiohookKey.PageUp:
        return 'PageUp';
      case UiohookKey.PageDown:
        return 'PageDown';
      case UiohookKey.Space:
        return 'Space';
      default:
        return null;
    }
  }

  private isModifierOnlyKey(keycode: number): boolean {
    return (
      keycode === UiohookKey.Ctrl ||
      keycode === UiohookKey.CtrlRight ||
      keycode === UiohookKey.Alt ||
      keycode === UiohookKey.AltRight ||
      keycode === UiohookKey.Shift ||
      keycode === UiohookKey.ShiftRight ||
      keycode === UiohookKey.Meta ||
      keycode === UiohookKey.MetaRight
    );
  }

  private inputIdentity(
    foreground: ForegroundContext,
    target: DesktopTargetSnapshot | null,
  ): string {
    const runtimeId = target?.runtime_id.length ? target.runtime_id.join('.') : null;
    const targetIdentity =
      runtimeId ??
      target?.automation_id ??
      [
        target?.control_type ?? 'unknown',
        target?.bounding_rect_physical?.x ?? '',
        target?.bounding_rect_physical?.y ?? '',
      ].join(':');

    return [
      foreground.process_id ?? 'unknown-process',
      foreground.window_handle ?? foreground.window_title ?? 'unknown-window',
      targetIdentity,
    ].join('|');
  }

  private valuePatternValue(target: DesktopTargetSnapshot | null): string | null {
    if (
      !target ||
      target.is_password ||
      !target.supports_value_pattern ||
      target.value_pattern_value === null
    ) {
      return null;
    }

    return target.value_pattern_value.length > 0 ? target.value_pattern_value : null;
  }

  private resolveInputValue(
    target: DesktopTargetSnapshot | null,
    reconstructedValue: string,
  ): {
    value: string | null;
    source: PendingInputCapture['valueSource'];
  } {
    const uiaValue = this.valuePatternValue(target);
    if (uiaValue !== null) {
      return { value: uiaValue, source: 'uia_value_pattern' };
    }
    if (reconstructedValue.length > 0) {
      return { value: reconstructedValue, source: 'keystroke_fallback' };
    }
    return { value: null, source: 'unavailable' };
  }

  private targetSelector(target: DesktopTargetSnapshot | null): string | null {
    const automationId = target?.automation_id?.trim();
    if (!automationId) return null;

    return `uia://automation-id/${encodeURIComponent(automationId)}`;
  }

  private targetLabel(target: DesktopTargetSnapshot | null): string | null {
    if (!target) return null;

    for (const candidate of [
      target.name,
      target.automation_id,
      target.localized_control_type,
      target.control_type,
    ]) {
      const value = candidate?.replace(/\s+/g, ' ').trim();
      if (!value) continue;

      return value.length <= TARGET_LABEL_MAX_LENGTH
        ? value
        : `${value.slice(0, TARGET_LABEL_MAX_LENGTH - 3)}...`;
    }

    return null;
  }

  private targetMetadata(
    target: DesktopTargetSnapshot | null,
  ): Partial<DesktopTargetSnapshot> | null {
    if (!target) return null;

    const metadata: Partial<DesktopTargetSnapshot> = { ...target };
    delete metadata.value_pattern_value;
    return metadata;
  }

  private toDipRectangle(
    target: DesktopTargetSnapshot | null,
  ): DesktopTargetSnapshot['bounding_rect_physical'] {
    const rect = target?.bounding_rect_physical;
    if (!rect || process.platform !== 'win32') {
      return rect ?? null;
    }

    return screen.screenToDipRect(null, rect);
  }

  private redactPasswordTarget(
    target: DesktopTargetSnapshot | null,
  ): Partial<DesktopTargetSnapshot> | null {
    if (!target) return null;

    return {
      provider: target.provider,
      control_type: target.control_type,
      localized_control_type: target.localized_control_type,
      is_password: true,
      bounding_rect_physical: target.bounding_rect_physical,
    };
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
