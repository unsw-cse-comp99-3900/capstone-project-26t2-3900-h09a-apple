const DB_NAME = 'worktrace-extension';
const DB_VERSION = 1;
const SESSION_STORE = 'sessions';

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

  await withSessionStore('readwrite', (store) =>
    requestToPromise(store.put(sessionPayload)),
  );
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
