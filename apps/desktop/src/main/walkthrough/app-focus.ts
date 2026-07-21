import type { ScreenRect, WalkthroughStep } from './types';

function attrsOf(step: WalkthroughStep): Record<string, unknown> | null {
  return step.attrs && typeof step.attrs === 'object' ? step.attrs : null;
}

/**
 * Steps that mean "bring this app to the front" — the live target is the
 * Windows taskbar icon, not a control inside the current window/page.
 */
export function isAppFocusStep(step: WalkthroughStep): boolean {
  const action = typeof step.expected_action === 'string' ? step.expected_action : '';
  if (action === 'window_change' || action === 'navigation') {
    return Boolean(targetAppNameFromStep(step));
  }

  const text = `${step.instruction || ''} ${step.target_label || ''}`.toLowerCase();
  if (!text.trim()) {
    return false;
  }

  const focusCue =
    /\b(focus|switch to|open|bring|launch|activate)\b/.test(text) &&
    /\b(application|app|window)\b/.test(text);
  const switchApp = /\bswitch to\b/.test(text) && Boolean(targetAppNameFromStep(step));
  return focusCue || switchApp;
}

/** Best-effort app name for taskbar lookup (Claude, File Explorer, …). */
export function targetAppNameFromStep(step: WalkthroughStep): string | null {
  const attrs = attrsOf(step);
  for (const key of ['to_app', 'foreground_app', 'app_name', 'target_app'] as const) {
    const value = attrs?.[key];
    if (typeof value === 'string' && value.trim() && !isGenericAppToken(value)) {
      return value.trim();
    }
  }

  const label = typeof step.target_label === 'string' ? step.target_label.trim() : '';
  if (label && !isGenericAppToken(label)) {
    // "Click within Claude" style labels.
    if (!/\s/.test(label) || /explorer|chrome|edge|claude|outlook|slack/i.test(label)) {
      return label;
    }
  }

  const instruction = typeof step.instruction === 'string' ? step.instruction : '';
  const quoted = instruction.match(/['"]([^'"]{2,60})['"]/);
  if (quoted?.[1] && !isGenericAppToken(quoted[1])) {
    return quoted[1].trim();
  }

  const switchMatch = instruction.match(
    /\b(?:switch to|focus|open|launch|activate)\s+(?:the\s+)?([A-Za-z][\w .+-]{1,40?}?)(?:\s+application|\s+app|\s+window)?/i,
  );
  if (switchMatch?.[1] && !isGenericAppToken(switchMatch[1])) {
    return switchMatch[1].trim();
  }

  return null;
}

function isGenericAppToken(value: string): boolean {
  const lower = value.trim().toLowerCase();
  return (
    !lower ||
    lower === 'application' ||
    lower === 'app' ||
    lower === 'window' ||
    lower === 'the application' ||
    lower === 'the app'
  );
}

/** Honest fallback band on the taskbar when live locate misses. */
export function taskbarIconHintRect(displayBounds: ScreenRect): ScreenRect {
  const height = Math.max(40, Math.min(56, Math.round(displayBounds.height * 0.05)));
  const width = Math.max(48, Math.min(72, Math.round(displayBounds.width * 0.04)));
  // Center-left of the icon tray (common for pinned apps); user can still see the bar.
  const x = displayBounds.x + Math.round(displayBounds.width * 0.42) - width / 2;
  const y = displayBounds.y + displayBounds.height - height - 4;
  return {
    x: Math.max(displayBounds.x, x),
    y: Math.max(displayBounds.y, y),
    width,
    height,
  };
}

/** Vision sometimes returns a huge box; taskbar icons are ~40-48px. */
export function tightenTaskbarHighlight(rect: ScreenRect, displayBounds: ScreenRect): ScreenRect {
  const size = 48;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const bottomBandTop = displayBounds.y + displayBounds.height * 0.88;
  const safeY = Math.max(cy, bottomBandTop + size / 2);
  return {
    x: Math.min(
      Math.max(displayBounds.x, cx - size / 2),
      displayBounds.x + displayBounds.width - size,
    ),
    y: Math.min(
      Math.max(displayBounds.y, safeY - size / 2),
      displayBounds.y + displayBounds.height - size,
    ),
    width: size,
    height: size,
  };
}

/** Reject vision hits that are clearly not on the taskbar for app-focus steps. */
export function isPlausibleTaskbarHit(rect: ScreenRect, displayBounds: ScreenRect): boolean {
  const cy = rect.y + rect.height / 2;
  // Bottom ~8% only — avoid treating chat/composer (often near bottom) as taskbar.
  const bandTop = displayBounds.y + displayBounds.height * 0.92;
  return cy >= bandTop;
}

/** Typing / keydown steps should never be resolved to the Windows taskbar. */
export function isTypingStep(step: WalkthroughStep): boolean {
  const action = typeof step.expected_action === 'string' ? step.expected_action : '';
  if (action === 'input' || action === 'keydown' || action === 'keypress') {
    return true;
  }
  const text = `${step.instruction || ''}`.toLowerCase();
  return (
    /\b(type|typing|keydown|keypress|keyboard|press a key|enter text|fill in)\b/.test(text) ||
    /\bin the ['"].+['"] field\b/.test(text)
  );
}

/**
 * Keep vision spotlight centered but shrink oversized boxes after image→DIP
 * upscale (120×48 image often becomes ~160×64 on screen).
 */
export function tightenVisionHighlight(rect: ScreenRect, displayBounds: ScreenRect): ScreenRect {
  const maxW = 100;
  const maxH = 40;
  const width = Math.min(Math.max(36, rect.width), maxW);
  const height = Math.min(Math.max(24, rect.height), maxH);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return {
    x: Math.min(
      Math.max(displayBounds.x, cx - width / 2),
      displayBounds.x + displayBounds.width - width,
    ),
    y: Math.min(
      Math.max(displayBounds.y, cy - height / 2),
      displayBounds.y + displayBounds.height - height,
    ),
    width,
    height,
  };
}

export function appFocusVisionDescription(step: WalkthroughStep): string {
  const app = targetAppNameFromStep(step) || 'the target';
  return (
    `Windows taskbar icon for "${app}". ` +
    `Locate ONLY the app icon on the BOTTOM Windows taskbar (the thin bar at the very bottom of the screen). ` +
    `Do NOT point at the left sidebar, page content, window title bar, or Start button unless it is that app's icon. ` +
    `Point at the center of the "${app}" taskbar icon.`
  );
}
