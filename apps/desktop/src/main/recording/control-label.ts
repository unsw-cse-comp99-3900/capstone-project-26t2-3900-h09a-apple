/**
 * Desktop recording must not store window/app chrome as target_label.
 * Those belong in attrs only; target_label is the control the user activated.
 */

export function normalizeLabel(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isAppOrWindowLabel(
  candidate: string | null | undefined,
  foregroundApp: string | null | undefined,
  windowTitle: string | null | undefined,
): boolean {
  const label = normalizeLabel(candidate);
  if (!label) {
    return false;
  }
  const lower = label.toLowerCase();
  const app = normalizeLabel(foregroundApp)?.toLowerCase();
  const title = normalizeLabel(windowTitle)?.toLowerCase();
  return (app != null && lower === app) || (title != null && lower === title);
}

const GENERIC_CONTROL_LABELS = new Set([
  'control',
  'button',
  'link',
  'field',
  'window',
  'pane',
  'document',
  'group',
  'nonclientarea',
  'highlighted control',
  'the highlighted control',
]);

/** Keep only control names that are not the app/window chrome. */
export function pickControlLabel(
  candidate: string | null | undefined,
  foregroundApp: string | null | undefined,
  windowTitle: string | null | undefined,
): string | null {
  const label = normalizeLabel(candidate);
  if (!label) {
    return null;
  }
  if (isAppOrWindowLabel(label, foregroundApp, windowTitle)) {
    return null;
  }
  if (GENERIC_CONTROL_LABELS.has(label.toLowerCase())) {
    return null;
  }
  return label;
}
