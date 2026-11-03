[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory,

    [int]$DurationSeconds = 10,

    [string]$WprProfileName,

    [string]$WprProfileFile,

    [switch]$RunColdEntryAudit
)

$ErrorActionPreference = 'Stop'
$startedAt = Get-Date
$etlPath = Join-Path $OutputDirectory 'gpu.etl'
$reportPath = Join-Path $OutputDirectory 'collection-report.json'
$startLog = Join-Path $OutputDirectory 'wpr-start.log'
$stopLog = Join-Path $OutputDirectory 'wpr-stop.log'
$state = [ordered]@{
    kind = 'e2-gpu-etw'
    outputDirectory = $OutputDirectory
    requestedDurationSeconds = $DurationSeconds
    startedAt = $startedAt.ToUniversalTime().ToString('o')
    stoppedAt = $null
    durationSeconds = $null
    user = $null
    isElevated = $false
    wprProfile = $null
    symlinkProbe = [ordered]@{
        created = $false
        path = $null
        target = $null
        error = $null
    }
    wprStartExitCode = $null
    wprStopExitCode = $null
    wprStartAttempted = $false
    wprStopAttempted = $false
    etl = $etlPath
    etlExists = $false
    wprStatusBefore = $null
    wprStatusDuring = $null
    wprStatusAfter = $null
    auditExitCode = $null
    auditReadySignal = $null
    auditDoneSignal = $null
    droppedEvents = $null
    error = $null
}

