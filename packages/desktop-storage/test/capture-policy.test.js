import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  applyDefensiveRedaction,
  clearSessionAudit,
  getSessionAuditSummary,
  getSessionWithEvents,
  loadSensitiveAppConfig,
  markSessionSubmitted,
  maskValue,
  matchSensitiveForeground,
  normalizeSensitivePatterns,
  openLocalBuffer,
  recordDefensiveStrip,
  recordWindowSkip,
  resetAllSessionAudits,
  saveEvent,
  saveSession,
} from '../src/index.js';

const BASE_TIME_MS = Date.UTC(2026, 6, 19, 10, 0, 0);

function makeSession(overrides = {}) {
  return {
    client_session_id: 'policy-session-1',
    workflow_name: 'Capture policy session',
    recorded_by: null,
    started_at_ms: BASE_TIME_MS,
    stopped_at_ms: BASE_TIME_MS + 60_000,
    status: 'completed',
    ...overrides,
  };
}

function makeEvent(overrides = {}) {
  return {
    id: `event-${overrides.seq ?? 1}`,
    session_id: 'policy-session-1',
    seq: overrides.seq ?? 1,
    source: 'user',
    layer: 'desktop',
    category: 'mouse',
    type: 'click',
    timestamp_ms: BASE_TIME_MS + (overrides.seq ?? 1) * 1_000,
    target_selector: null,
    target_label: null,
    value: null,
    url: null,
    screenshot_id: null,
    is_identified: false,
    identification_source: 'unidentified',
    raw_x: null,
    raw_y: null,
    attrs: {},
    ...overrides,
  };
}

test.beforeEach(() => {
  resetAllSessionAudits();
});

test('maskValue matches extension email/id/date redaction', () => {
  assert.equal(maskValue('manager@example.com'), '[MASKED]');
  assert.equal(maskValue('id 12345 and more'), 'id [MASKED] and more');
  assert.equal(maskValue('due 2026-07-19'), 'due [MASKED]');
  assert.equal(maskValue('plain name'), 'plain name');
  assert.equal(maskValue('secret', { forceMask: true }), '[MASKED]');
  assert.equal(maskValue(null), null);
  assert.equal(maskValue(''), '');
});

test('CLIPBOARD_COPY with populated value is redacted on save', () => {
  const db = openLocalBuffer();
  saveSession(db, makeSession());

  const result = saveEvent(
    db,
    makeEvent({
      seq: 1,
      category: 'clipboard',
      type: 'CLIPBOARD_COPY',
      value: 'super-secret-password',
      attrs: {
        content: 'super-secret-password',
        contentType: 'text',
        sourceApp: 'Notepad',
      },
    }),
  );

  assert.equal(result.saved, true);
  assert.equal(result.redacted, true);

  const stored = getSessionWithEvents(db, 'policy-session-1');
  assert.equal(stored.events[0].value, null);
  assert.equal(stored.events[0].attrs.content, undefined);
  assert.equal(stored.events[0].attrs.contentType, 'text');
  assert.equal(stored.events[0].attrs.sourceApp, 'Notepad');

  const audit = getSessionAuditSummary('policy-session-1');
  assert.equal(audit.captured_by_category.clipboard, 1);
  assert.equal(audit.redacted_by_category.clipboard, 1);

  db.close();
});

test('CLIPBOARD_PASTE never retains content in attrs_json', () => {
  const db = openLocalBuffer();
  saveSession(db, makeSession());

  saveEvent(
    db,
    makeEvent({
      seq: 1,
      category: 'clipboard',
      type: 'CLIPBOARD_PASTE',
      value: 'pasted',
      attrs: { text: 'pasted', targetApp: 'Chrome' },
    }),
  );

  const stored = getSessionWithEvents(db, 'policy-session-1');
  assert.equal(stored.events[0].value, null);
  assert.equal(stored.events[0].attrs.text, undefined);
  assert.equal(stored.events[0].attrs.targetApp, 'Chrome');

  db.close();
});

