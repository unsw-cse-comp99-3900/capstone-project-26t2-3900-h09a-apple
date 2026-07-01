const DB_NAME = 'worktrace-extension-db';
const DB_VERSION = 1;
const STORE_NAME = 'keyValue';

const ACTIVE_EVENTS_KEY = 'activeSessionEvents';
const ACTIVE_SCREENSHOTS_KEY = 'activeSessionScreenshots';

let dbPromise;

function openLocalDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  return dbPromise;
}

async function withStore(mode, callback) {
  const db = await openLocalDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = callback(store);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

export function getLocalValue(key) {
  return withStore('readonly', (store) => store.get(key));
}

export function setLocalValue(key, value) {
  return withStore('readwrite', (store) => store.put(value, key));
}

export function deleteLocalValue(key) {
  return withStore('readwrite', (store) => store.delete(key));
}

export async function getActiveSessionBuffers() {
  const [eventBuffer, screenshots] = await Promise.all([
    getLocalValue(ACTIVE_EVENTS_KEY),
    getLocalValue(ACTIVE_SCREENSHOTS_KEY),
  ]);

  return {
    eventBuffer: Array.isArray(eventBuffer) ? eventBuffer : [],
    screenshots: Array.isArray(screenshots) ? screenshots : [],
  };
}

export async function saveActiveSessionBuffers({ eventBuffer, screenshots }) {
  await Promise.all([
    setLocalValue(ACTIVE_EVENTS_KEY, eventBuffer),
    setLocalValue(ACTIVE_SCREENSHOTS_KEY, screenshots),
  ]);
}

export async function clearActiveSessionBuffers() {
  await Promise.all([
    deleteLocalValue(ACTIVE_EVENTS_KEY),
    deleteLocalValue(ACTIVE_SCREENSHOTS_KEY),
  ]);
}

export function sessionPayloadKey(sessionId) {
  return `sessionPayload:${sessionId}`;
}

export function saveSessionPayload(sessionId, payload) {
  return setLocalValue(sessionPayloadKey(sessionId), payload);
}

export function getSessionPayload(sessionId) {
  return getLocalValue(sessionPayloadKey(sessionId));
}
