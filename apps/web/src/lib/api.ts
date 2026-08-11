/**
 * Browser-side API client for the WorkTrace FastAPI backend.
 *
 * Calls go through the Next.js `/api/backend` proxy so cookies stay same-origin.
 * 401 responses trigger a silent refresh once before failing.
 */

import type {
  ConsentAcceptRequest,
  ConsentAcceptResponse,
  ConsentStatusResponse,
  ConsentType,
  FeedbackNotificationListResponse,
  FeedbackStatsResponse,
  FrictionAnalysisResponse,
  FrictionWorkflowListResponse,
  HealthResponse,
  FrictionRecalculateResponse,
  WorkflowClusterResponse,
  WorkflowClusterTimingsResponse,
  WorkflowInsightSummaryResponse,
  KmeansAnalysisRequest,
  KmeansAnalysisResponse,
  SessionCreateResponse,
  SessionStatusResponse,
  SessionUploadPayload,
  SopApproveResponse,
  SopDetailPayload,
  SopListResponse,
  SopPublishResponse,
  SopStatus,
  VoiceFeedbackItem,
  VoiceFeedbackListResponse,
  VoiceFeedbackReviewRequest,
} from '@h09a/types';

import { silentRefreshAccessToken } from '@/lib/auth/session-refresh';

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

/** Error with HTTP status from a failed API call. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function redirectToLogin(): void {
  if (typeof window !== 'undefined') {
    window.location.href = '/login';
  }
}

/** Absolute backend URL (bypasses the Next proxy; used for /health). */
export function apiUrl(path: string): string {
  const trimmed = path.startsWith('/') ? path : `/${path}`;
  return `${BASE_URL.replace(/\/$/, '')}${trimmed}`;
}

function proxyUrl(path: string): string {
  const trimmed = path.replace(/^\/api\/v1\//, '');
  return `/api/backend/${trimmed}`;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown };

    if (typeof body.detail === 'string') {
      return `${fallback}: ${body.detail}`;
    }

    if (Array.isArray(body.detail)) {
      return `${fallback}: ${body.detail
        .map((item) => {
          if (typeof item !== 'object' || item === null) {
            return String(item);
          }

          const detail = item as { loc?: unknown[]; msg?: string };
          const location = Array.isArray(detail.loc) ? detail.loc.join('.') : 'request';
          return `${location} ${detail.msg ?? 'is invalid'}`;
        })
        .join('; ')}`;
    }
  } catch {
    // Fall through to the status-only message if the response is not JSON.
  }

  return `${fallback}: ${res.status}`;
}

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const requestInit: RequestInit = {
    ...init,
    cache: 'no-store',
  };

  let response = await fetch(proxyUrl(path), requestInit);

  if (response.status === 401) {
    const refreshed = await silentRefreshAccessToken();
    if (refreshed.ok) {
      response = await fetch(proxyUrl(path), requestInit);
    }
  }

  if (response.status === 401) {
    redirectToLogin();
    throw new ApiError('Not authenticated', 401);
  }

  return response;
}

/** Unauthenticated health probe against the API. */
export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch(apiUrl('/health'), { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(await errorMessage(res, 'Health check failed'));
  }
  return res.json();
}

/** Upload a recorded session payload for SOP generation. */
export async function createSession(payload: SessionUploadPayload): Promise<SessionCreateResponse> {
  const res = await authedFetch('/api/v1/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(await errorMessage(res, 'Session submission failed'));
  }

  return res.json();
}

/** Poll processing status for an uploaded session. */
export async function getSessionStatus(sessionId: string): Promise<SessionStatusResponse> {
  const res = await authedFetch(`/api/v1/sessions/${sessionId}`);

  if (!res.ok) {
    throw new Error(await errorMessage(res, 'Session status failed'));
  }

  return res.json();
}

/** Re-trigger SOP generation for a failed/pending session. */
export async function retryGenerateSop(sessionId: string): Promise<void> {
  const res = await authedFetch(`/api/v1/sessions/${sessionId}/generate-sop`, {
    method: 'POST',
  });

  if (!res.ok) {
    throw new Error(await errorMessage(res, 'SOP retry failed'));
  }
}

