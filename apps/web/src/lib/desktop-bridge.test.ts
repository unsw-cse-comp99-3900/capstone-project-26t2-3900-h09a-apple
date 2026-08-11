/**
 * Tests for optional desktop companion bridge stubs.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { launchDesktopHandoff, pingDesktop } from './desktop-bridge';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('pingDesktop', () => {
  it('returns true when the companion responds ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    await expect(pingDesktop()).resolves.toBe(true);
  });

  it('returns false when the companion is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await expect(pingDesktop()).resolves.toBe(false);
  });
});

describe('launchDesktopHandoff', () => {
  it('sets the worktrace deep-link on window.location', () => {
    const location = { href: '' };
    vi.stubGlobal('window', { location });
    launchDesktopHandoff('abc 123');
    expect(location.href).toBe('worktrace://auth-callback?code=abc%20123');
  });
});
