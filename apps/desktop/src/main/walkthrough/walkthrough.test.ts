import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveAnchorMode } from './anchor-mode.js';
import {
  hasScreenSpaceCoordinates,
  mapViewportRectToScreen,
  misuseViewportAsScreen,
} from './coordinate-space.js';
import { mapWalkthroughStep } from './payload-map.js';
import { formatAgentPromptDocument, hasCompleteCoachingSections } from './prompt-export.js';
import {
  appendStepTiming,
  retractFrictionToStep,
  retractTimingsToStep,
  totalDurationSeconds,
} from './step-timing.js';
import { findTextRectInOcrWords, pickBestOcrMatch } from './ocr-resolve.js';
import { intersectRects } from './foreground-window.js';
import { formatVisionFailureLog, shouldApplyResolution } from './resolve-failure.js';
import { needleForStep, resolveStepPageUrl } from './step-navigation.js';
import { parseWalkthroughProtocolSopId } from './protocol.js';
import {
  isAppFocusStep,
  isPlausibleTaskbarHit,
  targetAppNameFromStep,
  taskbarIconHintRect,
} from './app-focus.js';
import { canSkipVisionForExtremeA11y } from './resolve-confidence.js';
import {
  buildMissFallbackNote,
  refineGridCell,
  resolvePlaybackTarget,
  shouldAttemptLiveResolve,
} from './target-resolve.js';
import { parseVoiceCommand, voiceCommandToAction } from './voice-commands.js';