/** Load full SOP detail including steps. */
export async function getSop(sopId: string): Promise<SopDetailPayload> {
  const res = await authedFetch(`/api/v1/sops/${sopId}`);

  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to load SOP'), res.status);
  }

  return res.json();
}

/** List published SOPs for the library view. */
export async function getPublishedSops(): Promise<SopListResponse> {
  const res = await authedFetch('/api/v1/sops?status=published');

  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to load SOP library'), res.status);
  }

  return res.json();
}

/** Soft-delete or remove a SOP the caller can manage. */
export async function deleteSop(sopId: string): Promise<void> {
  const res = await authedFetch(`/api/v1/sops/${encodeURIComponent(sopId)}`, {
    method: 'DELETE',
  });

  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to delete SOP'), res.status);
  }
}

/** Run K-means clustering analysis for a workflow payload. */
export async function runKmeansAnalysis(
  payload: KmeansAnalysisRequest,
): Promise<KmeansAnalysisResponse> {
  const res = await authedFetch('/api/v1/analytics/kmeans', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to run K-means analysis'), res.status);
  }

  return res.json();
}

/** Fetch the latest stored K-means result for a workflow. */
export async function getKmeansAnalysis(workflowId: string): Promise<KmeansAnalysisResponse> {
  const res = await authedFetch(`/api/v1/analytics/kmeans/${encodeURIComponent(workflowId)}`);

  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to load K-means analysis'), res.status);
  }

  return res.json();
}

/** Load friction analysis for a single SOP. */
export async function getFrictionAnalysis(sopId: string): Promise<FrictionAnalysisResponse> {
  const res = await authedFetch(`/api/v1/analytics/friction/${encodeURIComponent(sopId)}`);

  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to load friction analysis'), res.status);
  }

  return res.json();
}

/** List workflows with friction aggregates for the dashboard. */
export async function getFrictionWorkflowList(): Promise<FrictionWorkflowListResponse> {
  const res = await authedFetch('/api/v1/analytics/friction');

  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to load friction workflows'), res.status);
  }

  return res.json();
}

export type DashboardKpi = {
  id: string;
  label: string;
  value: string;
  delta: number;
  unit?: string | null;
};

export type DashboardListItem = {
  id: string;
  title: string;
  meta?: string;
};

export type DashboardSummary = {
  role: string;
  greeting: string;
  kpis: DashboardKpi[];
  primary_items: DashboardListItem[];
};

/** Role-aware dashboard greeting, KPIs, and primary list items. */
export async function getDashboardSummary(): Promise<DashboardSummary> {
  const res = await authedFetch('/api/v1/dashboard/summary');

  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to load dashboard summary'), res.status);
  }

  return res.json();
}

/** Narrative insight summary for a workflow. */
export async function getWorkflowInsightSummary(
  workflowId: string,
): Promise<WorkflowInsightSummaryResponse> {
  const res = await authedFetch(
    `/api/v1/workflows/${encodeURIComponent(workflowId)}/insight-summary`,
  );

  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to load insight summary'), res.status);
  }

  return res.json();
}

/** Recompute friction scores for a workflow. */
export async function recalculateWorkflowFriction(
  workflowId: string,
): Promise<FrictionRecalculateResponse> {
  const res = await authedFetch(
    `/api/v1/workflows/${encodeURIComponent(workflowId)}/friction/recalculate`,
    { method: 'POST' },
  );

  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to recalculate friction'), res.status);
  }

  return res.json();
}

/** Per-cluster timing breakdown for path comparison. */
export async function getWorkflowClusterTimings(
  workflowId: string,
): Promise<WorkflowClusterTimingsResponse> {
  const res = await authedFetch(
    `/api/v1/workflows/${encodeURIComponent(workflowId)}/cluster-timings`,
  );

  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to load cluster timings'), res.status);
  }

  return res.json();
}

