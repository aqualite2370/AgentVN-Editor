$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'android-cold-boot.ps1')

$expected = [pscustomobject]@{ ProcessId=10; CreationDate=[DateTime]'2026-09-21T17:00:00Z'; CommandLine='emulator -avd AgentVN_API35' }
$same = [pscustomobject]@{ ProcessId=10; CreationDate='20260922010000.000000+480'; CommandLine='emulator -avd AgentVN_API35' }
$reused = [pscustomobject]@{ ProcessId=10; CreationDate='20260922020000.000000+480'; CommandLine='other' }
if (-not (Test-AndroidOwnedProcess $expected $same)) { throw 'owned identity rejected' }
if (Test-AndroidOwnedProcess $expected $reused) { throw 'PID reuse accepted' }
try { Assert-AndroidBootPorts @(5554,5555,5044,5042,9223,5042); throw 'duplicate ports accepted' } catch { if ($_.Exception.Message -ne 'ANDROID_PORTS_MUST_BE_DISTINCT') { throw } }
try { Assert-AndroidBootPorts @(80); throw 'invalid port accepted' } catch { if ($_.Exception.Message -ne 'INVALID_PORT:80') { throw } }

$entry = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'start-android-acceptance.ps1'))
foreach ($required in @('Start-AndroidAcceptanceBoot','Stop-AndroidAcceptanceBoot','emulatorCleanupStatus')) {
  if (-not $entry.Contains($required)) { throw "missing formal cold boot integration: $required" }
}
if (-not $entry.Contains('Add-Member -NotePropertyName emulatorDiscovery')) { throw 'dynamic discovery request handoff missing' }
$cold = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'android-cold-boot.ps1'))
if (-not $cold.Contains("Stop-Process -Id `$owned.ProcessId -Force")) { throw 'verified force-stop fallback missing' }
Write-Output 'android-cold-boot: PASS (ownership identity, distinct ports, formal finally cleanup integration)'
