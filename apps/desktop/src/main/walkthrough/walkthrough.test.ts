import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveAnchorMode } from './anchor-mode.js';
import { mapWalkthroughStep } from './payload-map.js';
import { formatAgentPromptDocument, hasCompleteCoachingSections } from './prompt-export.js';
import {
  appendStepTiming,
  retractFrictionToStep,
  retractTimingsToStep,
  totalDurationSeconds,
} from './step-timing.js';
import { refineGridCell, resolvePlaybackTarget } from './target-resolve.js';
import { parseVoiceCommand, voiceCommandToAction } from './voice-commands.js';

test('resolveAnchorMode mirrors extension element/screenshot/none rules', () => {
  assert.equal(
    resolveAnchorMode({ step_number: 1, instruction: 'x', css_selector: '#a' }),
    'element',
  );
  assert.equal(
    resolveAnchorMode({
      step_number: 1,
      instruction: 'x',
      screenshot_url: 'https://example/s.png',
    }),
    'screenshot',
  );
  assert.equal(resolveAnchorMode({ step_number: 1, instruction: 'x' }), 'none');
  assert.equal(
    resolveAnchorMode({
      step_number: 1,
      instruction: 'x',
      raw_coordinates: { x: 10, y: 20 },
    }),
    'element',
  );
  assert.equal(
    resolveAnchorMode({
      step_number: 1,
      instruction: 'x',
      anchor_mode: 'screenshot',
      css_selector: '#ignored',
    }),
    'screenshot',
  );
});

test('voice commands are fixed vocabulary only', () => {
  assert.equal(parseVoiceCommand('Next'), 'next');
  assert.equal(parseVoiceCommand('please continue'), 'continue');
  assert.equal(parseVoiceCommand('  previous! '), 'previous');
  assert.equal(parseVoiceCommand('go to the inbox'), null);
  assert.equal(parseVoiceCommand(''), null);
  assert.equal(parseVoiceCommand(null), null);
  assert.equal(voiceCommandToAction('stop'), 'finish');
  assert.equal(voiceCommandToAction('repeat'), 'repeat');
  assert.equal(voiceCommandToAction('continue'), 'next');
  assert.equal(voiceCommandToAction('previous'), 'previous');
});

test('prompt export formats five coaching sections', () => {
  const sections = {
    identity: 'You are a helper.',
    context: 'Read the inbox.',
    steps: '1. Rank emails.',
    output: 'Return a list.',
    guardrails: 'Never send automatically.',
  };

  assert.equal(hasCompleteCoachingSections(sections), true);
  assert.equal(hasCompleteCoachingSections({ ...sections, guardrails: '  ' }), false);
  assert.equal(hasCompleteCoachingSections(null), false);

  const doc = formatAgentPromptDocument(sections);
  assert.match(doc, /## Identity/);
  assert.match(doc, /## Guardrails/);
  assert.match(doc, /Never send automatically/);
});

test('previous retracts forward timings like the extension', () => {
  let timings = appendStepTiming([], 1, 1000);
  timings = appendStepTiming(timings, 2, 2000);
  timings = retractTimingsToStep(timings, 2);
  assert.deepEqual(timings, [{ step_number: 1, duration_ms: 1000 }]);

  timings = appendStepTiming(timings, 2, 500);
  assert.equal(totalDurationSeconds(timings), 2);

  const friction = retractFrictionToStep(
    [
      { step_number: 1, event_type: 'selector_miss', occurred_at: 'a' },
      { step_number: 3, event_type: 'selector_miss', occurred_at: 'b' },
    ],
    2,
  );
  assert.deepEqual(friction, [{ step_number: 1, event_type: 'selector_miss', occurred_at: 'a' }]);
});

test('resolvePlaybackTarget prefers live resolvers then recorded hints', async () => {
  const display = { x: 100, y: 50, width: 1920, height: 1080 };

  const viaA11y = await resolvePlaybackTarget(
    { step_number: 1, instruction: 'Click', target_label: 'Send' },
    display,
    {
      resolveAccessibility: async () => ({ x: 200, y: 100, width: 80, height: 40 }),
    },
  );
  assert.equal(viaA11y.source, 'accessibility_api');
  assert.equal(viaA11y.fallbackNote, null);

  const viaOcr = await resolvePlaybackTarget(
    { step_number: 1, instruction: 'Click', target_label: 'Send' },
    display,
    {
      resolveAccessibility: async () => null,
      resolveOcr: async () => ({ x: 220, y: 120, width: 70, height: 30 }),
    },
  );
  assert.equal(viaOcr.source, 'ocr');

  const viaVision = await resolvePlaybackTarget(
    { step_number: 1, instruction: 'Click', target_label: 'Send' },
    display,
    {
      resolveAccessibility: async () => null,
      resolveOcr: async () => null,
      resolveVisionGrid: async () => ({ x: 300, y: 200, width: 90, height: 50 }),
    },
  );
  assert.equal(viaVision.source, 'vision_model');

  const viaHighlight = await resolvePlaybackTarget(
    {
      step_number: 1,
      instruction: 'Click',
      screenshot_highlight: { x: 150, y: 80, width: 100, height: 40 },
    },
    display,
  );
  assert.equal(viaHighlight.source, 'recorded_hint');
  assert.ok(viaHighlight.rect);

  const missed = await resolvePlaybackTarget(
    { step_number: 1, instruction: 'Click Send', target_label: 'Send' },
    display,
  );
  assert.equal(missed.source, 'unidentified');
  assert.match(String(missed.fallbackNote), /No live target/);

  const hinted = await resolvePlaybackTarget(
    {
      step_number: 2,
      instruction: 'Open Claude',
      raw_coordinates: { x: 400, y: 300 },
    },
    display,
  );
  assert.equal(hinted.source, 'recorded_hint');
  assert.ok(hinted.rect);

  const screenshotOnly = await resolvePlaybackTarget(
    {
      step_number: 3,
      instruction: 'Read this',
      screenshot_url: 'https://example/s.png',
    },
    display,
  );
  assert.equal(screenshotOnly.source, 'unidentified');
  assert.equal(screenshotOnly.rect, null);
});

test('two-stage grid refine stays inside the coarse region', () => {
  const full = { x: 0, y: 0, width: 1200, height: 800 };
  const cell = refineGridCell(full, 2, 1, 12, 8, 3, 2, 6, 6);
  assert.ok(cell.x >= 200 && cell.x < 300);
  assert.ok(cell.y >= 100 && cell.y < 200);
  assert.ok(cell.width > 0 && cell.height > 0);
});

test('mapWalkthroughStep reads desktop attrs hints', () => {
  const mapped = mapWalkthroughStep(
    {
      step_number: 4,
      instruction: 'Open Custom Instructions',
      attrs: {
        raw_coordinates: { x: 12, y: 34 },
        field_kind: 'prompt',
      },
    },
    0,
  );

  assert.deepEqual(mapped.raw_coordinates, { x: 12, y: 34 });
  assert.equal(mapped.field_kind, 'prompt');
  assert.equal(mapped.expected_action, 'click');
});
