import { app } from 'electron';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export const CONSENT_TERMS_VERSION = '2026-07-01';

export interface ConsentRecord {
  accepted: boolean;
  version: string;
  acceptedAt: string;
}

type ConsentStore = Record<string, ConsentRecord>;

const CONSENT_DIRECTORY = join(app.getPath('userData'), 'consent');
const CONSENT_FILE = join(CONSENT_DIRECTORY, 'consent.json');

function readStore(): ConsentStore {
  if (!existsSync(CONSENT_FILE)) {
    return {};
  }

  try {
    const text = readFileSync(CONSENT_FILE, 'utf8');
    return JSON.parse(text) as ConsentStore;
  } catch {
    return {};
  }
}

function writeStore(store: ConsentStore): void {
  mkdirSync(CONSENT_DIRECTORY, { recursive: true });

  writeFileSync(
    CONSENT_FILE,
    JSON.stringify(store, null, 2),
    'utf8',
  );
}

/**
 * Returns the stored consent for the specified user.
 */
export function loadConsent(userId: string): ConsentRecord | null {
  const store = readStore();

  return store[userId] ?? null;
}

/**
 * Persists consent for the specified user.
 */
export function saveConsent(
  userId: string,
  acceptedAt = new Date().toISOString(),
): ConsentRecord {
  const store = readStore();

  const record: ConsentRecord = {
    accepted: true,
    version: CONSENT_TERMS_VERSION,
    acceptedAt,
  };

  store[userId] = record;

  writeStore(store);

  return record;
}

/**
 * Removes the cached consent for one user.
 */
export function clearConsent(userId: string): void {
  const store = readStore();

  delete store[userId];

  writeStore(store);
}

/**
 * Whether the user already accepted the current terms.
 */
export function hasCurrentConsent(userId: string): boolean {
  const consent = loadConsent(userId);

  return (
    consent?.accepted === true &&
    consent.version === CONSENT_TERMS_VERSION
  );
}