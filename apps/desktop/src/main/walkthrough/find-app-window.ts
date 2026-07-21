import { spawn } from 'node:child_process';
import { screen } from 'electron';
import type { ScreenRect } from './types';

/**
 * Convert Win32 GetWindowRect (physical px) into Electron DIP screen space.
 */
function physicalToDip(bounds: ScreenRect): ScreenRect {
  const displays = screen.getAllDisplays();
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;

  let scale = screen.getPrimaryDisplay().scaleFactor || 1;
  for (const display of displays) {
    const sf = display.scaleFactor || 1;
    const pb = {
      x: display.bounds.x * sf,
      y: display.bounds.y * sf,
      width: display.bounds.width * sf,
      height: display.bounds.height * sf,
    };
    if (cx >= pb.x && cx < pb.x + pb.width && cy >= pb.y && cy < pb.y + pb.height) {
      scale = sf;
      break;
    }
  }

  if (scale <= 1) {
    return bounds;
  }
  return {
    x: bounds.x / scale,
    y: bounds.y / scale,
    width: bounds.width / scale,
    height: bounds.height / scale,
  };
}

/**
 * Best-effort: find an on-screen top-level window whose title/process matches
 * the recorded app name (e.g. Claude) while our Electron overlay holds focus.
 */
export async function findWindowBoundsByAppName(
  appName: string,
  timeoutMs = 900,
): Promise<{ appName: string; bounds: ScreenRect } | null> {
  const needle = appName.trim();
  if (!needle || process.platform !== 'win32') {
    return null;
  }

  // Note: do not use $pid — it is a PowerShell automatic variable.
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WtWinEnum {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
'@
$needle = ${JSON.stringify(needle)}.ToLowerInvariant()
$hits = New-Object System.Collections.Generic.List[object]
$callback = [WtWinEnum+EnumProc]{
  param([IntPtr]$hWnd, [IntPtr]$lParam)
  if (-not [WtWinEnum]::IsWindowVisible($hWnd)) { return $true }
  $len = [WtWinEnum]::GetWindowTextLength($hWnd)
  if ($len -le 0) { return $true }
  $sb = New-Object System.Text.StringBuilder ($len + 1)
  [void][WtWinEnum]::GetWindowText($hWnd, $sb, $sb.Capacity)
  $title = $sb.ToString()
  if (-not $title) { return $true }
  $procName = ''
  try {
    $procId = [uint32]0
    [void][WtWinEnum]::GetWindowThreadProcessId($hWnd, [ref]$procId)
    if ($procId -gt 0) {
      $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
      if ($p) { $procName = [string]$p.ProcessName }
    }
  } catch {}
  $titleL = $title.ToLowerInvariant()
  $procL = $procName.ToLowerInvariant()
  $hay = $titleL + ' ' + $procL
  if ($hay -notlike ('*' + $needle + '*')) { return $true }
  # Skip our own Electron / WorkTrace / IDE windows (process name, not loose "code" in titles).
  if ($procL -match '^(electron|worktrace|cursor|code)$') { return $true }
  if ($titleL -match 'worktrace') { return $true }
  $r = New-Object WtWinEnum+RECT
  if (-not [WtWinEnum]::GetWindowRect($hWnd, [ref]$r)) { return $true }
  $w = $r.Right - $r.Left
  $h = $r.Bottom - $r.Top
  if ($w -lt 200 -or $h -lt 200) { return $true }
  $hits.Add([ordered]@{
    title = $title
    proc = $procName
    x = [int]$r.Left
    y = [int]$r.Top
    width = [int]$w
    height = [int]$h
    area = [int]($w * $h)
  }) | Out-Null
  return $true
}
[void][WtWinEnum]::EnumWindows($callback, [IntPtr]::Zero)
if ($hits.Count -eq 0) { Write-Output 'null'; exit 0 }
$best = $hits | Sort-Object area -Descending | Select-Object -First 1
$best | ConvertTo-Json -Compress
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
    }, timeoutMs);
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
          title?: string;
          proc?: string;
        };
        if (
          Number.isFinite(parsed.x) &&
          Number.isFinite(parsed.y) &&
          Number(parsed.width) > 0 &&
          Number(parsed.height) > 0
        ) {
          resolve({
            appName: parsed.proc || parsed.title || needle,
            bounds: physicalToDip({
              x: Number(parsed.x),
              y: Number(parsed.y),
              width: Number(parsed.width),
              height: Number(parsed.height),
            }),
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
