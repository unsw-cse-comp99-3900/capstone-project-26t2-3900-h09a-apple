import type { ScreenRect, WalkthroughStep } from './types';
import { getForegroundWindowBounds } from './foreground-window';
import { captureDisplayRegionPng } from './screen-capture';
import { mapViewportRectToScreen } from './coordinate-space';

export interface OcrWordBox {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function needleForStep(step: WalkthroughStep): string {
  if (typeof step.target_label === 'string' && step.target_label.trim()) {
    return step.target_label.trim();
  }
  return '';
}

function toImageRect(words: OcrWordBox[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const x0 = Math.min(...words.map((word) => word.x0));
  const y0 = Math.min(...words.map((word) => word.y0));
  const x1 = Math.max(...words.map((word) => word.x1));
  const y1 = Math.max(...words.map((word) => word.y1));
  return {
    x: x0,
    y: y0,
    width: Math.max(1, x1 - x0),
    height: Math.max(1, y1 - y0),
  };
}

/** Pure matcher used by tests (no tesseract worker). */
export function findTextRectInOcrWords(
  words: OcrWordBox[],
  needle: string,
  contentBounds: ScreenRect,
  imageWidth: number,
  imageHeight: number,
): ScreenRect | null {
  const target = needle.trim().toLowerCase();
  if (!target || words.length === 0) {
    return null;
  }

  const normalized = words
    .map((word) => ({
      text: String(word.text || '').trim(),
      x0: word.x0,
      y0: word.y0,
      x1: word.x1,
      y1: word.y1,
    }))
    .filter((word) => word.text.length > 0);

  for (let i = 0; i < normalized.length; i += 1) {
    for (let span = 1; span <= 6 && i + span <= normalized.length; span += 1) {
      const slice = normalized.slice(i, i + span);
      const combined = slice
        .map((word) => word.text.toLowerCase())
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (combined === target || (target.length >= 3 && combined.includes(target))) {
        return mapViewportRectToScreen(toImageRect(slice), contentBounds, imageWidth, imageHeight);
      }
    }
  }

  return null;
}

type RecognizeFn = (pngBase64: string) => Promise<OcrWordBox[]>;

let defaultRecognize: RecognizeFn | null = null;

async function getDefaultRecognize(): Promise<RecognizeFn> {
  if (defaultRecognize) {
    return defaultRecognize;
  }

  const tesseract = await import('tesseract.js');
  defaultRecognize = async (pngBase64: string) => {
    const buffer = Buffer.from(pngBase64, 'base64');
    const result = await tesseract.recognize(buffer, 'eng', {
      logger: () => undefined,
    });
    const words = (result.data.words ?? []) as Array<{
      text?: string;
      bbox?: { x0: number; y0: number; x1: number; y1: number };
    }>;
    return words
      .filter((word) => word.bbox && word.text)
      .map((word) => ({
        text: String(word.text),
        x0: word.bbox!.x0,
        y0: word.bbox!.y0,
        x1: word.bbox!.x1,
        y1: word.bbox!.y1,
      }));
  };
  return defaultRecognize;
}

/**
 * Local OCR (H09AAPPLE-73 tooling: tesseract.js) over the foreground window crop.
 */
export async function resolveOcrTarget(
  step: WalkthroughStep,
  displayBounds: ScreenRect,
  options?: {
    recognize?: RecognizeFn;
    getWindowBounds?: typeof getForegroundWindowBounds;
    captureRegion?: typeof captureDisplayRegionPng;
  },
): Promise<ScreenRect | null> {
  const needle = needleForStep(step);
  if (!needle) {
    return null;
  }

  const getWindow = options?.getWindowBounds ?? getForegroundWindowBounds;
  const captureRegion = options?.captureRegion ?? captureDisplayRegionPng;
  const foreground = await getWindow();
  const crop = foreground?.bounds ?? null;

  if (!crop) {
    console.warn('[walkthrough] ocr failed: no foreground window bounds');
    return null;
  }

  const capture = await captureRegion(displayBounds, crop);
  if (!capture) {
    console.warn('[walkthrough] ocr failed: window capture unavailable');
    return null;
  }

  try {
    const recognize = options?.recognize ?? (await getDefaultRecognize());
    const words = await recognize(capture.base64);
    const rect = findTextRectInOcrWords(
      words,
      needle,
      capture.contentBounds,
      capture.width,
      capture.height,
    );
    if (!rect) {
      console.info('[walkthrough] ocr: no text match for', needle);
    }
    return rect;
  } catch (error) {
    console.warn(
      '[walkthrough] ocr failed:',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}
