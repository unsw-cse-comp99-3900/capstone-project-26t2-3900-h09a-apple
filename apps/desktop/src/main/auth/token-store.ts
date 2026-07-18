import { app, safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface StoredAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
  userId: string;
}

const AUTH_DIRECTORY = join(app.getPath('userData'), 'auth');
const AUTH_FILE = join(AUTH_DIRECTORY, 'tokens.dat');

/**
 * Persist encrypted authentication tokens to disk.
 *
 * Tokens are encrypted using Electron's safeStorage API before being written.
 * They should never be stored in SQLite or plaintext configuration files.
 */
export function saveTokens(tokens: StoredAuthTokens): void {
  mkdirSync(AUTH_DIRECTORY, { recursive: true });

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS secure storage is unavailable');
  }

  const encrypted = safeStorage.encryptString(JSON.stringify(tokens));

  writeFileSync(AUTH_FILE, encrypted);
}

/**
 * Read and decrypt stored authentication tokens.
 *
 * Returns null when no authentication state exists.
 */
export function loadTokens(): StoredAuthTokens | null {
  if (!existsSync(AUTH_FILE)) {
    return null;
  }

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS secure storage is unavailable');
  }

  const encrypted = readFileSync(AUTH_FILE);
  const decrypted = safeStorage.decryptString(encrypted);

  return JSON.parse(decrypted) as StoredAuthTokens;
}

/**
 * Remove all locally stored authentication credentials.
 */
export function clearTokens(): void {
  if (existsSync(AUTH_FILE)) {
    rmSync(AUTH_FILE);
  }
}

/**
 * Convenience helper used by the renderer/main process to determine whether
 * the desktop client is currently authenticated.
 */
export function hasTokens(): boolean {
  return loadTokens() !== null;
}