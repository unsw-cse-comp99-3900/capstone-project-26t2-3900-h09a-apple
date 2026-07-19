import { NextResponse } from 'next/server';

import { backendFetch } from '@/lib/auth/backend';
import { formatApiDetail } from '@/lib/auth/errors';

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json().catch(() => null)) as {
    token?: string;
    new_password?: string;
  } | null;

  if (!body?.token || !body.new_password) {
    return NextResponse.json({ detail: 'Token and new password are required' }, { status: 400 });
  }

  const upstream = await backendFetch('/api/v1/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: body.token,
      new_password: body.new_password,
    }),
  });

  const payload = (await upstream.json().catch(() => null)) as {
    detail?: unknown;
    ok?: boolean;
  } | null;
  if (!upstream.ok) {
    return NextResponse.json(
      { detail: formatApiDetail(payload?.detail, 'Unable to reset password') },
      { status: upstream.status },
    );
  }

  return NextResponse.json(payload ?? { ok: true });
}
