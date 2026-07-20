import type { WalkthroughStep } from './types';

const URL_PATTERN =
  /\bhttps?:\/\/[^\s)]+|\b(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+(?:\/[^\s)]*)?/i;

/** Prefer explicit target_label; else quoted UI text in the instruction. */
export function needleForStep(step: WalkthroughStep): string {
  if (typeof step.target_label === 'string' && step.target_label.trim()) {
    return step.target_label.trim();
  }
  const instruction = typeof step.instruction === 'string' ? step.instruction : '';
  const quoted = instruction.match(/['"]([^'"]{2,80})['"]/);
  if (quoted?.[1]) {
    return quoted[1].trim();
  }
  return '';
}

/** Same normalization idea as apps/extension walkthrough-launch.js. */
export function normalizeLaunchUrl(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const trimmed = String(value)
    .trim()
    .replace(/[.,;:!?]+$/, '');
  if (!trimmed) {
    return null;
  }
  const parseable = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(parseable).toString();
  } catch {
    return null;
  }
}

/**
 * Resolve the page URL for a step without site-specific path inventing.
 * Order mirrors the extension: expected_url -> page_url/attrs -> instruction text.
 */
export function resolveStepPageUrl(step: WalkthroughStep): string | null {
  const fromExpected = normalizeLaunchUrl(step.expected_url);
  if (fromExpected) {
    return fromExpected;
  }

  const attrs = step.attrs && typeof step.attrs === 'object' ? step.attrs : null;
  const fromPageUrl = normalizeLaunchUrl(
    attrs?.page_url ?? attrs?.href ?? attrs?.url ?? attrs?.expected_url,
  );
  if (fromPageUrl) {
    return fromPageUrl;
  }

  const instruction = typeof step.instruction === 'string' ? step.instruction : '';
  const match = instruction.match(URL_PATTERN);
  return normalizeLaunchUrl(match?.[0] ?? null);
}

/** @deprecated use resolveStepPageUrl */
export function extractHttpUrl(text: string): string | null {
  const match = text.match(URL_PATTERN);
  return normalizeLaunchUrl(match?.[0] ?? null);
}
