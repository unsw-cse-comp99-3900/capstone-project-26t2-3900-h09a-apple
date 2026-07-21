import assert from 'node:assert/strict';
import test from 'node:test';

import { EventCollector, type NormalizedDesktopEvent } from './event-collector';

function baseEvent(
  partial: Partial<NormalizedDesktopEvent> & Pick<NormalizedDesktopEvent, 'type' | 'category'>,
): NormalizedDesktopEvent {
  return {
    timestamp_ms: Date.now(),
    raw_x: null,
    raw_y: null,
    attrs: {},
    ...partial,
  };
}

test('window_change debounce collapses rapid same target', () => {
  const out: NormalizedDesktopEvent[] = [];
  const collector = new EventCollector((e) => out.push(e), { windowChangeDebounceMs: 300 });

  collector.emitWindowChange(
    baseEvent({
      category: 'system',
      type: 'window_change',
      timestamp_ms: 1000,
      attrs: { to_app: 'Claude', to_title: 'Claude' },
    }),
  );
  collector.emitWindowChange(
    baseEvent({
      category: 'system',
      type: 'window_change',
      timestamp_ms: 1100,
      attrs: { to_app: 'Claude', to_title: 'Claude' },
    }),
  );
  collector.emitWindowChange(
    baseEvent({
      category: 'system',
      type: 'window_change',
      timestamp_ms: 1500,
      attrs: { to_app: 'Chrome', to_title: 'Docs' },
    }),
  );

  assert.equal(out.length, 2);
  assert.equal(out[0]?.attrs.to_app, 'Claude');
  assert.equal(out[1]?.attrs.to_app, 'Chrome');
});

test('scroll merges deltas within the merge window', async () => {
  const out: NormalizedDesktopEvent[] = [];
  const collector = new EventCollector((e) => out.push(e), { scrollMergeMs: 40 });

  collector.emitScroll(
    baseEvent({
      category: 'mouse',
      type: 'scroll',
      timestamp_ms: 1,
      attrs: { delta_x: 0, delta_y: 3 },
    }),
  );
  collector.emitScroll(
    baseEvent({
      category: 'mouse',
      type: 'scroll',
      timestamp_ms: 2,
      attrs: { delta_x: 1, delta_y: 2 },
    }),
  );

  await new Promise((r) => setTimeout(r, 80));
  assert.equal(out.length, 1);
  assert.equal(out[0]?.attrs.delta_x, 1);
  assert.equal(out[0]?.attrs.delta_y, 5);
});

test('focus_change skips duplicate names', () => {
  const out: NormalizedDesktopEvent[] = [];
  const collector = new EventCollector((e) => out.push(e));

  collector.emitFocusChange(
    baseEvent({
      category: 'a11y',
      type: 'focus_change',
      attrs: { to_name: 'Create project' },
      target_label: 'Create project',
    }),
  );
  collector.emitFocusChange(
    baseEvent({
      category: 'a11y',
      type: 'focus_change',
      attrs: { to_name: 'Create project' },
      target_label: 'Create project',
    }),
  );
  collector.emitFocusChange(
    baseEvent({
      category: 'a11y',
      type: 'focus_change',
      attrs: { to_name: 'Cancel' },
      target_label: 'Cancel',
    }),
  );

  assert.equal(out.length, 2);
  assert.equal(out[0]?.attrs.from_name, null);
  assert.equal(out[1]?.attrs.from_name, 'Create project');
  assert.equal(out[1]?.attrs.to_name, 'Cancel');
});

test('pointer_sample stays off by default', () => {
  const out: NormalizedDesktopEvent[] = [];
  const collector = new EventCollector((e) => out.push(e));
  collector.emitPointerSample(
    baseEvent({
      category: 'mouse',
      type: 'pointer_sample',
      raw_x: 10,
      raw_y: 20,
      timestamp_ms: 1000,
    }),
  );
  assert.equal(out.length, 0);
});
