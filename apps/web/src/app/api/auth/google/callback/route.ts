import type { LoginResponse } from '@h09a/types';
import { NextResponse } from 'next/server';

import { backendFetch } from '@/lib/auth/backend';
import { roleFromAccessToken, roleLandingPath } from '@/lib/auth/constants';
import { setAuthCookies } from '@/lib/auth/cookies';

const GOOGLE_OAUTH_STATE_COOKIE = 'wt_google_oauth_state';
const SECURE = process.env.NODE_ENV === 'production';

function readCookie(request: Request, name: string): string | undefined {
  return request.headers
    .get('cookie')
    ?.split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function clearGoogleStateCookie(response: NextResponse): void {
  response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, '', {
    httpOnly: true,
    secure: SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const state = url.searchParams.get('state');
  const expectedState = readCookie(request, GOOGLE_OAUTH_STATE_COOKIE);

  if (error || !code || !state || state !== expectedState) {
    const response = NextResponse.redirect(new URL('/login?google=failed', request.url));
    clearGoogleStateCookie(response);
    return response;
  }

  const redirectUri = new URL('/api/auth/google/callback', request.url).toString();
  const upstream = await backendFetch('/api/v1/auth/google/callback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, redirect_uri: redirectUri }),
  });

  if (!upstream.ok) {
    const response = NextResponse.redirect(new URL('/login?google=failed', request.url));
    clearGoogleStateCookie(response);
    return response;
  }

  const payload = (await upstream.json()) as LoginResponse;
  const role = roleFromAccessToken(payload.access_token);
  const response = NextResponse.redirect(
    new URL(role ? roleLandingPath(role) : '/library', request.url),
  );

  setAuthCookies(response, payload.access_token, payload.refresh_token, payload.expires_in);
  clearGoogleStateCookie(response);
  return response;
}