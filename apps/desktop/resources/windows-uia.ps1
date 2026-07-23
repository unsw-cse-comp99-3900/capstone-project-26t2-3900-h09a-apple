$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

Add-Type -AssemblyName UIAutomationClient | Out-Null
Add-Type -AssemblyName UIAutomationTypes | Out-Null
Add-Type -AssemblyName WindowsBase | Out-Null

function Limit-Text {
  param(
    $Value,
    [int] $MaxLength,
    [bool] $CollapseWhitespace = $false
  )

  if ($null -eq $Value) {
    return $null
  }

  $text = [string]$Value
  if ($CollapseWhitespace) {
    $text = [regex]::Replace($text, '\s+', ' ').Trim()
  }

  if ($text.Length -le $MaxLength) {
    return $text
  }

  return $text.Substring(0, $MaxLength)
}

function Get-SafeProperty {
  param(
    [Parameter(Mandatory = $true)] $Element,
    [Parameter(Mandatory = $true)] [scriptblock] $Getter,
    $Fallback = $null
  )

  try {
    return & $Getter $Element
  } catch {
    return $Fallback
  }
}

function Convert-Rect {
  param($Rect)

  if ($null -eq $Rect -or $Rect.IsEmpty) {
    return $null
  }

  return [ordered]@{
    x = [double]$Rect.X
    y = [double]$Rect.Y
    width = [double]$Rect.Width
    height = [double]$Rect.Height
  }
}

function Convert-Ancestor {
  param($Element)

  return [ordered]@{
    automation_id = Limit-Text (
      Get-SafeProperty $Element { param($item) $item.Current.AutomationId }
    ) 200 $true
    name = Limit-Text (
      Get-SafeProperty $Element { param($item) $item.Current.Name }
    ) 120 $true
    control_type = Get-SafeProperty $Element {
      param($item)
      if ($null -eq $item.Current.ControlType) { return $null }
      return $item.Current.ControlType.ProgrammaticName
    }
    class_name = Get-SafeProperty $Element { param($item) $item.Current.ClassName }
  }
}

function Convert-Element {
  param($Element)

  if ($null -eq $Element) {
    return $null
  }

  $ancestors = @()
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $parent = Get-SafeProperty $Element { param($item) $walker.GetParent($item) }
  $depth = 0

  while ($null -ne $parent -and $depth -lt 6) {
    $ancestors += ,(Convert-Ancestor $parent)
    $parent = Get-SafeProperty $parent { param($item) $walker.GetParent($item) }
    $depth += 1
  }

  $runtimeId = Get-SafeProperty $Element { param($item) $item.GetRuntimeId() } @()
  $controlType = Get-SafeProperty $Element {
    param($item)
    if ($null -eq $item.Current.ControlType) { return $null }
    return $item.Current.ControlType.ProgrammaticName
  }
  $isPassword = Get-SafeProperty $Element {
    param($item) [bool]$item.Current.IsPassword
  } $false
  $supportsValuePattern = $false
  $valuePatternValue = $null

  if (-not $isPassword) {
    try {
      $valuePattern = [System.Windows.Automation.ValuePattern]$Element.GetCurrentPattern(
        [System.Windows.Automation.ValuePattern]::Pattern
      )
      $supportsValuePattern = $true
      $valuePatternValue = Limit-Text $valuePattern.Current.Value 10000 $false
    } catch {
      $supportsValuePattern = $false
      $valuePatternValue = $null
    }
  }

  return [ordered]@{
    provider = 'windows_uia'
    automation_id = Limit-Text (
      Get-SafeProperty $Element { param($item) $item.Current.AutomationId }
    ) 200 $true
    name = Limit-Text (
      Get-SafeProperty $Element { param($item) $item.Current.Name }
    ) 200 $true
    control_type = $controlType
    localized_control_type = Get-SafeProperty $Element {
      param($item) $item.Current.LocalizedControlType
    }
    class_name = Get-SafeProperty $Element { param($item) $item.Current.ClassName }
    framework_id = Get-SafeProperty $Element { param($item) $item.Current.FrameworkId }
    runtime_id = @($runtimeId)
    bounding_rect_physical = Convert-Rect (
      Get-SafeProperty $Element { param($item) $item.Current.BoundingRectangle }
    )
    is_enabled = Get-SafeProperty $Element { param($item) [bool]$item.Current.IsEnabled }
    is_offscreen = Get-SafeProperty $Element { param($item) [bool]$item.Current.IsOffscreen }
    is_password = $isPassword
    supports_value_pattern = $supportsValuePattern
    value_pattern_value = $valuePatternValue
    ancestor_path = $ancestors
  }
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  if ([string]::IsNullOrWhiteSpace($line)) {
    continue
  }

  $requestId = $null

  try {
    $request = $line | ConvertFrom-Json
    $requestId = [string]$request.requestId

    switch ([string]$request.command) {
      'elementFromPoint' {
        $point = New-Object System.Windows.Point(
          [double]$request.x,
          [double]$request.y
        )
        $element = [System.Windows.Automation.AutomationElement]::FromPoint($point)
      }
      'focusedElement' {
        $element = [System.Windows.Automation.AutomationElement]::FocusedElement
      }
      default {
        throw "Unsupported UI Automation command: $($request.command)"
      }
    }

    $response = [ordered]@{
      requestId = $requestId
      ok = $true
      target = Convert-Element $element
    }
  } catch {
    $response = [ordered]@{
      requestId = $requestId
      ok = $false
      error = $_.Exception.Message
    }
  }

  [Console]::Out.WriteLine(($response | ConvertTo-Json -Depth 12 -Compress))
  [Console]::Out.Flush()
}
