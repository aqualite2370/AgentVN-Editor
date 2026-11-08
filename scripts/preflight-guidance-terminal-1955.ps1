param([switch]$Elevated)
$ErrorActionPreference='Stop'
$principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
$isAdmin=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$out='F:\AgentVN\QA\Preflight-Guidance-Release-1955-20261108-01'
if (!$Elevated) {
    if ($isAdmin) { throw 'Begin from non-elevated session' }
    $p=Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -PassThru -ArgumentList @(
        '-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$PSCommandPath`"",'-Elevated')
    @{pid=$p.Id;status='REQUESTED'}|ConvertTo-Json|Set-Content -LiteralPath "$out\terminal-elevation.json" -Encoding UTF8
    return
}
if (!$isAdmin) { throw 'Actual administrator token required' }
$receipt="$out\installed-terminal-audit.json"
if (Test-Path -LiteralPath $receipt) { throw 'Never overwrite original audit' }
$result=[ordered]@{status='RUNNING';administrator=$isAdmin;at=[DateTime]::UtcNow.ToString('o');checks=@()}
try {
    $base='F:\AgentVN\QA\Windows-Isolated-1944-20261108-11'
    $controller=Get-Content -LiteralPath "$base\account-controller.json" -Raw -Encoding UTF8|ConvertFrom-Json
    if ($controller.status -cne 'FINISHED' -or !$controller.cleanup.accountDisabled -or
        $controller.cleanup.profileLoaded -or $controller.cleanup.ownedProcesses.Count -or
        $controller.jobs.Count -ne 1 -or $controller.jobs[0].status -cne 'PASS') { throw 'Controller or job incomplete' }
    $account=Get-LocalUser -SID $controller.account.sid
    $profile=Get-CimInstance Win32_UserProfile | Where-Object SID -CEQ $controller.account.sid
    if ($account.Enabled -or $profile.Loaded) { throw 'QA account/profile active' }
    $run=Get-Content -LiteralPath "$base\guidance-01\report.json" -Raw -Encoding UTF8|ConvertFrom-Json
    if ($run.status -cne 'PASS_INSTALLED_PREFLIGHT_GUIDANCE' -or $run.version -cne '1.9.55' -or
        $run.cleanupStatus -cne 'PASS' -or $run.stages.Count -ne 5 -or $run.launches.Count -ne 2 -or
        $run.cleanups.Count -ne 2 -or $run.screenshots.Count -ne 2 -or $run.modelRequests -ne 0 -or
        $run.errors.Count -or @($run.stages | Where-Object status -CNE 'PASS').Count) { throw 'Installed evidence incomplete' }
    foreach ($stage in @($run.stages | Where-Object name -In @(
        'supported-import-and-installed-publish-advice','default-database-restart-and-advice'))) {
        if ($stage.detail.advice.Count -ne 7 -or @($stage.detail.advice | Where-Object present -NE $true).Count) {
            throw 'Seven advice kinds not verified'
        }
    }
    $surviving=@(Get-CimInstance Win32_Process | ForEach-Object {
        $process=$_
        try {
            if ((Invoke-CimMethod -InputObject $process -MethodName GetOwnerSid -ErrorAction Stop).Sid -ceq $controller.account.sid) {
                $process.ProcessId
            }
        } catch {}
    })
    if ($surviving.Count) { throw 'QA SID still owns processes' }
    $ports=@($run.launches | ForEach-Object { $_.ports } | Select-Object -Unique)
    if (@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object LocalPort -In $ports).Count) {
        throw 'Owned listener survives'
    }
    function Check-Bytes($record) {
        if ((Get-FileHash -LiteralPath $record.path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $record.sha256) {
            throw "Artifact changed: $($record.path)"
        }
    }
    $release=Get-Content -LiteralPath "$out\report.json" -Raw -Encoding UTF8|ConvertFrom-Json
    if ($release.status -cne 'BUILD_AND_PAYLOAD_PASS_INSTALLATION_PENDING_LIVE_DEV_PRESERVED') { throw 'Release not passed' }
    foreach ($record in @($release.installer,$release.workspaceDev,$release.playerBefore,$release.liveDevBefore,$release.payload)) {
        Check-Bytes $record
    }
    foreach ($shot in $run.screenshots) {
        Check-Bytes $shot
        if ($shot.png.width -ne 1920 -or $shot.png.height -ne 1080 -or
            $shot.before.width -ne 1920 -or $shot.before.height -ne 1080 -or $shot.before.dpr -ne 1 -or
            $shot.before.reduced -or ($shot.before|ConvertTo-Json -Compress) -cne ($shot.after|ConvertTo-Json -Compress)) {
            throw 'Screenshot parameters mismatch'
        }
    }
    $installation=Get-Content -LiteralPath "$base\installation.json" -Raw -Encoding UTF8|ConvertFrom-Json
    if ($installation.status -cne 'PASS' -or $installation.metadataRestoration -cne 'PASS') { throw 'Installation incomplete' }
    foreach ($record in $installation.resources) { Check-Bytes $record }
    Check-Bytes $installation.executable
    $result.account=@{sid=$controller.account.sid;disabled=$true;profileUnloaded=$true;ownedProcesses=0}
    $result.ports=$ports
    $result.checks=@('actual-NSIS-payload-and-metadata','seven-advice-kinds-before-and-after-restart',
        'two-natural-host-backend-exits','all-SID-processes-and-ports-zero','artifact-and-PNG-provenance')
    $result.status='PASS_INSTALLED_PREFLIGHT_GUIDANCE_TERMINAL'
} catch { $result.status='FAILED';$result.error=$_.Exception.ToString() }
finally {
    $result.finishedAt=[DateTime]::UtcNow.ToString('o')
    [IO.File]::WriteAllText($receipt,($result|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
}
