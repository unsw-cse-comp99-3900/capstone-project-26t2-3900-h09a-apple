import Database from 'better-sqlite3';

function nullable(value) {
  return value === undefined ? null : value;
}

function parseJson(value) {
  if (!value) {
    return {};
  }

  return JSON.parse(value);
}

function ensureColumn(db, tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();

  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

export function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      client_session_id TEXT PRIMARY KEY,
      workflow_name TEXT NOT NULL,
      recorded_by TEXT,
      started_at_ms INTEGER NOT NULL,
      stopped_at_ms INTEGER,
      status TEXT NOT NULL DEFAULT 'recording',
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'user',
      layer TEXT NOT NULL DEFAULT 'desktop',
      category TEXT NOT NULL DEFAULT 'desktop',
      type TEXT NOT NULL,
      timestamp_ms INTEGER NOT NULL,
      target_selector TEXT,
      target_label TEXT,
      value TEXT,
      url TEXT,
      screenshot_id TEXT,
      is_identified INTEGER NOT NULL DEFAULT 0,
      identification_source TEXT,
      raw_x REAL,
      raw_y REAL,
      attrs_json TEXT NOT NULL DEFAULT '{}',
      created_at_ms INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(client_session_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_events_session_seq ON events(session_id, seq);
    CREATE INDEX IF NOT EXISTS idx_sessions_stopped_at ON sessions(stopped_at_ms);
  `);

  ensureColumn(db, 'events', 'source', "TEXT NOT NULL DEFAULT 'user'");
  ensureColumn(db, 'events', 'layer', "TEXT NOT NULL DEFAULT 'desktop'");
  ensureColumn(db, 'events', 'category', "TEXT NOT NULL DEFAULT 'desktop'");
}

export function openLocalBuffer(dbPath = ':memory:') {
  const db = new Database(dbPath);

  db.pragma('foreign_keys = ON');
  initSchema(db);

  return db;
}

export function saveSession(db, session) {
  const now = Date.now();

  db.prepare(
    `
      INSERT INTO sessions (
        client_session_id,
        workflow_name,
        recorded_by,
        started_at_ms,
        stopped_at_ms,
        status,
        created_at_ms,
        updated_at_ms
      )
      VALUES (
        @client_session_id,
        @workflow_name,
        @recorded_by,
        @started_at_ms,
        @stopped_at_ms,
        @status,
        @created_at_ms,
        @updated_at_ms
      )
      ON CONFLICT(client_session_id) DO UPDATE SET
        workflow_name = excluded.workflow_name,
        recorded_by = excluded.recorded_by,
        started_at_ms = excluded.started_at_ms,
        stopped_at_ms = excluded.stopped_at_ms,
        status = excluded.status,
        updated_at_ms = excluded.updated_at_ms
    `,
  ).run({
    client_session_id: session.client_session_id,
    workflow_name: session.workflow_name,
    recorded_by: nullable(session.recorded_by),
    started_at_ms: session.started_at_ms,
    stopped_at_ms: nullable(session.stopped_at_ms),
    status: session.status ?? 'recording',
    created_at_ms: session.created_at_ms ?? now,
    updated_at_ms: session.updated_at_ms ?? now,
  });
}

export function saveEvent(db, event) {
  const now = Date.now();

  db.prepare(
    `
      INSERT INTO events (
        id,
        session_id,
        seq,
        source,
        layer,
        category,
        type,
        timestamp_ms,
        target_selector,
        target_label,
        value,
        url,
        screenshot_id,
        is_identified,
        identification_source,
        raw_x,
        raw_y,
        attrs_json,
        created_at_ms
      )
      VALUES (
        @id,
        @session_id,
        @seq,
        @source,
        @layer,
        @category,
        @type,
        @timestamp_ms,
        @target_selector,
        @target_label,
        @value,
        @url,
        @screenshot_id,
        @is_identified,
        @identification_source,
        @raw_x,
        @raw_y,
        @attrs_json,
        @created_at_ms
      )
      ON CONFLICT(id) DO UPDATE SET
        session_id = excluded.session_id,
        seq = excluded.seq,
        source = excluded.source,
        layer = excluded.layer,
        category = excluded.category,
        type = excluded.type,
        timestamp_ms = excluded.timestamp_ms,
        target_selector = excluded.target_selector,
        target_label = excluded.target_label,
        value = excluded.value,
        url = excluded.url,
        screenshot_id = excluded.screenshot_id,
        is_identified = excluded.is_identified,
        identification_source = excluded.identification_source,
        raw_x = excluded.raw_x,
        raw_y = excluded.raw_y,
        attrs_json = excluded.attrs_json
    `,
  ).run({
    id: event.id,
    session_id: event.session_id,
    seq: event.seq,
    source: event.source ?? 'user',
    layer: event.layer ?? 'desktop',
    category: event.category ?? 'desktop',
    type: event.type,
    timestamp_ms: event.timestamp_ms,
    target_selector: nullable(event.target_selector),
    target_label: nullable(event.target_label),
    value: nullable(event.value),
    url: nullable(event.url),
    screenshot_id: nullable(event.screenshot_id),
    is_identified: event.is_identified ? 1 : 0,
    identification_source: nullable(event.identification_source),
    raw_x: nullable(event.raw_x),
    raw_y: nullable(event.raw_y),
    attrs_json: JSON.stringify(event.attrs ?? {}),
    created_at_ms: event.created_at_ms ?? now,
  });
}

export function getSessionWithEvents(db, sessionId) {
  const session = db.prepare('SELECT * FROM sessions WHERE client_session_id = ?').get(sessionId);

  if (!session) {
    return null;
  }

  const events = db
    .prepare('SELECT * FROM events WHERE session_id = ? ORDER BY seq ASC, timestamp_ms ASC')
    .all(sessionId)
    .map((event) => ({
      ...event,
      is_identified: Boolean(event.is_identified),
      attrs: parseJson(event.attrs_json),
    }));

  return {
    session,
    events,
  };
}

export function deleteSession(db, sessionId) {
  return db.prepare('DELETE FROM sessions WHERE client_session_id = ?').run(sessionId).changes;
}

export function evictStoppedSessions(db, { maxStoppedSessions }) {
  if (maxStoppedSessions < 0) {
    throw new Error('maxStoppedSessions must be greater than or equal to 0');
  }

  const sessionsToDelete = db
    .prepare(
      `
        SELECT client_session_id
        FROM sessions
        WHERE stopped_at_ms IS NOT NULL
        ORDER BY stopped_at_ms DESC
        LIMIT -1 OFFSET ?
      `,
    )
    .all(maxStoppedSessions);

  const deleteStatement = db.prepare('DELETE FROM sessions WHERE client_session_id = ?');

  const deleteMany = db.transaction((sessions) => {
    for (const session of sessions) {
      deleteStatement.run(session.client_session_id);
    }
  });

  deleteMany(sessionsToDelete);

  return sessionsToDelete.length;
}
