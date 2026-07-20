const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isWalkthroughSopId(value: string): boolean {
  return UUID_RE.test(value.trim());
}

export function normalizeWalkthroughSopId(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    throw new Error('Missing SOP id');
  }
  if (!isWalkthroughSopId(trimmed)) {
    throw new Error('SOP id must be a valid UUID');
  }
  return trimmed;
}
