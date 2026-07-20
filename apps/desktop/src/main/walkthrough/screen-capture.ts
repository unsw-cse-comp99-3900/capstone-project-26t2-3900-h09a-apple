import { desktopCapturer, nativeImage } from 'electron';
import type { ScreenRect } from './types';
import { displayForBounds } from './active-display';
import { intersectRects } from './foreground-window';

export interface CapturedPng {
  base64: string;
  width: number;
  height: number;
  /** Screen-space rect corresponding to the image content. */
  contentBounds: ScreenRect;
}

/**
 * Capture one display (matched from displayBounds), optionally cropped to a
 * screen-space window rect (privacy: do not upload unrelated apps).
 */
export async function captureDisplayRegionPng(
  displayBounds: ScreenRect,
  cropToScreenRect?: ScreenRect | null,
): Promise<CapturedPng | null> {
  const display = displayForBounds(displayBounds);
  const scaleFactor = display.scaleFactor || 1;
  const thumbWidth = Math.max(1, Math.round(displayBounds.width * scaleFactor));
  const thumbHeight = Math.max(1, Math.round(displayBounds.height * scaleFactor));

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: thumbWidth, height: thumbHeight },
  });

  const targetId = String(display.id);
  const source =
    sources.find((entry) => entry.display_id === targetId) ??
    sources.find((entry) => /screen|entire/i.test(entry.name)) ??
    sources[0];

  if (!source || source.thumbnail.isEmpty()) {
    return null;
  }

  let image = source.thumbnail;
  let contentBounds = { ...displayBounds };

  if (cropToScreenRect) {
    const clipped = intersectRects(displayBounds, cropToScreenRect);
    if (!clipped) {
      return null;
    }

    const imgSize = image.getSize();
    const scaleX = imgSize.width / displayBounds.width;
    const scaleY = imgSize.height / displayBounds.height;
    const crop = {
      x: Math.max(0, Math.round((clipped.x - displayBounds.x) * scaleX)),
      y: Math.max(0, Math.round((clipped.y - displayBounds.y) * scaleY)),
      width: Math.max(1, Math.round(clipped.width * scaleX)),
      height: Math.max(1, Math.round(clipped.height * scaleY)),
    };

    image = nativeImage.createFromBuffer(image.toPNG()).crop(crop);
    if (image.isEmpty()) {
      return null;
    }
    contentBounds = clipped;
  }

  const size = image.getSize();
  return {
    base64: image.toPNG().toString('base64'),
    width: size.width,
    height: size.height,
    contentBounds,
  };
}
