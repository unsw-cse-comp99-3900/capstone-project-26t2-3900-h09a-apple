/**
 * Tests for web-to-extension / desktop handoff broadcast.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/extension-bridge', () => ({
  pingExtension: vi.fn(),
  postExtensionHandoff: vi.fn(),
}));

vi.mock('@/lib/desktop-bridge', () => ({
  pingDesktop: vi.fn(),
  launchDesktopHandoff: vi.fn(),
}));

import { launchDesktopHandoff, pingDesktop } from '@/lib/desktop-bridge';
import { pingExtension, postExtensionHandoff } from '@/lib/extension-bridge';

import { broadcastExtensionHandoff } from './extension-handoff';

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(pingExtension).mockReset();
  vi.mocked(pingDesktop).mockReset();
  vi.mocked(postExtensionHandoff).mockReset();
  vi.mocked(launchDesktopHandoff).mockReset();
});

describe('broadcastExtensionHandoff', () => {
  it('no-ops when neither extension nor desktop is present', async () => {
    vi.mocked(pingExtension).mockResolvedValue(false);
    vi.mocked(pingDesktop).mockResolvedValue(false);
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await broadcastExtensionHandoff();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(postExtensionHandoff).not.toHaveBeenCalled();
    expect(launchDesktopHandoff).not.toHaveBeenCalled();
  });

  it('mints a code and posts it to the extension when present', async () => {
    vi.mocked(pingExtension).mockResolvedValue(true);
    vi.mocked(pingDesktop).mockResolvedValue(false);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 'handoff-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await broadcastExtensionHandoff();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/auth/extension-handoff',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(postExtensionHandoff).toHaveBeenCalledWith('handoff-1');
  });

  it('launches a desktop deep-link when the companion is present', async () => {
    vi.mocked(pingExtension).mockResolvedValue(false);
    vi.mocked(pingDesktop).mockResolvedValue(true);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 'desktop-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await broadcastExtensionHandoff();

    expect(launchDesktopHandoff).toHaveBeenCalledWith('desktop-1');
  });
});
