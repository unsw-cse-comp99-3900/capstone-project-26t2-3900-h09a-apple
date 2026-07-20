import { desktopCapturer, screen } from 'electron';
import { authenticatedFetch } from '../auth/auth-service';
import { mapViewportRectToScreen } from './coordinate-space';
import type { ScreenRect, WalkthroughStep } from './types';

function describeStepForVision(step: WalkthroughStep): string {
  if (typeof step.target_label === 'string' && step.target_label.trim()) {
    return step.target_label.trim();
  }
  if (typeof step.instruction === 'string' && step.instruction.trim()) {
    return step.instruction.trim().slice(0, 500);
  }
  return '';
}

async function capturePrimaryDisplayPng(
  displayBounds: ScreenRect,
): Promise<{ base64: string; width: number; height: number } | null> {
  const scaleFactor = screen.getPrimaryDisplay().scaleFactor || 1;
  const thumbWidth = Math.max(1, Math.round(displayBounds.width * scaleFactor));
  const thumbHeight = Math.max(1, Math.round(displayBounds.height * scaleFactor));

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: thumbWidth, height: thumbHeight },
  });

  const primaryId = String(screen.getPrimaryDisplay().id);
  const source =
    sources.find((entry) => entry.display_id === primaryId) ??
    sources.find((entry) => /screen|entire/i.test(entry.name)) ??
    sources[0];

  if (!source || source.thumbnail.isEmpty()) {
    return null;
  }

  const size = source.thumbnail.getSize();
  return {
    base64: source.thumbnail.toPNG().toString('base64'),
    width: size.width,
    height: size.height,
  };
}

/**
 * Conditional vision fallback (H09AAPPLE-53 API + screen capture).
 * Returns screen-space rect, or null when locate is unavailable.
 */
export async function resolveVisionGridOnScreen(
  step: WalkthroughStep,
  displayBounds: ScreenRect,
  options?: {
    beforeCapture?: () => void | Promise<void>;
    afterCapture?: () => void | Promise<void>;
  },
): Promise<ScreenRect | null> {
  const description = describeStepForVision(step);
  if (!description) {
    return null;
  }

  const capture = await (async () => {
    await options?.beforeCapture?.();
    try {
      return await capturePrimaryDisplayPng(displayBounds);
    } finally {
      await options?.afterCapture?.();
    }
  })();

  if (!capture) {
    return null;
  }

  try {
    const response = await authenticatedFetch('/api/v1/walkthroughs/locate-element', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_base64: capture.base64,
        content_type: 'image/png',
        description,
        instruction: typeof step.instruction === 'string' ? step.instruction.slice(0, 2000) : null,
        viewport_width: capture.width,
        viewport_height: capture.height,
        step_number: step.step_number,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const body = (await response.json()) as {
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      viewport_width?: number;
      viewport_height?: number;
    };

    if (
      !Number.isFinite(body.x) ||
      !Number.isFinite(body.y) ||
      !Number.isFinite(body.width) ||
      !Number.isFinite(body.height) ||
      !(Number(body.width) > 0) ||
      !(Number(body.height) > 0)
    ) {
      return null;
    }

    // Full-display capture: image pixels correspond to the primary display
    // content bounds, so mapping through displayBounds is valid here.
    return mapViewportRectToScreen(
      {
        x: Number(body.x),
        y: Number(body.y),
        width: Number(body.width),
        height: Number(body.height),
      },
      displayBounds,
      Number(body.viewport_width) || capture.width,
      Number(body.viewport_height) || capture.height,
    );
  } catch (error) {
    console.warn('[walkthrough] vision locate failed:', error);
    return null;
  }
}
