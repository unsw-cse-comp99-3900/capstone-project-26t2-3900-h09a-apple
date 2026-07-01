import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleSession } from './session-assembly.js';

test('assembleSession sorts chronologically, deduplicates adjacent events, and formats SessionPayload', () => {
  const metadata = {
    client_session_id: 'session-xyz-789',
    workflowName: 'Test Backend Assembly',
    startedAt: 1000,
    stoppedAt: 5000,
  };

  // Array containing > 10 mixed events, out of chronological order, with adjacent duplicates
  const rawEvents = [
    { type: 'INPUT', payload: { selector: '#in', value: 'hello', timestamp: 1005 } },
    { type: 'NAVIGATION', payload: { url: 'https://apple.com', timestamp: 1001 } },
    { type: 'CLICK', payload: { selector: '#btn', timestamp: 1004 } },
    { type: 'NAVIGATION', payload: { url: 'https://apple.com/mac', timestamp: 1002 } },
    { type: 'NAVIGATION', payload: { url: 'https://apple.com/mac', timestamp: 1003 } }, // Duplicate NAV
    { type: 'CLICK', payload: { selector: '#btn', timestamp: 1007 } },
    { type: 'INPUT', payload: { selector: '#in', value: 'hello', timestamp: 1006 } }, // Duplicate INPUT
    { type: 'INPUT', payload: { selector: '#in2', value: 'foo', timestamp: 1008 } },
    { type: 'INPUT', payload: { selector: '#in2', value: 'bar', timestamp: 1009 } }, // Different value (valid)
    { type: 'CLICK', payload: { selector: '#btn', timestamp: 1010 } }, // Valid click
    { type: 'CLICK', payload: { selector: '#btn', timestamp: 1011 } }, // Duplicate CLICK
  ];

  const payload = assembleSession(rawEvents, metadata);

  // Verify Metadata
  assert.equal(payload.client_session_id, 'session-xyz-789');
  assert.equal(payload.workflow_name, 'Test Backend Assembly');
  assert.equal(payload.started_at, new Date(1000).toISOString());
  assert.equal(payload.stopped_at, new Date(5000).toISOString());

  // Verify sorting and deduplication (11 raw -> 8 unique)
  assert.equal(payload.event_count, 8);
  assert.equal(payload.events.length, 8);

  // Verify order
  const sortedTimestamps = payload.events.map((e) => e.timestamp_ms);
  assert.deepEqual(sortedTimestamps, [1001, 1002, 1004, 1005, 1007, 1008, 1009, 1010]);

  // Verify timestamp_ms injection
  assert.equal(payload.events[0].timestamp_ms, 1001);

  // Verify type sequence after sorting & deduplicating
  const finalSequence = payload.events.map((e) => e.type);
  assert.deepEqual(finalSequence, [
    'navigation',
    'navigation',
    'click',
    'input',
    'click',
    'input',
    'input',
    'click',
  ]);

  // Verify flattened event structure (no nested payload)
  const firstNav = payload.events[0];
  assert.equal(firstNav.url, 'https://apple.com');
  assert.equal('payload' in firstNav, false);

  const firstInput = payload.events[3];
  assert.equal(firstInput.target_selector, '#in');
  assert.equal(firstInput.value, 'hello');
});

test('assembleSession carries page title into event attrs for LLM context', () => {
  const payload = assembleSession(
    [
      {
        type: 'NAVIGATION',
        payload: {
          url: 'https://example.com/login',
          title: '  Example Login  ',
          timestamp: 1001,
        },
      },
    ],
    { workflowName: 'Login flow', startedAt: 1000, stoppedAt: 2000 },
  );

  assert.equal(payload.events[0].attrs.page_title, 'Example Login');
});

test('assembleSession carries screenshot ids and screenshot payloads', () => {
  const screenshot = {
    id: '33333333-3333-3333-3333-333333333333',
    data_base64: 'abc123',
    content_type: 'image/jpeg',
  };
  const payload = assembleSession(
    [
      {
        type: 'CLICK',
        payload: {
          selector: '#login',
          label: 'Log in',
          url: 'https://example.com/login',
          screenshot_id: screenshot.id,
          timestamp: 1001,
        },
      },
    ],
    {
      workflowName: 'Login flow',
      startedAt: 1000,
      stoppedAt: 2000,
      screenshots: [screenshot],
    },
  );

  assert.equal(payload.events[0].screenshot_id, screenshot.id);
  assert.deepEqual(payload.screenshots, [screenshot]);
});

test('assembleSession drops screenshots not referenced by any event after dedup', () => {
  const keptScreenshot = {
    id: '11111111-1111-1111-1111-111111111111',
    data_base64: 'kept',
    content_type: 'image/jpeg',
  };
  const orphanScreenshot = {
    id: '22222222-2222-2222-2222-222222222222',
    data_base64: 'orphan',
    content_type: 'image/jpeg',
  };

  const payload = assembleSession(
    [
      {
        type: 'CLICK',
        payload: {
          selector: '#btn',
          screenshot_id: keptScreenshot.id,
          timestamp: 1001,
        },
      },
      {
        type: 'CLICK',
        payload: {
          selector: '#btn',
          screenshot_id: orphanScreenshot.id,
          timestamp: 1002,
        },
      },
    ],
    {
      workflowName: 'Dedup flow',
      startedAt: 1000,
      stoppedAt: 2000,
      screenshots: [keptScreenshot, orphanScreenshot],
    },
  );

  assert.equal(payload.event_count, 1);
  assert.equal(payload.events[0].screenshot_id, keptScreenshot.id);
  assert.deepEqual(payload.screenshots, [keptScreenshot]);
});
