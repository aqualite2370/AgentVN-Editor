param(
  [string]$ApkPath = "",
  [string]$SdkRoot = "D:\Android_dev\Sdk",
  [string]$AvdName = "AgentVN_API35",
  [string]$Serial = "emulator-5554",
  [int]$BootTimeoutSeconds = 180,
  [string]$AdbPath = "",
  [string]$AaptPath = "",
  [string]$EmulatorPath = ""
)

$ErrorActionPreference = "Stop"

function Resolve-RequiredPath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Label,
    [ValidateSet("Leaf", "Container")][string]$PathType = "Leaf"
  )

  if (-not (Test-Path -LiteralPath $Path -PathType $PathType)) {
    throw "$Label not found: $Path"
  }
  return [System.IO.Path]::GetFullPath($Path)
}

function Invoke-External {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [switch]$AllowFailure
  )

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & $FilePath @Arguments 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if (-not $AllowFailure -and $exitCode -ne 0) {
    $details = (($output | ForEach-Object { $_.ToString() }) -join "`n").Trim()
    if (-not $details) { $details = "exit code $exitCode" }
    throw "$FilePath failed: $details"
  }
  return [pscustomobject]@{
    ExitCode = $exitCode
    Output = (($output | ForEach-Object { $_.ToString() }) -join "`n").Trim()
  }
}

function Find-LatestAapt {
  param([Parameter(Mandatory = $true)][string]$Root)

  $buildToolsRoot = Join-Path $Root "build-tools"
  if (-not (Test-Path -LiteralPath $buildToolsRoot -PathType Container)) {
    return $null
  }

  $candidate = Get-ChildItem -LiteralPath $buildToolsRoot -Directory |
    Sort-Object Name -Descending |
    ForEach-Object {
      $path = Join-Path $_.FullName "aapt.exe"
      if (Test-Path -LiteralPath $path -PathType Leaf) { return $path }
    } |
    Select-Object -First 1

  if ($candidate) { return [System.IO.Path]::GetFullPath($candidate) }
  return $null
}

function Test-AsciiPath {
  param([Parameter(Mandatory = $true)][string]$Path)
  return $Path -notmatch "[^\x00-\x7F]"
}

function New-AsciiApkStagingCopy {
  param([Parameter(Mandatory = $true)][string]$SourcePath)

  $candidates = @(
    (Join-Path $env:SystemRoot "Temp"),
    (Join-Path $env:SystemDrive "AgentVN-AndroidDev-Temp"),
    ([System.IO.Path]::GetTempPath())
  ) | Where-Object { $_ -and (Test-AsciiPath -Path $_) } | Select-Object -Unique
  foreach ($candidate in $candidates) {
    try {
      New-Item -ItemType Directory -Force -Path $candidate -ErrorAction Stop | Out-Null
      $stagingPath = Join-Path $candidate ("agentvn-androiddev-" + [guid]::NewGuid().ToString("N") + ".apk")
      Copy-Item -LiteralPath $SourcePath -Destination $stagingPath -Force -ErrorAction Stop
      return [System.IO.Path]::GetFullPath($stagingPath)
    } catch {
      continue
    }
  }
  throw "Could not create an ASCII-only staging copy for the APK. aapt cannot safely inspect a non-ASCII path: $SourcePath"
}

if ([string]::IsNullOrWhiteSpace($ApkPath)) {
  $ApkPath = Read-Host "Enter APK path (you can drag an APK into this window, then press Enter)"
}
$ApkPath = $ApkPath.Trim().Trim('"')
if ([string]::IsNullOrWhiteSpace($ApkPath)) {
  throw "APK path cannot be empty."
}
$apk = Resolve-RequiredPath -Path $ApkPath -Label "APK"
if ([System.IO.Path]::GetExtension($apk) -ine ".apk") {
  throw "The selected file is not an APK: $apk"
}
$apkForTools = $apk
$stagingApk = $null
if (-not (Test-AsciiPath -Path $apk)) {
  $stagingApk = New-AsciiApkStagingCopy -SourcePath $apk
  $apkForTools = $stagingApk
  Write-Host "[AgentVN] APK path contains non-ASCII characters; using temporary ASCII staging copy for Androiddev tools." -ForegroundColor Yellow
}

