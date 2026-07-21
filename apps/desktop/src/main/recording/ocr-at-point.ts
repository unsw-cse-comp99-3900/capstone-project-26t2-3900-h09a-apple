import { captureDisplayRegionPng } from '../walkthrough/screen-capture';
import { recognizePngWords } from '../walkthrough/ocr-resolve';
import type { OcrWordBox } from '../walkthrough/ocr-resolve';
import type { ScreenRect } from '../walkthrough/types';

/** Small neighbourhood (DIP) sampled around a click when UIA gives no Name. */
const CROP_WIDTH = 300;
const CROP_HEIGHT = 96;
const MAX_LABEL_CHARS = 48;

type RecognizeFn = (pngBase64: string) => Promise<OcrWordBox[]>;
type CaptureFn = (
  displayBounds: ScreenRect,
  cropToScreenRect?: ScreenRect | null,
) => Promise<{ base64: string; width: number; height: number; contentBounds: ScreenRect } | null>;

function clampCrop(centerX: number, centerY: number, display: ScreenRect): ScreenRect {
  const width = Math.min(CROP_WIDTH, display.width);
  const height = Math.min(CROP_HEIGHT, display.height);
  const x = Math.min(Math.max(display.x, centerX - width / 2), display.x + display.width - width);
  const y = Math.min(
    Math.max(display.y, centerY - height / 2),
    display.y + display.height - height,
  );
  return { x, y, width, height };
}

function sameLine(a: OcrWordBox, b: OcrWordBox): boolean {
  const midA = (a.y0 + a.y1) / 2;
  const midB = (b.y0 + b.y1) / 2;
  const tol = Math.max(6, (a.y1 - a.y0) * 0.6);
  return Math.abs(midA - midB) <= tol;
}

/**
 * OCR the text nearest a screen click. Returns the on-screen label of the
 * control the user clicked when accessibility exposed no Name (common for
 * Claude / Electron). Picks the word under the click, then joins same-line
 * neighbours so multi-word buttons ("Create project") stay intact.
 */
export async function ocrLabelAtPoint(
  screenX: number,
  screenY: number,
  displayBounds: ScreenRect,
  deps?: { recognize?: RecognizeFn; capture?: CaptureFn },
): Promise<string | null> {
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) {
    return null;
  }

  const capture = deps?.capture ?? captureDisplayRegionPng;
  const recognize = deps?.recognize ?? recognizePngWords;

  const crop = clampCrop(screenX, screenY, displayBounds);
  const shot = await capture(displayBounds, crop);
  if (!shot || !(shot.width > 0) || !(shot.height > 0)) {
    return null;
  }

  let words: OcrWordBox[];
  try {
    words = await recognize(shot.base64);
  } catch (error) {
    console.warn(
      '[desktop] ocr-at-point failed:',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
  const usable = words.filter((word) => String(word.text || '').trim().length > 0);
  if (usable.length === 0) {
    return null;
  }

  // Click point → image-pixel space (contentBounds is the crop in screen DIP).
  const imgX = ((screenX - shot.contentBounds.x) / shot.contentBounds.width) * shot.width;
  const imgY = ((screenY - shot.contentBounds.y) / shot.contentBounds.height) * shot.height;

  const nearest = pickNearestWord(usable, imgX, imgY);
  if (!nearest) {
    return null;
  }

  const line = usable.filter((word) => sameLine(nearest, word)).sort((a, b) => a.x0 - b.x0);

  const label = line
    .map((word) => String(word.text).trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!label || label.length > MAX_LABEL_CHARS || !/[a-zA-Z0-9]/.test(label)) {
    return null;
  }
  return label;
}

function pickNearestWord(words: OcrWordBox[], imgX: number, imgY: number): OcrWordBox | null {
  let best: OcrWordBox | null = null;
  let bestDist = Infinity;
  for (const word of words) {
    const inside = imgX >= word.x0 && imgX <= word.x1 && imgY >= word.y0 && imgY <= word.y1;
    const cx = (word.x0 + word.x1) / 2;
    const cy = (word.y0 + word.y1) / 2;
    const dist = inside ? 0 : (cx - imgX) ** 2 + (cy - imgY) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = word;
    }
    if (dist === 0) {
      break;
    }
  }
  return best;
}
