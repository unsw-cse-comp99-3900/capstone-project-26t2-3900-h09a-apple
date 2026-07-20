import type { ScreenRect, WalkthroughStep } from './types';
import { getForegroundWindowBounds } from './foreground-window';
import { captureDisplayRegionPng } from './screen-capture';
import { mapViewportRectToScreen } from './coordinate-space';
import { needleForStep } from './step-navigation';

export interface OcrWordBox {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
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

export interface OcrImageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrMatchCandidate extends OcrImageRect {
  /** True when no more OCR tokens continue on the same visual line after the hit. */
  standalone: boolean;
}

function sameLine(a: { y0: number; y1: number }, b: { y0: number; y1: number }): boolean {
  const midA = (a.y0 + a.y1) / 2;
  const midB = (b.y0 + b.y1) / 2;
  const tol = Math.max(6, (a.y1 - a.y0) * 0.6);
  return Math.abs(midA - midB) <= tol;
}

/**
 * Prefer a standalone label (nav item) over the same words as a heading prefix
 * ("Code frequency" vs "Code frequency over the history...").
 * Area is only a tie-breaker, not "left sidebar means correct".
 */
export function pickBestOcrMatch(candidates: OcrMatchCandidate[]): OcrMatchCandidate | null {
  if (candidates.length === 0) {
    return null;
  }
  const ranked = [...candidates].sort((a, b) => {
    if (a.standalone !== b.standalone) {
      return a.standalone ? -1 : 1;
    }
    const areaA = a.width * a.height;
    const areaB = b.width * b.height;
    if (areaA !== areaB) {
      return areaA - areaB;
    }
    return a.y - b.y;
  });
  return ranked[0] ?? null;
}

/** @deprecated use pickBestOcrMatch */
export function pickBestOcrImageRect(candidates: OcrImageRect[]): OcrImageRect | null {
  return pickBestOcrMatch(candidates.map((c) => ({ ...c, standalone: true })));
}

/**
 * Pure matcher used by tests (no tesseract worker).
 * Exact phrase only. When the phrase appears more than once, prefer a
 * standalone line hit (control label) over a heading that continues afterward.
 */
export function findTextRectInOcrWords(
  words: OcrWordBox[],
  needle: string,
  contentBounds: ScreenRect,
  imageWidth: number,
  imageHeight: number,
): ScreenRect | null {
  const target = needle.trim().toLowerCase().replace(/\s+/g, ' ');
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

  const targetTokens = target.split(' ').filter(Boolean);
  const candidates: OcrMatchCandidate[] = [];

  for (let i = 0; i < normalized.length; i += 1) {
    const span = targetTokens.length;
    if (i + span > normalized.length) {
      break;
    }
    const slice = normalized.slice(i, i + span);
    const combined = slice
      .map((word) => word.text.toLowerCase())
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (combined !== target) {
      continue;
    }

    const last = slice[slice.length - 1];
    const continuesOnLine = normalized.slice(i + span).some((word) => {
      if (!sameLine(last, word)) {
        return false;
      }
      // Token to the right of the match on the same line => heading/sentence.
      return word.x0 >= last.x0;
    });

    const rect = toImageRect(slice);
    candidates.push({ ...rect, standalone: !continuesOnLine });
  }

  const best = pickBestOcrMatch(candidates);
  if (!best) {
    return null;
  }
  return mapViewportRectToScreen(best, contentBounds, imageWidth, imageHeight);
}

type RecognizeFn = (pngBase64: string) => Promise<OcrWordBox[]>;

let defaultRecognize: RecognizeFn | null = null;

async function getDefaultRecognize(): Promise<RecognizeFn> {
  if (defaultRecognize) {
    return defaultRecognize;
  }

  const tesseractMod = (await import('tesseract.js')) as {
    recognize?: typeof import('tesseract.js').recognize;
    default?: { recognize?: typeof import('tesseract.js').recognize };
  };
  const recognize = tesseractMod.recognize ?? tesseractMod.default?.recognize ?? null;
  if (!recognize) {
    throw new Error('tesseract.recognize is not a function');
  }

  defaultRecognize = async (pngBase64: string) => {
    const buffer = Buffer.from(pngBase64, 'base64');
    const result = await recognize(buffer, 'eng', {
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
