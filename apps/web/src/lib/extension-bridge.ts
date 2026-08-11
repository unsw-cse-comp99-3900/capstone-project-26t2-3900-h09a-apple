/**
 * chrome.runtime messaging helpers for the fixed-ID WorkTrace extension.
 *
 * Used for login handoff, walkthrough start, and presence pings from the web app.
 */

import { getExtensionId } from '@/lib/extension-config';

export const EXTENSION_MESSAGE_TYPES = {
  ping: 'EXTENSION_PING',
  handoff: 'EXTENSION_HANDOFF',
  logout: 'EXTENSION_LOGOUT',
  sessionSubmitted: 'SESSION_SUBMITTED',
  startWalkthrough: 'START_WALKTHROUGH',
} as const;

const DEFAULT_PING_TIMEOUT_MS = 1500;

type ExtensionRuntimeResponse = {
  ok?: boolean;
  present?: boolean;
  requestId?: string;
  error?: string;
};

type ChromeRuntime = {
  sendMessage: (
    extensionId: string,
    message: unknown,
    responseCallback?: (response: ExtensionRuntimeResponse) => void,
  ) => void;
  lastError?: { message?: string };
};

function getChromeRuntime(): ChromeRuntime | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const runtime = (window as Window & { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime;
  if (!runtime || typeof runtime.sendMessage !== 'function') {
    return null;
  }

  return runtime;
}

function sendExtensionMessage(message: unknown): Promise<ExtensionRuntimeResponse | null> {
  return new Promise((resolve) => {
    const runtime = getChromeRuntime();
    const extensionId = getExtensionId();

    if (!runtime || !extensionId) {
      resolve(null);
      return;
    }

    try {
      runtime.sendMessage(extensionId, message, (response) => {
        if (runtime.lastError) {
          resolve(null);
          return;
        }

        resolve(response ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

/** Probe whether the installed extension responds to EXTENSION_PING. */
export function pingExtension(timeoutMs = DEFAULT_PING_TIMEOUT_MS): Promise<boolean> {
  if (typeof window === 'undefined' || !getExtensionId()) {
    return Promise.resolve(false);
  }

  const requestId = crypto.randomUUID();

  return Promise.race([
    new Promise<boolean>((resolve) => {
      window.setTimeout(() => resolve(false), timeoutMs);
    }),
    sendExtensionMessage({
      type: EXTENSION_MESSAGE_TYPES.ping,
      requestId,
    }).then((response) =>
      Boolean(response?.ok && response.present && response.requestId === requestId),
    ),
  ]);
}

/** Send a one-time handoff code to the extension for token redeem. */
export async function postExtensionHandoff(code: string): Promise<void> {
  await sendExtensionMessage({
    type: EXTENSION_MESSAGE_TYPES.handoff,
    requestId: crypto.randomUUID(),
    code,
  });
}

/** Ask the extension to clear stored auth tokens. */
export async function postExtensionLogout(): Promise<void> {
  await sendExtensionMessage({
    type: EXTENSION_MESSAGE_TYPES.logout,
    requestId: crypto.randomUUID(),
  });
}

/** Notify the extension that a session was submitted so local cache can drop. */
export async function postExtensionSessionSubmitted(sessionId: string): Promise<void> {
  await sendExtensionMessage({
    type: EXTENSION_MESSAGE_TYPES.sessionSubmitted,
    requestId: crypto.randomUUID(),
    sessionId,
  });
}

/** Ask the extension to start walkthrough playback for a SOP. */
export async function postExtensionStartWalkthrough(sopId: string): Promise<void> {
  const response = await sendExtensionMessage({
    type: EXTENSION_MESSAGE_TYPES.startWalkthrough,
    requestId: crypto.randomUUID(),
    sopId,
  });

  if (!response) {
    throw new Error('Install or enable the WorkTrace extension to start walkthroughs.');
  }

  if (!response.ok) {
    throw new Error(response.error ?? 'The WorkTrace extension could not start this walkthrough.');
  }
}
