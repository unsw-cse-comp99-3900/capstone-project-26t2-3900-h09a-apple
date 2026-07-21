import { desktopCapturer, nativeImage, type DesktopCapturerSource } from 'electron';
import type { ScreenRect } from './types';
import { displayForBounds } from './active-display';
import { intersectRects } from './foreground-window';

export interface CapturedPng {
  base64: string;
  width: number;
  height: number;
  /** Screen-space rect corresponding to the image content (DIP / logical). */
  contentBounds: ScreenRect;
}

export type CaptureFailReason = 'no_sources' | 'empty_thumbnail' | 'crop_miss' | 'crop_empty';

export type CaptureResult =
  | { ok: true; capture: CapturedPng }
  | { ok: false; reason: CaptureFailReason; detail?: string };

/** Cap thumbnail edges: smaller = faster upload + vision; still enough for POINT. */
const MAX_THUMB_EDGE = 1280;
/**
 * Final PNG sent to vision is always capped to this edge, independent of how
 * large the pre-crop grab was. Lets the coarse-to-fine refine pass grab the
 * display at (near) native resolution, crop a tight region, then downscale only
 * that small region for upload — so the target keeps its pixels.
 */
const UPLOAD_MAX_EDGE = 1280;

type ThumbMode = 'dip' | 'physical';

function cappedSize(
  width: number,
  height: number,
  maxEdge: number = MAX_THUMB_EDGE,
): { width: number; height: number } {
  let w = Math.max(1, Math.round(width));
  let h = Math.max(1, Math.round(height));
  const longest = Math.max(w, h);
  if (longest > maxEdge) {
    const scale = maxEdge / longest;
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
  }
  return { width: w, height: h };
}

function aspectScore(imageWidth: number, imageHeight: number, bounds: ScreenRect): number {
  const displayAspect = bounds.width / Math.max(1, bounds.height);
  const imageAspect = imageWidth / Math.max(1, imageHeight);
  // 0 = perfect match; lower is better.
  return Math.abs(displayAspect - imageAspect);
}

function pickSource(
  sources: DesktopCapturerSource[],
  displayId: string,
): DesktopCapturerSource | undefined {
  return (
    sources.find((entry) => entry.display_id === displayId) ??
    sources.find((entry) => String(entry.display_id) === displayId) ??
    sources.find((entry) => /screen|entire|display/i.test(entry.name)) ??
    sources[0]
  );
}

async function grabThumbnail(
  displayBounds: ScreenRect,
  displayId: string,
  thumb: { width: number; height: number },
): Promise<{ image: Electron.NativeImage; modeHint: string } | null> {
  let sources: DesktopCapturerSource[];
  try {
    sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: thumb,
      fetchWindowIcons: false,
    });
  } catch {
    return null;
  }
  if (!sources.length) {
    return null;
  }
  const source = pickSource(sources, displayId);
  if (!source || source.thumbnail.isEmpty()) {
    return null;
  }
  return { image: source.thumbnail, modeHint: `${thumb.width}x${thumb.height}` };
}

/**
 * Adaptive capture: try DIP-sized and physical-sized thumbnails, keep the one
 * whose aspect ratio best matches the logical display. Mapping always uses
 * actual image pixels -> contentBounds (works at 100%/125%/150%/200%).
 */
export async function captureDisplayRegionPng(
  displayBounds: ScreenRect,
  cropToScreenRect?: ScreenRect | null,
): Promise<CapturedPng | null> {
  const result = await captureDisplayRegionPngDetailed(displayBounds, cropToScreenRect);
  return result.ok ? result.capture : null;
}

export interface CaptureOptions {
  /**
   * Edge cap for the whole-display grab BEFORE cropping. Raise it (e.g. native
   * physical resolution) so a small crop keeps real detail for a refine pass.
   * The cropped result is still downscaled to UPLOAD_MAX_EDGE for upload.
   */
  maxEdge?: number;
}

