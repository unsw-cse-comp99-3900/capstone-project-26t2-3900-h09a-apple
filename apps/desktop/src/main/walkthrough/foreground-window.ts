import activeWindow from 'active-win';
import type { ScreenRect } from './types';

export interface ForegroundWindowInfo {
  title: string;
  appName: string;
  bounds: ScreenRect;
}

export async function getForegroundWindowBounds(): Promise<ForegroundWindowInfo | null> {
  try {
    const window = await activeWindow({
      accessibilityPermission: true,
      screenRecordingPermission: process.platform === 'darwin',
    });

    if (!window?.bounds) {
      return null;
    }

    const bounds = window.bounds;
    if (!(bounds.width > 0) || !(bounds.height > 0)) {
      return null;
    }

    return {
      title: window.title || '',
      appName: window.owner?.name || window.owner?.path || 'unknown',
      bounds: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
    };
  } catch (error) {
    console.warn(
      '[walkthrough] active-win failed:',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

export function intersectRects(a: ScreenRect, b: ScreenRect): ScreenRect | null {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const width = right - left;
  const height = bottom - top;
  if (!(width > 0) || !(height > 0)) {
    return null;
  }
  return { x: left, y: top, width, height };
}
