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

  export function openLocalBuffer(dbPath?: string): LocalBufferDatabase;
  export function saveSession(db: LocalBufferDatabase, session: LocalSessionInput): void;
  export function saveEvent(db: LocalBufferDatabase, event: LocalEventInput): void;
  export function getSessionWithEvents(
    db: LocalBufferDatabase,
    sessionId: string,
  ): StoredSessionRows | null;
  export function assembleSessionFromRows(rows: StoredSessionRows): Record<string, unknown>;
}
