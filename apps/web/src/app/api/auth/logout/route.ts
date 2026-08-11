/**
 * Clears auth cookies and notifies the API to revoke refresh tokens.
 */

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { backendFetch } from '@/lib/auth/backend';
import { REFRESH_TOKEN_COOKIE } from '@/lib/auth/constants';
import { clearAuthCookies } from '@/lib/auth/cookies';

export async function POST(): Promise<NextResponse> {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;

  if (refreshToken) {
    await backendFetch('/api/v1/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    }).catch(() => null);
  }

  const response = NextResponse.json({ ok: true });
  clearAuthCookies(response);
  return response;
}
