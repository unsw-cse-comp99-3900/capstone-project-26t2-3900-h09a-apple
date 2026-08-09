/**
 * Sprint 1 session data contract (H09AAPPLE-15).
 *
 * Authoritative description lives in `docs/db-schema.md`. This file is the
 * TypeScript rendering of that contract; field names and types must stay 1:1
 * with `apps/api/app/models.py` and the markdown doc.
 *
 * Read / write DTOs are intentionally split:
 *   - `WTEventInput` / `SessionUploadPayload` are what the extension sends.
 *   - `WTEvent` / `SessionDetail` are what the API returns.
 * Conflating them would force every consumer to handle optionals (`id?`,
 * `occurred_at?`) for fields that are mandatory in one direction.
 */

// ---------------------------------------------------------------------------
// Shared enums (mirror the CHECK-constrained varchars in Postgres)
// ---------------------------------------------------------------------------
export type SessionStatus = 'recording' | 'captured' | 'submitted' | 'processed' | 'failed';

export type EventType = 'click' | 'navigation' | 'input' | 'submit' | 'tab_switch';

export type SopStatus = 'draft' | 'needs_review' | 'approved' | 'published';

export type CodificationJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

// ---------------------------------------------------------------------------
// Write DTOs (extension → API)
// ---------------------------------------------------------------------------

/**
 * A single event as emitted by the content script.
 *
 * No `seq` field: the server assigns the sequence number on ingest. See
 * "Sequence number assignment" in `docs/db-schema.md` for why.
 */
export interface WTEventInput {
  type: EventType;
  target_selector?: string | null;
  target_label?: string | null;
  /** Already PII-masked at source (see H09AAPPLE-11). */
  value?: string | null;
  url?: string | null;
  /** Open bag for `aria-role`, `href`, `name`, etc. */
  attrs?: Record<string, unknown>;
  screenshot_id?: string | null;
  /** Client wall clock, epoch milliseconds. */
  timestamp_ms: number;
}

export interface ScreenshotInput {
  id: string;
  data_base64: string;
  content_type: 'image/png' | 'image/jpeg' | 'image/webp';
  width?: number | null;
  height?: number | null;
}

/** Body of POST /sessions when the extension flushes a recording. */
export interface SessionUploadPayload {
  /** Idempotency key; the extension generates this once per recording. */
  client_session_id: string;
  workflow_name: string;
  /**
   * UUID of the recording user. Optional until the auth/users card lands —
   * before that, the extension has no real user identity to attach.
   */
  recorded_by?: string | null;
  /** ISO-8601 with explicit UTC offset (e.g. `2026-06-16T12:30:00Z`). */
  started_at: string;
  /** ISO-8601 with offset; null while recording is still in progress. */
  stopped_at?: string | null;
  events: WTEventInput[];
  screenshots?: ScreenshotInput[];
}

export interface SessionCreateResponse {
  session_id: string;
  job_id: string;
}

// ---------------------------------------------------------------------------
// Read DTOs (API → FE)
// ---------------------------------------------------------------------------

export interface WTEvent extends WTEventInput {
  /**
   * BIGINT serialised as string to stay JS-safe past 2^53.
   * The API MUST dump this as a JSON string, not a number — see
   * "Identifier serialisation" in `docs/db-schema.md`.
   */
  id: string;
  /** Server-assigned ordering within the session. */
  seq: number;
  /** Derived server-side from `timestamp_ms`. ISO-8601 with UTC offset. */
  occurred_at: string;
  /** When the server received the event. ISO-8601 with UTC offset. */
  ingested_at: string;
}

export interface SessionSummary {
  id: string;
  client_session_id: string;
  tenant_id: string;
  /** Null for sessions recorded before auth/users landed. */
  recorded_by?: string | null;
  workflow_name: string;
  status: SessionStatus;
  /** ISO-8601 with UTC offset. */
  started_at: string;
  /** ISO-8601 with UTC offset. */
  stopped_at?: string | null;
  event_count: number;
  /** ISO-8601 with UTC offset. */
  created_at: string;
}

export interface SessionDetail extends SessionSummary {
  events: WTEvent[];
}

export interface SessionStatusResponse {
  session_id: string;
  workflow_name: string;
  job_status: CodificationJobStatus;
  sop_id?: string | null;
}

// ---------------------------------------------------------------------------
// Screenshots
// ---------------------------------------------------------------------------

export interface Screenshot {
  id: string;
  session_id: string;
  /** Key in object storage; the blob is fetched via a short-lived signed URL. */
  object_key: string;
  width?: number | null;
  height?: number | null;
  bytes?: number | null;
  /** ISO-8601. */
  created_at: string;
}

