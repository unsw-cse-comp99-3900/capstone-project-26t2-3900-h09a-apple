import type {
  ConsentAcceptRequest,
  ConsentAcceptResponse,
  ConsentStatusResponse,
  ConsentType,
  HealthResponse,
  SessionCreateResponse,
  SessionStatusResponse,
  SessionUploadPayload,
  SopApproveResponse,
  SopDetailPayload,
  SopListResponse,
  SopPublishResponse,
  SopStatus,
} from '@h09a/types';

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

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
  const response = await fetch(proxyUrl(path), {
    ...init,
    cache: 'no-store',
  });

  if (response.status === 401) {
    redirectToLogin();
    throw new ApiError('Not authenticated', 401);
  }

  return response;
}

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch(apiUrl('/health'), { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(await errorMessage(res, 'Health check failed'));
  }
  return res.json();
}

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

export async function getSessionStatus(sessionId: string): Promise<SessionStatusResponse> {
  const res = await authedFetch(`/api/v1/sessions/${sessionId}`);

  if (!res.ok) {
    throw new Error(await errorMessage(res, 'Session status failed'));
  }

  return res.json();
}

export async function retryGenerateSop(sessionId: string): Promise<void> {
  const res = await authedFetch(`/api/v1/sessions/${sessionId}/generate-sop`, {
    method: 'POST',
  });

  if (!res.ok) {
    throw new Error(await errorMessage(res, 'SOP retry failed'));
  }
}

export async function getSop(sopId: string): Promise<SopDetailPayload> {
  const res = await authedFetch(`/api/v1/sops/${sopId}`);

  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to load SOP'), res.status);
  }

  return res.json();
}

export async function getPublishedSops(): Promise<SopListResponse> {
  const res = await authedFetch('/api/v1/sops?status=published');

  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to load SOP library'), res.status);
  }

  return res.json();
}

export async function getMyDrafts(): Promise<SopListResponse> {
  const res = await authedFetch('/api/v1/sops?mine=true');

  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to load draft SOPs'), res.status);
  }

  return res.json();
}

export async function getSopsByStatus(status: SopStatus): Promise<SopListResponse> {
  const res = await authedFetch(`/api/v1/sops?status=${encodeURIComponent(status)}`);

  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to load SOPs'), res.status);
  }

  return res.json();
}

export async function approveSop(sopId: string): Promise<SopApproveResponse> {
  const res = await authedFetch(`/api/v1/sops/${encodeURIComponent(sopId)}/approve`, {
    method: 'POST',
  });

  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to approve SOP'), res.status);
  }

  return res.json();
}

export async function publishSop(sopId: string): Promise<SopPublishResponse> {
  const res = await authedFetch(`/api/v1/sops/${encodeURIComponent(sopId)}/publish`, {
    method: 'POST',
  });

  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to publish SOP'), res.status);
  }

  return res.json();
}

export async function getConsentStatus(consentType: ConsentType): Promise<ConsentStatusResponse> {
  const res = await authedFetch(
    `/api/v1/consent/status?consent_type=${encodeURIComponent(consentType)}`,
  );

  if (!res.ok) {
    throw new ApiError(await errorMessage(res, 'Failed to load consent status'), res.status);
  }

  return res.json();
}

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
