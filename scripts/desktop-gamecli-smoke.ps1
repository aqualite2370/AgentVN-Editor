param(
  [Parameter(Mandatory = $true)]
  [string]$ExePath,

  [Parameter(Mandatory = $true)]
  [string]$OutputDir,

  [int]$TimeoutSeconds = 120,

  [string[]]$Arguments = @(),

  [switch]$Json
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $ExePath)) {
  throw "ExePath not found: $ExePath"
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

if (-not ([System.Management.Automation.PSTypeName]"AgentVNSmokeWin32").Type) {
  Add-Type @"
using System;
using System.Runtime.InteropServices;

public class AgentVNSmokeWin32 {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT {
    public int X;
    public int Y;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct WINDOWPLACEMENT {
    public int length;
    public int flags;
    public int showCmd;
    public POINT ptMinPosition;
    public POINT ptMaxPosition;
    public RECT rcNormalPosition;
  }

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

  [DllImport("user32.dll")]
  public static extern bool GetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT placement);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool IsZoomed(IntPtr hWnd);

  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtr")]
  private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);

  [DllImport("user32.dll", EntryPoint = "GetWindowLong")]
  private static extern IntPtr GetWindowLongPtr32(IntPtr hWnd, int nIndex);

  public static IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex) {
    return IntPtr.Size == 8 ? GetWindowLongPtr64(hWnd, nIndex) : GetWindowLongPtr32(hWnd, nIndex);
  }
}
"@
}

function Convert-Rect($Rect) {
  [ordered]@{
    left = $Rect.Left
    top = $Rect.Top
    right = $Rect.Right
    bottom = $Rect.Bottom
    width = $Rect.Right - $Rect.Left
    height = $Rect.Bottom - $Rect.Top
  }
}

function Save-DesktopScreenshot($Path) {
  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

function Get-MainWindowHandle($Process, [int]$TimeoutMilliseconds = 5000) {
  $deadline = (Get-Date).AddMilliseconds($TimeoutMilliseconds)
  while ((Get-Date) -lt $deadline) {
    $Process.Refresh()
    if ($Process.HasExited) { return [IntPtr]::Zero }
    $handle = $Process.MainWindowHandle
    if ($null -ne $handle -and $handle -ne [IntPtr]::Zero) {
      return [IntPtr]$handle
    }
    Start-Sleep -Milliseconds 250
  }
  return [IntPtr]::Zero
}

function Get-WindowSnapshot($Process, $Label) {
  $Process.Refresh()
  $handle = Get-MainWindowHandle -Process $Process -TimeoutMilliseconds 5000
  if ($null -eq $handle -or $handle -eq [IntPtr]::Zero) {
    return [ordered]@{
      label = $Label
      processId = $Process.Id
      hasWindow = $false
    }
  }

  $rect = New-Object AgentVNSmokeWin32+RECT
  [AgentVNSmokeWin32]::GetWindowRect($handle, [ref]$rect) | Out-Null
  $placement = New-Object AgentVNSmokeWin32+WINDOWPLACEMENT
  $placement.length = [Runtime.InteropServices.Marshal]::SizeOf([type]"AgentVNSmokeWin32+WINDOWPLACEMENT")
  [AgentVNSmokeWin32]::GetWindowPlacement($handle, [ref]$placement) | Out-Null

  $screen = [System.Windows.Forms.Screen]::FromHandle($handle)
  $screenBounds = $screen.Bounds
  $workArea = $screen.WorkingArea
  $styleValue = [AgentVNSmokeWin32]::GetWindowLongPtr($handle, -16).ToInt64()
  $wsThickFrame = 0x00040000
  $wsMinimizeBox = 0x00020000
  $wsMaximizeBox = 0x00010000
  $rectHash = Convert-Rect $rect

  $coversWorkArea =
    [Math]::Abs($rect.Left - $workArea.Left) -le 12 -and
    [Math]::Abs($rect.Top - $workArea.Top) -le 12 -and
    [Math]::Abs($rect.Right - $workArea.Right) -le 16 -and
    [Math]::Abs($rect.Bottom - $workArea.Bottom) -le 16
  $coversScreen =
    [Math]::Abs($rect.Left - $screenBounds.Left) -le 12 -and
    [Math]::Abs($rect.Top - $screenBounds.Top) -le 12 -and
    [Math]::Abs($rect.Right - $screenBounds.Right) -le 16 -and
    [Math]::Abs($rect.Bottom - $screenBounds.Bottom) -le 16

  [ordered]@{
    label = $Label
    processId = $Process.Id
    title = $Process.MainWindowTitle
    hasWindow = $true
    showCmd = $placement.showCmd
    isZoomed = [AgentVNSmokeWin32]::IsZoomed($handle)
    rect = $rectHash
    workArea = [ordered]@{ left = $workArea.Left; top = $workArea.Top; right = $workArea.Right; bottom = $workArea.Bottom; width = $workArea.Width; height = $workArea.Height }
    screenBounds = [ordered]@{ left = $screenBounds.Left; top = $screenBounds.Top; right = $screenBounds.Right; bottom = $screenBounds.Bottom; width = $screenBounds.Width; height = $screenBounds.Height }
    coversWorkArea = $coversWorkArea
    coversScreen = $coversScreen
    style = [ordered]@{
      value = $styleValue
      hasThickFrame = (($styleValue -band $wsThickFrame) -ne 0)
      hasMinimizeBox = (($styleValue -band $wsMinimizeBox) -ne 0)
      hasMaximizeBox = (($styleValue -band $wsMaximizeBox) -ne 0)
    }
  }
}

function Wait-MainWindow($Process, $TimeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $Process.Refresh()
    if ($Process.HasExited) {
      throw "Process exited before creating a main window. ExitCode=$($Process.ExitCode)"
    }
    if ((Get-MainWindowHandle -Process $Process -TimeoutMilliseconds 500) -ne [IntPtr]::Zero) {
      return
    }
    Start-Sleep -Milliseconds 500
  }
  throw "Timed out waiting for main window."
}

