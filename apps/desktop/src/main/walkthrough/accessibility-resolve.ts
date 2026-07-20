import { spawn } from 'node:child_process';
import type { ScreenRect, WalkthroughStep } from './types';
import { needleForStep } from './step-navigation';

/**
 * Windows UI Automation lookup by Name.
 * Prefers compact interactive controls (link/button/list item) over large text
 * nodes that share the same name (e.g. sidebar "Code frequency" vs page H1).
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
    return await lookupWindowsAutomationBounds(needle);
  } catch (error) {
    console.warn(
      '[walkthrough] a11y resolve failed:',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

function lookupWindowsAutomationBounds(needle: string): Promise<ScreenRect | null> {
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$needle = ${JSON.stringify(needle)}
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::NameProperty, $needle)
$found = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
if (-not $found -or $found.Count -eq 0) { Write-Output 'null'; exit 0 }

$interactive = @(
  [System.Windows.Automation.ControlType]::Hyperlink,
  [System.Windows.Automation.ControlType]::Button,
  [System.Windows.Automation.ControlType]::ListItem,
  [System.Windows.Automation.ControlType]::MenuItem,
  [System.Windows.Automation.ControlType]::TabItem
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
  }
}
if ($candidates.Count -eq 0) { Write-Output 'null'; exit 0 }

$preferred = @($candidates | Where-Object { $_.interactive })
if ($preferred.Count -eq 0) { $preferred = $candidates }
$best = $preferred | Sort-Object area, x, y | Select-Object -First 1
@{ x = $best.x; y = $best.y; width = $best.width; height = $best.height } | ConvertTo-Json -Compress
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
      resolve(null);
    }, 1500);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', () => {
      clearTimeout(timer);
      const trimmed = stdout.trim();
      if (!trimmed || trimmed === 'null') {
        if (stderr.trim()) {
          console.warn('[walkthrough] a11y powershell:', stderr.trim().slice(0, 300));
        }
        resolve(null);
        return;
      }
      try {
        const parsed = JSON.parse(trimmed) as {
          x?: number;
          y?: number;
          width?: number;
          height?: number;
        };
        if (
          Number.isFinite(parsed.x) &&
          Number.isFinite(parsed.y) &&
          Number(parsed.width) > 0 &&
          Number(parsed.height) > 0
        ) {
          resolve({
            x: Number(parsed.x),
            y: Number(parsed.y),
            width: Number(parsed.width),
            height: Number(parsed.height),
          });
          return;
        }
      } catch {
        // ignore parse errors
      }
      resolve(null);
    });
  });
}
