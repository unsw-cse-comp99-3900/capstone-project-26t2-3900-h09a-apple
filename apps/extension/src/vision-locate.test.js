import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildVisionCacheKey,
  describeStepForVision,
  isUsableLocateRect,
  pageKeyFromUrl,
} from './vision-locate.js';

test('buildVisionCacheKey is stable per step and page', () => {
  assert.equal(
    buildVisionCacheKey({
      sopId: 'sop-1',
      stepNumber: 3,
      tabId: 9,
      pageKey: 'https://example.com/a',
    }),
    'sop-1:3:9:https://example.com/a',
  );
});

test('describeStepForVision prefers target_label over instruction', () => {
  assert.equal(
    describeStepForVision({
      target_label: 'Close',
      instruction: 'Click the close issue button',
    }),
    'Close',
  );
  assert.equal(describeStepForVision({ instruction: 'Click submit' }), 'Click submit');
});

test('pageKeyFromUrl strips hash', () => {
  assert.equal(
    pageKeyFromUrl('https://example.com/path?x=1#section'),
    'https://example.com/path?x=1',
  );
});

test('isUsableLocateRect rejects empty bounds', () => {
  assert.equal(isUsableLocateRect({ x: 1, y: 2, width: 3, height: 4 }), true);
  assert.equal(isUsableLocateRect({ x: 1, y: 2, width: 0, height: 4 }), false);
});
