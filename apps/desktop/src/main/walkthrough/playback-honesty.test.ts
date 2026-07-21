import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildStepContext,
  highlightStyleForSource,
  isPaintableResolveSource,
  pointInRect,
  shouldAutoOpenStepUrl,
  windowBoundsFromStep,
} from './playback-honesty';

test('live and approximate sources are paintable; silent recorded_hint is not', () => {
  assert.equal(isPaintableResolveSource('accessibility_api'), true);
  assert.equal(isPaintableResolveSource('ocr'), true);
  assert.equal(isPaintableResolveSource('vision_model'), true);
  assert.equal(isPaintableResolveSource('recorded_approximate'), true);
  assert.equal(isPaintableResolveSource('recorded_hint'), false);
  assert.equal(isPaintableResolveSource('unidentified'), false);
  assert.equal(highlightStyleForSource('vision_model'), 'live');
  assert.equal(highlightStyleForSource('recorded_approximate'), 'approximate');
});

test('windowBoundsFromStep reads recorded attrs only', () => {
  assert.equal(windowBoundsFromStep({ step_number: 1, instruction: 'x' }), null);
  assert.deepEqual(
    windowBoundsFromStep({
      step_number: 1,
      instruction: 'x',
      attrs: { window_bounds: { x: 10, y: 20, width: 800, height: 600 } },
    }),
    { x: 10, y: 20, width: 800, height: 600 },
  );
});

test('pointInRect uses padding without inventing a hit', () => {
  const rect = { x: 100, y: 200, width: 80, height: 40 };
  assert.equal(pointInRect(110, 210, rect), true);
  assert.equal(pointInRect(90, 210, rect, 12), true);
  assert.equal(pointInRect(50, 210, rect, 12), false);
});

test('buildStepContext never invents missing app/window fields', () => {
  const empty = buildStepContext({ step_number: 1, instruction: 'Click' }, null);
  assert.equal(empty.app, null);
  assert.equal(empty.windowTitle, null);
  assert.equal(empty.targetLabel, null);

  const filled = buildStepContext(
    {
      step_number: 1,
      instruction: 'Click Send',
      target_label: 'Send',
      attrs: { foreground_app: 'Outlook', window_title: 'Inbox' },
    },
    'https://example.com/mail',
  );
  assert.equal(filled.app, 'Outlook');
  assert.equal(filled.windowTitle, 'Inbox');
  assert.equal(filled.targetLabel, 'Send');
  assert.equal(filled.recordedUrl, 'https://example.com/mail');
});

test('shouldAutoOpenStepUrl only allows first-step recorded/resolved URLs', () => {
  assert.equal(
    shouldAutoOpenStepUrl({ mode: 'recorded', url: 'https://example.com', stepIndex: 0 }),
    true,
  );
  assert.equal(
    shouldAutoOpenStepUrl({ mode: 'recorded', url: 'https://example.com', stepIndex: 2 }),
    false,
  );
  assert.equal(
    shouldAutoOpenStepUrl({ mode: 'unresolved_dynamic', url: null, stepIndex: 0 }),
    false,
  );
  assert.equal(
    shouldAutoOpenStepUrl({ mode: 'live', url: 'https://example.com/x/1', stepIndex: 0 }),
    false,
  );
});