test('TEXT_INPUT-equivalent event is masked identically to extension maskValue', () => {
  const db = openLocalBuffer();
  saveSession(db, makeSession());

  const raw = 'user@corp.com paid 123456 on 01/02/2026';
  const expected = maskValue(raw);

  saveEvent(
    db,
    makeEvent({
      seq: 1,
      category: 'keyboard',
      type: 'TEXT_INPUT',
      value: raw,
      attrs: { fieldLabel: 'Notes' },
    }),
  );

  const stored = getSessionWithEvents(db, 'policy-session-1');
  assert.equal(stored.events[0].value, expected);
  assert.equal(expected, '[MASKED] paid [MASKED] on [MASKED]');

  db.close();
});

test('password fields are never persisted', () => {
  const db = openLocalBuffer();
  saveSession(db, makeSession());

  const result = saveEvent(
    db,
    makeEvent({
      seq: 1,
      category: 'keyboard',
      type: 'TEXT_INPUT',
      value: 'hunter2',
      attrs: { field_type: 'password' },
    }),
  );

  assert.equal(result.saved, false);
  assert.equal(result.skipped, true);

  const stored = getSessionWithEvents(db, 'policy-session-1');
  assert.equal(stored.events.length, 0);

  const audit = getSessionAuditSummary('policy-session-1');
  assert.equal(audit.skipped_password_fields, 1);

  db.close();
});

test('FILE_* events never retain a raw absolute path', () => {
  const db = openLocalBuffer();
  saveSession(db, makeSession());

  saveEvent(
    db,
    makeEvent({
      seq: 1,
      category: 'file',
      type: 'FILE_OPEN',
      value: 'C:\\Users\\alice\\Documents\\secret-report.pdf',
      attrs: {
        path: 'C:\\Users\\alice\\Documents\\secret-report.pdf',
        absolutePath: 'C:\\Users\\alice\\Documents\\secret-report.pdf',
      },
    }),
  );

  const stored = getSessionWithEvents(db, 'policy-session-1');
  const attrs = stored.events[0].attrs;

  assert.equal(stored.events[0].value, null);
  assert.equal(attrs.path, undefined);
  assert.equal(attrs.absolutePath, undefined);
  assert.equal(attrs.fileName, 'secret-report.pdf');
  assert.equal(attrs.fileExt, 'pdf');
  assert.equal(attrs.pathMasked, '***/secret-report.pdf');

  const serialized = JSON.stringify(stored.events[0]);
  assert.equal(serialized.includes('Users\\alice'), false);
  assert.equal(serialized.includes('C:'), false);

  db.close();
});

test('post-submission purge clears sensitive-category attrs ahead of cap eviction', () => {
  const db = openLocalBuffer();
  saveSession(db, makeSession({ status: 'completed' }));

  saveEvent(
    db,
    makeEvent({
      seq: 1,
      category: 'clipboard',
      type: 'CLIPBOARD_COPY',
      attrs: { contentType: 'text', sourceApp: 'Notepad' },
    }),
  );
  saveEvent(
    db,
    makeEvent({
      seq: 2,
      category: 'file',
      type: 'FILE_SAVE',
      attrs: { fileName: 'notes.txt', fileExt: 'txt', pathMasked: '***/notes.txt' },
    }),
  );
  saveEvent(
    db,
    makeEvent({
      seq: 3,
      category: 'mouse',
      type: 'click',
      attrs: { button: 1 },
    }),
  );

  const result = markSessionSubmitted(db, 'policy-session-1', {
    submittedAtMs: BASE_TIME_MS + 120_000,
  });

  assert.equal(result.purgedEventCount, 2);

  const stored = getSessionWithEvents(db, 'policy-session-1');
  assert.equal(stored.session.status, 'submitted');
  assert.equal(stored.session.submitted_at_ms, BASE_TIME_MS + 120_000);

  const clipboard = stored.events.find((event) => event.seq === 1);
  const file = stored.events.find((event) => event.seq === 2);
  const mouse = stored.events.find((event) => event.seq === 3);

  assert.equal(clipboard.attrs.purged, true);
  assert.equal(clipboard.attrs.contentType, undefined);
  assert.equal(file.attrs.purged, true);
  assert.equal(file.attrs.fileName, undefined);
  assert.deepEqual(mouse.attrs, { button: 1 });

  db.close();
});

