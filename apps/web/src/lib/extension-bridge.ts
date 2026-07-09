export const WORKTRACE_WEB_MESSAGE_SOURCE = 'worktrace-web';
export const WORKTRACE_EXTENSION_MESSAGE_SOURCE = 'worktrace-extension';

export const EXTENSION_MESSAGE_TYPES = {
  ping: 'EXTENSION_PING',
  pingResult: 'EXTENSION_PING_RESULT',
  handoff: 'EXTENSION_HANDOFF',
  logout: 'EXTENSION_LOGOUT',
} as const;

const DEFAULT_PING_TIMEOUT_MS = 1500;

export function pingExtension(timeoutMs = DEFAULT_PING_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve(false);
      return;
    }

    const requestId = crypto.randomUUID();
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', handleMessage);
      resolve(false);
    }, timeoutMs);

    function handleMessage(event: MessageEvent) {
      if (event.source !== window || event.data?.source !== WORKTRACE_EXTENSION_MESSAGE_SOURCE) {
        return;
      }

      if (
        event.data.type !== EXTENSION_MESSAGE_TYPES.pingResult ||
        event.data.requestId !== requestId
      ) {
        return;
      }

      window.clearTimeout(timeout);
      window.removeEventListener('message', handleMessage);
      resolve(Boolean(event.data.present));
    }

    window.addEventListener('message', handleMessage);
    window.postMessage(
      {
        source: WORKTRACE_WEB_MESSAGE_SOURCE,
        type: EXTENSION_MESSAGE_TYPES.ping,
        requestId,
      },
      window.location.origin,
    );
  });
}

export function postExtensionHandoff(code: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.postMessage(
    {
      source: WORKTRACE_WEB_MESSAGE_SOURCE,
      type: EXTENSION_MESSAGE_TYPES.handoff,
      requestId: crypto.randomUUID(),
      code,
    },
    window.location.origin,
  );
}

export function postExtensionLogout(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.postMessage(
    {
      source: WORKTRACE_WEB_MESSAGE_SOURCE,
      type: EXTENSION_MESSAGE_TYPES.logout,
      requestId: crypto.randomUUID(),
    },
    window.location.origin,
  );
}
