const DB_NAME = 'worktrace-extension';
const DB_VERSION = 1;
const SESSION_STORE = 'sessions';
export const MAX_STORED_SESSIONS = 5;

let dbPromise = null;

function openDatabase() {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        db.createObjectStore(SESSION_STORE, { keyPath: 'client_session_id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      reject(new Error('Session database upgrade was blocked'));
    };
  });

  return dbPromise;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withSessionStore(mode, callback) {
  const db = await openDatabase();
  const transaction = db.transaction(SESSION_STORE, mode);
  const store = transaction.objectStore(SESSION_STORE);
  const done = new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  const result = await callback(store);

  await done;

  return result;
}

export async function saveSessionPayload(sessionPayload) {
  if (!sessionPayload?.client_session_id) {
    throw new Error('Cannot save session payload without a client_session_id');
  }

  await withSessionStore('readwrite', (store) => requestToPromise(store.put(sessionPayload)));
}

export async function listSessionPayloads() {
  return withSessionStore('readonly', (store) => requestToPromise(store.getAll()));
}

export async function deleteSessionPayload(sessionId) {
  if (!sessionId) {
    return;
  }

  await withSessionStore('readwrite', (store) => requestToPromise(store.delete(sessionId)));
}

export async function enforceSessionPayloadCap(maxSessions = MAX_STORED_SESSIONS) {
  const sessions = await listSessionPayloads();
  const overflowCount = sessions.length - maxSessions;

  if (overflowCount <= 0) {
    return [];
  }

  const evicted = [...sessions]
    .sort((left, right) => {
      const leftStoppedAt = new Date(left.stopped_at ?? left.started_at ?? 0).getTime();
      const rightStoppedAt = new Date(right.stopped_at ?? right.started_at ?? 0).getTime();
      return leftStoppedAt - rightStoppedAt;
    })
    .slice(0, overflowCount);

  await Promise.all(evicted.map((session) => deleteSessionPayload(session.client_session_id)));
  return evicted.map((session) => session.client_session_id);
}

export async function saveSessionPayloadWithCap(sessionPayload, maxSessions = MAX_STORED_SESSIONS) {
  await enforceSessionPayloadCap(Math.max(0, maxSessions - 1));
  await saveSessionPayload(sessionPayload);
}

export async function getSessionPayload(sessionId) {
  if (!sessionId) {
    return null;
  }

  return withSessionStore('readonly', (store) => requestToPromise(store.get(sessionId)));
}

export async function hasSessionPayload(sessionId) {
  return Boolean(await getSessionPayload(sessionId));
}
