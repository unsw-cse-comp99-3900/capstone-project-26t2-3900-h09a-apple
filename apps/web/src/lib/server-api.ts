/**
 * Server-component helpers for authenticated FastAPI reads.
 */

import type { FrictionWorkflowListResponse } from '@h09a/types';
import { cookies } from 'next/headers';

import { ACCESS_TOKEN_COOKIE } from '@/lib/auth/constants';

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

/**
 * Server-side friction list fetch for the variance dashboard initial render.
 * Returns null when unauthenticated or the API is unavailable so the client can retry.
 */
/** Server-component helper to load friction workflows (null on failure). */
export async function loadFrictionWorkflowList(): Promise<FrictionWorkflowListResponse | null> {
  const token = (await cookies()).get(ACCESS_TOKEN_COOKIE)?.value;
  if (!token) {
    return null;
  }

  try {
    const response = await fetch(`${BASE_URL.replace(/\/$/, '')}/api/v1/analytics/friction`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as FrictionWorkflowListResponse;
  } catch {
    return null;
  }
}
