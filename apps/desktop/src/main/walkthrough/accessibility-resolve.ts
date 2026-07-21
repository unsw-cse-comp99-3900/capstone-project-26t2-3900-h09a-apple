import { spawn } from 'node:child_process';
import type { ScreenRect, WalkthroughStep } from './types';
import { needleForStep } from './step-navigation';

/**
 * Windows UI Automation lookup by Name.
 * Prefers compact interactive controls (link/button/list item) over large text
 * nodes that share the same name (e.g. sidebar label vs page H1).
 * When the step recorded a control type / click point, those bias the pick.
 *
 * macOS AXUIElement is intentionally out of scope for H09AAPPLE-78; non-Windows
 * platforms degrade to OCR + vision only (never a silent no-op without log/UI).
 */
export function isAccessibilityResolveSupported(): boolean {
  return process.platform === 'win32';
}

export function accessibilityDegradeNote(): string | null {
  if (isAccessibilityResolveSupported()) {
    return null;
  }
  return (
    'Accessibility (a11y) lookup is Windows-only on this build. ' +
    `${process.platform} playback uses OCR + vision only (two-stage grid when vision runs).`
  );
}

export type A11yCandidate = {
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
  interactive: boolean;
  controlType: string | null;
};

function attrsOf(step: WalkthroughStep): Record<string, unknown> | null {
  return step.attrs && typeof step.attrs === 'object' ? step.attrs : null;
}

function recordedClickPoint(step: WalkthroughStep): { x: number; y: number } | null {
  const coords = step.raw_coordinates;
  if (coords && typeof coords === 'object') {
    const x = Number((coords as { x?: unknown }).x);
    const y = Number((coords as { y?: unknown }).y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return { x, y };
    }
  }
  const attrs = attrsOf(step);
  const raw = attrs?.raw_coordinates;
  if (raw && typeof raw === 'object') {
    const x = Number((raw as { x?: unknown }).x);
    const y = Number((raw as { y?: unknown }).y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return { x, y };
    }
  }
  return null;
}

function preferredControlTypeToken(step: WalkthroughStep): string | null {
  const raw = attrsOf(step)?.uia_control_type;
  if (typeof raw !== 'string' || !raw.trim()) {
    return null;
  }
  const lower = raw.toLowerCase();
  // Match against ProgrammaticName fragments from playback candidates.
  const tokens = [
    'button',
    'hyperlink',
    'menuitem',
    'tabitem',
    'listitem',
    'edit',
    'checkbox',
    'radiobutton',
    'combobox',
    'treeitem',
    'dataitem',
  ];
  return tokens.find((t) => lower.includes(t)) ?? null;
}

/**
 * Pure ranking used by tests (no PowerShell). Prefer: matching role → near click →
 * interactive → smaller area.
 */
export function pickBestA11yCandidate(
  candidates: A11yCandidate[],
  options?: {
    preferredTypeToken?: string | null;
    nearPoint?: { x: number; y: number } | null;
  },
): A11yCandidate | null {
  if (candidates.length === 0) {
    return null;
  }
  const preferred = options?.preferredTypeToken?.toLowerCase() ?? null;
  const near = options?.nearPoint ?? null;

  const ranked = [...candidates].sort((a, b) => {
    if (preferred) {
      const aMatch = (a.controlType || '').toLowerCase().includes(preferred) ? 0 : 1;
      const bMatch = (b.controlType || '').toLowerCase().includes(preferred) ? 0 : 1;
      if (aMatch !== bMatch) {
        return aMatch - bMatch;
      }
    }
    if (near) {
      const dist = (c: A11yCandidate) => {
        const cx = c.x + c.width / 2;
        const cy = c.y + c.height / 2;
        return (cx - near.x) ** 2 + (cy - near.y) ** 2;
      };
      const d = dist(a) - dist(b);
      if (Math.abs(d) > 1) {
        return d;
      }
    }
    if (a.interactive !== b.interactive) {
      return a.interactive ? -1 : 1;
    }
    if (a.area !== b.area) {
      return a.area - b.area;
    }
    return a.x - b.x || a.y - b.y;
  });

  return ranked[0] ?? null;
}

