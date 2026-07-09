const PROTECTED_PREFIXES = ['/library', '/review', '/dashboard', '/session', '/sop'] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
