import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  roleFromAccessToken,
  roleLandingPath,
} from '@/lib/auth/constants';

const PUBLIC_PATHS = new Set(['/login', '/register']);

const PROTECTED_PREFIXES = ['/library', '/review', '/dashboard', '/session', '/sop'];

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isAuthenticated(request: NextRequest): boolean {
  return Boolean(
    request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ||
    request.cookies.get(REFRESH_TOKEN_COOKIE)?.value,
  );
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const authenticated = isAuthenticated(request);

  if (PUBLIC_PATHS.has(pathname) && authenticated) {
    const role = roleFromAccessToken(request.cookies.get(ACCESS_TOKEN_COOKIE)?.value);
    const destination = role ? roleLandingPath(role) : '/library';
    return NextResponse.redirect(new URL(destination, request.url));
  }

  if (isProtectedPath(pathname) && !authenticated) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
