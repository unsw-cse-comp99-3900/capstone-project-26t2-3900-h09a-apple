import { spawn } from 'node:child_process';
import { pickControlLabel } from './control-label';

export type UiaBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type UiaAtPointHit = {
  name: string;
  controlType: string | null;
  helpText: string | null;
  labeledBy: string | null;
  automationId: string | null;
  bounds: UiaBounds | null;
  /** Other usable labels from the hit/ancestors (not app chrome). */
  alternateLabels: string[];
};

type UiaCandidate = {
  name: string | null;
  helpText: string | null;
  automationId: string | null;
  labeledBy: string | null;
  controlType: string | null;
  interactive: boolean;
  bounds: UiaBounds | null;
};

/**
 * Windows UI Automation element under a screen point.
 * Collects Name / HelpText / LabeledBy / AutomationId on the hit and ancestors
 * (plus nearby interactive children), then picks the first label that is not
 * app/window chrome — critical for Electron apps where the root Name is often
 * empty or equal to the app title.
 */
export async function lookupUiaLabelAtPoint(
  screenX: number,
  screenY: number,
  options?: {
    foregroundApp?: string | null;
    windowTitle?: string | null;
    timeoutMs?: number;
  },
): Promise<UiaAtPointHit | null> {
  if (process.platform !== 'win32') {
    return null;
  }
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) {
    return null;
  }

  const timeoutMs = options?.timeoutMs ?? 900;
  const candidates = await runFromPointScript(screenX, screenY, timeoutMs);
  if (!candidates || candidates.length === 0) {
    return null;
  }

  const app = options?.foregroundApp;
  const title = options?.windowTitle;
  const ordered = [
    ...candidates.filter((c) => c.interactive),
    ...candidates.filter((c) => !c.interactive),
  ];

  let winner: { name: string; candidate: UiaCandidate } | null = null;
  for (const candidate of ordered) {
    for (const field of labelFields(candidate)) {
      const name = pickControlLabel(field, app, title);
      if (name) {
        winner = { name, candidate };
        break;
      }
    }
    if (winner) {
      break;
    }
  }

  if (!winner) {
    return null;
  }

  const alternateLabels: string[] = [];
  const seen = new Set([winner.name.toLowerCase()]);
  for (const candidate of ordered) {
    for (const field of labelFields(candidate)) {
      const label = pickControlLabel(field, app, title);
      if (!label) {
        continue;
      }
      const key = label.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      alternateLabels.push(label);
      if (alternateLabels.length >= 4) {
        break;
      }
    }
    if (alternateLabels.length >= 4) {
      break;
    }
  }

  const c = winner.candidate;
  return {
    name: winner.name,
    controlType: c.controlType,
    helpText: c.helpText,
    labeledBy: c.labeledBy,
    automationId: c.automationId,
    bounds: c.bounds,
    alternateLabels,
  };
}

/** Prefer human-facing fields; AutomationId last and only when readable. */
function labelFields(candidate: UiaCandidate): string[] {
  const fields: string[] = [];
  if (candidate.name) {
    fields.push(candidate.name);
  }
  if (candidate.labeledBy) {
    fields.push(candidate.labeledBy);
  }
  if (candidate.helpText) {
    fields.push(candidate.helpText);
  }
  const aid = readableAutomationId(candidate.automationId);
  if (aid) {
    fields.push(aid);
  }
  return fields;
}

/** Drop GUID-like / opaque ids; keep short readable AutomationIds. */
export function readableAutomationId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length < 2 || trimmed.length > 48) {
    return null;
  }
  if (/^[0-9a-f-]{16,}$/i.test(trimmed)) {
    return null;
  }
  if (/^\{?[0-9a-f]{8}-/i.test(trimmed)) {
    return null;
  }
  // Prefer ids that look like UI labels (letters present).
  if (!/[a-zA-Z]/.test(trimmed)) {
    return null;
  }
  // CamelCase / snake_case → spaced words when helpful.
  if (/^[A-Za-z][A-Za-z0-9_:-]*$/.test(trimmed) && /[_:-]|[a-z][A-Z]/.test(trimmed)) {
    return trimmed
      .replace(/[_:-]+/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return trimmed;
}

function parseBounds(raw: unknown): UiaBounds | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const b = raw as Record<string, unknown>;
  const x = Number(b.x);
  const y = Number(b.y);
  const width = Number(b.width);
  const height = Number(b.height);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !(width > 0) ||
    !(height > 0)
  ) {
    return null;
  }
  return { x, y, width, height };
}

