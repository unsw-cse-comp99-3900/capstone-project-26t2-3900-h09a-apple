/**
 * Issues a short-lived code so the web session can hand off to the extension.
 */

import type { ExtensionHandoffCreateResponse } from '@h09a/types';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { backendFetch } from '@/lib/auth/backend';
import { ACCESS_TOKEN_COOKIE } from '@/lib/auth/constants';
import { clearAuthCookies } from '@/lib/auth/cookies';

export async function POST(): Promise<NextResponse> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;

  if (!accessToken) {
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });
  }

  const upstream = await backendFetch('/api/v1/auth/extension-handoff', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });

  if (!upstream.ok) {
    const response = NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });
    if (upstream.status === 401) {
      clearAuthCookies(response);
    }
    return response;
  }

  const payload = (await upstream.json()) as ExtensionHandoffCreateResponse;
  return NextResponse.json(payload);
}
