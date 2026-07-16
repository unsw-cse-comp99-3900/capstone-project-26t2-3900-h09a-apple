import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assembleSessionFromRows,
  deleteSession,
  evictStoppedSessions,
  getSessionWithEvents,
  openLocalBuffer,
  saveEvent,
  saveSession,
} from '../src/index.js';

const BASE_TIME_MS = Date.UTC(2026, 0, 1, 10, 0, 0);
const RECORDED_BY_USER_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_SCREENSHOT_ID = '88888888-8888-4888-8888-888888888888';

function makeSession(overrides = {}) {
  return {
    client_session_id: 'desktop-session-1',
    workflow_name: 'Desktop onboarding workflow',
    recorded_by: RECORDED_BY_USER_ID,
    started_at_ms: BASE_TIME_MS,
    stopped_at_ms: BASE_TIME_MS + 60_000,
    status: 'completed',
    ...overrides,
  };
}

function makeEvent(overrides = {}) {
  return {
    id: `event-${overrides.seq}`,
    session_id: 'desktop-session-1',
    seq: overrides.seq,
    source: 'user',
    layer: 'desktop',
    category: 'mouse',
    type: 'click',
    timestamp_ms: BASE_TIME_MS + overrides.seq * 1_000,
    target_selector: null,
    target_label: null,
    value: null,
    url: null,
    screenshot_id: null,
    is_identified: true,
    identification_source: 'accessibility_api',
    raw_x: null,
    raw_y: null,
    attrs: {},
    ...overrides,
  };
}

test('stores, reads, and assembles a completed desktop session', () => {
  const db = openLocalBuffer();

  saveSession(db, makeSession());

  const events = [
    makeEvent({
      seq: 1,
      category: 'mouse',
      type: 'click',
      target_label: 'Start',
      target_selector: 'button[name="Start"]',
    }),
    makeEvent({
      seq: 2,
      category: 'keyboard',
      type: 'input',
      value: 'Jane Doe',
      target_label: 'Name',
    }),
    makeEvent({
      seq: 3,
      source: 'app',
      layer: 'browser',
      category: 'navigation',
      type: 'navigation',
      url: 'https://example.com/profile',
    }),
    makeEvent({
      seq: 4,
      category: 'mouse',
      type: 'click',
      target_label: 'Continue',
      identification_source: 'ocr',
    }),
    makeEvent({
      seq: 5,
      category: 'mouse',
      type: 'click',
      target_label: null,
      target_selector: null,
      is_identified: false,
      identification_source: null,
      raw_x: 412,
      raw_y: 238,
    }),
    makeEvent({
      seq: 6,
      category: 'keyboard',
      type: 'input',
      value: 'manager@example.com',
      identification_source: 'accessibility_api',
    }),
    makeEvent({
      seq: 7,
      source: 'app',
      layer: 'browser',
      category: 'tab',
      type: 'tab_switch',
      attrs: { tab_title: 'Review' },
    }),
    makeEvent({
      seq: 8,
      category: 'mouse',
      type: 'click',
      target_label: 'Submit',
      screenshot_id: EVENT_SCREENSHOT_ID,
    }),
    makeEvent({
      seq: 9,
      source: 'system',
      layer: 'desktop',
      category: 'window',
      type: 'navigation',
      attrs: { window_title: 'Confirmation' },
    }),
    makeEvent({
      seq: 10,
      category: 'mouse',
      type: 'click',
      target_label: 'Done',
      target_selector: 'button[name="Done"]',
      identification_source: 'ocr',
    }),
    makeEvent({
      seq: 11,
      category: 'mouse',
      type: 'click',
      target_label: 'Done',
      target_selector: 'button[name="Done"]',
      identification_source: 'ocr',
    }),
  ];

  for (const event of events) {
    saveEvent(db, event);
  }

  const stored = getSessionWithEvents(db, 'desktop-session-1');

  assert.equal(stored.session.client_session_id, 'desktop-session-1');
  assert.equal(stored.events.length, 11);
  assert.equal(stored.events[0].source, 'user');
  assert.equal(stored.events[0].layer, 'desktop');
  assert.equal(stored.events[0].category, 'mouse');

  const unidentifiedEvent = stored.events.find((event) => event.seq === 5);

  assert.equal(unidentifiedEvent.is_identified, false);
  assert.equal(unidentifiedEvent.identification_source, 'unidentified');
  assert.equal(unidentifiedEvent.raw_x, 412);
  assert.equal(unidentifiedEvent.raw_y, 238);

  const payload = assembleSessionFromRows(stored);

  assert.equal(payload.client_session_id, 'desktop-session-1');
  assert.equal(payload.workflow_name, 'Desktop onboarding workflow');
  assert.equal(payload.recorded_by, RECORDED_BY_USER_ID);
  assert.equal(payload.events.length, 11);
  assert.equal(payload.events[0].type, 'click');
  assert.equal(payload.events[0].attrs.source, 'user');
  assert.equal(payload.events[0].attrs.layer, 'desktop');
  assert.equal(payload.events[0].attrs.category, 'mouse');
  assert.equal(payload.events[4].attrs.is_identified, false);
  assert.deepEqual(payload.events[4].attrs.raw_coordinates, {
    x: 412,
    y: 238,
  });
  assert.equal(payload.events[7].screenshot_id, null);
  assert.equal(payload.events[10].target_label, 'Done');
  assert.equal(payload.events[10].timestamp_ms, BASE_TIME_MS + 11_000);
  assert.deepEqual(payload.screenshots, []);

  db.close();
});

