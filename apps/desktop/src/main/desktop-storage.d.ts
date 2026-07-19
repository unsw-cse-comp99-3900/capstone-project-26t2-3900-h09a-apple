declare module '@h09a/desktop-storage' {
  export interface LocalBufferDatabase {
    close(): void;
  }

  export interface LocalSessionInput {
    client_session_id: string;
    workflow_name: string;
    recorded_by?: string | null;
    started_at_ms: number;
    stopped_at_ms?: number | null;
    submitted_at_ms?: number | null;
    status?: string;
    created_at_ms?: number;
    updated_at_ms?: number;
  }

  export interface LocalEventInput {
    id: string;
    session_id: string;
    seq: number;
    source?: string;
    layer?: string;
    category?: string;
    type: string;
    timestamp_ms: number;
    target_selector?: string | null;
    target_label?: string | null;
    value?: string | null;
    url?: string | null;
    screenshot_id?: string | null;
    is_identified: boolean;
    identification_source?: 'accessibility_api' | 'ocr' | 'vision_model' | 'unidentified' | null;
    raw_x?: number | null;
    raw_y?: number | null;
    attrs?: Record<string, unknown>;
    created_at_ms?: number;
  }

  export interface StoredSessionRows {
    session: Record<string, unknown>;
    events: Array<Record<string, unknown>>;
  }

  export interface SaveEventResult {
    saved: boolean;
    skipped?: boolean;
    redacted?: boolean;
    reason?: string | null;
  }

  export interface SessionAuditSummary {
    session_id: string;
    captured_by_category: Record<string, number>;
    redacted_by_category: Record<string, number>;
    skipped_password_fields: number;
    windows_skipped: number;
    skipped_by_app_pattern: Record<string, number>;
    defensive_strips: number;
  }

  export const DEFAULT_SENSITIVE_APP_PATTERNS: string[];
  export const DEFAULT_MAX_STOPPED_SESSIONS: number;

  export function openLocalBuffer(dbPath?: string): LocalBufferDatabase;
  export function saveSession(db: LocalBufferDatabase, session: LocalSessionInput): void;
  export function saveEvent(db: LocalBufferDatabase, event: LocalEventInput): SaveEventResult;
  export function getSessionWithEvents(
    db: LocalBufferDatabase,
    sessionId: string,
  ): StoredSessionRows | null;
  export function assembleSessionFromRows(rows: StoredSessionRows): Record<string, unknown>;
  export function maskValue(value: unknown, options?: { forceMask?: boolean }): unknown;
  export function applyCapturePolicy(event: LocalEventInput): {
    event: LocalEventInput | null;
    redacted: boolean;
    skipped: boolean;
    reason: string | null;
  };
  export function loadSensitiveAppConfig(configPath?: string): {
    patterns: string[];
    source: string;
  };
  export function saveSensitiveAppConfig(
    configPath: string,
    patterns: string[],
  ): { patterns: string[] };
  export function matchSensitiveForeground(
    foregroundApp: string | null | undefined,
    windowTitle: string | null | undefined,
    patterns?: string[],
  ): string | null;
  export function recordWindowSkip(sessionId: string, pattern: string): void;
  export function getSessionAuditSummary(sessionId: string): SessionAuditSummary;
  export function clearSessionAudit(sessionId: string): void;
  export function markSessionSubmitted(
    db: LocalBufferDatabase,
    sessionId: string,
    options?: { submittedAtMs?: number },
  ): { sessionId: string; submittedAtMs: number; purgedEventCount: number };
  export function purgeSensitiveEventContent(
    db: LocalBufferDatabase,
    sessionId: string,
    options?: { purgedAtMs?: number },
  ): number;
}
