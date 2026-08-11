/**
 * Server-side fetch helper that talks to the FastAPI base URL.
 */

import { backendBaseUrl } from '@/lib/auth/constants';

export async function backendFetch(path: string, init?: RequestInit): Promise<Response> {
  const trimmed = path.startsWith('/') ? path : `/${path}`;
  return fetch(`${backendBaseUrl()}${trimmed}`, init);
}
