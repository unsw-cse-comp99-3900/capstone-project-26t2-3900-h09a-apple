/**
 * Auth cookie names, role landing paths, and JWT helpers.
 */

import type { UserRole } from '@h09a/types';

export const ACCESS_TOKEN_COOKIE = 'wt_access_token';
export const REFRESH_TOKEN_COOKIE = 'wt_refresh_token';

const ROLE_LANDING: Record<UserRole, string> = {
  EMPLOYEE: '/dashboard',
  REVIEWER: '/dashboard',
  MANAGER: '/dashboard',
};

/** Default post-login landing path for a role. */
export function roleLandingPath(role: UserRole): string {
  return ROLE_LANDING[role];
}

/** FastAPI base URL from env (server-side). */
export function backendBaseUrl(): string {
  return (
    process.env.API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    'http://localhost:8000'
  ).replace(/\/$/, '');
}

/** Default tenant id used when none is supplied. */
export function defaultTenantId(): string {
  return process.env.AUTH_DEFAULT_TENANT_ID ?? '22222222-2222-2222-2222-222222222222';
}

/** Edge-safe base64url decode for JWT payload segments (no Node Buffer). */
/** Decode a JWT base64url segment to a UTF-8 string. */
export function decodeBase64Url(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(base64 + padding);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Extract the role claim from a JWT access token, if present. */
export function roleFromAccessToken(token: string | undefined): UserRole | null {
  if (!token) {
    return null;
  }

  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }

  try {
    const payload = JSON.parse(decodeBase64Url(parts[1])) as {
      role?: string;
    };
    if (payload.role === 'EMPLOYEE' || payload.role === 'REVIEWER' || payload.role === 'MANAGER') {
      return payload.role;
    }
  } catch {
    return null;
  }

  return null;
}

/** Seconds until access-token exp claim; null when missing/invalid. */
/** Seconds until JWT exp, or null if missing/invalid. */
export function expiresInFromAccessToken(token: string | undefined): number | null {
  if (!token) {
    return null;
  }

  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }

  try {
    const payload = JSON.parse(decodeBase64Url(parts[1])) as { exp?: unknown };
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
      return null;
    }
    return Math.max(0, Math.floor(payload.exp - Date.now() / 1000));
  } catch {
    return null;
  }
}
