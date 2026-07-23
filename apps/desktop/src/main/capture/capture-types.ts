export interface CapturePoint {
  x: number;
  y: number;
}

export interface CaptureRectangle extends CapturePoint {
  width: number;
  height: number;
}

export interface UiaAncestorSnapshot {
  automation_id: string | null;
  name: string | null;
  control_type: string | null;
  class_name: string | null;
}

export interface DesktopTargetSnapshot {
  provider: 'windows_uia';
  automation_id: string | null;
  name: string | null;
  control_type: string | null;
  localized_control_type: string | null;
  class_name: string | null;
  framework_id: string | null;
  runtime_id: number[];
  bounding_rect_physical: CaptureRectangle | null;
  is_enabled: boolean | null;
  is_offscreen: boolean | null;
  is_password: boolean;
  supports_value_pattern: boolean;
  value_pattern_value: string | null;
  ancestor_path: UiaAncestorSnapshot[];
}

export interface ForegroundContext {
  foreground_app: string;
  executable_path: string | null;
  process_id: number | null;
  window_title: string | null;
  window_handle: string | null;
  window_bounds: CaptureRectangle | null;
  active_win_error?: string;
}

export interface ScreenshotCaptureMetadata {
  display_id: string;
  display_scale_factor: number;
  display_bounds_dip: CaptureRectangle;
  image_width: number;
  image_height: number;
  captured_at_ms: number;
}

export interface CapturedScreenshot {
  data: Buffer;
  contentType: 'image/jpeg';
  metadata: ScreenshotCaptureMetadata;
}

export interface UiaInspectionResult {
  target: DesktopTargetSnapshot | null;
  error?: string;
}