test('foreground app matching skip list produces zero buffered events for that window', () => {
  const db = openLocalBuffer();
  saveSession(db, makeSession());

  const matched = matchSensitiveForeground('1Password', 'Login - 1Password', [
    '1password',
    'bitwarden',
  ]);
  assert.equal(matched, '1password');

  // Capture path: RecordingService would skip before saveEvent; verify audit + no insert.
  recordWindowSkip('policy-session-1', matched);

  const audit = getSessionAuditSummary('policy-session-1');
  assert.equal(audit.windows_skipped, 1);
  assert.equal(audit.skipped_by_app_pattern['1password'], 1);

  const stored = getSessionWithEvents(db, 'policy-session-1');
  assert.equal(stored.events.length, 0);

  assert.equal(matchSensitiveForeground('Notepad', 'Untitled', ['1password']), null);

  db.close();
});

test('sensitive-apps config file is loadable and user-editable', async () => {
  const { loadSensitiveAppConfig, saveSensitiveAppConfig } =
    await import('../src/sensitive-apps.js');
  const dir = mkdtempSync(join(tmpdir(), 'sensitive-apps-'));
  const configPath = join(dir, 'sensitive-apps.json');

  saveSensitiveAppConfig(configPath, ['CustomBank', 'keePass']);
  const loaded = loadSensitiveAppConfig(configPath);

  assert.deepEqual(loaded.patterns, ['custombank', 'keepass']);
  assert.equal(loaded.source, 'file');

  writeFileSync(configPath, '{ not json', 'utf8');
  const fallback = loadSensitiveAppConfig(configPath);
  assert.equal(fallback.source, 'default_fallback');
  assert.ok(fallback.patterns.includes('1password'));
});

test('keyboard keydown without value is not treated as TEXT_INPUT masking target', () => {
  const db = openLocalBuffer();
  saveSession(db, makeSession());

  saveEvent(
    db,
    makeEvent({
      seq: 1,
      category: 'keyboard',
      type: 'keydown',
      value: null,
      attrs: { keycode: 30, foreground_app: 'Notepad' },
    }),
  );

  const stored = getSessionWithEvents(db, 'policy-session-1');
  assert.equal(stored.events[0].value, null);
  assert.equal(stored.events[0].attrs.keycode, 30);

  db.close();
});

test('password field aliases are skipped', () => {
  const db = openLocalBuffer();
  saveSession(db, makeSession());

  for (const [seq, attrs] of [
    [1, { is_password: true }],
    [2, { isPassword: true }],
    [3, { password: true }],
  ]) {
    const result = saveEvent(
      db,
      makeEvent({
        seq,
        category: 'keyboard',
        type: 'TEXT_INPUT',
        value: 'secret',
        attrs,
      }),
    );
    assert.equal(result.saved, false);
    assert.equal(result.skipped, true);
  }

  assert.equal(getSessionWithEvents(db, 'policy-session-1').events.length, 0);
  assert.equal(getSessionAuditSummary('policy-session-1').skipped_password_fields, 3);

  db.close();
});

test('TEXT_INPUT masks attrs.text and existing textMasked', () => {
  const db = openLocalBuffer();
  saveSession(db, makeSession());

  saveEvent(
    db,
    makeEvent({
      seq: 1,
      category: 'keyboard',
      type: 'TEXT_INPUT',
      value: 'hello',
      attrs: { text: 'a@b.com', force_mask: false },
    }),
  );
  saveEvent(
    db,
    makeEvent({
      seq: 2,
      category: 'keyboard',
      type: 'TEXT_INPUT',
      value: 'x',
      attrs: { textMasked: 'id 99999', pii: true },
    }),
  );

  const stored = getSessionWithEvents(db, 'policy-session-1');
  assert.equal(stored.events[0].attrs.text, undefined);
  assert.equal(stored.events[0].attrs.textMasked, '[MASKED]');
  assert.equal(stored.events[1].value, '[MASKED]');
  assert.equal(stored.events[1].attrs.textMasked, '[MASKED]');

  db.close();
});