$sdkRoot = Resolve-RequiredPath -Path $SdkRoot -Label "Android SDK root" -PathType Container
$adb = if ($AdbPath) {
  Resolve-RequiredPath -Path $AdbPath -Label "adb"
} else {
  Resolve-RequiredPath -Path (Join-Path $sdkRoot "platform-tools\adb.exe") -Label "adb"
}
$emulator = if ($EmulatorPath) {
  Resolve-RequiredPath -Path $EmulatorPath -Label "Android emulator"
} else {
  Resolve-RequiredPath -Path (Join-Path $sdkRoot "emulator\emulator.exe") -Label "Android emulator"
}
$aapt = if ($AaptPath) {
  Resolve-RequiredPath -Path $AaptPath -Label "aapt"
} else {
  Find-LatestAapt -Root $sdkRoot
}
if (-not $aapt) {
  $managedSdkRoot = Join-Path $env:LOCALAPPDATA "AgentVN\AndroidToolchain\Sdk"
  if ((Test-Path -LiteralPath $managedSdkRoot -PathType Container) -and
      -not $managedSdkRoot.Equals($sdkRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    $aapt = Find-LatestAapt -Root $managedSdkRoot
  }
}
if (-not $aapt) {
  throw "aapt.exe was not found in the configured SDK or AgentVN managed SDK. Install Android SDK Build-Tools."
}

$env:ANDROID_SDK_ROOT = $sdkRoot
$env:ANDROID_HOME = $sdkRoot
try {
  $env:ANDROID_AVD_HOME = "D:\Android_dev\avd"

  Write-Host "[AgentVN] APK: $apk" -ForegroundColor Cyan
  Write-Host "[AgentVN] AVD: $AvdName ($Serial)" -ForegroundColor Cyan

  $state = (Invoke-External -FilePath $adb -Arguments @("-s", $Serial, "get-state") -AllowFailure).Output
  if ($state -ne "device") {
    Write-Host "[AgentVN] Starting Android emulator..." -ForegroundColor Green
    Start-Process `
      -FilePath $emulator `
      -ArgumentList @(
        "-avd", $AvdName,
        "-no-snapshot",
        "-no-boot-anim",
        "-gpu", "swiftshader_indirect",
        "-accel", "on"
      ) `
      -WindowStyle Hidden | Out-Null
  } else {
    Write-Host "[AgentVN] Emulator is already running." -ForegroundColor Yellow
  }

  Write-Host "[AgentVN] Waiting for Android to finish booting..." -ForegroundColor Green
  $booted = $false
  for ($second = 0; $second -lt $BootTimeoutSeconds; $second++) {
    $deviceState = (Invoke-External -FilePath $adb -Arguments @("-s", $Serial, "get-state") -AllowFailure).Output
    if ($deviceState -eq "device") {
      $bootCompleted = (Invoke-External -FilePath $adb -Arguments @("-s", $Serial, "shell", "getprop", "sys.boot_completed") -AllowFailure).Output
      if ($bootCompleted -match "(^|\s)1(\s|$)") {
        $booted = $true
        break
      }
    }
    Start-Sleep -Seconds 1
  }
  if (-not $booted) {
    throw "Emulator did not finish booting within $BootTimeoutSeconds seconds: $Serial"
  }

  $badging = (Invoke-External -FilePath $aapt -Arguments @("dump", "badging", $apkForTools)).Output
  $packageMatch = [regex]::Match($badging, 'package:\s+name=''([^'']+)''')
  if (-not $packageMatch.Success) {
    throw "Could not determine the Android package name from the APK."
  }
  $packageName = $packageMatch.Groups[1].Value

  Write-Host "[AgentVN] Installing APK..." -ForegroundColor Green
  Invoke-External -FilePath $adb -Arguments @("-s", $Serial, "install", "-r", $apkForTools) | Out-Null

  Write-Host "[AgentVN] Launching $packageName..." -ForegroundColor Green
  Invoke-External -FilePath $adb -Arguments @("-s", $Serial, "shell", "am", "force-stop", $packageName) | Out-Null
  Invoke-External -FilePath $adb -Arguments @("-s", $Serial, "shell", "monkey", "-p", $packageName, "1") | Out-Null

  Write-Host "[AgentVN] APK started successfully." -ForegroundColor Cyan
  exit 0
} finally {
  if ($stagingApk -and (Test-Path -LiteralPath $stagingApk -PathType Leaf)) {
    Remove-Item -LiteralPath $stagingApk -Force -ErrorAction SilentlyContinue
  }
}
