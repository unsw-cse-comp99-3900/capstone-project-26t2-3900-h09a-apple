import { spawn } from 'node:child_process';
import type { ScreenRect, WalkthroughStep } from './types';

function describeNeedle(step: WalkthroughStep): string {
  if (typeof step.target_label === 'string' && step.target_label.trim()) {
    return step.target_label.trim();
  }
  return '';
}

/**
 * Windows UI Automation lookup by Name.
 * Returns screen-space bounds or null. Other platforms: not implemented yet.
 */
export async function resolveAccessibilityTarget(
  step: WalkthroughStep,
): Promise<ScreenRect | null> {
  const needle = describeNeedle(step);
  if (!needle) {
    return null;
  }

  if (process.platform !== 'win32') {
    console.info('[walkthrough] a11y resolve skipped: UI Automation helper is Windows-only');
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
  // Keep the script short: exact Name match under the desktop root.
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$needle = ${JSON.stringify(needle)}
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::NameProperty, $needle)
$el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
if (-not $el) { Write-Output 'null'; exit 0 }
$r = $el.Current.BoundingRectangle
if ($r.Width -le 0 -or $r.Height -le 0) { Write-Output 'null'; exit 0 }
@{ x = [int]$r.X; y = [int]$r.Y; width = [int]$r.Width; height = [int]$r.Height } | ConvertTo-Json -Compress
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
    }, 2500);

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
