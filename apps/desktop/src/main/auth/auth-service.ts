import {
  clearTokens,
  loadTokens,
  saveTokens,
  type StoredAuthTokens,
} from './token-store';

const API_BASE_URL = __API_BASE_URL__;
if (!API_BASE_URL) {
  throw new Error('WORKTRACE_API_BASE_URL is not configured');
}

interface LoginResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: string;
}

interface RefreshResponse {
  access_token: string;
  expires_in: number;
}

function apiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL.replace(/\/$/, '')}${normalized}`;
}

/**
 * Redeem a one-time handoff code issued by the web app.
 *
 * On success the desktop client becomes authenticated and the
 * returned credentials are persisted securely.
 */
export async function redeemHandoffCode(code: string): Promise<void> {
  const response = await fetch(apiUrl('/api/v1/auth/extension-handoff/redeem'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code }),
  });

  if (!response.ok) {
    throw new Error('Failed to redeem handoff code');
  }

  const payload = (await response.json()) as LoginResponse;

  saveTokens({
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAtMs: Date.now() + payload.expires_in * 1000,
    userId: payload.user_id,
  });
}

/**
 * Refresh the current access token using the stored refresh token.
 */
async function refreshAccessToken(
  refreshToken: string,
): Promise<string> {
  const response = await fetch(apiUrl('/api/v1/auth/refresh'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to refresh access token');
  }

  const payload = (await response.json()) as RefreshResponse;

  const current = await loadTokens();

  if (!current) {
    throw new Error('Authentication state disappeared');
  }

  await saveTokens({
    ...current,
    accessToken: payload.access_token,
    expiresAtMs: Date.now() + payload.expires_in * 1000,
  });

  return payload.access_token;
}

/**
 * Wrapper around fetch() that automatically attaches the access token.
 *
 * If the request receives a 401 response, one silent refresh is attempted
 * before retrying the request once.
 */
export async function authenticatedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  console.log(loadTokens());
  const tokens = loadTokens();

  if (!tokens) {
    throw new Error('Desktop is not authenticated');
  }

  const headers = new Headers(init.headers);

  headers.set(
    'Authorization',
    `Bearer ${tokens.accessToken}`,
  );

  let response = await fetch(apiUrl(path), {
    ...init,
    headers,
  });

  if ((response.status !== 401 || !tokens.refreshToken)) {
    return response;
  }

  try {
    const nextAccessToken = await refreshAccessToken(
      tokens.refreshToken,
    );

    headers.set(
      'Authorization',
      `Bearer ${nextAccessToken}`,
    );

    response = await fetch(apiUrl(path), {
      ...init,
      headers,
    });

    return response;
  } catch {
    await clearTokens();
    throw new Error('Desktop authentication expired');
  }
}

/**
 * Returns the currently authenticated user, or null if the
 * desktop client has not completed auth handoff.
 */
export function getCurrentAuth(): StoredAuthTokens | null {
  return loadTokens();
}

/**
 * Clear all locally stored authentication state.
 */
export function logout(): void {
  clearTokens();
}