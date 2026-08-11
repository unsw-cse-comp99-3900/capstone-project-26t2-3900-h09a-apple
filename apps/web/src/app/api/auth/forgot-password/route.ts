/**
 * BFF proxy for forgot-password email requests.
 */

import { NextResponse } from 'next/server';

import { backendFetch } from '@/lib/auth/backend';
import { formatApiDetail } from '@/lib/auth/errors';

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json().catch(() => null)) as { email?: string } | null;
  if (!body?.email) {
    return NextResponse.json({ detail: 'Email is required' }, { status: 400 });
  }

  const upstream = await backendFetch('/api/v1/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: body.email }),
  });

  const payload = (await upstream.json().catch(() => null)) as { detail?: unknown } | null;
  if (!upstream.ok) {
    return NextResponse.json(
      { detail: formatApiDetail(payload?.detail, 'Unable to start password reset') },
      { status: upstream.status },
    );
  }

  return NextResponse.json(
    payload ?? {
      detail: 'If an account exists for that email, a reset link has been sent.',
    },
  );
}
