import type { WalkthroughStep } from './types';
import { readableAutomationId } from '../recording/uia-at-point';

const URL_PATTERN =
  /\bhttps?:\/\/[^\s)]+|\b(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+(?:\/[^\s)]*)?/i;

function attrsOf(step: WalkthroughStep): Record<string, unknown> | null {
  return step.attrs && typeof step.attrs === 'object' ? step.attrs : null;
}

/**
 * App/window chrome names are too weak for a11y/OCR Exact Name search
 * (legacy desktop recordings stored window title as target_label).
 */
export function isWeakNeedle(needle: string, step: WalkthroughStep): boolean {
  const trimmed = needle.trim();
  if (!trimmed) {
    return true;
  }
  // Truncated OCR fragments e.g. "uments, or ther text to"
  if (/^[a-z]/.test(trimmed) && /,/.test(trimmed) && trimmed.split(/\s+/).length >= 3) {
    return true;
  }
  const lower = trimmed.toLowerCase();
  const attrs = attrsOf(step);
  const app = attrs?.foreground_app;
  const title = attrs?.window_title;
  if (typeof app === 'string' && app.trim().toLowerCase() === lower) {
    return true;
  }
  if (typeof title === 'string' && title.trim().toLowerCase() === lower) {
    return true;
  }
  return false;
}

function quotedInstructionNeedle(step: WalkthroughStep): string {
  const instruction = typeof step.instruction === 'string' ? step.instruction : '';
  const quoted = instruction.match(/['"]([^'"]{2,80})['"]/);
  return quoted?.[1]?.trim() ?? '';
}

const GENERIC_INSTRUCTION_TARGETS =
  /^(?:the\s+)?(?:highlighted\s+)?(?:control|button|link|field|icon|menu(?:\s+item)?|window|application)(?:\b.*)?$/i;

/**
 * Unquoted "Click Create project." / "Open Insights" style targets.
 * Rejects placeholder phrases like "the highlighted control".
 */
export function actionInstructionNeedle(step: WalkthroughStep): string {
  const instruction = typeof step.instruction === 'string' ? step.instruction.trim() : '';
  if (!instruction) {
    return '';
  }
  const firstLine = instruction.split(/\n/)[0]?.trim() ?? '';
  const match = firstLine.match(
    /^(?:click|open|select|press|focus|activate)\s+(?:on\s+)?(.+?)\.?$/i,
  );
  if (!match?.[1]) {
    return '';
  }
  let candidate = match[1].trim();
  // "Click within the X application" is not a control needle.
  if (/^(?:within|inside|in)\b/i.test(candidate)) {
    return '';
  }
  // Keyboard / free-form actions are not Exact Name OCR targets.
  if (/\b(?:key(?:board|s)?|type|typing|series of)\b/i.test(candidate)) {
    return '';
  }
  candidate = candidate.replace(/\s+(?:button|link|control|field|icon|menu item)$/i, '').trim();
  if (!candidate || candidate.length < 2 || candidate.length > 40) {
    return '';
  }
  if (candidate.split(/\s+/).length > 6) {
    return '';
  }
  if (GENERIC_INSTRUCTION_TARGETS.test(candidate)) {
    return '';
  }
  candidate = candidate.replace(/^the\s+/i, '').trim();
  if (GENERIC_INSTRUCTION_TARGETS.test(candidate)) {
    return '';
  }
  if (/\b(?:application|window)\s*$/i.test(candidate)) {
    return '';
  }
  return candidate;
}

/** Alternate labels recorded from UIA (help / labeled-by / automation id / candidates). */
export function alternateNeedlesFromAttrs(step: WalkthroughStep): string[] {
  const attrs = attrsOf(step);
  if (!attrs) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown) => {
    if (typeof raw !== 'string') {
      return;
    }
    const trimmed = raw.trim();
    if (!trimmed || isWeakNeedle(trimmed, step)) {
      return;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(trimmed);
  };

  push(attrs.uia_labeled_by);
  push(attrs.uia_help_text);
  push(
    readableAutomationId(
      typeof attrs.uia_automation_id === 'string' ? attrs.uia_automation_id : null,
    ),
  );

  const candidates = attrs.uia_name_candidates;
  if (Array.isArray(candidates)) {
    for (const entry of candidates) {
      push(entry);
      if (out.length >= 5) {
        break;
      }
    }
  }
  return out;
}

/** Human role word from UIA ControlType.ProgrammaticName (no product strings). */
export function controlRoleHint(step: WalkthroughStep): string | null {
  const attrs = attrsOf(step);
  const raw = attrs?.uia_control_type;
  if (typeof raw !== 'string' || !raw.trim()) {
    return null;
  }
  const lower = raw.toLowerCase();
  if (lower.includes('button')) return 'button';
  if (lower.includes('hyperlink') || lower.includes('link')) return 'link';
  if (lower.includes('menuitem')) return 'menu item';
  if (lower.includes('tabitem') || lower.includes('tab')) return 'tab';
  if (lower.includes('listitem')) return 'list item';
  if (lower.includes('edit') || lower.includes('document')) return 'text field';
  if (lower.includes('checkbox')) return 'checkbox';
  if (lower.includes('radiobutton')) return 'radio button';
  if (lower.includes('combobox')) return 'combo box';
  if (lower.includes('treeitem')) return 'tree item';
  return null;
}

/**
 * Prefer explicit target_label; else UIA alternates; else quoted / action UI text.
 * Skips weak app/window names so resolve does not search for the app chrome name.
 */
export function needleForStep(step: WalkthroughStep): string {
  if (typeof step.target_label === 'string' && step.target_label.trim()) {
    const label = step.target_label.trim();
    if (!isWeakNeedle(label, step)) {
      return label;
    }
  }
  for (const alt of alternateNeedlesFromAttrs(step)) {
    if (alt) {
      return alt;
    }
  }
  const quoted = quotedInstructionNeedle(step);
  if (quoted && !isWeakNeedle(quoted, step)) {
    return quoted;
  }
  const action = actionInstructionNeedle(step);
  if (action && !isWeakNeedle(action, step)) {
    return action;
  }
  return '';
}

/**
 * Vision / miss-note description: prefer a strong needle (+ role hint), else full
 * instruction plus app context. Never ask the model to locate the app window name alone.
 */
export function visionDescriptionForStep(step: WalkthroughStep): string {
  const strong = needleForStep(step);
  const role = controlRoleHint(step);
  if (strong) {
    if (role) {
      return `${strong} (${role})`.slice(0, 500);
    }
    return strong;
  }
  const instruction = typeof step.instruction === 'string' ? step.instruction.trim() : '';
  if (!instruction) {
    if (role) {
      const attrs = attrsOf(step);
      const app = typeof attrs?.foreground_app === 'string' ? attrs.foreground_app.trim() : '';
      return app
        ? `the highlighted ${role} in the ${app} application`.slice(0, 500)
        : `the highlighted ${role}`.slice(0, 500);
    }
    return '';
  }
  const attrs = attrsOf(step);
  const app = typeof attrs?.foreground_app === 'string' ? attrs.foreground_app.trim() : '';
  let desc = instruction;
  if (role && !desc.toLowerCase().includes(role)) {
    desc = `${desc} (prefer a ${role})`;
  }
  if (app && !desc.toLowerCase().includes(app.toLowerCase())) {
    desc = `${desc} (in the ${app} application)`;
  }
  return desc.slice(0, 500);
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
    const parsed = new URL(parseable);
    // Refuse dangerous schemes (javascript:, file:, etc.) even if they sneak in.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
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

  const attrs = attrsOf(step);
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