function runFromPointScript(
  screenX: number,
  screenY: number,
  timeoutMs: number,
): Promise<UiaCandidate[] | null> {
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$x = ${Math.round(screenX)}
$y = ${Math.round(screenY)}
$pt = New-Object System.Windows.Point($x, $y)
try {
  $el = [System.Windows.Automation.AutomationElement]::FromPoint($pt)
} catch {
  Write-Output '[]'
  exit 0
}
if (-not $el) { Write-Output '[]'; exit 0 }

$interactiveTypes = @(
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

$candidates = New-Object System.Collections.Generic.List[object]

function Test-Interactive($ct) {
  foreach ($t in $interactiveTypes) { if ($ct -eq $t) { return $true } }
  return $false
}

function Add-Candidate($node) {
  if (-not $node) { return }
  try {
    $name = $node.Current.Name
    if (-not ($name -and $name.Trim().Length -gt 0)) {
      # Chromium/Electron often expose the label only via MSAA (LegacyIAccessible).
      try {
        $legacyObj = $null
        if ($node.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern, [ref]$legacyObj)) {
          $ln = $legacyObj.Current.Name
          if ($ln -and $ln.Trim().Length -gt 0) {
            $name = $ln
          } else {
            $lv = $legacyObj.Current.Value
            if ($lv -and $lv.Trim().Length -gt 0) { $name = $lv }
          }
        }
      } catch {}
    }
    $help = $node.Current.HelpText
    $aid = $node.Current.AutomationId
    $lbName = $null
    try {
      $lb = $node.Current.LabeledBy
      if ($lb) { $lbName = $lb.Current.Name }
    } catch {}
    $ct = $node.Current.ControlType
    $isInteractive = Test-Interactive $ct
    $hasAny = (
      ($name -and $name.Trim().Length -gt 0) -or
      ($help -and $help.Trim().Length -gt 0) -or
      ($aid -and $aid.Trim().Length -gt 0) -or
      ($lbName -and $lbName.Trim().Length -gt 0)
    )
    if (-not $hasAny) { return }
    $bounds = $null
    try {
      $br = $node.Current.BoundingRectangle
      if ($br.Width -gt 0 -and $br.Height -gt 0) {
        $bounds = @{
          x = [int]$br.X
          y = [int]$br.Y
          width = [int]$br.Width
          height = [int]$br.Height
        }
      }
    } catch {}
    $candidates.Add([ordered]@{
      name = $(if ($name) { $name.Trim() } else { $null })
      helpText = $(if ($help) { $help.Trim() } else { $null })
      automationId = $(if ($aid) { $aid.Trim() } else { $null })
      labeledBy = $(if ($lbName) { $lbName.Trim() } else { $null })
      controlType = $ct.ProgrammaticName
      interactive = $isInteractive
      bounds = $bounds
    }) | Out-Null
  } catch {}
}

# Hit + ancestors (prefer nearer controls first).
$cur = $el
for ($i = 0; $i -lt 12 -and $cur; $i++) {
  Add-Candidate $cur
  try {
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $cur = $walker.GetParent($cur)
  } catch { break }
}

# Nearby interactive children of the hit (Electron often paints empty panes).
try {
  $childWalker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $child = $childWalker.GetFirstChild($el)
  $guard = 0
  while ($child -and $guard -lt 24) {
    $guard++
    try {
      $br = $child.Current.BoundingRectangle
      if ($br.Width -gt 0 -and $br.Height -gt 0 -and
          $x -ge $br.X -and $x -le ($br.X + $br.Width) -and
          $y -ge $br.Y -and $y -le ($br.Y + $br.Height)) {
        Add-Candidate $child
        $grand = $childWalker.GetFirstChild($child)
        $g = 0
        while ($grand -and $g -lt 12) {
          $g++
          try {
            $gbr = $grand.Current.BoundingRectangle
            if ($gbr.Width -gt 0 -and $gbr.Height -gt 0 -and
                $x -ge $gbr.X -and $x -le ($gbr.X + $gbr.Width) -and
                $y -ge $gbr.Y -and $y -le ($gbr.Y + $gbr.Height)) {
              Add-Candidate $grand
            }
          } catch {}
          $grand = $childWalker.GetNextSibling($grand)
        }
      }
    } catch {}
    $child = $childWalker.GetNextSibling($child)
  }
} catch {}

if ($candidates.Count -eq 0) { Write-Output '[]'; exit 0 }
$candidates | ConvertTo-Json -Compress -Depth 4
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
    }, timeoutMs);

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
      if (!trimmed || trimmed === 'null' || trimmed === '[]') {
        if (stderr.trim()) {
          console.warn('[desktop] uia-at-point:', stderr.trim().slice(0, 240));
        }
        resolve(trimmed === '[]' ? [] : null);
        return;
      }
      try {
        const parsed = JSON.parse(trimmed) as UiaCandidate | UiaCandidate[];
        const list = Array.isArray(parsed) ? parsed : [parsed];
        resolve(
          list.map((item) => ({
            name: typeof item.name === 'string' ? item.name : null,
            helpText: typeof item.helpText === 'string' ? item.helpText : null,
            automationId: typeof item.automationId === 'string' ? item.automationId : null,
            labeledBy: typeof item.labeledBy === 'string' ? item.labeledBy : null,
            controlType: typeof item.controlType === 'string' ? item.controlType : null,
            interactive: Boolean(item.interactive),
            bounds: parseBounds(item.bounds),
          })),
        );
      } catch {
        resolve(null);
      }
    });
  });
}