/** Run H36 embedding clustering. Path param is session workflow_name, not SOP UUID. */
export async function clusterWorkflowByName(
  workflowName: string,
): Promise<WorkflowClusterResponse> {
  const res = await authedFetch(`/api/v1/workflows/${encodeURIComponent(workflowName)}/cluster`, {
    method: 'POST',
  });

  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to generate path comparison'), res.status);
  }

  return res.json();
}

export type FrictionWsTicket = {
  ticket: string;
  expires_in_seconds: number;
  ws_path: string;
};

/** Mint a short-lived ticket for the friction WebSocket. */
export async function createFrictionWsTicket(): Promise<FrictionWsTicket> {
  const res = await authedFetch('/api/v1/analytics/friction/ws-ticket', { method: 'POST' });
  if (!res.ok) {
    throw new ApiError(
      await errorMessage(res, 'Failed to mint friction socket ticket'),
      res.status,
    );
  }
  return res.json();
}

/** Build the friction WS URL with the minted ticket query param. */
export function frictionWebSocketUrl(
  ticket: string,
  wsPath = '/api/v1/analytics/friction/ws',
): string {
  const httpBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000').replace(
    /\/$/,
    '',
  );
  const wsBase = httpBase.replace(/^http/, 'ws');
  const path = wsPath.startsWith('/') ? wsPath : `/${wsPath}`;
  return `${wsBase}${path}?token=${encodeURIComponent(ticket)}`;
}

/** List SOPs owned by the current user (drafts). */
export async function getMyDrafts(): Promise<SopListResponse> {
  const res = await authedFetch('/api/v1/sops?mine=true');

  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to load draft SOPs'), res.status);
  }

  return res.json();
}

/** List published SOPs owned by the current user. */
export async function getMyPublishedSops(): Promise<SopListResponse> {
  const res = await authedFetch('/api/v1/sops?mine=true&status=published');

  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to load your published SOPs'), res.status);
  }

  return res.json();
}

/** List SOPs filtered by workflow status. */
export async function getSopsByStatus(status: SopStatus): Promise<SopListResponse> {
  const res = await authedFetch(`/api/v1/sops?status=${encodeURIComponent(status)}`);

  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to load SOPs'), res.status);
  }

  return res.json();
}

/** Manager approve action for a pending SOP. */
export async function approveSop(sopId: string): Promise<SopApproveResponse> {
  const res = await authedFetch(`/api/v1/sops/${encodeURIComponent(sopId)}/approve`, {
    method: 'POST',
  });

  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to approve SOP'), res.status);
  }

  return res.json();
}

/** Publish an approved SOP to the library. */
export async function publishSop(sopId: string): Promise<SopPublishResponse> {
  const res = await authedFetch(`/api/v1/sops/${encodeURIComponent(sopId)}/publish`, {
    method: 'POST',
  });

  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to publish SOP'), res.status);
  }

  return res.json();
}

export type SopStepEditResponse = {
  sop_id: string;
  step_number: number;
  instruction: string;
  edit_id: string;
  edited_at: string;
};

export type SopStepEditLogItem = {
  id: string;
  step_number: number;
  editor_id: string | null;
  before_text: string;
  after_text: string;
  created_at: string;
};

