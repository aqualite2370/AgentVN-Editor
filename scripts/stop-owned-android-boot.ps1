param([Parameter(Mandatory=$true)][string]$BootEvidencePath)
$ErrorActionPreference = 'Stop'
$path = [IO.Path]::GetFullPath($BootEvidencePath)
$boot = [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8) | ConvertFrom-Json
if ($boot.isElevated -ne $true -or $boot.status -ne 'PASS') { throw 'BOOT_EVIDENCE_NOT_PASS' }
. (Join-Path $PSScriptRoot 'android-cold-boot.ps1')
$context = [ordered]@{
  outputDir = Split-Path -Parent $path
  adb = 'D:\Android_dev\Sdk\platform-tools\adb.exe'
  adbPort = [int]$boot.adbPort
  serial = 'emulator-5554'
  bootId = [string]$boot.bootId
  processes = @($boot.processes)
  adbOwned = $false
  emulatorCleanupStatus = 'NOT_RUN'
}
Stop-AndroidAcceptanceBoot $context
if ($context.emulatorCleanupStatus -ne 'PASS') { throw "ANDROID_EMULATOR_CLEANUP_FAILED:$($context.cleanupError)" }
Write-Output "owned Android emulator stopped: PASS ($($context.emulatorCleanupMode ?? 'graceful'))"
