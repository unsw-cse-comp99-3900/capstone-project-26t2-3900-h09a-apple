import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const backgroundSource = readFileSync(new URL('./background.js', import.meta.url), 'utf-8');

test('background deletes local session payloads after web submit notification', () => {
  assert.match(backgroundSource, /message\.type === 'SESSION_SUBMITTED'/);
  assert.match(backgroundSource, /deleteSessionPayload\(message\.sessionId\)/);
  assert.match(backgroundSource, /handleExternalAuthMessage/);
  assert.match(backgroundSource, /deleteSessionPayload,/);
});

test('background saves assembled sessions with capped retention', () => {
  assert.match(backgroundSource, /saveSessionPayloadWithCap\(sessionPayload\)/);
});

test('background reports local session storage failures to the popup', () => {
  assert.match(backgroundSource, /sessionStorageError/);
  assert.match(backgroundSource, /SESSION_PAYLOAD_ERROR/);
  assert.match(backgroundSource, /Could not save captured session locally/);
});

test('background starts walkthroughs from external web handoff using only sop id', () => {
  assert.match(backgroundSource, /startWalkthroughFromSop/);
  assert.match(backgroundSource, /authenticatedFetch/);
  assert.match(
    backgroundSource,
    /\/api\/v1\/sops\/\$\{encodeURIComponent\(trimmedSopId\)\}\/walkthrough/,
  );
  assert.match(backgroundSource, /WALKTHROUGH_STORAGE_KEY/);
  assert.match(backgroundSource, /WALKTHROUGH_PAYLOAD_KEY/);
  assert.match(backgroundSource, /startWalkthroughFromSop,/);
  assert.match(backgroundSource, /inferLaunchUrl/);
  assert.match(backgroundSource, /waitForTabComplete/);
  assert.match(backgroundSource, /syncWalkthroughToTab/);
  assert.match(backgroundSource, /WALKTHROUGH_ENSURE_PAGE/);
});