/** Patch a single step instruction and return the edit metadata. */
export async function patchSopStepInstruction(
  sopId: string,
  stepNumber: number,
  instruction: string,
): Promise<SopStepEditResponse> {
  const res = await authedFetch(
    `/api/v1/sops/${encodeURIComponent(sopId)}/steps/${encodeURIComponent(String(stepNumber))}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction }),
    },
  );

  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to save step description'), res.status);
  }

  return res.json();
}

/** Load step instruction edit history for a SOP. */
export async function getSopStepEdits(
  sopId: string,
): Promise<{ sop_id: string; edits: SopStepEditLogItem[] }> {
  const res = await authedFetch(`/api/v1/sops/${encodeURIComponent(sopId)}/step-edits`);

  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to load step edit history'), res.status);
  }

  return res.json();
}

/** Server-side consent status for a consent type. */
export async function getConsentStatus(consentType: ConsentType): Promise<ConsentStatusResponse> {
  const res = await authedFetch(
    `/api/v1/consent/status?consent_type=${encodeURIComponent(consentType)}`,
  );

  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to load consent status'), res.status);
  }

  return res.json();
}

/** Record consent acceptance for a consent type/version. */
export async function acceptConsent(payload: ConsentAcceptRequest): Promise<ConsentAcceptResponse> {
  const res = await authedFetch('/api/v1/consent/accept', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to record consent'), res.status);
  }

  return res.json();
}

/** List voice feedback items with optional filters. */
export async function listVoiceFeedback(params?: {
  severity?: string;
  classification?: string;
  status?: string;
  sopId?: string;
}): Promise<VoiceFeedbackListResponse> {
  const query = new URLSearchParams();
  if (params?.severity) query.set('severity', params.severity);
  if (params?.classification) query.set('classification', params.classification);
  if (params?.status) query.set('status', params.status);
  if (params?.sopId) query.set('sop_id', params.sopId);
  query.set('include_audio_url', 'true');
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const res = await authedFetch(`/api/v1/feedback${suffix}`);
  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to load voice feedback'), res.status);
  }
  return res.json();
}

/** Load one voice feedback item by id. */
export async function getVoiceFeedback(feedbackId: string): Promise<VoiceFeedbackItem> {
  const res = await authedFetch(`/api/v1/feedback/${encodeURIComponent(feedbackId)}`);
  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to load feedback'), res.status);
  }
  return res.json();
}

/** Submit a manager review decision for a feedback item. */
export async function reviewVoiceFeedback(
  feedbackId: string,
  payload: VoiceFeedbackReviewRequest,
): Promise<VoiceFeedbackItem> {
  const res = await authedFetch(`/api/v1/feedback/${encodeURIComponent(feedbackId)}/review`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to save feedback review'), res.status);
  }
  return res.json();
}

/** Aggregate feedback stats for the manager dashboard. */
export async function getFeedbackStats(): Promise<FeedbackStatsResponse> {
  const res = await authedFetch('/api/v1/feedback/stats');
  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to load feedback stats'), res.status);
  }
  return res.json();
}

/** List in-app feedback notifications (optionally unread only). */
export async function listFeedbackNotifications(
  unreadOnly = false,
): Promise<FeedbackNotificationListResponse> {
  const suffix = unreadOnly ? '?unread_only=true' : '';
  const res = await authedFetch(`/api/v1/notifications${suffix}`);
  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to load notifications'), res.status);
  }
  return res.json();
}

/** Mark a feedback notification as read. */
export async function markFeedbackNotificationRead(notificationId: string): Promise<void> {
  const res = await authedFetch(
    `/api/v1/notifications/${encodeURIComponent(notificationId)}/read`,
    { method: 'POST' },
  );
  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to mark notification read'), res.status);
  }
}

export type NotificationWsTicket = {
  ticket: string;
  expires_in_seconds: number;
  ws_path: string;
};

/** Mint a short-lived ticket for the notifications WebSocket. */
export async function createNotificationWsTicket(): Promise<NotificationWsTicket> {
  const res = await authedFetch('/api/v1/notifications/ws-ticket', { method: 'POST' });
  if (!res.ok) {
    throw new ApiError(
      await errorMessage(res, 'Failed to mint notification socket ticket'),
      res.status,
    );
  }
  return res.json();
}

/** Build the notifications WS URL with the minted ticket query param. */
export function notificationsWebSocketUrl(
  ticket: string,
  wsPath = '/api/v1/notifications/ws',
): string {
  const httpBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000').replace(
    /\/$/,
    '',
  );
  const wsBase = httpBase.replace(/^http/, 'ws');
  const path = wsPath.startsWith('/') ? wsPath : `/${wsPath}`;
  return `${wsBase}${path}?token=${encodeURIComponent(ticket)}`;
}
