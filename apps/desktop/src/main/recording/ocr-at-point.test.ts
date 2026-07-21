import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ocrLabelAtPoint } from './ocr-at-point';
import type { ScreenRect } from '../walkthrough/types';

const DISPLAY: ScreenRect = { x: 0, y: 0, width: 1920, height: 1080 };

function fakeCapture(width: number, height: number) {
  return async (_display: ScreenRect, crop?: ScreenRect | null) => ({
    base64: 'x',
    width,
    height,
    contentBounds: crop ?? _display,
  });
}

test('joins same-line words into a multi-word button label', async () => {
  const label = await ocrLabelAtPoint(500, 400, DISPLAY, {
    capture: fakeCapture(300, 96),
    recognize: async () => [
      { text: 'Create', x0: 100, x1: 170, y0: 40, y1: 60 },
      { text: 'project', x0: 175, x1: 260, y0: 40, y1: 60 },
      { text: 'Sidebar', x0: 10, x1: 60, y0: 5, y1: 20 },
    ],
  });
  assert.equal(label, 'Create project');
});

test('returns null when OCR finds no usable words', async () => {
  const label = await ocrLabelAtPoint(500, 400, DISPLAY, {
    capture: fakeCapture(300, 96),
    recognize: async () => [],
  });
  assert.equal(label, null);
});

test('rejects an over-long OCR run rather than storing noise', async () => {
  const label = await ocrLabelAtPoint(500, 400, DISPLAY, {
    capture: fakeCapture(300, 96),
    recognize: async () =>
      'the quick brown fox jumps over the lazy dog again and again now'
        .split(' ')
        .map((text, i) => ({ text, x0: 100 + i * 20, x1: 118 + i * 20, y0: 40, y1: 60 })),
  });
  assert.equal(label, null);
});
