/**
 * Tests for best-effort extension logout broadcast.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/extension-bridge', () => ({
  postExtensionLogout: vi.fn(),
}));

import { postExtensionLogout } from '@/lib/extension-bridge';

import { broadcastExtensionLogout } from './extension-logout';

afterEach(() => {
  vi.mocked(postExtensionLogout).mockReset();
});

describe('broadcastExtensionLogout', () => {
  it('delegates to postExtensionLogout', async () => {
    vi.mocked(postExtensionLogout).mockResolvedValue(undefined);
    await broadcastExtensionLogout();
    expect(postExtensionLogout).toHaveBeenCalledTimes(1);
  });
});