test('FILE event with file_name only gets pathMasked metadata', () => {
  const db = openLocalBuffer();
  saveSession(db, makeSession());

  saveEvent(
    db,
    makeEvent({
      seq: 1,
      category: 'file',
      type: 'FILE_SELECT',
      attrs: { file_name: 'invoice.docx' },
    }),
  );

  const attrs = getSessionWithEvents(db, 'policy-session-1').events[0].attrs;
  assert.equal(attrs.fileName, 'invoice.docx');
  assert.equal(attrs.fileExt, 'docx');
  assert.equal(attrs.pathMasked, '***/invoice.docx');
  assert.equal(attrs.file_name, undefined);

  db.close();
});

test('defensive redact strips residual non-string path attrs on save', () => {
  const db = openLocalBuffer();
  saveSession(db, makeSession());

  // Policy only deletes string paths; non-string leftovers are stripped defensively.
  const result = saveEvent(
    db,
    makeEvent({
      seq: 1,
      category: 'file',
      type: 'FILE_OPEN',
      attrs: {
        fileName: 'a.txt',
        path: { raw: 'C:\\Users\\alice\\a.txt' },
      },
    }),
  );

  assert.equal(result.saved, true);
  assert.equal(result.redacted, true);

  const stored = getSessionWithEvents(db, 'policy-session-1');
  assert.equal(stored.events[0].attrs.path, undefined);
  assert.equal(stored.events[0].attrs.fileName, 'a.txt');

  const audit = getSessionAuditSummary('policy-session-1');
  assert.ok(audit.defensive_strips >= 1);

  db.close();
});

test('applyDefensiveRedaction strips clipboard value and sensitive attrs', () => {
  const { event, stripped } = applyDefensiveRedaction({
    category: 'clipboard',
    type: 'CLIPBOARD_COPY',
    value: 'leak',
    attrs: { content: 'leak', contentType: 'text' },
  });

  assert.equal(stripped, true);
  assert.equal(event.value, null);
  assert.equal(event.attrs.content, undefined);
  assert.equal(event.attrs.contentType, 'text');
});

test('audit clear and empty summary helpers', () => {
  recordDefensiveStrip('audit-session');
  assert.equal(getSessionAuditSummary('audit-session').defensive_strips, 1);

  clearSessionAudit('audit-session');
  assert.equal(getSessionAuditSummary('audit-session').defensive_strips, 0);
  assert.equal(getSessionAuditSummary('missing-session').windows_skipped, 0);
});

test('sensitive-apps normalize and missing config fallbacks', () => {
  assert.ok(normalizeSensitivePatterns(null).includes('1password'));
  assert.ok(normalizeSensitivePatterns(['', '  ']).includes('bitwarden'));
  assert.deepEqual(normalizeSensitivePatterns(['Bank']), ['bank']);

  const missing = loadSensitiveAppConfig(join(tmpdir(), 'no-such-sensitive-apps.json'));
  assert.equal(missing.source, 'default');

  const noPath = loadSensitiveAppConfig();
  assert.equal(noPath.source, 'default');
});

test('markSessionSubmitted throws for unknown session', () => {
  const db = openLocalBuffer();
  assert.throws(() => markSessionSubmitted(db, 'missing'), /Session not found/);
  db.close();
});

test('purge tolerates corrupt attrs_json on sensitive rows', () => {
  const db = openLocalBuffer();
  saveSession(db, makeSession());
  saveEvent(
    db,
    makeEvent({
      seq: 1,
      category: 'clipboard',
      type: 'CLIPBOARD_COPY',
      attrs: { contentType: 'text' },
    }),
  );

  db.prepare('UPDATE events SET attrs_json = ? WHERE id = ?').run('{bad', 'event-1');
  const purged = markSessionSubmitted(db, 'policy-session-1').purgedEventCount;
  assert.equal(purged, 1);

  const stored = getSessionWithEvents(db, 'policy-session-1');
  assert.equal(stored.events[0].attrs.purged, true);

  db.close();
});