export async function resolveAccessibilityTarget(
  step: WalkthroughStep,
): Promise<ScreenRect | null> {
  const needle = needleForStep(step);
  if (!needle) {
    return null;
  }

  if (!isAccessibilityResolveSupported()) {
    console.info(
      `[walkthrough] a11y unavailable on ${process.platform}: UI Automation helper is Windows-only; ` +
        'degrading to OCR + vision-only mode (macOS AXUIElement not implemented in this release)',
    );
    return null;
  }

  try {
    const candidates = await lookupWindowsAutomationCandidates(needle);
    const best = pickBestA11yCandidate(candidates, {
      preferredTypeToken: preferredControlTypeToken(step),
      nearPoint: recordedClickPoint(step),
    });
    if (!best) {
      return null;
    }
    return { x: best.x, y: best.y, width: best.width, height: best.height };
  } catch (error) {
    console.warn(
      '[walkthrough] a11y resolve failed:',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

function lookupWindowsAutomationCandidates(needle: string): Promise<A11yCandidate[]> {
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$needle = ${JSON.stringify(needle)}
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::NameProperty, $needle)
$found = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
if (-not $found -or $found.Count -eq 0) { Write-Output '[]'; exit 0 }

$interactive = @(
  [System.Windows.Automation.ControlType]::Hyperlink,
  [System.Windows.Automation.ControlType]::Button,
  [System.Windows.Automation.ControlType]::ListItem,
  [System.Windows.Automation.ControlType]::MenuItem,
  [System.Windows.Automation.ControlType]::TabItem,
  [System.Windows.Automation.ControlType]::Edit,
  [System.Windows.Automation.ControlType]::CheckBox,
  [System.Windows.Automation.ControlType]::RadioButton,
  [System.Windows.Automation.ControlType]::ComboBox,
  [System.Windows.Automation.ControlType]::TreeItem,
  [System.Windows.Automation.ControlType]::DataItem
)

$candidates = @()
foreach ($el in $found) {
  $r = $el.Current.BoundingRectangle
  if ($r.Width -le 0 -or $r.Height -le 0) { continue }
  $ct = $el.Current.ControlType
  $isInteractive = $false
  foreach ($t in $interactive) { if ($ct -eq $t) { $isInteractive = $true; break } }
  $candidates += [pscustomobject]@{
    x = [int]$r.X
    y = [int]$r.Y
    width = [int]$r.Width
    height = [int]$r.Height
    area = [int]($r.Width * $r.Height)
    interactive = [bool]$isInteractive
    controlType = $ct.ProgrammaticName
  }
}
if ($candidates.Count -eq 0) { Write-Output '[]'; exit 0 }
$candidates | ConvertTo-Json -Compress
`;

  return new Promise((resolve) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true },
    );

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve([]);
    }, 1500);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve([]);
    });
    child.on('close', () => {
      clearTimeout(timer);
      const trimmed = stdout.trim();
      if (!trimmed || trimmed === 'null' || trimmed === '[]') {
        if (stderr.trim()) {
          console.warn('[walkthrough] a11y powershell:', stderr.trim().slice(0, 300));
        }
        resolve([]);
        return;
      }
      try {
        const parsed = JSON.parse(trimmed) as A11yCandidate | A11yCandidate[];
        const list = Array.isArray(parsed) ? parsed : [parsed];
        resolve(
          list
            .map((item) => ({
              x: Number(item.x),
              y: Number(item.y),
              width: Number(item.width),
              height: Number(item.height),
              area: Number(item.area) || Number(item.width) * Number(item.height),
              interactive: Boolean(item.interactive),
              controlType: typeof item.controlType === 'string' ? item.controlType : null,
            }))
            .filter(
              (item) =>
                Number.isFinite(item.x) &&
                Number.isFinite(item.y) &&
                item.width > 0 &&
                item.height > 0,
            ),
        );
      } catch {
        resolve([]);
      }
    });
  });
}
