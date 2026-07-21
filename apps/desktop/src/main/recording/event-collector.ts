export type DesktopEventCategory = 'mouse' | 'keyboard' | 'clipboard' | 'system' | 'a11y';

export type DesktopEventType =
  | 'click'
  | 'keydown'
  | 'input'
  | 'clipboard_copy'
  | 'clipboard_paste'
  | 'window_change'
  | 'scroll'
  | 'focus_change'
  | 'pointer_sample';

export type IdentificationSource =
  | 'accessibility_api'
  | 'ocr'
  | 'vision_model'
  | 'unidentified'
  | null;

export interface NormalizedDesktopEvent {
  category: DesktopEventCategory;
  type: DesktopEventType;
  timestamp_ms: number;
  raw_x: number | null;
  raw_y: number | null;
  value?: string | null;
  target_label?: string | null;
  url?: string | null;
  screenshot_id?: string | null;
  is_identified?: boolean;
  identification_source?: IdentificationSource;
  attrs: Record<string, unknown>;
}

export interface EventCollectorConfig {
  enableScroll: boolean;
  enableFocusChange: boolean;
  enablePointerSample: boolean;
  windowChangeDebounceMs: number;
  scrollMergeMs: number;
  pointerSampleMinMs: number;
  pointerSampleMinDistancePx: number;
}

export const DEFAULT_EVENT_COLLECTOR_CONFIG: EventCollectorConfig = {
  enableScroll: true,
  enableFocusChange: true,
  enablePointerSample: false,
  windowChangeDebounceMs: 300,
  scrollMergeMs: 150,
  pointerSampleMinMs: 500,
  pointerSampleMinDistancePx: 24,
};

export type PersistDesktopEvent = (event: NormalizedDesktopEvent) => void;

/**
 * Normalizes and debounces desktop capture signals before persistence.
 * High-frequency sources (pointer_sample) stay off unless config enables them.
 */
export class EventCollector {
  private readonly config: EventCollectorConfig;
  private readonly persist: PersistDesktopEvent;

  private pendingScroll: NormalizedDesktopEvent | null = null;
  private scrollFlushTimer: ReturnType<typeof setTimeout> | null = null;

  private lastWindowChangeAt = 0;
  private lastWindowKey: string | null = null;

  private lastPointerAt = 0;
  private lastPointerX = 0;
  private lastPointerY = 0;

  private lastFocusName: string | null = null;

  constructor(persist: PersistDesktopEvent, config: Partial<EventCollectorConfig> = {}) {
    this.persist = persist;
    this.config = { ...DEFAULT_EVENT_COLLECTOR_CONFIG, ...config };
  }

  getConfig(): EventCollectorConfig {
    return { ...this.config };
  }

  /** Immediate persist for click/key/clipboard (ordering-critical). */
  emitImmediate(event: NormalizedDesktopEvent): void {
    if (event.type === 'pointer_sample' && !this.config.enablePointerSample) {
      return;
    }
    this.persist(event);
  }

  emitWindowChange(event: NormalizedDesktopEvent): void {
    const toApp = String(event.attrs.to_app ?? event.attrs.foreground_app ?? '');
    const toTitle = String(event.attrs.to_title ?? event.attrs.window_title ?? '');
    const key = `${toApp}\0${toTitle}`;
    const now = event.timestamp_ms;
    if (
      key === this.lastWindowKey &&
      now - this.lastWindowChangeAt < this.config.windowChangeDebounceMs
    ) {
      return;
    }
    this.lastWindowKey = key;
    this.lastWindowChangeAt = now;
    this.persist(event);
  }

  emitScroll(event: NormalizedDesktopEvent): void {
    if (!this.config.enableScroll) {
      return;
    }

    const deltaX = Number(event.attrs.delta_x ?? 0) || 0;
    const deltaY = Number(event.attrs.delta_y ?? 0) || 0;

    if (!this.pendingScroll) {
      this.pendingScroll = {
        ...event,
        attrs: {
          ...event.attrs,
          delta_x: deltaX,
          delta_y: deltaY,
        },
      };
    } else {
      const prevX = Number(this.pendingScroll.attrs.delta_x ?? 0) || 0;
      const prevY = Number(this.pendingScroll.attrs.delta_y ?? 0) || 0;
      this.pendingScroll = {
        ...this.pendingScroll,
        timestamp_ms: event.timestamp_ms,
        raw_x: event.raw_x ?? this.pendingScroll.raw_x,
        raw_y: event.raw_y ?? this.pendingScroll.raw_y,
        attrs: {
          ...this.pendingScroll.attrs,
          ...event.attrs,
          delta_x: prevX + deltaX,
          delta_y: prevY + deltaY,
        },
      };
    }

    if (this.scrollFlushTimer) {
      clearTimeout(this.scrollFlushTimer);
    }
    this.scrollFlushTimer = setTimeout(() => {
      this.flushScroll();
    }, this.config.scrollMergeMs);
  }

  emitFocusChange(event: NormalizedDesktopEvent): void {
    if (!this.config.enableFocusChange) {
      return;
    }
    const toName =
      typeof event.attrs.to_name === 'string'
        ? event.attrs.to_name.trim()
        : event.target_label?.trim();
    if (!toName) {
      return;
    }
    if (toName === this.lastFocusName) {
      return;
    }
    const fromName = this.lastFocusName;
    this.lastFocusName = toName;
    this.persist({
      ...event,
      target_label: toName,
      is_identified: true,
      identification_source: 'accessibility_api',
      attrs: {
        ...event.attrs,
        from_name: fromName,
        to_name: toName,
      },
    });
  }

  emitPointerSample(event: NormalizedDesktopEvent): void {
    if (!this.config.enablePointerSample) {
      return;
    }
    const x = Number(event.raw_x);
    const y = Number(event.raw_y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }
    const now = event.timestamp_ms;
    const dx = x - this.lastPointerX;
    const dy = y - this.lastPointerY;
    const dist = Math.hypot(dx, dy);
    if (
      now - this.lastPointerAt < this.config.pointerSampleMinMs ||
      dist < this.config.pointerSampleMinDistancePx
    ) {
      return;
    }
    this.lastPointerAt = now;
    this.lastPointerX = x;
    this.lastPointerY = y;
    this.persist({ ...event, type: 'pointer_sample' });
  }

  flush(): void {
    this.flushScroll();
  }

  reset(): void {
    this.flushScroll();
    this.lastWindowChangeAt = 0;
    this.lastWindowKey = null;
    this.lastPointerAt = 0;
    this.lastPointerX = 0;
    this.lastPointerY = 0;
    this.lastFocusName = null;
  }

  private flushScroll(): void {
    if (this.scrollFlushTimer) {
      clearTimeout(this.scrollFlushTimer);
      this.scrollFlushTimer = null;
    }
    const pending = this.pendingScroll;
    this.pendingScroll = null;
    if (!pending) {
      return;
    }
    const dx = Number(pending.attrs.delta_x ?? 0) || 0;
    const dy = Number(pending.attrs.delta_y ?? 0) || 0;
    if (dx === 0 && dy === 0) {
      return;
    }
    this.persist(pending);
  }
}

/** Stub vision/diff source — reserved; not wired this release. */
export class VisionDiffEventSource {
  start(): void {
    // Intentionally empty: screenshot_diff / element_appeared stay off.
  }

  stop(): void {
    // no-op
  }
}
