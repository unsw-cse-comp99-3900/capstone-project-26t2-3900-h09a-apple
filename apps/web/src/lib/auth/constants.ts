import type { UserRole } from '@h09a/types';

export const ACCESS_TOKEN_COOKIE = 'wt_access_token';
export const REFRESH_TOKEN_COOKIE = 'wt_refresh_token';

const ROLE_LANDING: Record<UserRole, string> = {
  EMPLOYEE: '/library',
  REVIEWER: '/review',
  MANAGER: '/dashboard/variance',
};

export function roleLandingPath(role: UserRole): string {
  return ROLE_LANDING[role];
}

export function backendBaseUrl(): string {
  return (
    process.env.API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    'http://localhost:8000'
  ).replace(/\/$/, '');
}

export function defaultTenantId(): string {
  return process.env.AUTH_DEFAULT_TENANT_ID ?? '22222222-2222-2222-2222-222222222222';
}

export function roleFromAccessToken(token: string | undefined): UserRole | null {
  if (!token) {
    return null;
  }

  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
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
