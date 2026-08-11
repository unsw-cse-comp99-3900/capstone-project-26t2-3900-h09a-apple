/**
 * Redirects the browser into the Google OAuth authorize URL.
 */

import { NextResponse } from 'next/server';

import { backendBaseUrl } from '@/lib/auth/constants';

const GOOGLE_OAUTH_STATE_COOKIE = 'wt_google_oauth_state';
const SECURE = process.env.NODE_ENV === 'production';

export function GET(request: Request): NextResponse {
  const state = crypto.randomUUID();
  const redirectUri = new URL('/api/auth/google/callback', request.url).toString();
  const authorizationUrl = new URL('/api/v1/auth/google/authorize', backendBaseUrl());

  authorizationUrl.searchParams.set('redirect_uri', redirectUri);
  authorizationUrl.searchParams.set('state', state);

  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 10,
  });

  return response;
}