export async function captureDisplayRegionPngDetailed(
  displayBounds: ScreenRect,
  cropToScreenRect?: ScreenRect | null,
  options?: CaptureOptions,
): Promise<CaptureResult> {
  const display = displayForBounds(displayBounds);
  const scaleFactor = display.scaleFactor || 1;
  const targetId = String(display.id);
  const grabMaxEdge = options?.maxEdge && options.maxEdge > 0 ? options.maxEdge : MAX_THUMB_EDGE;

  const modes: Array<{ mode: ThumbMode; width: number; height: number }> = [
    {
      mode: 'dip',
      ...cappedSize(displayBounds.width, displayBounds.height, grabMaxEdge),
    },
    {
      mode: 'physical',
      ...cappedSize(
        displayBounds.width * scaleFactor,
        displayBounds.height * scaleFactor,
        grabMaxEdge,
      ),
    },
  ];

  // Dedupe if scaleFactor === 1 (same request twice).
  const uniqueModes = modes.filter(
    (entry, index, all) =>
      all.findIndex((other) => other.width === entry.width && other.height === entry.height) ===
      index,
  );

  let best: {
    image: Electron.NativeImage;
    mode: ThumbMode;
    score: number;
    requested: string;
  } | null = null;

  for (const candidate of uniqueModes) {
    const grabbed = await grabThumbnail(displayBounds, targetId, {
      width: candidate.width,
      height: candidate.height,
    });
    if (!grabbed) {
      continue;
    }
    const size = grabbed.image.getSize();
    const score = aspectScore(size.width, size.height, displayBounds);
    if (
      !best ||
      score < best.score - 1e-6 ||
      (score <= best.score + 1e-6 && candidate.mode === 'dip')
    ) {
      best = {
        image: grabbed.image,
        mode: candidate.mode,
        score,
        requested: grabbed.modeHint,
      };
    }
  }

  if (!best) {
    return {
      ok: false,
      reason: 'empty_thumbnail',
      detail: `wanted display_id=${targetId}; scaleFactor=${scaleFactor}`,
    };
  }

  let image = best.image;
  let contentBounds = { ...displayBounds };
  const imgSize0 = image.getSize();

  console.info(
    `[walkthrough] capture adaptive: mode=${best.mode} scaleFactor=${scaleFactor} ` +
      `display=${displayBounds.width}x${displayBounds.height} ` +
      `image=${imgSize0.width}x${imgSize0.height} aspectErr=${best.score.toFixed(4)} ` +
      `requested=${best.requested}`,
  );

  if (cropToScreenRect) {
    const clipped = intersectRects(displayBounds, cropToScreenRect);
    if (!clipped) {
      return {
        ok: false,
        reason: 'crop_miss',
        detail: `crop=${JSON.stringify(cropToScreenRect)} display=${JSON.stringify(displayBounds)}`,
      };
    }

    const imgSize = image.getSize();
    // Image spans the full displayBounds in DIP; scale crop DIP -> image pixels.
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
      return { ok: false, reason: 'crop_empty', detail: JSON.stringify(crop) };
    }
    contentBounds = clipped;

    // A high-res pre-crop grab can leave the cropped region larger than needed
    // for upload. Downscale only the crop (contentBounds stays in DIP, so the
    // image-pixels -> contentBounds mapping is unaffected).
    const croppedSize = image.getSize();
    const croppedLongest = Math.max(croppedSize.width, croppedSize.height);
    if (croppedLongest > UPLOAD_MAX_EDGE) {
      const scale = UPLOAD_MAX_EDGE / croppedLongest;
      image = image.resize({
        width: Math.max(1, Math.round(croppedSize.width * scale)),
        height: Math.max(1, Math.round(croppedSize.height * scale)),
        quality: 'best',
      });
    }
  }

  const size = image.getSize();
  if (!(size.width > 0) || !(size.height > 0)) {
    return { ok: false, reason: 'empty_thumbnail', detail: 'final size zero' };
  }

  return {
    ok: true,
    capture: {
      base64: image.toPNG().toString('base64'),
      width: size.width,
      height: size.height,
      contentBounds,
    },
  };
}