function Focus-Window($Process) {
  $Process.Refresh()
  $handle = Get-MainWindowHandle -Process $Process -TimeoutMilliseconds 5000
  if ($handle -ne [IntPtr]::Zero) {
    [AgentVNSmokeWin32]::SetForegroundWindow($handle) | Out-Null
    Start-Sleep -Milliseconds 900
  }
}

function Get-WindowAccessibilityText($Process, $Label, $OutputDir) {
  $Process.Refresh()
  $handle = Get-MainWindowHandle -Process $Process -TimeoutMilliseconds 5000
  $textPath = Join-Path $OutputDir ("desktop_accessibility_" + $Label + ".txt")
  if ($handle -eq [IntPtr]::Zero) {
    "" | Set-Content -LiteralPath $textPath -Encoding UTF8
    return [ordered]@{
      label = $Label
      textPath = $textPath
      text = ""
      error = "No main window handle."
    }
  }

  try {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
    if ($null -eq $root) {
      "" | Set-Content -LiteralPath $textPath -Encoding UTF8
      return [ordered]@{
        label = $Label
        textPath = $textPath
        text = ""
        error = "UI Automation returned no root element."
      }
    }

    $lines = New-Object System.Collections.Generic.List[string]
    $queue = New-Object System.Collections.Generic.Queue[object]
    $queue.Enqueue([ordered]@{ element = $root; depth = 0 })
    $trueCondition = [System.Windows.Automation.Condition]::TrueCondition

    while ($queue.Count -gt 0 -and $lines.Count -lt 500) {
      $item = $queue.Dequeue()
      $element = $item.element
      $depth = [int]$item.depth
      try {
        $name = $element.Current.Name
        $automationId = $element.Current.AutomationId
        $controlType = $element.Current.ControlType.ProgrammaticName
        if (-not [string]::IsNullOrWhiteSpace($name) -or -not [string]::IsNullOrWhiteSpace($automationId)) {
          $lines.Add(("{0}{1} | {2} | {3}" -f ("  " * $depth), $controlType, $automationId, $name))
        }

        if ($depth -lt 10) {
          $children = $element.FindAll([System.Windows.Automation.TreeScope]::Children, $trueCondition)
          foreach ($child in $children) {
            $queue.Enqueue([ordered]@{ element = $child; depth = ($depth + 1) })
          }
        }
      } catch {
        $lines.Add(("{0}<UIA read error: {1}>" -f ("  " * $depth), $_.Exception.Message))
      }
    }

    $text = ($lines -join "`n")
    $text | Set-Content -LiteralPath $textPath -Encoding UTF8
    return [ordered]@{
      label = $Label
      textPath = $textPath
      text = $text
      error = $null
    }
  } catch {
    $_.Exception.Message | Set-Content -LiteralPath $textPath -Encoding UTF8
    return [ordered]@{
      label = $Label
      textPath = $textPath
      text = ""
      error = $_.Exception.Message
    }
  }
}

