param(
    [ValidateSet('SelfTest','Launch','Elevated','Task')][string]$Action='SelfTest',
    [ValidatePattern('^\d{2}$')][string]$Attempt='06',
    [switch]$UseTaskEngine,
    [switch]$NativeUpgrade
)
# QA only. A genuine same-user RunAs boundary avoids inheriting the desktop
# app's filesystem redirection. It is not a normal-user/picker acceptance.
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -Force
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Management\Microsoft.PowerShell.Management.psd1') -Force
$qa='F:\AgentVN\QA\Android-Package-20261021-01'
$run=Join-Path $qa ('administrator-'+$Attempt)
$editor=Join-Path $qa ('editor-'+$Attempt)
$repo='D:\AgentVN'
function Boundary($directory) {
    $full=[IO.Path]::GetFullPath($directory)
    if([IO.Path]::GetDirectoryName($full) -cne $qa -or
        [IO.Path]::GetFileName($full) -cnotmatch '^administrator-\d{2}$') {
        throw 'Exact physical-host QA directory required'
    }
}
if($Action -ceq 'SelfTest') {
    foreach($case in @(@($run,$true),@(($qa+'\administrator-99'),$true),
        @($qa,$false),@(($run+'\nested'),$false),@(($qa+'\administrator-6'),$false),
        @('C:\Users\1',$false),@($repo,$false),@('F:\AgentVN',$false))) {
        $accepted=$true;try {Boundary $case[0]}catch {$accepted=$false}
        if($accepted -ne $case[1]) {throw 'Physical-host path boundary regression'}
    }
    'PASS: eight physical-host boundaries; no mutations'
    exit
}
Boundary $run
function Read($file) {[IO.File]::ReadAllText($file,[Text.Encoding]::UTF8)|ConvertFrom-Json}
function Save($file,$value) {
    [IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 14),[Text.UTF8Encoding]::new($false))
}
function Sha($file) {
    $stream=[IO.File]::OpenRead($file);$hash=[Security.Cryptography.SHA256]::Create()
    try {([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
    finally {$stream.Dispose();$hash.Dispose()}
}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$isElevated=([Security.Principal.WindowsPrincipal]::new($identity)).
    IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$originFile=Join-Path $run 'origin.json'
$resultFile=Join-Path $run 'result.json'
$tools=@($PSCommandPath,(Join-Path $repo 'scripts\installed-android-package-current.cjs'),
    (Join-Path $repo 'scripts\android-current-cache-session.ps1'),
    (Join-Path $repo 'scripts\android-acceptance-preflight.ps1'),
    (Join-Path $repo 'scripts\android-current-webview-policy.ps1'),
    (Join-Path $repo 'scripts\lib\installed-release-session.cjs'))
if($NativeUpgrade){$tools+=Join-Path $repo 'scripts\lib\android-game-upgrade-fixture.cjs'}
if($Action -ceq 'Launch') {
    if($isElevated) {throw 'Actual non-admin origin required'}
    if((Test-Path -LiteralPath $run) -or (Test-Path -LiteralPath $editor)) {throw 'Fresh QA run required'}
    $null=New-Item -ItemType Directory -Path $run
    $origin=Get-CimInstance Win32_Process -Filter "ProcessId=$PID"
    $state=[ordered]@{status='AWAITING_RUNAS';originIsElevated=$false;originProcessId=$PID
        originCreated=$origin.CreationDate.ToUniversalTime().ToString('o')
        userSid=$identity.User.Value;requestedAt=[DateTime]::UtcNow.ToString('o')
        attempt=$Attempt;runDirectory=$run;editorDirectory=$editor;taskEngine=[bool]$UseTaskEngine;
        nativeUpgrade=[bool]$NativeUpgrade;tools=@()}
    foreach($tool in $tools) {
        $state.tools+=@{path=$tool;sha256=(Sha $tool)}
        Copy-Item -LiteralPath $tool -Destination (Join-Path $run ([IO.Path]::GetFileName($tool)))
    }
    Save $originFile $state
    try {
        $arguments=@(
            '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),
            '-Action','Elevated','-Attempt',$Attempt)
        if($UseTaskEngine){$arguments+='-UseTaskEngine'}
        if($NativeUpgrade){$arguments+='-NativeUpgrade'}
        $helper=Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -PassThru -ArgumentList $arguments
        $state.status='HELPER_STARTED'
        $state.helperPid=$helper.Id
        $state.helperCreated=$helper.StartTime.ToUniversalTime().ToString('o')
        Save $originFile $state
        [pscustomobject]$state|Select-Object status,originProcessId,helperPid,helperCreated,runDirectory|
            ConvertTo-Json -Depth 4
    }catch {
        $state.status='BLOCKED';$state.error=$_.Exception.ToString();Save $originFile $state;throw
    }
    exit
}
if(!$isElevated) {throw 'Real administrator token required'}
if(Test-Path -LiteralPath $resultFile) {throw 'Never overwrite an administrator receipt'}
$request=Read $originFile
if($request.originIsElevated -or $request.userSid -cne $identity.User.Value -or
    $request.attempt -cne $Attempt -or $request.runDirectory -cne $run -or
    $request.editorDirectory -cne $editor -or [bool]$request.nativeUpgrade -ne [bool]$NativeUpgrade) {throw 'Origin ownership mismatch'}
foreach($file in $request.tools) {
    if($file.path -cnotin $tools -or (Sha $file.path) -cne $file.sha256) {throw 'QA tool changed after authorization'}
}
if(@($request.tools).Count -ne $tools.Count) {throw 'Incomplete QA tool provenance'}
if($Action -ceq 'Elevated' -and $UseTaskEngine) {
    # The task engine starts the same audited helper without inheriting the
    # packaged desktop app's VFS mapping. No recurrence and no saved password.
    Import-Module ScheduledTasks -ErrorAction Stop
    $taskName='AgentVN-QA-Android-Build-20261021-'+$Attempt
    $taskReceipt=Join-Path $run 'task-engine.json'
    if(Test-Path -LiteralPath $taskReceipt) {throw 'Fresh task engine receipt required'}
    if(Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue) {throw 'Existing task is not owned'}
    $taskState=@{status='RUNNING';at=[DateTime]::UtcNow.ToString('o');processId=$PID;taskName=$taskName
        registered=$false;cleanup='NOT_RUN';error=$null}
    Save $taskReceipt $taskState
    try {
        $taskArgument='-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+$PSCommandPath+'" -Action Task -Attempt '+$Attempt
        if($NativeUpgrade){$taskArgument+=' -NativeUpgrade'}
        $taskAction=New-ScheduledTaskAction -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' `
            -Argument $taskArgument
        $principal=New-ScheduledTaskPrincipal -UserId $identity.User.Value -LogonType Interactive -RunLevel Highest
        $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 4) -MultipleInstances IgnoreNew
        $null=Register-ScheduledTask -TaskName $taskName -TaskPath '\' -Action $taskAction -Principal $principal -Settings $settings
        $taskState.registered=$true;Save $taskReceipt $taskState
        Export-ScheduledTask -TaskName $taskName -TaskPath '\' |
            Out-File -LiteralPath (Join-Path $run 'task-registration.xml') -Encoding utf8
        Start-ScheduledTask -TaskName $taskName -TaskPath '\'
        do {
            Start-Sleep -Seconds 2
            $task=Get-ScheduledTask -TaskName $taskName -TaskPath '\'
            $info=Get-ScheduledTaskInfo -TaskName $taskName -TaskPath '\'
            $taskState.taskState=$task.State.ToString();$taskState.lastTaskResult=$info.LastTaskResult
            Save $taskReceipt $taskState
            $terminal=$false
            if(Test-Path -LiteralPath $resultFile) {$terminal=[bool](Read $resultFile).finishedAt}
            if(!$terminal -and $task.State -ne 'Running' -and
                $info.LastRunTime.ToUniversalTime() -ge [DateTime]::Parse($taskState.at).ToUniversalTime()) {
                throw 'Task engine reached terminal state without a completed helper receipt'
            }
        }while(!$terminal -or $task.State -eq 'Running')
        $taskState.status='TERMINAL'
    }catch {$taskState.status='FAILED';$taskState.error=$_.Exception.ToString()}
    finally {
        if($taskState.registered) {
            $task=Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
            if($task -and $task.State -eq 'Running') {$taskState.cleanup='BLOCKED_RUNNING_TASK'}
            else {
                if($task){Unregister-ScheduledTask -TaskName $taskName -TaskPath '\' -Confirm:$false}
                $taskState.cleanup=if(Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue){'FAILED'}else{'PASS'}
            }
        }
        $taskState.finishedAt=[DateTime]::UtcNow.ToString('o');Save $taskReceipt $taskState
    }
    exit
}
$physicalProtection=@()
if($Action -ceq 'Task') {
    if(!$request.taskEngine) {throw 'Origin did not authorize task-engine execution'}
    $baseline=if($NativeUpgrade) {
        $currentBaseline=Read 'F:\AgentVN\QA\Editor-1.9.22-20261022-01\baseline-01.json'
        @{status=$currentBaseline.status;protected=$currentBaseline.protectedFiles}
    }elseif($Attempt -ceq '10') {
        Read 'F:\AgentVN\QA\Android-RunId-Release-20261021-01\install-01\report.json'
    }else {
        Read (Join-Path $qa 'preflight-01\preparation.json')
    }
    $minimum=if($NativeUpgrade){4}else{7}
    if($baseline.status -cne 'PASS' -or @($baseline.protected).Count -lt $minimum) {
        throw 'Complete, successful protected-file baseline required'
    }
    foreach($file in $baseline.protected) {
        $exists=Test-Path -LiteralPath $file.path -PathType Leaf
        if($file.path -cne 'C:\Users\1\AppData\Roaming\com.agentvn.editor\backend\vn_engine.db') {
            if(!$exists -or (Sha $file.path) -cne $file.sha256) {throw 'Product baseline changed outside packaged host'}
        }
        $row=@{path=$file.path;existed=$exists}
        if($exists){$row.sha256=Sha $file.path;$row.bytes=(Get-Item -LiteralPath $file.path).Length}
        $physicalProtection+=$row
    }
    Save (Join-Path $run 'physical-protection.json') @{status='PASS';at=[DateTime]::UtcNow.ToString('o')
        scope='ACTUAL_UNREDIRECTED_DEFAULT_FILES_NOT_PACKAGED_PREFLIGHT_VIEW';files=$physicalProtection}
}
$current=Get-CimInstance Win32_Process -Filter "ProcessId=$PID"
$result=[ordered]@{status='RUNNING';scope='ELEVATED_INSTALLED_EDITOR_CONTROLLED_ANDROID_NOT_NORMAL_PICKER'
    startedAt=[DateTime]::UtcNow.ToString('o');isElevated=$true;processId=$PID
    created=$current.CreationDate.ToUniversalTime().ToString('o');userSid=$identity.User.Value
    originProcessId=$request.originProcessId;attempt=$Attempt;editorDirectory=$editor
    localAppData=$env:LOCALAPPDATA;probe=$null;nodeProcessId=$null;exitCode=$null;error=$null
    taskEngine=($Action -ceq 'Task');parentProcessId=$current.ParentProcessId}
Save $resultFile $result
try {
    $permission=Join-Path $run 'permission'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'scripts\android-acceptance-preflight.ps1') -OutputDir $permission
    if($LASTEXITCODE -ne 0) {throw 'Administrator symlink probe failed'}
    $result.probe=Read (Join-Path $permission 'acceptance-permission.json')
    if(!$result.probe.success -or !$result.probe.isElevated -or
        [IO.Path]::GetDirectoryName([string]$result.probe.probeRoot) -cne $permission -or
        (Test-Path -LiteralPath $result.probe.probeRoot)) {throw 'Invalid symlink evidence or probe cleanup'}
    Save $resultFile $result
    $node=(Get-Command node.exe -ErrorAction Stop).Source
    $arguments=@(('"'+(Join-Path $repo 'scripts\installed-android-package-current.cjs')+'"'),$Attempt,
        '--physical-package-cache','--physical-environment-cache',
        ('"--administrator-launch='+$run+'"'))
    if($NativeUpgrade){$arguments+='--native-upgrade'}
    $child=Start-Process -FilePath $node -WorkingDirectory $repo -WindowStyle Hidden -PassThru -ArgumentList $arguments `
        -RedirectStandardOutput (Join-Path $run 'stdout.log') -RedirectStandardError (Join-Path $run 'stderr.log')
    $result.nodeProcessId=$child.Id
    $result.nodeCreated=$child.StartTime.ToUniversalTime().ToString('o')
    Save $resultFile $result
    # Separate helper; caller polls its exact PID/creation time and receipt.
    $null=$child.Handle
    $child.WaitForExit()
    $child.Refresh()
    $result.exitCode=$child.ExitCode
    $result.status=if($child.ExitCode -eq 0) {'BUILD_PASS_DEVICE_PENDING'}else {'CHECK_EDITOR_REPORT'}
}catch {$result.status='BLOCKED';$result.error=$_.Exception.ToString()}
finally {
    if((Test-Path -LiteralPath (Join-Path $run 'webview-policy.json')) -and
        !(Test-Path -LiteralPath (Join-Path $run 'webview-policy-restoration.json'))) {
        try {
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'scripts\android-current-webview-policy.ps1') `
                -Action Restore -RunDirectory $run
            if($LASTEXITCODE -ne 0) {throw 'App policy restoration failed'}
            $result.policyRestoration='PASS'
        }catch {$result.status='FAILED';$result.policyRestoration='FAILED';$result.cleanupError=$_.Exception.ToString()}
    }
    if($physicalProtection.Count) {
        try {
            foreach($file in $physicalProtection) {
                $exists=Test-Path -LiteralPath $file.path -PathType Leaf
                if($exists -ne $file.existed -or ($exists -and (Sha $file.path) -cne $file.sha256)) {
                    throw 'Unredirected original file changed'
                }
            }
            $result.physicalProtectionRestoration='PASS'
        }catch {$result.status='FAILED';$result.physicalProtectionRestoration='FAILED';$result.cleanupError=$_.Exception.ToString()}
    }
    $result.finishedAt=[DateTime]::UtcNow.ToString('o');Save $resultFile $result
}
if($result.status -cne 'BUILD_PASS_DEVICE_PENDING') {exit 2}
