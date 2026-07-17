import type { RefreshResponse } from '@h09a/types';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { backendFetch } from '@/lib/auth/backend';
import { REFRESH_TOKEN_COOKIE } from '@/lib/auth/constants';
import { clearAuthCookies, setAccessCookie } from '@/lib/auth/cookies';

export async function POST(): Promise<NextResponse> {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;

  if (!refreshToken) {
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });
  }

  const upstream = await backendFetch('/api/v1/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!upstream.ok) {
    const response = NextResponse.json({ detail: 'Invalid or expired token' }, { status: 401 });
    clearAuthCookies(response);
    return response;
  }

  const payload = (await upstream.json()) as RefreshResponse;
  const response = NextResponse.json({ ok: true, expires_in: payload.expires_in });
  setAccessCookie(response, payload.access_token, payload.expires_in);
  return response;
}