$resolvedExe = (Resolve-Path -LiteralPath $ExePath).Path
$process = $null
$snapshots = @()
$screenshots = @()
$accessibilitySnapshots = @()
$errors = @()

try {
  $startProcessParams = @{
    FilePath = $resolvedExe
    WorkingDirectory = (Split-Path -Parent $resolvedExe)
    PassThru = $true
    WindowStyle = "Normal"
  }
  if ($Arguments.Count -gt 0) {
    $startProcessParams.ArgumentList = $Arguments
  }
  $process = Start-Process @startProcessParams
  Wait-MainWindow -Process $process -TimeoutSeconds $TimeoutSeconds
  Start-Sleep -Seconds 4
  Focus-Window $process

  $initialPng = Join-Path $OutputDir "desktop_initial.png"
  Save-DesktopScreenshot $initialPng
  $screenshots += $initialPng
  $snapshots += Get-WindowSnapshot -Process $process -Label "initial"
  $accessibilitySnapshots += Get-WindowAccessibilityText -Process $process -Label "initial" -OutputDir $OutputDir

  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
  Start-Sleep -Seconds 2
  [System.Windows.Forms.SendKeys]::SendWait("{TAB}{ENTER}")
  Start-Sleep -Seconds 3
  $afterStartPng = Join-Path $OutputDir "desktop_after_start_keys.png"
  Save-DesktopScreenshot $afterStartPng
  $screenshots += $afterStartPng
  $snapshots += Get-WindowSnapshot -Process $process -Label "after_start_keys"
  $accessibilitySnapshots += Get-WindowAccessibilityText -Process $process -Label "after_start_keys" -OutputDir $OutputDir

  $maximizedModeSnapshot = $null
  for ($attempt = 1; $attempt -le 3; $attempt += 1) {
    Focus-Window $process
    [System.Windows.Forms.SendKeys]::SendWait("f")
    Start-Sleep -Seconds 3
    $candidate = Get-WindowSnapshot -Process $process -Label "after_maximized_mode_key_$attempt"
    if ($candidate.isZoomed -or $candidate.coversWorkArea -or $candidate.coversScreen) {
      $maximizedModeSnapshot = $candidate
      break
    }
  }
  if ($null -eq $maximizedModeSnapshot) {
    $maximizedModeSnapshot = Get-WindowSnapshot -Process $process -Label "after_maximized_mode_key_failed"
  }
  $snapshots += $maximizedModeSnapshot
  $maximizedModePng = Join-Path $OutputDir "desktop_maximized_mode_attempt.png"
  Save-DesktopScreenshot $maximizedModePng
  $screenshots += $maximizedModePng
  $accessibilitySnapshots += Get-WindowAccessibilityText -Process $process -Label "after_maximized_mode" -OutputDir $OutputDir

  Focus-Window $process
  [System.Windows.Forms.SendKeys]::SendWait("f")
  Start-Sleep -Seconds 3
  $afterExitPng = Join-Path $OutputDir "desktop_after_reapply_maximized_mode.png"
  Save-DesktopScreenshot $afterExitPng
  $screenshots += $afterExitPng
  $snapshots += Get-WindowSnapshot -Process $process -Label "after_reapply_maximized_mode"
  $accessibilitySnapshots += Get-WindowAccessibilityText -Process $process -Label "after_reapply_maximized_mode" -OutputDir $OutputDir
} catch {
  $errors += $_.Exception.Message
} finally {
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }
}

$initial = $snapshots | Where-Object { $_.label -eq "initial" } | Select-Object -First 1
$afterExit = $snapshots | Where-Object { $_.label -eq "after_reapply_maximized_mode" } | Select-Object -First 1
$maximizedMode = $snapshots | Where-Object { $_.label -like "after_maximized_mode_key*" } | Select-Object -First 1

