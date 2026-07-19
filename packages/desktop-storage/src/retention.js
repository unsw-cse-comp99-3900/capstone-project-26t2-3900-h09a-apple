import { isSensitiveRetentionCategory } from './capture-policy.js';

export const DEFAULT_MAX_STOPPED_SESSIONS = 5;

const PURGED_ATTRS_MARKER = {
  purged: true,
  reason: 'post_submit_sensitive_retention',
};

function parseJson(value) {
  if (!value) {
    return {};
  }

  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export function purgeSensitiveEventContent(db, sessionId, { purgedAtMs = Date.now() } = {}) {
  const rows = db
    .prepare(
      `
        SELECT id, category, type, value, attrs_json
        FROM events
        WHERE session_id = ?
      `,
    )
    .all(sessionId);

  const update = db.prepare(
    `
      UPDATE events
      SET value = NULL, attrs_json = ?
      WHERE id = ?
    `,
  );

  let purged = 0;

  const run = db.transaction(() => {
    for (const row of rows) {
      const event = {
        category: row.category,
        type: row.type,
        value: row.value,
        attrs: parseJson(row.attrs_json),
      };

      if (!isSensitiveRetentionCategory(event)) {
        continue;
      }

      update.run(
        JSON.stringify({
          ...PURGED_ATTRS_MARKER,
          purged_at_ms: purgedAtMs,
          category: row.category,
          type: row.type,
        }),
        row.id,
      );
      purged += 1;
    }
  });

  run();

  return purged;
}

export function markSessionSubmitted(db, sessionId, { submittedAtMs = Date.now() } = {}) {
  const session = db
    .prepare('SELECT client_session_id, status FROM sessions WHERE client_session_id = ?')
    .get(sessionId);

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  db.prepare(
    `
      UPDATE sessions
      SET status = 'submitted',
          submitted_at_ms = ?,
          updated_at_ms = ?
      WHERE client_session_id = ?
    `,
  ).run(submittedAtMs, submittedAtMs, sessionId);

  const purged = purgeSensitiveEventContent(db, sessionId, { purgedAtMs: submittedAtMs });

  return { sessionId, submittedAtMs, purgedEventCount: purged };
}
