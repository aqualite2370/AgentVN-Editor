param(
    [ValidateSet('SelfTest','Launch','Elevated','Task')][string]$Action='SelfTest',
    [ValidateSet('08','09','10')][string]$CleanupAttempt='08'
)
# Supplemental cleanup of the exact terminal editor-08 session. Original
# failure reports stay immutable. Never launches/retries a product build.
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -Force
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Management\Microsoft.PowerShell.Management.psd1') -Force
$qa='F:\AgentVN\QA\Android-Package-20261021-01'
$run=Join-Path $qa ('terminal-cleanup-'+$CleanupAttempt)
$taskName='AgentVN-QA-Android-TerminalCleanup-20261021-'+$CleanupAttempt
function Save($file,$value) {
    [IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 16),[Text.UTF8Encoding]::new($false))
}
function Read($file) {[IO.File]::ReadAllText($file,[Text.Encoding]::UTF8)|ConvertFrom-Json}
function Sha($file) {
    $stream=[IO.File]::OpenRead($file);$hash=[Security.Cryptography.SHA256]::Create()
    try{([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
    finally{$stream.Dispose();$hash.Dispose()}
}
function IdentityMatches($expected,$actual) {
    $null -ne $actual -and $expected.ProcessId -eq $actual.ProcessId -and
        $expected.Created -ceq $actual.CreationDate.ToUniversalTime().ToString('o')
}
function HandleIdentityMatches($expected,$process) {
    # WMI/CIM serializes microseconds; Process.StartTime retains 100ns ticks.
    # Require the SAME microsecond after exact PID+CIM comparison, not equal
    # string formatting. Keep a handle to prevent a reused PID kill.
    $ticks=[DateTime]::Parse($expected.Created).ToUniversalTime().Ticks
    [Math]::Abs($process.StartTime.ToUniversalTime().Ticks-$ticks) -lt 10
}
if($Action -ceq 'SelfTest') {
    $expected=@{ProcessId=7;Created='2026-10-21T07:20:47.7308310Z'}
    $good=[pscustomobject]@{ProcessId=7;CreationDate=[DateTime]::Parse($expected.Created).ToUniversalTime()}
    if(!(IdentityMatches $expected $good)){throw 'Matching identity rejected'}
    if(IdentityMatches $expected ([pscustomobject]@{ProcessId=8;CreationDate=$good.CreationDate})){throw 'Wrong PID accepted'}
    if(IdentityMatches $expected ([pscustomobject]@{ProcessId=7;CreationDate=$good.CreationDate.AddSeconds(1)})){throw 'Reused PID accepted'}
    if(IdentityMatches $expected $null){throw 'Absent process accepted'}
    $micro=[pscustomobject]@{StartTime=$good.CreationDate.AddTicks(9)}
    if(!(HandleIdentityMatches $expected $micro)){throw '100ns precision rejected'}
    $reused=[pscustomobject]@{StartTime=$good.CreationDate.AddTicks(10)}
    if(HandleIdentityMatches $expected $reused){throw 'Different microsecond accepted'}
    'PASS: exact process identity, reused PID and absent-process boundaries; no mutations'
    exit
}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$admin=([Security.Principal.WindowsPrincipal]::new($identity)).
    IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if($Action -ceq 'Launch') {
    if($admin){throw 'Actual non-administrator origin required'}
    if(Test-Path -LiteralPath $run){throw 'Fresh supplemental cleanup receipt required'}
    $recovery=Read (Join-Path $qa 'recovery-08\report.json')
    if($recovery.nativeResult.status -cne 'TERMINAL'){throw 'Never clean an in-flight native build'}
    $null=New-Item -ItemType Directory -Path $run
    Copy-Item -LiteralPath $PSCommandPath -Destination (Join-Path $run 'executed.ps1')
    Save (Join-Path $run 'origin.json') @{isElevated=$false;processId=$PID;userSid=$identity.User.Value
        at=[DateTime]::UtcNow.ToString('o');scriptSha256=(Sha $PSCommandPath)
        recoverySha256=(Sha (Join-Path $qa 'recovery-08\report.json'))}
    $arguments=@('-NoProfile','-ExecutionPolicy','Bypass','-File',
        ('"'+(Join-Path $run 'executed.ps1')+'"'),'-Action','Elevated','-CleanupAttempt',$CleanupAttempt)
    $helper=Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -PassThru -ArgumentList $arguments
    Save (Join-Path $run 'launch.json') @{status='HELPER_STARTED';processId=$helper.Id
        created=$helper.StartTime.ToUniversalTime().ToString('o');isElevatedOrigin=$false}
    'Terminal cleanup helper PID: '+$helper.Id;exit
}
if(!$admin){throw 'Actual administrator token required'}
$origin=Read (Join-Path $run 'origin.json')
if($origin.isElevated -or $origin.userSid -cne $identity.User.Value -or
    (Sha $PSCommandPath) -cne $origin.scriptSha256){throw 'Cleanup origin or code identity mismatch'}
if($Action -ceq 'Elevated') {
    Import-Module ScheduledTasks -ErrorAction Stop
    $resultFile=Join-Path $run 'task.json'
    if(Test-Path -LiteralPath $resultFile){throw 'Never overwrite coordinator evidence'}
    $state=@{status='RUNNING';isElevated=$true;taskName=$taskName;registered=$false;cleanup='NOT_RUN'}
    Save $resultFile $state
    try{
        if(Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue){throw 'Existing task is not owned'}
        $taskAction=New-ScheduledTaskAction -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' `
            -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+$PSCommandPath+'" -Action Task -CleanupAttempt '+$CleanupAttempt)
        $principal=New-ScheduledTaskPrincipal -UserId $identity.User.Value -LogonType Interactive -RunLevel Highest
        $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
        $null=Register-ScheduledTask -TaskName $taskName -TaskPath '\' -Action $taskAction -Principal $principal -Settings $settings
        $state.registered=$true;Save $resultFile $state
        Start-ScheduledTask -TaskName $taskName -TaskPath '\'
        do{
            Start-Sleep -Seconds 2
            $task=Get-ScheduledTask -TaskName $taskName -TaskPath '\'
            $info=Get-ScheduledTaskInfo -TaskName $taskName -TaskPath '\'
            $state.taskState=$task.State.ToString();$state.lastTaskResult=$info.LastTaskResult;Save $resultFile $state
            $terminal=(Test-Path -LiteralPath (Join-Path $run 'result.json')) -and
                [bool](Read (Join-Path $run 'result.json')).finishedAt
        }while(!$terminal -or $task.State -eq 'Running')
        $state.status='TERMINAL'
    }catch{$state.status='FAILED';$state.error=$_.Exception.ToString()}
    finally{
        if($state.registered){
            $task=Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
            if($task -and $task.State -eq 'Running'){$state.cleanup='BLOCKED_RUNNING_TASK'}
            else{
                if($task){Unregister-ScheduledTask -TaskName $taskName -TaskPath '\' -Confirm:$false}
                $state.cleanup=if(Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue){'FAILED'}else{'PASS'}
            }
        }
        $state.finishedAt=[DateTime]::UtcNow.ToString('o');Save $resultFile $state
    }
    exit
}
$resultFile=Join-Path $run 'result.json'
if(Test-Path -LiteralPath $resultFile){throw 'Never overwrite cleanup evidence'}
$state=@{status='RUNNING';isElevated=$true;startedAt=[DateTime]::UtcNow.ToString('o')
    processId=$PID;stage='validate-terminal';stopped=@();error=$null;buildInvocations=0;modelRequests=0}
Save $resultFile $state
try{
    $recoveryFile=Join-Path $qa 'recovery-08\report.json'
    if((Sha $recoveryFile) -cne $origin.recoverySha256){throw 'Original recovery report changed'}
    $recovery=Read $recoveryFile
    if($recovery.nativeResult.status -cne 'TERMINAL' -or
        $recovery.nativeResult.result.failureCode -cne 'APK_PROVENANCE_FAILED'){throw 'Expected terminal failure missing'}
    $original=Read $recovery.original.path
    if((Sha $recovery.original.path) -cne $recovery.original.sha256){throw 'Original FAILED report changed'}
    $helper=Read (Join-Path $qa 'administrator-08\result.json')
    $owner=@{ProcessId=$helper.nodeProcessId;Created=$helper.nodeCreated}
    $state.stage='stop-owned-children';Save $resultFile $state
    foreach($p in @($recovery.knownProcesses | Sort-Object Created -Descending)){
        if($p.ProcessId -eq $owner.ProcessId){continue}
        $actual=Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ProcessId)"
        if(!(IdentityMatches $p $actual)){continue}
        $handle=Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
        if(!$handle){continue}
        try{
            $null=$handle.Handle
            $state.handleIdentity=@{expected=$p.Created;actual=$handle.StartTime.ToUniversalTime().ToString('o')}
            Save $resultFile $state
            if(!(HandleIdentityMatches $p $handle)){throw 'Process handle identity changed'}
            try{$handle.Kill()}catch{if(!$handle.HasExited){throw}}
            $handle.WaitForExit(15000)|Out-Null
            if(!$handle.HasExited){throw 'Owned process stop timed out'}
            $state.stopped+=@{processId=$p.ProcessId;created=$p.Created;name=$p.Name}
        }finally{$handle.Dispose()}
    }
    foreach($p in $recovery.knownProcesses){
        if($p.ProcessId -eq $owner.ProcessId){continue}
        if(IdentityMatches $p (Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ProcessId)")){
            throw 'Owned build or host process remains'
        }
    }
    foreach($port in $original.launches[0].ports){
        if(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue){throw 'Original build port remains'}
    }
    $state.stage='restore-caches';Save $resultFile $state
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'D:\AgentVN\scripts\android-current-cache-session.ps1' `
        -Action Restore -RunDirectory (Join-Path $qa 'editor-08') -PhysicalPackageCache -PhysicalEnvironmentCache `
        1> (Join-Path $run 'cache-stdout.log') 2> (Join-Path $run 'cache-stderr.log')
    if($LASTEXITCODE -ne 0){throw 'Cache restoration failed; keep original runner and policy owner'}
    $restoration=Read (Join-Path $qa 'editor-08\cache-restoration.json')
    if($restoration.status -cne 'PASS'){throw 'Cache restoration receipt not PASS'}
    foreach($file in $original.protectedFiles){
        if((Sha $file.path) -cne $file.sha256){throw 'Original protected file bytes changed'}
    }
    foreach($file in $original.physicalHostAbsentFiles){
        if(Test-Path -LiteralPath $file){throw 'Originally absent physical file was created'}
    }
    $state.stage='release-original-runner';Save $resultFile $state
    $actual=Get-CimInstance Win32_Process -Filter "ProcessId=$($owner.ProcessId)"
    if(IdentityMatches $owner $actual){
        $handle=Get-Process -Id $owner.ProcessId -ErrorAction Stop
        try{
            $null=$handle.Handle
            if(!(HandleIdentityMatches $owner $handle)){throw 'Runner handle identity changed'}
            try{$handle.Kill()}catch{if(!$handle.HasExited){throw}}
            $handle.WaitForExit(15000)|Out-Null
            if(!$handle.HasExited){throw 'Runner stop timeout'}
        }finally{$handle.Dispose()}
    }
    if((Sha $recoveryFile) -cne $origin.recoverySha256 -or
        (Sha $recovery.original.path) -cne $recovery.original.sha256){throw 'Original failure evidence changed'}
    $state.status='PASS';$state.stage='original-admin-finally-pending'
}catch{$state.status='FAILED';$state.error=$_.Exception.ToString()}
finally{$state.finishedAt=[DateTime]::UtcNow.ToString('o');Save $resultFile $state}
if($state.status -cne 'PASS'){exit 2}
