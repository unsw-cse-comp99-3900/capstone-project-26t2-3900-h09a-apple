export const ALLOWED_EXTERNAL_ORIGINS = new Set(['http://localhost:3000', 'http://127.0.0.1:3000']);

export function isAllowedExternalOrigin(origin) {
  return Boolean(origin && ALLOWED_EXTERNAL_ORIGINS.has(origin));
}

export function handleExternalAuthMessage(message, sender, sendResponse, handlers) {
  if (!isAllowedExternalOrigin(sender?.origin)) {
    sendResponse({ ok: false, error: 'Unauthorized origin' });
    return false;
  }

  if (message.type === 'EXTENSION_PING') {
    sendResponse({
      ok: true,
      present: true,
      requestId: message.requestId,
    });
    return false;
  }

  if (message.type === 'EXTENSION_HANDOFF') {
    handlers
      .redeemHandoffCode(message.code)
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to redeem handoff code',
        });
      });

    return true;
  }

  if (message.type === 'EXTENSION_LOGOUT') {
    handlers
      .clearStoredAuthTokens()
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to clear extension auth',
        });
      });

    return true;
  }

  sendResponse({ ok: false, error: 'Unknown message type' });
  return false;
}
