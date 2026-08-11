'use client';

/**
 * Authenticated app segment layout wrapping pages in AppShell.
 */

import type { ReactNode } from 'react';

import { AppShell } from '@/components/shell/app-shell';

export default function AppShellLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
