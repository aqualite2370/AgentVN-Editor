param(
  [Parameter(Mandatory=$true)][string]$RequestPath,
  [switch]$Elevated
)
$ErrorActionPreference = 'Stop'
$requestFile = [IO.Path]::GetFullPath($RequestPath)
$request = [IO.File]::ReadAllText($requestFile, [Text.Encoding]::UTF8).TrimStart([char]0xFEFF) | ConvertFrom-Json
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$isElevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $Elevated) {
  if ($isElevated) { throw 'Start from a non-administrator session so the elevation boundary is recorded.' }
  $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"'), '-RequestPath', ('"' + $requestFile + '"'), '-Elevated')
  $child = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList $arguments -PassThru
  Write-Output "Administrator helper PID: $($child.Id)"
  exit 0
}
if (-not $isElevated) { throw 'ANDROID_ADMIN_REQUIRED' }
$runRoot = [IO.Path]::GetFullPath([string]$request.outputDir)
if (Test-Path -LiteralPath (Join-Path $runRoot 'acceptance-launch.json')) { throw 'RUN_DIRECTORY_ALREADY_USED' }
New-Item -ItemType Directory -Force -Path $runRoot | Out-Null
$launch = [ordered]@{ isElevated=$true; processId=$PID; parentBoundary='non-admin-to-RunAs'; startedAt=(Get-Date).ToUniversalTime().ToString('o'); status='RUNNING' }
function Save-Launch {
  [IO.File]::WriteAllText((Join-Path $runRoot 'acceptance-launch.json'), ($launch | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))
}
Save-Launch
$bootContext = [ordered]@{}
try {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'android-acceptance-preflight.ps1') -OutputDir $runRoot
  if ($LASTEXITCODE -ne 0) { throw 'ANDROID_SYMLINK_REQUIRED' }
  if ($request.coldBoot) {
    . (Join-Path $PSScriptRoot 'android-cold-boot.ps1')
    Start-AndroidAcceptanceBoot $request $bootContext
    $request | Add-Member -NotePropertyName emulatorDiscovery -NotePropertyValue $bootContext.emulatorDiscovery -Force
    [IO.File]::WriteAllText($requestFile, ($request | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))
  }
  if ($request.traceCapabilitiesOnly -eq $true) {
    if (-not $bootContext.bootId) { throw 'CAPABILITY_OWNED_COLD_BOOT_REQUIRED' }
    $arguments = @((Join-Path $PSScriptRoot 'android-trace-capabilities.cjs'),
      '--output', $runRoot, '--sdk', [string]$request.sdk, '--serial', [string]$request.serial,
      '--adb-port', [string]$request.adbPort, '--boot-id', [string]$bootContext.bootId)
    if ($request.perfSelfcheck -eq $true) { $arguments += @('--perf-selfcheck', '--run-id', [string]$request.runId) }
    if ($request.webviewPackage) { $arguments += @('--webview-package', [string]$request.webviewPackage) }
    if ($request.webviewSourceApk) { $arguments += @('--webview-source-apk', [string]$request.webviewSourceApk) }
  } elseif ($request.scope -ceq 'installed-native-upgrade') {
    # Explicit QA-only upgrade branch. The ordinary smoke path still performs
    # its original clean installation; it cannot stand in for install -r.
    $arguments = @((Join-Path $PSScriptRoot 'android-native-upgrade-device.cjs'), $requestFile)
  } elseif ($request.scope -ceq 'installed-current-navigation') {
    $arguments = @((Join-Path $PSScriptRoot 'android-current-navigation.cjs'), $requestFile)
  } else {
  $arguments = @((Join-Path $PSScriptRoot 'android-apk-runtime-qa.cjs'), '--apk', [string]$request.apk,
    '--package', [string]$request.package, '--output', $runRoot, '--sdk', [string]$request.sdk,
    '--serial', [string]$request.serial, '--adb-port', [string]$request.adbPort, '--cdp-port', [string]$request.cdpPort,
    '--run-id', [string]$request.runId)
  if ($request.scope) { $arguments += @('--scope', [string]$request.scope) }
  if ($request.cacheProbe -eq $true) { $arguments += '--cache-probe' }
  if ($request.cachePerf -eq $true) { $arguments += '--cache-perf' }
  if ($request.cacheFileTrace -eq $true) { $arguments += '--cache-file-trace' }
  if ($request.cacheStack -eq $true) { $arguments += '--cache-stack' }
  if ($request.cacheDebugger -eq $true) {
    $arguments += @('--cache-debugger', '--debugger-ndk', [string]$request.debuggerNdk, '--debugger-port', [string]$request.debuggerPort)
  }
  if ($request.rendererOnly -eq $true) { $arguments += '--renderer-only' }
  if ($request.audioConfirmation) { $arguments += @('--audio-confirmation', [string]$request.audioConfirmation) }
  if ($request.storyFixture) { $arguments += @('--story-fixture', [string]$request.storyFixture) }
  $discovery = if ($request.coldBoot) { $bootContext.emulatorDiscovery } else { $request.emulatorDiscovery }
  if ($discovery) { $arguments += @('--emulator-discovery', [string]$discovery) }
  }
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & node @arguments 1> (Join-Path $runRoot 'runner-stdout.log') 2> (Join-Path $runRoot 'runner-stderr.log')
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previous }
  $launch.exitCode = $code
  $launch.status = if ($code -eq 0) { 'PASS' } else { 'CHECK_RUNTIME_REPORT' }
} catch {
  $launch.status = 'BLOCKED'
  $launch.error = $_.Exception.Message
  if ($bootContext.outputDir -and $bootContext.status -ne 'PASS') { $bootContext.status = 'BLOCKED'; $bootContext.error = $_.Exception.Message }
} finally {
  if ($request.coldBoot -and $bootContext.outputDir) {
    Stop-AndroidAcceptanceBoot $bootContext
    $launch.emulatorCleanupStatus = $bootContext.emulatorCleanupStatus
    if ($bootContext.emulatorCleanupStatus -ne 'PASS') { $launch.status = 'FAILED'; $launch.cleanupError = $bootContext.cleanupError }
  }
  $launch.finishedAt = (Get-Date).ToUniversalTime().ToString('o')
  Save-Launch
}
