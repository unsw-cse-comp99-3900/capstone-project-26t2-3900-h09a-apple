import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import 'fake-indexeddb/auto';
import {
  deleteSessionPayload,
  enforceSessionPayloadCap,
  getSessionPayload,
  listSessionPayloads,
  saveSessionPayload,
  saveSessionPayloadWithCap,
} from './session-store.js';

function sessionPayload(id, stoppedAt) {
  return {
    client_session_id: id,
    workflow_name: `Workflow ${id}`,
    started_at: new Date(1000).toISOString(),
    stopped_at: new Date(stoppedAt).toISOString(),
    event_count: 0,
    events: [],
    screenshots: [],
  };
}

beforeEach(async () => {
  const sessions = await listSessionPayloads();
  await Promise.all(sessions.map((session) => deleteSessionPayload(session.client_session_id)));
});

test('deleteSessionPayload removes a submitted session from IndexedDB', async () => {
  await saveSessionPayload(sessionPayload('submitted-session', 2000));

  assert.ok(await getSessionPayload('submitted-session'));

  await deleteSessionPayload('submitted-session');

  assert.equal(await getSessionPayload('submitted-session'), undefined);
});

test('saveSessionPayloadWithCap evicts oldest sessions before writing a new one', async () => {
  await saveSessionPayload(sessionPayload('oldest', 1000));
  await saveSessionPayload(sessionPayload('middle', 2000));
  await saveSessionPayload(sessionPayload('newest', 3000));

  await saveSessionPayloadWithCap(sessionPayload('incoming', 4000), 3);

  const ids = (await listSessionPayloads()).map((session) => session.client_session_id).sort();

  assert.deepEqual(ids, ['incoming', 'middle', 'newest']);
});

test('enforceSessionPayloadCap evicts oldest retained sessions', async () => {
  await saveSessionPayload(sessionPayload('one', 1000));
  await saveSessionPayload(sessionPayload('two', 2000));
  await saveSessionPayload(sessionPayload('three', 3000));
  await saveSessionPayload(sessionPayload('four', 4000));

  const evicted = await enforceSessionPayloadCap(2);

  assert.deepEqual(evicted, ['one', 'two']);
  assert.deepEqual(
    (await listSessionPayloads()).map((session) => session.client_session_id).sort(),
    ['four', 'three'],
  );
});
