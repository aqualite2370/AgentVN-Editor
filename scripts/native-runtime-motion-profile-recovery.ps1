param(
    [Parameter(Mandatory=$true)][string]$ReceiptDirectory
)
$ErrorActionPreference='Stop'
$run='F:\AgentVN\QA\Native-Runtime-State-20261020-01\motion-02'
$receiptRoot=[IO.Path]::GetFullPath($ReceiptDirectory)
if([IO.Path]::GetDirectoryName($receiptRoot) -ne [IO.Path]::GetDirectoryName($run) -or
   [IO.Path]::GetFileName($receiptRoot) -notmatch '^motion-recovery-\d{2}$' -or
   (Test-Path -LiteralPath $receiptRoot)){throw 'Recovery receipt must be a new bounded QA directory'}
New-Item -ItemType Directory -Path $receiptRoot | Out-Null
$script='D:\AgentVN\scripts\native-dev-preview-profile.ps1'
$sessionFile=Join-Path $run 'session.json'
$guardFile=Join-Path $run 'profile-process-guard.log'
$receipt=[ordered]@{
    status='RUNNING';at=(Get-Date).ToUniversalTime().ToString('o');run=$run
    originalSessionSha256=(Get-FileHash -LiteralPath $sessionFile -Algorithm SHA256).Hash.ToLowerInvariant()
    originalGuardSha256=(Get-FileHash -LiteralPath $guardFile -Algorithm SHA256).Hash.ToLowerInvariant()
    restoreScriptSha256=(Get-FileHash -LiteralPath $script -Algorithm SHA256).Hash.ToLowerInvariant()
    observations=@();processesTerminated=0;originalFailureRewritten=$false
    originalGuardCause='UNKNOWN_NO_MATCHING_PID_RECORDED';restoreExitCode=$null
}
try {
    $old=Get-Content -LiteralPath $sessionFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if($old.status -ne 'FAILED' -or $old.commands.Count -ne 3 -or
       $old.commands[2].exitCode -ne 1 -or
       (Test-Path -LiteralPath (Join-Path $run 'profile-restoration.json'))){throw 'Unexpected original failure state'}
    $clearSamples=0
    for($sample=0;$sample -lt 20;$sample++) {
        $matches=@(Get-CimInstance Win32_Process | Where-Object {
            $_.Name -eq 'agentvn-player.exe' -or
            ($_.Name -eq 'msedgewebview2.exe' -and
              ($_.CommandLine -like ('*'+$run+'*') -or $_.CommandLine -match 'com\.agentvn\.player'))
        } | Select-Object ProcessId,ParentProcessId,Name,CreationDate,ExecutablePath,CommandLine)
        $receipt.observations+=@{at=(Get-Date).ToUniversalTime().ToString('o');matches=$matches}
        if($matches.Count -eq 0){$clearSamples++}else{$clearSamples=0}
        if($clearSamples -ge 2){break}
        Start-Sleep -Milliseconds 500
    }
    if($clearSamples -lt 2){throw 'Player or profile WebView still active; recovery refused without terminating anything'}
    $receipt.command=@('powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',$script,
        '-Action','Restore','-RunDirectory',$run)
    $output=& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -Action Restore -RunDirectory $run 2>&1
    $receipt.restoreExitCode=$LASTEXITCODE
    [IO.File]::WriteAllText((Join-Path $receiptRoot 'restore.log'),($output|Out-String),[Text.UTF8Encoding]::new($false))
    if($receipt.restoreExitCode -ne 0){throw 'Existing identity/byte-checked Restore failed; see restore.log'}
    $restoration=Join-Path $run 'profile-restoration.json'
    $restored=Get-Content -LiteralPath $restoration -Raw -Encoding UTF8 | ConvertFrom-Json
    if($restored.status -ne 'PASS' -or $restored.deletedUserFiles -ne 0 -or $restored.restored.Count -ne 2){
        throw 'Restoration verification incomplete'
    }
    if((Get-FileHash -LiteralPath $sessionFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $receipt.originalSessionSha256 -or
       (Get-FileHash -LiteralPath $guardFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $receipt.originalGuardSha256){
        throw 'Original failure evidence changed'
    }
    $receipt.restoration=@{path=$restoration;sha256=(Get-FileHash -LiteralPath $restoration -Algorithm SHA256).Hash.ToLowerInvariant()}
    $receipt.status='USER_PROFILES_RESTORED_ORIGINAL_SESSION_FAILED_PRESERVED'
} catch {
    $receipt.status='FAILED'
    $receipt.error=($_ | Out-String)
} finally {
    $receipt.finishedAt=(Get-Date).ToUniversalTime().ToString('o')
    [IO.File]::WriteAllText((Join-Path $receiptRoot 'receipt.json'),($receipt|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
    Copy-Item -LiteralPath $PSCommandPath -Destination (Join-Path $receiptRoot 'executed-recovery.ps1')
    Write-Output ($receipt|ConvertTo-Json -Depth 12)
}
if($receipt.status -eq 'FAILED'){exit 1}