// ---------------------------------------------------------------------------
// SOP
// ---------------------------------------------------------------------------

/**
 * Mirrors `SopStep` in `apps/api/app/sop_schema.py`.
 * Keep field names in sync — both definitions describe the same JSONB shape.
 */
export interface SopStep {
  order: number;
  title: string;
  instruction: string;
  branch?: string | null;
  source_event_ids: string[];
  time_estimate?: number | null;
}

/** Mirrors `SopWarning` in `apps/api/app/sop_schema.py`. */
export interface SopWarning {
  type: 'repeated_action' | 'invalid_sequence' | 'missing_context';
  message: string;
  source_event_ids: string[];
}

export interface Sop {
  id: string;
  session_id: string;
  title: string;
  version: number;
  status: SopStatus;
  steps: SopStep[];
  warnings: SopWarning[];
  /** ISO-8601. */
  generated_at: string;
  gen_duration_ms?: number | null;
}

export interface SopStepResponse extends SopStep {
  /**
   * Short-lived signed URL generated by the API.
   * Null if no screenshot is associated with the step.
   */
  screenshot_url: string | null;
  screenshot_highlight: ScreenshotHighlight | null;
}

/**
 * Response returned by GET /api/v1/sops/{id}.
 *
 * Extends the persisted SOP with response-only fields used by the frontend.
 */
export interface SopDetailPayload {
  id: string;
  title: string;
  summary: string;
  version: number;
  generated_at: string;
  status: SopStatus;

  steps: SopStepResponse[];

  warnings: SopWarning[];
}

/**
 * Response returned by POST /api/v1/sops/{id}/approve.
 *
 * Mirrors `SopApproveResponse` in `apps/api/app/sop_schema.py`.
 */
export interface SopApproveResponse {
  id: string;
  status: string;
}

/**
 * Response returned by POST /api/v1/sops/{id}/publish.
 *
 * Mirrors `SopPublishResponse` in `apps/api/app/sop_schema.py`.
 */
export interface SopPublishResponse {
  id: string;
  status: string;
  /** ISO-8601. */
  published_at: string;
  library_url: string;
  /** pending | complete | failed; set when publish enqueues embed work. */
  embedding_status?: string | null;
  friction_analysis_id: string;
  /** pending | processing | completed | failed. */
  friction_status: string;
}

/**
 * Response returned by POST /api/v1/sops/{id}/embed (H09AAPPLE-35).
 */
export interface SopEmbedResponse {
  id: string;
  job_id: string;
  embedding_status: string;
}

/**
 * Item returned in the SOP Library listing.
 *
 * Mirrors `SopLibraryItem` in `apps/api/app/sop_schema.py`.
 */
export interface SopLibraryItem {
  id: string;
  title: string;
  workflow_category?: string | null;
  step_count: number;

  /** ISO-8601. */
  published_at?: string | null;

  /** Current SOP status (draft, needs_review, approved, published). */
  status: string;
}

/**
 * Response returned by GET /api/v1/sops.
 *
 * Mirrors `SopListResponse` in `apps/api/app/sop_schema.py`.
 */
export interface SopListResponse {
  sops: SopLibraryItem[];
}

/** How the live walkthrough player should anchor a step. */
export type WalkthroughAnchorMode = 'element' | 'screenshot' | 'none';

/** How the player should auto-advance for this step. */
export type WalkthroughExpectedAction = 'click' | 'input' | 'submit';

/** Mirrors `WalkthroughStep` in `apps/api/app/sop_schema.py`. */
export interface WalkthroughStep {
  step_number: number;
  instruction: string;
  css_selector?: string | null;
  xpath?: string | null;
  target_label: string | null;
  /** Captured aria-label used preferentially for live highlight resolution. */
  aria_label?: string | null;
  /** Explicit or inferred ARIA role used to disambiguate shared aria-labels. */
  role?: string | null;
  screenshot_url?: string | null;
  time_estimate?: number | null;
  screenshot_highlight?: ScreenshotHighlight | null;
  /** element: css/xpath/aria_label; screenshot: image fallback; none: instruction-only. */
  anchor_mode?: WalkthroughAnchorMode;
  expected_action?: WalkthroughExpectedAction | null;
  expected_url?: string | null;
  /** Joined SopWarning messages for this step, when any. */
  warning?: string | null;
}

/** Response returned by GET /api/v1/sops/{id}/walkthrough. */
export interface WalkthroughPayload {
  steps: WalkthroughStep[];
}

export interface ScreenshotHighlight {
  x: number;
  y: number;
  width: number;
  height: number;
  viewport_width: number;
  viewport_height: number;
}
