export type VisionFailureReason =
  | 'no_description'
  | 'capture_failed'
  | 'not_authenticated'
  | 'config_missing'
  | 'network_error'
  | 'http_error'
  | 'no_match'
  | 'invalid_response';

export type VisionLocateOutcome =
  | {
      ok: true;
      rect: import('./types').ScreenRect;
      coachingHint?: string | null;
      /** Clicky POINT label / grid cell used as live Target in the panel. */
      liveTargetLabel?: string | null;
    }
  | { ok: false; reason: VisionFailureReason; detail?: string };

export function formatVisionFailureLog(reason: VisionFailureReason, detail?: string): string {
  const base = {
    no_description: 'vision skipped: step has no target_label/instruction',
    capture_failed: 'vision failed: screen capture unavailable',
    not_authenticated: 'vision failed: desktop is not signed in',
    config_missing: 'vision failed: locate API unavailable (missing vision API key/config)',
    network_error: 'vision failed: network error calling locate-element',
    http_error: 'vision failed: locate-element returned an HTTP error',
    no_match: 'vision failed: model returned no usable match',
    invalid_response: 'vision failed: locate-element response was invalid',
  }[reason];

  return detail ? `${base} (${detail})` : base;
}

/** Pure helper for stale async resolution discard (H09AAPPLE-78 race AC). */
export function shouldApplyResolution(
  requestGeneration: number,
  currentGeneration: number,
): boolean {
  return requestGeneration === currentGeneration;
}