test('parseWalkthroughProtocolSopId reads worktrace walkthrough URLs', () => {
  assert.equal(
    parseWalkthroughProtocolSopId(
      'worktrace://walkthrough?sopId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    ),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  );
  assert.equal(
    parseWalkthroughProtocolSopId(
      'worktrace://walkthrough?id=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ),
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  );
  // Reject non-UUID ids (API walkthrough route requires UUID).
  assert.equal(parseWalkthroughProtocolSopId('worktrace://walkthrough?id=sop-42'), null);
  assert.equal(parseWalkthroughProtocolSopId('worktrace://auth-callback?code=x'), null);
  assert.equal(parseWalkthroughProtocolSopId('https://example.com/walkthrough?sopId=x'), null);
});

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
  // Viewport screenshot_highlight alone is not a live desktop target hint.
  assert.equal(
    resolveAnchorMode({
      step_number: 1,
      instruction: 'x',
      screenshot_highlight: { x: 10, y: 20, width: 30, height: 40 },
      screenshot_url: 'https://example/s.png',
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

test('viewport coords need contentBounds; misuse as screen diverges', () => {
  const viewportHighlight = { x: 1100, y: 80, width: 120, height: 36 };
  const viewportWidth = 1440;
  const viewportHeight = 900;

  // Browser window content area on a larger desktop (not full display).
  const browserContent = { x: 120, y: 80, width: 1280, height: 800 };
  const display = { x: 0, y: 0, width: 1920, height: 1080 };

  const correct = mapViewportRectToScreen(
    viewportHighlight,
    browserContent,
    viewportWidth,
    viewportHeight,
  );
  assert.ok(correct);
  assert.ok(correct.x > browserContent.x);
  assert.ok(correct.y > browserContent.y);

  // Wrong: paint viewport pixels as screen pixels (pre-fix desktop bug).
  const misused = misuseViewportAsScreen(viewportHighlight);
  assert.notEqual(Math.round(misused.x), Math.round(correct.x));
  assert.notEqual(Math.round(misused.y), Math.round(correct.y));

  // Also wrong: scale onto full display when the browser did not fill it.
  const scaledToDisplay = mapViewportRectToScreen(
    viewportHighlight,
    display,
    viewportWidth,
    viewportHeight,
  );
  assert.ok(scaledToDisplay);
  assert.notEqual(Math.round(scaledToDisplay.x), Math.round(correct.x));
});

test('hasScreenSpaceCoordinates only trusts desktop-marked raw coords', () => {
  assert.equal(
    hasScreenSpaceCoordinates({
      step_number: 1,
      instruction: 'x',
      raw_coordinates: { x: 1, y: 2 },
    }),
    false,
  );
  assert.equal(
    hasScreenSpaceCoordinates({
      step_number: 1,
      instruction: 'x',
      raw_coordinates: { x: 1, y: 2 },
      attrs: { layer: 'desktop' },
    }),
    true,
  );
  assert.equal(
    hasScreenSpaceCoordinates({
      step_number: 1,
      instruction: 'x',
      raw_coordinates: { x: 1, y: 2 },
      attrs: { coordinate_space: 'screen' },
    }),
    true,
  );
  assert.equal(
    hasScreenSpaceCoordinates({
      step_number: 1,
      instruction: 'x',
      raw_coordinates: { x: 1, y: 2 },
      attrs: { platform: 'darwin', foreground_app: 'Chrome' },
    }),
    true,
  );
});

test('app-focus steps target taskbar, not mid-page recorded coords', async () => {
  const display = { x: 0, y: 0, width: 1707, height: 1067 };
  const step = {
    step_number: 2,
    instruction: 'Click to focus the Claude application window.',
    target_label: 'Claude',
    attrs: { foreground_app: 'Claude', window_title: 'Claude' },
    raw_coordinates: { x: 110, y: 180 },
  };

  assert.equal(isAppFocusStep(step), true);
  assert.equal(targetAppNameFromStep(step), 'Claude');

  const viaTaskbar = await resolvePlaybackTarget(step, display, {
    resolveTaskbarIcon: async () => ({ x: 900, y: 1010, width: 44, height: 44 }),
    resolveVisionGrid: async () => {
      throw new Error('should not call vision when taskbar a11y hits');
    },
  });
  assert.equal(viaTaskbar.source, 'accessibility_api');
  assert.ok(viaTaskbar.rect);
  assert.ok(viaTaskbar.rect!.y > display.height * 0.85);
  assert.match(String(viaTaskbar.liveTargetLabel), /taskbar/i);

  const viaHint = await resolvePlaybackTarget(step, display, {
    resolveTaskbarIcon: async () => null,
    resolveVisionGrid: async () => null,
  });
  assert.equal(viaHint.source, 'recorded_approximate');
  assert.ok(viaHint.rect);
  assert.ok(viaHint.rect!.y > display.height * 0.85);
  assert.notEqual(viaHint.rect!.y, 160);

  const midScreen = { x: 400, y: 300, width: 120, height: 48 };
  assert.equal(isPlausibleTaskbarHit(midScreen, display), false);
  const bar = taskbarIconHintRect(display);
  assert.equal(isPlausibleTaskbarHit(bar, display), true);
});

test('non-app-focus steps reject vision taskbar hits', async () => {
  const display = { x: 0, y: 0, width: 1707, height: 1067 };
  const step = {
    step_number: 5,
    instruction: "Continue clicking to navigate through 'Claude'.",
    attrs: {
      foreground_app: 'Claude',
      window_title: 'Claude',
      layer: 'desktop',
      coordinate_space: 'screen',
      window_bounds: { x: 80, y: 40, width: 1400, height: 900 },
    },
    raw_coordinates: { x: 980, y: 720 },
  };

  assert.equal(isAppFocusStep(step), false);

  const resolved = await resolvePlaybackTarget(step, display, {
    resolveVisionGrid: async () => ({
      rect: { x: 1100, y: 1010, width: 120, height: 48 },
      coachingHint: 'Click the Claude icon on the bottom taskbar.',
      liveTargetLabel: 'claude taskbar',
    }),
    resolveOcr: async () => null,
    resolveAccessibility: async () => null,
  });

  assert.notEqual(resolved.source, 'vision_model');
  assert.equal(/taskbar/i.test(String(resolved.liveTargetLabel || '')), false);
  // Falls back to recorded click approximate inside the window, not taskbar.
  assert.equal(resolved.source, 'recorded_approximate');
  assert.ok(resolved.rect);
  assert.ok(resolved.rect!.y < display.height * 0.85);
});

test('typing steps paint a field box instead of Unknown/taskbar', async () => {
  const display = { x: 0, y: 0, width: 1707, height: 1067 };
  const step = {
    step_number: 3,
    instruction: "Press a keyboard key in the 'Claude' window.",
    expected_action: 'keydown' as const,
    attrs: {
      foreground_app: 'Claude',
      window_title: 'Claude',
      layer: 'desktop',
      coordinate_space: 'screen',
      window_bounds: { x: 80, y: 40, width: 1400, height: 900 },
    },
    raw_coordinates: { x: 700, y: 420 },
  };

  const resolved = await resolvePlaybackTarget(step, display, {
    resolveVisionGrid: async () => ({
      rect: { x: 1100, y: 1010, width: 120, height: 48 },
      coachingHint: 'Press a key in the text input area at the bottom.',
      liveTargetLabel: 'composer',
    }),
    resolveOcr: async () => null,
    resolveAccessibility: async () => null,
  });

  assert.equal(resolved.source, 'recorded_approximate');
  assert.ok(resolved.rect);
  assert.ok(resolved.rect!.width >= 200);
  assert.ok(resolved.rect!.y < display.height * 0.85);
  assert.equal(resolved.liveTargetLabel, 'text field');
});

test('pickBestA11yCandidate prefers matching role then near click', async () => {
  const { pickBestA11yCandidate } = await import('./accessibility-resolve.js');
  const heading = {
    x: 100,
    y: 100,
    width: 400,
    height: 80,
    area: 32000,
    interactive: false,
    controlType: 'ControlType.Text',
  };
  const farButton = {
    x: 900,
    y: 500,
    width: 120,
    height: 36,
    area: 4320,
    interactive: true,
    controlType: 'ControlType.Button',
  };
  const nearButton = {
    x: 200,
    y: 220,
    width: 100,
    height: 32,
    area: 3200,
    interactive: true,
    controlType: 'ControlType.Button',
  };
  const best = pickBestA11yCandidate([heading, farButton, nearButton], {
    preferredTypeToken: 'button',
    nearPoint: { x: 210, y: 230 },
  });
  assert.equal(best, nearButton);
});

test('extreme a11y skip requires multi-word needle and compact rect', () => {
  const display = { x: 0, y: 0, width: 1920, height: 1080 };
  const compact = { x: 400, y: 300, width: 140, height: 36 };
  assert.equal(
    canSkipVisionForExtremeA11y(
      { step_number: 1, instruction: 'Click Save', target_label: 'Save' },
      compact,
      display,
    ),
    false,
  );
  assert.equal(
    canSkipVisionForExtremeA11y(
      { step_number: 1, instruction: 'Click Create project', target_label: 'Create project' },
      compact,
      display,
    ),
    true,
  );
  assert.equal(
    canSkipVisionForExtremeA11y(
      { step_number: 1, instruction: 'Click Create project', target_label: 'Create project' },
      { x: 0, y: 0, width: 1800, height: 900 },
      display,
    ),
    false,
  );
});

test('resolvePlaybackTarget runs OCR and vision in parallel after a11y', async () => {
  const display = { x: 100, y: 50, width: 1920, height: 1080 };
  const order: string[] = [];

  // Short needle "Send" is NOT extreme-confidence - vision must still run.
  const viaShortA11y = await resolvePlaybackTarget(
    { step_number: 1, instruction: 'Click', target_label: 'Send' },
    display,
    {
      resolveAccessibility: async () => {
        order.push('a11y-start');
        await new Promise((r) => setTimeout(r, 20));
        order.push('a11y-done');
        return { x: 200, y: 100, width: 80, height: 40 };
      },
      resolveOcr: async () => {
        order.push('ocr-start');
        await new Promise((r) => setTimeout(r, 5));
        order.push('ocr-done');
        return { x: 220, y: 120, width: 70, height: 30 };
      },
      resolveVisionGrid: async () => {
        order.push('vision-start');
        await new Promise((r) => setTimeout(r, 5));
        order.push('vision-done');
        return {
          rect: { x: 300, y: 200, width: 90, height: 50 },
          coachingHint: 'click Send near the bottom right',
        };
      },
    },
  );
  // Strong needle + OCR hit preferred over POINT (keeps vision coach text).
  assert.equal(viaShortA11y.source, 'ocr');
  assert.equal(viaShortA11y.coachingHint, 'click Send near the bottom right');
  // a11y finishes before OCR/vision start; OCR and vision overlap.
  assert.ok(order.indexOf('a11y-done') < order.indexOf('ocr-start'));
  assert.ok(order.indexOf('a11y-done') < order.indexOf('vision-start'));
  assert.ok(order.indexOf('ocr-start') < order.indexOf('vision-done'));
  assert.ok(order.indexOf('vision-start') < order.indexOf('ocr-done'));

  // Strong text needle: OCR wins over vision (avoids POINT drift to captions).
  const viaOcrOverVision = await resolvePlaybackTarget(
    { step_number: 1, instruction: 'Click', target_label: 'Chat' },
    display,
    {
      resolveAccessibility: async () => null,
      resolveOcr: async () => ({ x: 220, y: 120, width: 70, height: 30 }),
      resolveVisionGrid: async () => ({
        rect: { x: 300, y: 400, width: 90, height: 50 },
        coachingHint: 'click Chat',
      }),
    },
  );
  assert.equal(viaOcrOverVision.source, 'ocr');
  assert.equal(viaOcrOverVision.coachingHint, 'click Chat');

  // Extreme multi-word a11y + compact rect may skip vision.
  let visionCalls = 0;
  const viaExtreme = await resolvePlaybackTarget(
    { step_number: 1, instruction: 'Click Create project', target_label: 'Create project' },
    display,
    {
      resolveAccessibility: async () => ({ x: 400, y: 300, width: 140, height: 36 }),
      resolveOcr: async () => null,
      resolveVisionGrid: async () => {
        visionCalls += 1;
        return { x: 300, y: 200, width: 90, height: 50 };
      },
    },
  );
  assert.equal(viaExtreme.source, 'accessibility_api');
  assert.equal(visionCalls, 0);

  // Vision miss falls back to OCR.
  const viaOcrFallback = await resolvePlaybackTarget(
    { step_number: 1, instruction: 'Click', target_label: 'Send' },
    display,
    {
      resolveAccessibility: async () => null,
      resolveOcr: async () => ({ x: 220, y: 120, width: 70, height: 30 }),
      resolveVisionGrid: async () => null,
    },
  );
  assert.equal(viaOcrFallback.source, 'ocr');
});

test('screenshot-mode steps with a UI label still attempt live resolve', async () => {
  const display = { x: 0, y: 0, width: 1920, height: 1080 };
  const step = {
    step_number: 2,
    instruction: 'Confirm Dependabot alerts are enabled.',
    target_label: 'Dependabot',
    anchor_mode: 'screenshot' as const,
    screenshot_url: 'https://example/s.png',
  };

  assert.equal(shouldAttemptLiveResolve(step), true);

  let ocrCalls = 0;
  let visionCalls = 0;
  const resolved = await resolvePlaybackTarget(step, display, {
    resolveAccessibility: async () => null,
    resolveOcr: async () => {
      ocrCalls += 1;
      return { x: 120, y: 340, width: 160, height: 28 };
    },
    resolveVisionGrid: async () => {
      visionCalls += 1;
      return null;
    },
  });

  assert.equal(ocrCalls, 1);
  assert.equal(visionCalls, 1);
  assert.equal(resolved.source, 'ocr');
  assert.equal(resolved.fallbackNote, null);
  assert.ok(resolved.rect);
});

test('miss fallback suggests Previous after step 1', () => {
  assert.match(buildMissFallbackNote({ step_number: 1, instruction: 'Start' }), /use Next/);
  assert.doesNotMatch(
    buildMissFallbackNote({ step_number: 1, instruction: 'Start' }),
    /press Previous/,
  );
  assert.match(
    buildMissFallbackNote({ step_number: 2, instruction: 'Next action' }),
    /press Previous to go back/,
  );
});

test('miss fallback explicitly names Windows-only a11y degrade on non-Windows', () => {
  const note = buildMissFallbackNote(
    { step_number: 1, instruction: 'Start' },
    {
      a11yAvailable: false,
      a11yDegradeNote:
        'Accessibility (a11y) lookup is Windows-only; this session uses OCR + vision only.',
    },
  );
  assert.match(note, /Windows-only/);
  assert.match(note, /OCR \+ vision only/);
});

test('resolvePlaybackTarget never paints non-screen recorded hints', async () => {
  const display = { x: 100, y: 50, width: 1920, height: 1080 };

  const viaHighlight = await resolvePlaybackTarget(
    {
      step_number: 2,
      instruction: 'Click New issue',
      target_label: 'New issue',
      screenshot_highlight: { x: 150, y: 80, width: 100, height: 40 },
    },
    display,
  );
  assert.equal(viaHighlight.source, 'unidentified');
  assert.equal(viaHighlight.rect, null);
  assert.match(String(viaHighlight.fallbackNote), /press Previous to go back/);

  const missed = await resolvePlaybackTarget(
    { step_number: 1, instruction: 'Click Send', target_label: 'Send' },
    display,
  );
  assert.equal(missed.source, 'unidentified');
  assert.equal(missed.rect, null);
  assert.match(String(missed.fallbackNote), /use Next/);

  const browserRaw = await resolvePlaybackTarget(
    {
      step_number: 2,
      instruction: 'Open Claude',
      raw_coordinates: { x: 400, y: 300 },
    },
    display,
  );
  assert.equal(browserRaw.source, 'unidentified');
  assert.equal(browserRaw.rect, null);

  const hinted = await resolvePlaybackTarget(
    {
      step_number: 2,
      instruction: 'Open Claude',
      raw_coordinates: { x: 400, y: 300 },
      attrs: { layer: 'desktop', platform: 'win32', foreground_app: 'Chrome' },
    },
    display,
  );
  // Live miss: honest approximate hole from recorded screen coords (dashed UI).
  assert.equal(hinted.source, 'recorded_approximate');
  assert.ok(hinted.rect);
  assert.equal(hinted.rect?.x, 360);
  assert.equal(hinted.rect?.y, 280);
  assert.match(String(hinted.fallbackNote), /Approximate \(recorded\)/);

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
  // Desktop always attempts live resolve when instruction text exists (Clicky).
  assert.equal(
    shouldAttemptLiveResolve({
      step_number: 3,
      instruction: 'Read this',
      screenshot_url: 'https://example/s.png',
    }),
    true,
  );

  assert.equal(
    shouldAttemptLiveResolve({
      step_number: 4,
      instruction: 'Click where you clicked before',
      anchor_mode: 'none',
      raw_coordinates: { x: 400, y: 300 },
      attrs: { layer: 'desktop', coordinate_space: 'screen' },
    }),
    true,
  );
});

test('full-display vision mapping uses contentBounds equal to display', () => {
  const display = { x: 0, y: 0, width: 1920, height: 1080 };
  const located = mapViewportRectToScreen(
    { x: 1600, y: 40, width: 140, height: 40 },
    display,
    1920,
    1080,
  );
  assert.deepEqual(located, { x: 1600, y: 40, width: 140, height: 40 });
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

test('vision env failures log distinct diagnosable reasons', () => {
  assert.match(formatVisionFailureLog('not_authenticated'), /not signed in/);
  assert.match(formatVisionFailureLog('config_missing'), /API key/);
  assert.match(formatVisionFailureLog('network_error', 'ECONNRESET'), /network error.*ECONNRESET/);
  assert.match(formatVisionFailureLog('no_match'), /no usable match/);
  assert.notEqual(formatVisionFailureLog('config_missing'), formatVisionFailureLog('no_match'));
});

test('stale resolve generation is discarded (rapid Next race)', async () => {
  assert.equal(shouldApplyResolution(1, 1), true);
  assert.equal(shouldApplyResolution(1, 2), false);
  assert.equal(shouldApplyResolution(3, 3), true);

  // Simulate three rapid Next clicks while one slow vision call is in flight.
  let appliedStep: number | null = null;
  let currentGeneration = 0;
  const slowVisionForStep = async (stepIndex: number, gen: number) => {
    await new Promise((r) => setTimeout(r, stepIndex === 0 ? 40 : 5));
    if (!shouldApplyResolution(gen, currentGeneration)) {
      return;
    }
    appliedStep = stepIndex;
  };

  const g0 = ++currentGeneration;
  const p0 = slowVisionForStep(0, g0);
  const g1 = ++currentGeneration;
  const p1 = slowVisionForStep(1, g1);
  const g2 = ++currentGeneration;
  const p2 = slowVisionForStep(2, g2);
  await Promise.all([p0, p1, p2]);
  assert.equal(appliedStep, 2);
});

test('vision unavailable still resolves via a11y or OCR', async () => {
  const display = { x: 0, y: 0, width: 1920, height: 1080 };

  // Short "Save" is not extreme - vision is attempted; on miss, a11y remains.
  const viaA11y = await resolvePlaybackTarget(
    { step_number: 1, instruction: 'Click Save', target_label: 'Save' },
    display,
    {
      resolveAccessibility: async () => ({ x: 10, y: 20, width: 60, height: 24 }),
      resolveOcr: async () => null,
      resolveVisionGrid: async () => null,
    },
  );
  assert.equal(viaA11y.source, 'accessibility_api');
  assert.ok(viaA11y.rect);

  const viaOcr = await resolvePlaybackTarget(
    { step_number: 1, instruction: 'Click Save', target_label: 'Save' },
    display,
    {
      resolveAccessibility: async () => null,
      resolveOcr: async () => ({ x: 40, y: 50, width: 70, height: 28 }),
      resolveVisionGrid: async () => null,
    },
  );
  assert.equal(viaOcr.source, 'ocr');
});

test('OCR text matcher maps image boxes onto window contentBounds', () => {
  const windowBounds = { x: 100, y: 80, width: 800, height: 600 };
  const words = [
    { text: 'New', x0: 10, y0: 20, x1: 50, y1: 40 },
    { text: 'issue', x0: 55, y0: 20, x1: 120, y1: 40 },
  ];
  const rect = findTextRectInOcrWords(words, 'New issue', windowBounds, 800, 600);
  assert.ok(rect);
  assert.equal(rect.x, 110);
  assert.equal(rect.y, 100);
  assert.equal(rect.width, 110);
  assert.equal(rect.height, 20);
});

test('OCR matcher rejects loose substring hits that paint the wrong control', () => {
  const windowBounds = { x: 0, y: 0, width: 1000, height: 800 };
  const words = [
    { text: 'Code', x0: 10, y0: 100, x1: 60, y1: 120 },
    { text: 'scanning', x0: 65, y0: 100, x1: 140, y1: 120 },
    { text: 'alerts', x0: 145, y0: 100, x1: 200, y1: 120 },
  ];
  const wrong = findTextRectInOcrWords(words, 'Code frequency', windowBounds, 1000, 800);
  assert.equal(wrong, null);
});

test('OCR prefers standalone label over same words as heading prefix', () => {
  const windowBounds = { x: 0, y: 0, width: 1200, height: 800 };
  // Nav item alone on its line, then H1 "Code frequency over the history..."
  const words = [
    { text: 'Code', x0: 20, y0: 200, x1: 70, y1: 220 },
    { text: 'frequency', x0: 75, y0: 200, x1: 160, y1: 220 },
    { text: 'Code', x0: 280, y0: 40, x1: 420, y1: 80 },
    { text: 'frequency', x0: 430, y0: 40, x1: 620, y1: 80 },
    { text: 'over', x0: 630, y0: 40, x1: 700, y1: 80 },
    { text: 'the', x0: 710, y0: 40, x1: 760, y1: 80 },
    { text: 'history', x0: 770, y0: 40, x1: 900, y1: 80 },
  ];
  const rect = findTextRectInOcrWords(words, 'Code frequency', windowBounds, 1200, 800);
  assert.ok(rect);
  assert.ok(rect.y > 100, 'should pick the standalone nav line, not the heading line');

  const best = pickBestOcrMatch([
    { x: 280, y: 40, width: 340, height: 40, standalone: false },
    { x: 20, y: 200, width: 140, height: 20, standalone: true },
  ]);
  assert.equal(best?.standalone, true);
  assert.equal(best?.y, 200);
});

test('resolveStepPageUrl mirrors extension expected_url / instruction order', () => {
  assert.equal(
    resolveStepPageUrl({
      step_number: 1,
      instruction: 'Go somewhere',
      expected_url: 'https://example.com/settings',
    }),
    'https://example.com/settings',
  );
  assert.equal(
    resolveStepPageUrl({
      step_number: 2,
      instruction: 'Open https://example.com/docs/start now',
    }),
    'https://example.com/docs/start',
  );
  assert.equal(
    resolveStepPageUrl({
      step_number: 3,
      instruction: "Click on the 'Insights' link",
      attrs: { page_url: 'https://github.com/org/repo/pulse' },
    }),
    'https://github.com/org/repo/pulse',
  );
  // No inventing paths from button labels alone.
  assert.equal(
    resolveStepPageUrl({
      step_number: 4,
      instruction: "Click 'Code frequency'",
      target_label: 'Code frequency',
    }),
    null,
  );
  assert.equal(needleForStep({ step_number: 1, instruction: "Open 'Insights'" }), 'Insights');
  assert.equal(
    needleForStep({
      step_number: 1,
      instruction: "Click within the 'Claude' application window.",
      target_label: 'Claude',
      attrs: { foreground_app: 'Claude', window_title: 'Claude' },
    }),
    '',
  );
  assert.equal(
    needleForStep({
      step_number: 1,
      instruction: "Click 'Create project'",
      target_label: 'Claude',
      attrs: { foreground_app: 'Claude', window_title: 'Claude' },
    }),
    'Create project',
  );
  assert.equal(
    needleForStep({
      step_number: 1,
      instruction: 'Click Create project.',
      attrs: { foreground_app: 'Claude' },
    }),
    'Create project',
  );
  assert.equal(
    needleForStep({
      step_number: 1,
      instruction: 'Click the highlighted control in the Claude window.',
      attrs: { foreground_app: 'Claude', window_title: 'Claude' },
    }),
    '',
  );
  assert.equal(
    needleForStep({
      step_number: 2,
      instruction: "Press a series of keys on the keyboard while 'Claude' is active.",
      attrs: { foreground_app: 'Claude' },
    }),
    '',
  );
  assert.equal(
    needleForStep({
      step_number: 3,
      instruction: 'Click the highlighted control.',
      target_label: null,
      attrs: {
        foreground_app: 'Claude',
        uia_help_text: 'New chat',
        uia_control_type: 'ControlType.Button',
      },
    }),
    'New chat',
  );
});

test('privacy crop uses window intersect, not full display', () => {
  const display = { x: 0, y: 0, width: 1920, height: 1080 };
  const windowBounds = { x: 200, y: 100, width: 1000, height: 700 };
  const clipped = intersectRects(display, windowBounds);
  assert.deepEqual(clipped, windowBounds);
  assert.notDeepEqual(clipped, display);

  const offscreen = intersectRects(display, { x: -50, y: 0, width: 80, height: 100 });
  assert.deepEqual(offscreen, { x: 0, y: 0, width: 30, height: 100 });
});

test('resolveCaptureCrop uses full display when live is Electron (no stale recorded bounds)', async () => {
  const { resolveCaptureCrop } = await import('./capture-crop.js');
  const display = { x: 0, y: 0, width: 1707, height: 1067 };
  const recorded = { x: 100, y: 40, width: 1200, height: 900 };
  const decision = resolveCaptureCrop(display, {
    liveAppName: 'Electron',
    liveBounds: { x: 0, y: 0, width: 400, height: 300 },
    step: {
      step_number: 1,
      instruction: 'Click Chat',
      attrs: { window_bounds: recorded, foreground_app: 'Claude' },
    },
  });
  assert.equal(decision.crop, null);
  assert.match(decision.reason, /full_display/);
});

test('resolveCaptureCrop prefers live target app window when overlay holds focus', async () => {
  const { resolveCaptureCrop } = await import('./capture-crop.js');
  const display = { x: 0, y: 0, width: 1707, height: 1067 };
  const claude = { x: 80, y: 40, width: 1400, height: 900 };
  const decision = resolveCaptureCrop(display, {
    liveAppName: 'Electron',
    liveBounds: { x: 0, y: 0, width: 400, height: 300 },
    targetAppName: 'Claude',
    targetAppBounds: claude,
  });
  assert.deepEqual(decision.crop, claude);
  assert.equal(decision.reason, 'target_app=Claude');
});

test('viewport highlight alone cannot become a screen-space resolve', async () => {
  const display = { x: 0, y: 0, width: 1920, height: 1080 };
  const result = await resolvePlaybackTarget(
    {
      step_number: 1,
      instruction: 'Click',
      target_label: 'X',
      screenshot_highlight: { x: 400, y: 300, width: 120, height: 40 },
    },
    display,
    {
      resolveAccessibility: async () => null,
      resolveOcr: async () => null,
      resolveVisionGrid: async () => null,
    },
  );
  assert.equal(result.rect, null);
  assert.equal(result.source, 'unidentified');
});

test('two-stage grid mapping works at non-default DPI scale factors', () => {
  // Physical capture at 150% DPI: image pixels are 1.5x logical CSS size,
  // but contentBounds stay in screen logical units used by the overlay.
  const scaleFactor = 1.5;
  const logicalWindow = { x: 80, y: 60, width: 1000, height: 700 };
  const imageWidth = Math.round(logicalWindow.width * scaleFactor);
  const imageHeight = Math.round(logicalWindow.height * scaleFactor);

  const coarse = refineGridCell(
    { x: 0, y: 0, width: imageWidth, height: imageHeight },
    2,
    1,
    12,
    8,
    0,
    0,
    6,
    6,
  );
  const fine = refineGridCell(
    { x: 0, y: 0, width: imageWidth, height: imageHeight },
    2,
    1,
    12,
    8,
    3,
    2,
    6,
    6,
  );

  const screenFine = mapViewportRectToScreen(fine, logicalWindow, imageWidth, imageHeight);
  assert.ok(screenFine);
  assert.ok(screenFine.x >= logicalWindow.x);
  assert.ok(screenFine.y >= logicalWindow.y);
  assert.ok(screenFine.x + screenFine.width <= logicalWindow.x + logicalWindow.width + 1);
  assert.ok(screenFine.y + screenFine.height <= logicalWindow.y + logicalWindow.height + 1);

  // Coarse cell maps into a larger region containing the fine cell.
  const screenCoarse = mapViewportRectToScreen(coarse, logicalWindow, imageWidth, imageHeight);
  assert.ok(screenCoarse);
  assert.ok(screenFine.x >= screenCoarse.x - 0.5);
  assert.ok(screenFine.y >= screenCoarse.y - 0.5);
});
