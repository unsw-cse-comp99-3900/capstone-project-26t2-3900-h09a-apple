import { API_BASE_URL } from './config.js';

export const AUTH_STORAGE_KEYS = {
  accessToken: 'authAccessToken',
  refreshToken: 'authRefreshToken',
  expiresAt: 'authExpiresAt',
  userId: 'authUserId',
  email: 'authEmail',
  displayName: 'authDisplayName',
};

function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });
}

function storageSet(items) {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, resolve);
  });
}

function storageRemove(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.remove(keys, resolve);
  });
}

export async function getStoredAuthTokens() {
  const result = await storageGet(Object.values(AUTH_STORAGE_KEYS));
  return {
    accessToken: result[AUTH_STORAGE_KEYS.accessToken] ?? null,
    refreshToken: result[AUTH_STORAGE_KEYS.refreshToken] ?? null,
    expiresAt: result[AUTH_STORAGE_KEYS.expiresAt] ?? null,
    userId: result[AUTH_STORAGE_KEYS.userId] ?? null,
    email: result[AUTH_STORAGE_KEYS.email] ?? null,
    displayName: result[AUTH_STORAGE_KEYS.displayName] ?? null,
  };
}

export async function setStoredAuthTokens(accessToken, refreshToken, expiresIn, userId) {
  const expiresAt = Date.now() + expiresIn * 1000;
  await storageSet({
    [AUTH_STORAGE_KEYS.accessToken]: accessToken,
    [AUTH_STORAGE_KEYS.refreshToken]: refreshToken,
    [AUTH_STORAGE_KEYS.expiresAt]: expiresAt,
    [AUTH_STORAGE_KEYS.userId]: userId,
  });
}

export async function clearStoredAuthTokens() {
  await storageRemove(Object.values(AUTH_STORAGE_KEYS));
}

export async function hasStoredAuthTokens() {
  const tokens = await getStoredAuthTokens();
  return Boolean(tokens.accessToken && tokens.refreshToken);
}

function authUrl(path) {
  const trimmed = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL.replace(/\/$/, '')}${trimmed}`;
}

export async function redeemHandoffCode(code) {
  const response = await fetch(authUrl('/api/v1/auth/extension-handoff/redeem'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });

  if (!response.ok) {
    throw new Error('Failed to redeem extension handoff code');
  }

  const payload = await response.json();
  await setStoredAuthTokens(
    payload.access_token,
    payload.refresh_token,
    payload.expires_in,
    payload.user_id,
  );
  try {
    await refreshStoredUserProfile();
  } catch {
    // Profile is best-effort; tokens alone are enough to start recording.
  }
  return payload;
}

function displayNameFromEmail(email) {
  const local = String(email || '').split('@')[0] || 'User';
  return local
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .trim();
}

export async function setStoredUserProfile({ email, displayName }) {
  await storageSet({
    [AUTH_STORAGE_KEYS.email]: email ?? null,
    [AUTH_STORAGE_KEYS.displayName]: displayName ?? null,
  });
}

export async function getStoredUserProfile() {
  const tokens = await getStoredAuthTokens();
  return {
    email: tokens.email,
    displayName: tokens.displayName,
    userId: tokens.userId,
  };
}

/** Fetch GET /api/v1/auth/me and cache email/displayName for popup + walkthrough UI. */
export async function refreshStoredUserProfile() {
  const response = await authenticatedFetch('/api/v1/auth/me');
  if (!response.ok) {
    throw new Error('Failed to load extension user profile');
  }
  const body = await response.json();
  const email = typeof body.email === 'string' ? body.email : null;
  const displayName =
    (typeof body.display_name === 'string' && body.display_name.trim()) ||
    (email ? displayNameFromEmail(email) : null);
  await setStoredUserProfile({ email, displayName });
  return { email, displayName, userId: body.id ?? null, role: body.role ?? null };
}

async function refreshAccessToken(refreshToken) {
  const response = await fetch(authUrl('/api/v1/auth/refresh'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!response.ok) {
    throw new Error('Failed to refresh access token');
  }

  const payload = await response.json();
  await storageSet({
    [AUTH_STORAGE_KEYS.accessToken]: payload.access_token,
    [AUTH_STORAGE_KEYS.expiresAt]: Date.now() + payload.expires_in * 1000,
  });
  return payload.access_token;
}

export async function authenticatedFetch(path, init = {}) {
  const tokens = await getStoredAuthTokens();
  if (!tokens.accessToken) {
    throw new Error('Extension is not authenticated');
  }

  const trimmed = path.startsWith('/') ? path : `/${path}`;
  const url = `${API_BASE_URL.replace(/\/$/, '')}${trimmed}`;
  const headers = new Headers(init.headers ?? {});
  headers.set('Authorization', `Bearer ${tokens.accessToken}`);

  let response = await fetch(url, {
    ...init,
    headers,
  });

  if (response.status !== 401 || !tokens.refreshToken) {
    return response;
  }

  try {
    const nextAccessToken = await refreshAccessToken(tokens.refreshToken);
    headers.set('Authorization', `Bearer ${nextAccessToken}`);
    response = await fetch(url, {
      ...init,
      headers,
    });
  } catch {
    await clearStoredAuthTokens();
    throw new Error('Extension session expired');
  }

  return response;
}