function Save-State {
    $now = Get-Date
    $state.stoppedAt = $now.ToUniversalTime().ToString('o')
    $state.durationSeconds = [math]::Round(($now - $startedAt).TotalSeconds, 3)
    $state.etlExists = Test-Path -LiteralPath $etlPath
    $state | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $reportPath -Encoding utf8
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
Save-State

$wprWasStartedByThisScript = $false
$symlinkRoot = Join-Path $OutputDirectory 'symlink-probe'
$symlinkTarget = Join-Path $OutputDirectory 'symlink-target.txt'
$symlinkPath = Join-Path $symlinkRoot 'probe.txt'
$auditProcess = $null
$auditOutputDirectory = Join-Path $OutputDirectory 'audit'
$auditStdout = Join-Path $OutputDirectory 'audit.stdout.log'
$auditStderr = Join-Path $OutputDirectory 'audit.stderr.log'
$readyFile = Join-Path $OutputDirectory 'audit.ready.json'
$releaseFile = Join-Path $OutputDirectory 'audit.release'
$doneFile = Join-Path $OutputDirectory 'audit.done.json'

try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    $state.user = $identity.Name
    $state.isElevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    Save-State

    if (-not $state.isElevated) {
        throw 'Administrator token was not present in the elevated collector process.'
    }

    Import-Module (Join-Path $PSScriptRoot 'lib\E2GpuWprProfile.psm1') -Force
    $wprProfileSpec = Get-E2WprProfileSpec -ProfileName $WprProfileName -ProfileFile $WprProfileFile
    $state.wprProfile = $wprProfileSpec
    Save-State

    New-Item -ItemType Directory -Path $symlinkRoot -Force | Out-Null
    Set-Content -LiteralPath $symlinkTarget -Value 'agentvn-etw-probe' -Encoding utf8
    $state.symlinkProbe.path = $symlinkPath
    $state.symlinkProbe.target = $symlinkTarget
    try {
        New-Item -ItemType SymbolicLink -Path $symlinkPath -Target $symlinkTarget -ErrorAction Stop | Out-Null
        $state.symlinkProbe.created = Test-Path -LiteralPath $symlinkPath
    } catch {
        $state.symlinkProbe.error = $_.Exception.Message
    }
    Save-State

    $state.wprStatusBefore = (& wpr.exe -status 2>&1 | Out-String).Trim()
    if ($state.wprStatusBefore -notmatch 'WPR is not recording') {
        throw 'Refusing to start because another WPR recording is already active.'
    }
    Save-State

    if ($RunColdEntryAudit) {
        New-Item -ItemType Directory -Path $auditOutputDirectory -Force | Out-Null
        $env:AGENTVN_TEST_PROJECT = Join-Path $PSScriptRoot 'fixtures\editor-isolated-small.vnproj'
        $env:AGENTVN_WORKSPACE_OUTPUT = $auditOutputDirectory
        $env:AGENTVN_ADVANCED_PERF_PREVIEW = '1'
        $env:AGENTVN_ADVANCED_PERF_DIAGNOSTIC = '1'
        $env:AGENTVN_ADVANCED_PERF_DIAGNOSTIC_ASSERT = '1'
        $env:AGENTVN_ADVANCED_PERF_ENFORCE_LOAF = '1'
        $env:AGENTVN_ADVANCED_PERF_TRACE = '1'
        $env:AGENTVN_ADVANCED_PERF_TRACE_RENDERER = '1'
        $env:AGENTVN_ADVANCED_PERF_LAYER_TREE_TRACE_JOIN = '1'
        $env:AGENTVN_ADVANCED_PERF_REQUIRE_HARDWARE_GPU = '1'
        $env:AGENTVN_ADVANCED_PERF_EXPECTED_GPU = 'NVIDIA GeForce GTX 1050 Ti'
        $env:AGENTVN_ADVANCED_PERF_DIAGNOSTIC_REPEATS = '1'
        $env:AGENTVN_ADVANCED_PERF_ENTRY_MODE = 'cold'
        $env:AGENTVN_ADVANCED_PERF_TARGET_TAB = 'layout'
        $env:AGENTVN_ADVANCED_LAYOUT_HEADFUL = '1'
        $env:AGENTVN_AUDIT_VIEWPORT = '4k'
        $env:AGENTVN_ADVANCED_PERF_ETW_READY_FILE = $readyFile
        $env:AGENTVN_ADVANCED_PERF_ETW_RELEASE_FILE = $releaseFile
        $env:AGENTVN_ADVANCED_PERF_ETW_DONE_FILE = $doneFile
        $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
        $auditScript = Join-Path $PSScriptRoot 'advanced-layout-transition-audit.cjs'
        $auditProcess = Start-Process -FilePath $nodePath -ArgumentList @($auditScript) `
            -WorkingDirectory $PSScriptRoot -PassThru -WindowStyle Hidden `
            -RedirectStandardOutput $auditStdout -RedirectStandardError $auditStderr

        $readyDeadline = (Get-Date).AddSeconds(90)
        while (-not (Test-Path -LiteralPath $readyFile) -and (Get-Date) -lt $readyDeadline) {
            $auditProcess.Refresh()
            if ($auditProcess.HasExited) {
                $state.auditExitCode = $auditProcess.ExitCode
                throw "Cold-entry audit exited before ETW trigger readiness (exit $($state.auditExitCode))."
            }
            Start-Sleep -Milliseconds 100
        }
        if (-not (Test-Path -LiteralPath $readyFile)) {
            throw 'Cold-entry audit did not reach the pre-interaction ETW gate within 90 seconds.'
        }
        $state.auditReadySignal = Get-Content -Raw -LiteralPath $readyFile | ConvertFrom-Json
    }

    $state.wprStartAttempted = $true
    & wpr.exe -start $wprProfileSpec -filemode 2>&1 | Tee-Object -FilePath $startLog | Out-Host
    $state.wprStartExitCode = $LASTEXITCODE
    Save-State
    if ($state.wprStartExitCode -ne 0) {
        throw "WPR start failed with exit code $($state.wprStartExitCode)."
    }
    $wprWasStartedByThisScript = $true

    if ($RunColdEntryAudit) {
        Set-Content -LiteralPath $releaseFile -Value 'capture-started' -Encoding utf8
        $doneDeadline = (Get-Date).AddSeconds(20)
        while (-not (Test-Path -LiteralPath $doneFile) -and (Get-Date) -lt $doneDeadline) {
            $auditProcess.Refresh()
            if ($auditProcess.HasExited) {
                $state.auditExitCode = $auditProcess.ExitCode
                throw "Cold-entry audit exited before its interaction completion signal (exit $($state.auditExitCode))."
            }
            Start-Sleep -Milliseconds 25
        }
        if (-not (Test-Path -LiteralPath $doneFile)) {
            throw 'Cold-entry audit did not complete the measured interaction within the ETW capture deadline.'
        }
        $state.auditDoneSignal = Get-Content -Raw -LiteralPath $doneFile | ConvertFrom-Json
        $state.wprStatusDuring = (& wpr.exe -status 2>&1 | Out-String).Trim()
    } else {
        Start-Sleep -Seconds $DurationSeconds
        $state.wprStatusDuring = (& wpr.exe -status 2>&1 | Out-String).Trim()
    }
    Save-State

    $state.wprStopAttempted = $true
    & wpr.exe -stop $etlPath 2>&1 | Tee-Object -FilePath $stopLog | Out-Host
    $state.wprStopExitCode = $LASTEXITCODE
    if ($stopLog -and (Test-Path -LiteralPath $stopLog)) {
        $stopText = Get-Content -Raw -LiteralPath $stopLog
        if ($stopText -match 'dropped\s+([\d,]+)\s+events') {
            $state.droppedEvents = [int]($Matches[1] -replace ',', '')
        }
    }
    Save-State
    if ($state.wprStopExitCode -ne 0) {
        throw "WPR stop failed with exit code $($state.wprStopExitCode)."
    }
    $wprWasStartedByThisScript = $false
} catch {
    $state.error = $_.Exception.Message
} finally {
    if ($wprWasStartedByThisScript) {
        try {
            & wpr.exe -stop $etlPath 2>&1 | Tee-Object -FilePath $stopLog | Out-Host
            $state.wprStopAttempted = $true
            $state.wprStopExitCode = $LASTEXITCODE
        } catch {
            $state.error = if ($state.error) { "$($state.error); cleanup stop: $($_.Exception.Message)" } else { "cleanup stop: $($_.Exception.Message)" }
        }
    }

    try {
        $state.wprStatusAfter = (& wpr.exe -status 2>&1 | Out-String).Trim()
    } catch {
        $state.wprStatusAfter = "status check failed: $($_.Exception.Message)"
    }

    try {
        if (Test-Path -LiteralPath $symlinkPath) {
            Remove-Item -LiteralPath $symlinkPath -Force -ErrorAction SilentlyContinue
        }
        if (Test-Path -LiteralPath $symlinkRoot) {
            Remove-Item -LiteralPath $symlinkRoot -Force -Recurse -ErrorAction SilentlyContinue
        }
    } catch {
        $state.symlinkProbe.error = if ($state.symlinkProbe.error) { "$($state.symlinkProbe.error); cleanup: $($_.Exception.Message)" } else { "cleanup: $($_.Exception.Message)" }
    }

    if ($auditProcess) {
        $auditProcess.Refresh()
        if ($auditProcess.HasExited) {
            $state.auditExitCode = $auditProcess.ExitCode
        }
    }

    Save-State
}

if ($state.error -or -not $state.etlExists) {
    exit 1
}
exit 0
