import { spawn } from 'node:child_process';

export type UiaFocusHit = {
  name: string;
  controlType: string | null;
};

/** Best-effort Windows UI Automation focused element Name. */
export async function lookupUiaFocusedElement(timeoutMs = 700): Promise<UiaFocusHit | null> {
  if (process.platform !== 'win32') {
    return null;
  }

  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
try {
  $el = [System.Windows.Automation.AutomationElement]::FocusedElement
} catch {
  Write-Output 'null'
  exit 0
}
if (-not $el) { Write-Output 'null'; exit 0 }
$name = $el.Current.Name
if (-not $name -or $name.Trim().Length -eq 0) { Write-Output 'null'; exit 0 }
@{ name = $name.Trim(); controlType = $el.Current.ControlType.ProgrammaticName } | ConvertTo-Json -Compress
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
        const parsed = JSON.parse(trimmed) as { name?: string; controlType?: string };
        if (typeof parsed.name === 'string' && parsed.name.trim()) {
          resolve({
            name: parsed.name.trim(),
            controlType: typeof parsed.controlType === 'string' ? parsed.controlType : null,
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
