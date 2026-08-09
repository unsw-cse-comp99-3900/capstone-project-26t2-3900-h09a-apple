import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { backendFetch } from '@/lib/auth/backend';
import { ACCESS_TOKEN_COOKIE } from '@/lib/auth/constants';

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

async function proxy(request: Request, context: RouteContext): Promise<NextResponse> {
  const { path } = await context.params;
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;

  if (!accessToken) {
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });
  }

  const targetPath = `/api/v1/${path.join('/')}`;
  const url = new URL(request.url);
  const query = url.search;

  const headers = new Headers(request.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  headers.delete('host');
  headers.delete('connection');

  const body =
    request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();

  const upstream = await backendFetch(`${targetPath}${query}`, {
    method: request.method,
    headers,
    body,
  });

  // 204/205/304 must not carry a body; NextResponse throws if given one.
  const nullBody = upstream.status === 204 || upstream.status === 205 || upstream.status === 304;
  const responseBody = nullBody ? null : await upstream.arrayBuffer();
  const response = new NextResponse(responseBody, { status: upstream.status });

  upstream.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'transfer-encoding') {
      return;
    }
    if (nullBody && key.toLowerCase() === 'content-length') {
      return;
    }
    response.headers.set(key, value);
  });

  // Do not clear cookies on 401; the client refresh-and-retry path owns session teardown.
  return response;
}

export async function GET(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function POST(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function PUT(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function PATCH(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function DELETE(request: Request, context: RouteContext) {
  return proxy(request, context);
}
