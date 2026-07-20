import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const EXTENSION_ID = 'abcdefghijklmnopqrstuvwxyzabcd';

function createWindowStub(chrome: unknown) {
  return {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    chrome,
  };
}

describe('extension bridge', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_EXTENSION_ID', EXTENSION_ID);
    vi.stubGlobal('window', createWindowStub(undefined));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('returns false when chrome runtime is unavailable', async () => {
    const { pingExtension } = await import('@/lib/extension-bridge');
    await expect(pingExtension()).resolves.toBe(false);
  });

  it('pings the configured extension through chrome.runtime.sendMessage', async () => {
    const sendMessage = vi.fn((_extensionId, message, callback) => {
      callback({
        ok: true,
        present: true,
        requestId: message.requestId,
      });
    });

    vi.stubGlobal(
      'window',
      createWindowStub({
        runtime: {
          sendMessage,
        },
      }),
    );

    const { pingExtension } = await import('@/lib/extension-bridge');
    await expect(pingExtension()).resolves.toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(
      EXTENSION_ID,
      expect.objectContaining({ type: 'EXTENSION_PING', requestId: expect.any(String) }),
      expect.any(Function),
    );
  });

  it('sends handoff codes through chrome.runtime.sendMessage', async () => {
    const sendMessage = vi.fn((_extensionId, _message, callback) => {
      callback({ ok: true });
    });

    vi.stubGlobal(
      'window',
      createWindowStub({
        runtime: {
          sendMessage,
        },
      }),
    );

    const { postExtensionHandoff } = await import('@/lib/extension-bridge');
    await postExtensionHandoff('handoff-code');

    expect(sendMessage).toHaveBeenCalledWith(
      EXTENSION_ID,
      expect.objectContaining({ type: 'EXTENSION_HANDOFF', code: 'handoff-code' }),
      expect.any(Function),
    );
  });

  it('sends submitted session ids through chrome.runtime.sendMessage', async () => {
    const sendMessage = vi.fn((_extensionId, _message, callback) => {
      callback({ ok: true });
    });

    vi.stubGlobal(
      'window',
      createWindowStub({
        runtime: {
          sendMessage,
        },
      }),
    );

    const { postExtensionSessionSubmitted } = await import('@/lib/extension-bridge');
    await postExtensionSessionSubmitted('session-123');

    expect(sendMessage).toHaveBeenCalledWith(
      EXTENSION_ID,
      expect.objectContaining({ type: 'SESSION_SUBMITTED', sessionId: 'session-123' }),
      expect.any(Function),
    );
  });

  it('sends start walkthrough requests through chrome.runtime.sendMessage', async () => {
    const sendMessage = vi.fn((_extensionId, _message, callback) => {
      callback({ ok: true });
    });

    vi.stubGlobal(
      'window',
      createWindowStub({
        runtime: {
          sendMessage,
        },
      }),
    );

    const { postExtensionStartWalkthrough } = await import('@/lib/extension-bridge');
    await postExtensionStartWalkthrough('sop-123');

    expect(sendMessage).toHaveBeenCalledWith(
      EXTENSION_ID,
      expect.objectContaining({ type: 'START_WALKTHROUGH', sopId: 'sop-123' }),
      expect.any(Function),
    );
  });

  it('rejects start walkthrough requests when extension is unavailable', async () => {
    const { postExtensionStartWalkthrough } = await import('@/lib/extension-bridge');

    await expect(postExtensionStartWalkthrough('sop-123')).rejects.toThrow(
      'Install or enable the WorkTrace extension',
    );
  });
});