$initialDisplayModeValid = $initial -and ($initial.isZoomed -or $initial.coversWorkArea -or $initial.coversScreen)
$notResizable = $initial -and (-not $initial.style.hasThickFrame) -and (-not $initial.style.hasMaximizeBox)
$minimizeDisabled = $initial -and (-not $initial.style.hasMinimizeBox)
$maximizedModeRetained = $maximizedMode -and ($maximizedMode.isZoomed -or $maximizedMode.coversWorkArea -or $maximizedMode.coversScreen)
$fullscreenKeyStayedWindowed = $maximizedMode -and $initial -and ($maximizedMode.style.value -eq $initial.style.value) -and (-not $maximizedMode.style.hasThickFrame) -and (-not $maximizedMode.style.hasMinimizeBox)
$exitDisplayModeValid = $afterExit -and ($afterExit.isZoomed -or $afterExit.coversWorkArea -or $afterExit.coversScreen)
$combinedAccessibilityText = (($accessibilitySnapshots | ForEach-Object { $_.text }) -join "`n")
$errorTextPattern = "GAMECLI ERROR|卡带加载或运行失败|控件类型不支持|component_type|Unsupported component|Unknown component|main_menu_actions"
$titleOrStoryPattern = "GameCLI Player|合集|重写视觉小说|开始|重新开始|继续|存档|读档|卡带库|画廊|设置|关于|自动|跳过|隐藏|历史|快进|菜单"
$accessibilityAvailable = -not [string]::IsNullOrWhiteSpace($combinedAccessibilityText)
$errorTextDetected = $combinedAccessibilityText -match $errorTextPattern
$dynamicCartridgeTitleDetected = $combinedAccessibilityText -match "\S+\s+-\s+AgentVN Player"
$titleOrStoryDetected = $dynamicCartridgeTitleDetected -or ($combinedAccessibilityText -match $titleOrStoryPattern)

if (-not $initialDisplayModeValid) { $errors += "Initial window does not cover the work area or full screen." }
if (-not $notResizable) { $errors += "Window style still exposes resize/maximize affordance." }
if (-not $minimizeDisabled) { $errors += "Window style still exposes minimize affordance." }
if (-not $maximizedModeRetained) { $errors += "F key did not retain the configured full-window display mode." }
if (-not $fullscreenKeyStayedWindowed) { $errors += "F key changed the native window style instead of staying windowed." }
if (-not $exitDisplayModeValid) { $errors += "Reapplying the display mode did not restore work-area or full-screen coverage." }
if (-not $accessibilityAvailable) { $errors += "Desktop smoke could not read any UI content, so it cannot prove the cartridge loaded." }
if ($errorTextDetected) { $errors += "GameCli error page text was detected in the desktop window." }
if (-not $titleOrStoryDetected) { $errors += "Desktop smoke did not detect title menu or story player content." }

$report = [ordered]@{
  exePath = $resolvedExe
  arguments = $Arguments
  ok = ($errors.Count -eq 0)
  timestamp = (Get-Date).ToString("o")
  screenshots = $screenshots
  assertions = [ordered]@{
    initialMaximizedOrFullscreen = [bool]$initialDisplayModeValid
    notResizable = [bool]$notResizable
    minimizeDisabled = [bool]$minimizeDisabled
    maximizedModeRetained = [bool]$maximizedModeRetained
    fullscreenKeyStayedWindowed = [bool]$fullscreenKeyStayedWindowed
    exitRestoredMaximizedOrFullscreen = [bool]$exitDisplayModeValid
    accessibilityAvailable = [bool]$accessibilityAvailable
    errorTextDetected = [bool]$errorTextDetected
    dynamicCartridgeTitleDetected = [bool]$dynamicCartridgeTitleDetected
    titleOrStoryDetected = [bool]$titleOrStoryDetected
  }
  snapshots = $snapshots
  accessibilitySnapshots = $accessibilitySnapshots
  errors = $errors
}

$reportPath = Join-Path $OutputDir "desktop-smoke-report.json"
$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $reportPath -Encoding UTF8

if ($Json) {
  $report | ConvertTo-Json -Depth 12
}

if (-not $report.ok) {
  exit 1
}
