import { spawn } from 'node:child_process';
import type { ScreenRect } from './types';
import { isAccessibilityResolveSupported } from './accessibility-resolve';

/**
 * Find a pinned/running app button on the Windows taskbar by name substring.
 */
export async function resolveTaskbarAppIcon(appName: string): Promise<ScreenRect | null> {
  const needle = appName.trim();
  if (!needle || !isAccessibilityResolveSupported()) {
    return null;
  }

  try {
    return await lookupTaskbarButtonBounds(needle);
  } catch (error) {
    console.warn(
      '[walkthrough] taskbar a11y failed:',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

function lookupTaskbarButtonBounds(needle: string): Promise<ScreenRect | null> {
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$needle = ${JSON.stringify(needle)}
$root = [System.Windows.Automation.AutomationElement]::RootElement
$classNames = @('Shell_TrayWnd', 'Shell_SecondaryTrayWnd')
$candidates = @()
foreach ($className in $classNames) {
  $classCond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ClassNameProperty, $className)
  $tray = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $classCond)
  if (-not $tray) { continue }
  $all = $tray.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($el in $all) {
    $name = $el.Current.Name
    if (-not $name) { continue }
    if ($name -notmatch [regex]::Escape($needle)) { continue }
    $r = $el.Current.BoundingRectangle
    if ($r.Width -le 0 -or $r.Height -le 0) { continue }
    if ($r.Height -gt 120 -or $r.Width -gt 400) { continue }
    $candidates += [pscustomobject]@{
      x = [int]$r.X
      y = [int]$r.Y
      width = [int]$r.Width
      height = [int]$r.Height
      area = [int]($r.Width * $r.Height)
      name = $name
    }
  }
}
if ($candidates.Count -eq 0) { Write-Output 'null'; exit 0 }
$best = $candidates | Sort-Object area, x | Select-Object -First 1
@{ x = $best.x; y = $best.y; width = $best.width; height = $best.height; name = $best.name } | ConvertTo-Json -Compress
`;

  return new Promise((resolve) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true },
    );

    let stdout = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 2000);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', () => {
      clearTimeout(timer);
      const trimmed = stdout.trim();
      if (!trimmed || trimmed === 'null') {
        resolve(null);
        return;
      }
      try {
        const parsed = JSON.parse(trimmed) as {
          x?: number;
          y?: number;
          width?: number;
          height?: number;
          name?: string;
        };
        if (
          Number.isFinite(parsed.x) &&
          Number.isFinite(parsed.y) &&
          Number(parsed.width) > 0 &&
          Number(parsed.height) > 0
        ) {
          console.info(
            `[walkthrough] taskbar a11y hit name=${JSON.stringify(parsed.name || needle)} ` +
              `rect=${parsed.x},${parsed.y} ${parsed.width}x${parsed.height}`,
          );
          resolve({
            x: Number(parsed.x),
            y: Number(parsed.y),
            width: Number(parsed.width),
            height: Number(parsed.height),
          });
          return;
        }
      } catch {
        // ignore
      }
      resolve(null);
    });
  });
}
