# Smoke probe for Windows UI Automation (recording / playback).
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File apps/desktop/scripts/uia-probe.ps1
#   powershell ... -File apps/desktop/scripts/uia-probe.ps1 -Needle "Create project"
#   powershell ... -File apps/desktop/scripts/uia-probe.ps1 -X 1000 -Y 600

param(
  [string]$Needle = 'Create project',
  [int]$X = -1,
  [int]$Y = -1
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Write-Host "UIA probe needle=$Needle point=($X,$Y)"

if ($X -ge 0 -and $Y -ge 0) {
  $pt = New-Object System.Windows.Point($X, $Y)
  $el = [System.Windows.Automation.AutomationElement]::FromPoint($pt)
  if ($el) {
    Write-Host ("FromPoint name={0} type={1}" -f $el.Current.Name, $el.Current.ControlType.ProgrammaticName)
  } else {
    Write-Host 'FromPoint: null'
  }
}

$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::NameProperty, $Needle)
$found = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
Write-Host ("FindAll Name='$Needle' count={0}" -f $(if ($found) { $found.Count } else { 0 }))
if ($found) {
  $i = 0
  foreach ($el in $found) {
    if ($i -ge 8) { break }
    $r = $el.Current.BoundingRectangle
    Write-Host ("  [{0}] type={1} rect={2},{3} {4}x{5}" -f $i, $el.Current.ControlType.ProgrammaticName, [int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height)
    $i++
  }
}
