import type { LoginResponse } from '@h09a/types';
import { NextResponse } from 'next/server';

import { backendFetch } from '@/lib/auth/backend';
import { setAuthCookies } from '@/lib/auth/cookies';

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as { email?: string; password?: string };

  if (!body.email || !body.password) {
    return NextResponse.json({ detail: 'Email and password are required' }, { status: 400 });
  }

  const upstream = await backendFetch('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: body.email, password: body.password }),
  });

  if (!upstream.ok) {
    const detail = await upstream.json().catch(() => ({ detail: 'Invalid credentials' }));
    return NextResponse.json(detail, { status: upstream.status });
  }

  const payload = (await upstream.json()) as LoginResponse;
  const response = NextResponse.json({ ok: true });
  setAuthCookies(response, payload.access_token, payload.refresh_token, payload.expires_in);
  return response;
}
