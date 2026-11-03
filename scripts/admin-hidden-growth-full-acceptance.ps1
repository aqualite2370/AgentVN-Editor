$ErrorActionPreference = "Stop"

$root = "D:\AgentVN"
$outputDir = Join-Path $root "output\hidden-growth\android"
$logPath = Join-Path $outputDir "admin-full-acceptance-20260906.log"
$statusPath = Join-Path $outputDir "admin-full-acceptance-20260906.status.json"
$stagingApk = Join-Path $env:TEMP ("agentvn-hidden-growth-" + [guid]::NewGuid().ToString("N") + ".apk")

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$isElevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Set-Content -LiteralPath $logPath -Value ("isElevated=" + $isElevated) -Encoding utf8
if (-not $isElevated) { throw "ADMINISTRATOR_REQUIRED" }

$exitCode = 1

function Read-StrictUtf8Json {
  param([Parameter(Mandatory = $true)][string]$Path)
  $utf8 = New-Object System.Text.UTF8Encoding($false, $true)
  $text = [System.IO.File]::ReadAllText($Path, $utf8)
  return ($text.TrimStart([char]0xFEFF) | ConvertFrom-Json)
}

try {
  & node (Join-Path $root "scripts\hidden-growth-android-acceptance.cjs") *>> $logPath
  if ($LASTEXITCODE -ne 0) { throw "ANDROID_BUILD_FAILED: exit code $LASTEXITCODE" }

  $apk = Get-ChildItem -LiteralPath $outputDir -Filter "*.apk" -File |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $apk) { throw "ANDROID_APK_MISSING" }
  Copy-Item -LiteralPath $apk.FullName -Destination $stagingApk -Force

  & node (Join-Path $root "scripts\hidden-growth-android-landscape-acceptance.cjs") `
    --apk $apk.FullName `
    --staging-apk $stagingApk `
    --package com.agentvn.hidden.growth `
    --serial emulator-5554 `
    --sdk D:\Android_dev\Sdk *>> $logPath
  $exitCode = $LASTEXITCODE
} catch {
  Add-Content -LiteralPath $logPath -Value $_.Exception.Message
  $exitCode = if ($LASTEXITCODE) { $LASTEXITCODE } else { 1 }
} finally {
  if (Test-Path -LiteralPath $stagingApk -PathType Leaf) {
    Remove-Item -LiteralPath $stagingApk -Force -ErrorAction SilentlyContinue
  }
  $reportPath = Join-Path $root "output\hidden-growth\android\landscape-acceptance\report.json"
  $manifestPath = Join-Path $outputDir "diagnostics\package-build-manifest.json"
  $report = $null
  $manifest = $null
  if (Test-Path -LiteralPath $reportPath -PathType Leaf) {
    try {
      $report = Read-StrictUtf8Json -Path $reportPath
    } catch {
      Add-Content -LiteralPath $logPath -Value ("reportReadError=" + $_.Exception.Message)
    }
  }
  if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
    try {
      $manifest = Read-StrictUtf8Json -Path $manifestPath
    } catch {
      Add-Content -LiteralPath $logPath -Value ("manifestReadError=" + $_.Exception.Message)
    }
  }
  $statusValue = [ordered]@{
    isElevated = $isElevated
    exitCode = [int]$exitCode
    runId = if ($report -and $report.runId) { $report.runId } elseif ($manifest) { $manifest.runId } else { $null }
    reportPath = $reportPath
    manifestPath = $manifestPath
    status = if ($report) { $report.status } else { $null }
    uninstallStatus = if ($report) { $report.uninstallStatus } else { $null }
    apkCleanupStatus = if ($report) { $report.apkCleanupStatus } else { $null }
    cleanupError = if ($report) { $report.cleanupError } else { $null }
    completedAt = (Get-Date).ToUniversalTime().ToString("o")
  } | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText(
    $statusPath,
    $statusValue + [Environment]::NewLine,
    (New-Object System.Text.UTF8Encoding($false))
  )
}
exit $exitCode
