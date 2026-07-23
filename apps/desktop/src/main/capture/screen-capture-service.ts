import { desktopCapturer, screen } from 'electron';
import type { CapturedScreenshot, CapturePoint } from './capture-types';

const MAX_SCREENSHOT_DIMENSION = 1_280;
const JPEG_QUALITY = 75;

export class ScreenCaptureService {
  async captureDisplayAtPhysicalPoint(point: CapturePoint): Promise<CapturedScreenshot | null> {
    const dipPoint =
      process.platform === 'win32' ? screen.screenToDipPoint(point) : { x: point.x, y: point.y };
    const display = screen.getDisplayNearestPoint(dipPoint);
    const aspectRatio = display.bounds.width / Math.max(1, display.bounds.height);
    const landscape = display.bounds.width >= display.bounds.height;
    const width = landscape
      ? MAX_SCREENSHOT_DIMENSION
      : Math.max(1, Math.round(MAX_SCREENSHOT_DIMENSION * aspectRatio));
    const height = landscape
      ? Math.max(1, Math.round(MAX_SCREENSHOT_DIMENSION / aspectRatio))
      : MAX_SCREENSHOT_DIMENSION;

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height },
      fetchWindowIcons: false,
    });
    const source =
      sources.find((candidate) => candidate.display_id === String(display.id)) ??
      (sources.length === 1 ? sources[0] : null);

    if (!source || source.thumbnail.isEmpty()) {
      return null;
    }

    const imageSize = source.thumbnail.getSize();

    return {
      data: source.thumbnail.toJPEG(JPEG_QUALITY),
      contentType: 'image/jpeg',
      metadata: {
        display_id: String(display.id),
        display_scale_factor: display.scaleFactor,
        display_bounds_dip: {
          x: display.bounds.x,
          y: display.bounds.y,
          width: display.bounds.width,
          height: display.bounds.height,
        },
        image_width: imageSize.width,
        image_height: imageSize.height,
        captured_at_ms: Date.now(),
      },
    };
  }
}