test('normalizes non-uuid recorded_by values to null during assembly', () => {
  const db = openLocalBuffer();

  saveSession(db, makeSession({ recorded_by: 'employee@example.com' }));
  saveEvent(db, makeEvent({ seq: 1 }));

  const payload = assembleSessionFromRows(getSessionWithEvents(db, 'desktop-session-1'));

  assert.equal(payload.recorded_by, null);

  db.close();
});

test('rejects unsupported identification_source values', () => {
  const db = openLocalBuffer();

  saveSession(db, makeSession());

  assert.throws(
    () =>
      saveEvent(
        db,
        makeEvent({
          seq: 1,
          identification_source: 'bad_source',
        }),
      ),
    /Invalid identification_source/,
  );

  db.close();
});

test('falls back to empty attrs when attrs_json is corrupt', () => {
  const db = openLocalBuffer();

  saveSession(db, makeSession());
  saveEvent(db, makeEvent({ seq: 1, attrs: { ok: true } }));

  db.prepare('UPDATE events SET attrs_json = ? WHERE id = ?').run('{bad json', 'event-1');

  const stored = getSessionWithEvents(db, 'desktop-session-1');

  assert.deepEqual(stored.events[0].attrs, {});

  db.close();
});

test('rejects duplicate seq values in the same session', () => {
  const db = openLocalBuffer();

  saveSession(db, makeSession());
  saveEvent(db, makeEvent({ id: 'event-1', seq: 1 }));

  assert.throws(() => saveEvent(db, makeEvent({ id: 'event-2', seq: 1 })));

  db.close();
});

test('deletes a session and cascades its events', () => {
  const db = openLocalBuffer();

  saveSession(db, makeSession());
  saveEvent(db, makeEvent({ seq: 1 }));

  assert.equal(deleteSession(db, 'desktop-session-1'), 1);
  assert.equal(getSessionWithEvents(db, 'desktop-session-1'), null);

  const eventCount = db.prepare('SELECT COUNT(*) AS count FROM events').get().count;

  assert.equal(eventCount, 0);

  db.close();
});

test('evicts oldest stopped sessions without deleting active recordings', () => {
  const db = openLocalBuffer();

  saveSession(
    db,
    makeSession({
      client_session_id: 'old-stopped',
      stopped_at_ms: BASE_TIME_MS + 1_000,
    }),
  );
  saveSession(
    db,
    makeSession({
      client_session_id: 'new-stopped',
      stopped_at_ms: BASE_TIME_MS + 2_000,
    }),
  );
  saveSession(
    db,
    makeSession({
      client_session_id: 'active-recording',
      stopped_at_ms: null,
      status: 'recording',
    }),
  );

  assert.equal(evictStoppedSessions(db, { maxStoppedSessions: 1 }), 1);
  assert.equal(getSessionWithEvents(db, 'old-stopped'), null);
  assert.notEqual(getSessionWithEvents(db, 'new-stopped'), null);
  assert.notEqual(getSessionWithEvents(db, 'active-recording'), null);

  db.close();
});
