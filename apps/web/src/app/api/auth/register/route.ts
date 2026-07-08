import type { LoginResponse } from '@h09a/types';
import { NextResponse } from 'next/server';

import { backendFetch } from '@/lib/auth/backend';
import { defaultTenantId } from '@/lib/auth/constants';
import { setAuthCookies } from '@/lib/auth/cookies';
import { formatApiDetail } from '@/lib/auth/errors';

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as { email?: string; password?: string };

  if (!body.email || !body.password) {
    return NextResponse.json({ detail: 'Email and password are required' }, { status: 400 });
  }

  const registerResponse = await backendFetch('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: body.email,
      password: body.password,
      role: 'EMPLOYEE',
      tenant_id: defaultTenantId(),
    }),
  });

  if (!registerResponse.ok) {
    const body = (await registerResponse.json().catch(() => null)) as { detail?: unknown } | null;
    return NextResponse.json(
      { detail: formatApiDetail(body?.detail, 'Registration failed') },
      { status: registerResponse.status },
    );
  }

  const loginResponse = await backendFetch('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: body.email, password: body.password }),
  });

  if (!loginResponse.ok) {
    return NextResponse.json({ detail: 'Registration succeeded but login failed' }, { status: 500 });
  }

  const payload = (await loginResponse.json()) as LoginResponse;
  const response = NextResponse.json({ ok: true });
  setAuthCookies(response, payload.access_token, payload.refresh_token, payload.expires_in);
  return response;
}
