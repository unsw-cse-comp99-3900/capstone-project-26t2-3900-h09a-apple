import assert from 'node:assert/strict';
import test from 'node:test';

import { serializeFrictionEvents } from './walkthrough-completion.js';

test('serializes friction event millisecond timestamps as ISO-8601 strings', () => {
  const events = [
    {
      step_number: 1,
      event_type: 'miss',
      occurred_at: 1_753_668_123_456,
    },
  ];

  const serialized = serializeFrictionEvents(events);

  assert.deepEqual(serialized, [
    {
      step_number: 1,
      event_type: 'miss',
      occurred_at: '2025-07-28T02:02:03.456Z',
    },
  ]);
  assert.equal(events[0].occurred_at, 1_753_668_123_456);
});

test('preserves existing ISO timestamps and events without usable numeric timestamps', () => {
  const existingIso = {
    step_number: 1,
    event_type: 'miss',
    occurred_at: '2026-07-28T00:00:00.000Z',
  };
  const invalidNumericTimestamp = {
    step_number: 2,
    event_type: 'retry',
    occurred_at: Number.POSITIVE_INFINITY,
  };

  const serialized = serializeFrictionEvents([existingIso, invalidNumericTimestamp, null]);

  assert.deepEqual(serialized, [existingIso, invalidNumericTimestamp, null]);
  assert.equal(serialized[0], existingIso);
  assert.equal(serialized[1], invalidNumericTimestamp);
});

test('returns an empty list for missing legacy friction event collections', () => {
  assert.deepEqual(serializeFrictionEvents(undefined), []);
  assert.deepEqual(serializeFrictionEvents(null), []);
});
