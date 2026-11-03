param(
    [ValidateSet('Launch','Elevated','Task')][string]$Action='Launch',
    [ValidatePattern('^\d{2}$')][string]$Attempt='37'
)
# QA-only genuine RunAs and one-shot task host. No recurring job or password.
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -Force
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Management\Microsoft.PowerShell.Management.psd1') -Force
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$qa='F:\AgentVN\QA\Android-Package-20261021-01'
$run=Join-Path $qa ('administrator-'+$Attempt)
$editor=Join-Path $qa ('editor-'+$Attempt)
$installation='F:\AgentVN\QA\Player-Aspect-20261102-01\installation-01\installation.json'
$author='F:\AgentVN\QA\Player-Aspect-20261102-01\session-01\report.json'
$originFile=Join-Path $run 'origin.json'
$resultFile=Join-Path $run 'result.json'
function Read($file){[IO.File]::ReadAllText($file,[Text.Encoding]::UTF8)|ConvertFrom-Json}
function Save($file,$value){[IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 16),[Text.UTF8Encoding]::new($false))}
function Sha($file){
    $stream=[IO.File]::OpenRead($file);$hash=[Security.Cryptography.SHA256]::Create()
    try{([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
    finally{$stream.Dispose();$hash.Dispose()}
}
$tools=@($PSCommandPath,(Join-Path $PSScriptRoot 'player-aspect-android-export.cjs'),
    (Join-Path $PSScriptRoot 'android-current-cache-session.ps1'),
    (Join-Path $PSScriptRoot 'android-current-webview-policy.ps1'),
    (Join-Path $PSScriptRoot 'android-acceptance-preflight.ps1'))
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$elevated=([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if($Action -ceq 'Launch'){
    if($elevated){throw 'Non-admin origin required'}
    if((Test-Path -LiteralPath $run) -or (Test-Path -LiteralPath $editor)){throw 'Fresh bounded Android attempt required'}
    if(@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '^(agentvn-editor|agentvn-player|creator-backend|AgentVN Dev)\.exe$'}).Count){
        throw 'Existing editor/player protected'
    }
    $null=New-Item -ItemType Directory -Path $run
    $current=Get-CimInstance Win32_Process -Filter "ProcessId=$PID"
    $state=@{status='AWAITING_RUNAS';originIsElevated=$false;originProcessId=$PID;
        originCreated=$current.CreationDate.ToUniversalTime().ToString('o');userSid=$identity.User.Value;
        attempt=$Attempt;runDirectory=$run;editorDirectory=$editor;requestedAt=[DateTime]::UtcNow.ToString('o');
        tools=@($tools|ForEach-Object {@{path=$_;sha256=(Sha $_)}})}
    Save $originFile $state
    try{
        $helper=Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -PassThru -ArgumentList @(
            '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Action','Elevated','-Attempt',$Attempt)
        $state.status='HELPER_STARTED';$state.helperPid=$helper.Id;$state.helperCreated=$helper.StartTime.ToUniversalTime().ToString('o')
        Save $originFile $state
        [pscustomobject]$state|Select-Object status,helperPid,helperCreated,runDirectory|ConvertTo-Json
    }catch{$state.status='BLOCKED';$state.error=$_.Exception.ToString();Save $originFile $state;throw}
    exit
}
if(!$elevated){throw 'Actual administrator token required'}
$request=Read $originFile
if($request.originIsElevated -or $request.userSid -cne $identity.User.Value -or
    $request.runDirectory -cne $run -or $request.editorDirectory -cne $editor -or $request.attempt -cne $Attempt){
    throw 'Same-user origin/attempt boundary differs'
}
if(@($request.tools).Count -ne $tools.Count){throw 'Incomplete source binding'}
foreach($file in $request.tools){if($file.path -cnotin $tools -or (Sha $file.path) -cne $file.sha256){throw 'QA source changed'}}
if($Action -ceq 'Elevated'){
    Import-Module ScheduledTasks -ErrorAction Stop
    $taskName='AgentVN-QA-Player-Aspect-Android-'+$Attempt
    $taskFile=Join-Path $run 'task-engine.json'
    if((Test-Path -LiteralPath $taskFile) -or (Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue)){
        throw 'Existing task protected'
    }
    $state=@{status='RUNNING';taskName=$taskName;registered=$false;cleanup='PENDING';startedAt=[DateTime]::UtcNow.ToString('o')}
    Save $taskFile $state
    try{
        $arguments='-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+$PSCommandPath+'" -Action Task -Attempt '+$Attempt
        $taskAction=New-ScheduledTaskAction -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -Argument $arguments
        $principal=New-ScheduledTaskPrincipal -UserId $identity.User.Value -LogonType Interactive -RunLevel Highest
        $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 4) -MultipleInstances IgnoreNew
        $null=Register-ScheduledTask -TaskName $taskName -TaskPath '\' -Action $taskAction -Principal $principal -Settings $settings
        $state.registered=$true;Save $taskFile $state
        Start-ScheduledTask -TaskName $taskName -TaskPath '\'
        do{
            Start-Sleep -Seconds 2
            $current=Get-ScheduledTask -TaskName $taskName -TaskPath '\'
            $info=Get-ScheduledTaskInfo -TaskName $taskName -TaskPath '\'
            $started=$info.LastRunTime.ToUniversalTime() -ge [DateTime]::Parse($state.startedAt).ToUniversalTime().AddSeconds(-1)
        }while(!$started -or $current.State -eq 'Running')
        $state.lastTaskResult=$info.LastTaskResult
        if(!(Test-Path -LiteralPath $resultFile)){throw 'Task ended without administrator receipt'}
        $result=Read $resultFile
        if($result.status -cne 'BUILD_PASS_DEVICE_PENDING'){throw 'Actual build not passed; inspect report'}
        $state.status='PASS'
    }catch{$state.status='FAILED';$state.error=$_.Exception.ToString();throw}
    finally{
        if($state.registered){
            $current=Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
            if($current -and $current.State -eq 'Running'){$state.cleanup='LIVE_TASK_PRESERVED_DO_NOT_RESTART'}
            else{
                Unregister-ScheduledTask -TaskName $taskName -TaskPath '\' -Confirm:$false
                $state.cleanup=if(Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue){'FAILED'}else{'PASS'}
            }
        }
        $state.finishedAt=[DateTime]::UtcNow.ToString('o');Save $taskFile $state
    }
    exit
}
if(Test-Path -LiteralPath $resultFile){throw 'Existing administrator receipt protected'}
$current=Get-CimInstance Win32_Process -Filter "ProcessId=$PID"
$result=@{status='RUNNING';isElevated=$true;processId=$PID;created=$current.CreationDate.ToUniversalTime().ToString('o');
    parentProcessId=$current.ParentProcessId;originProcessId=$request.originProcessId;userSid=$identity.User.Value;
    startedAt=[DateTime]::UtcNow.ToString('o');attempt=$Attempt;editorDirectory=$editor;probe=$null;exitCode=$null}
Save $resultFile $result
try{
    $permission=Join-Path $run 'permission'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'android-acceptance-preflight.ps1') -OutputDir $permission
    if($LASTEXITCODE -ne 0){throw 'Elevated symlink gate failed'}
    $result.probe=Read (Join-Path $permission 'acceptance-permission.json')
    if(!$result.probe.success -or !$result.probe.isElevated -or (Test-Path -LiteralPath $result.probe.probeRoot)){
        throw 'Invalid probe or cleanup'
    }
    Save $resultFile $result
    $node=(Get-Command node.exe -ErrorAction Stop).Source
    $arguments=@(('"'+(Join-Path $PSScriptRoot 'player-aspect-android-export.cjs')+'"'),
        ('"'+$installation+'"'),('"'+$author+'"'),('"'+$editor+'"'),('"'+$run+'"'))
    $child=Start-Process -FilePath $node -WorkingDirectory $repo -WindowStyle Hidden -PassThru -ArgumentList $arguments `
        -RedirectStandardOutput (Join-Path $run 'stdout.log') -RedirectStandardError (Join-Path $run 'stderr.log')
    $result.nodeProcessId=$child.Id;$result.nodeCreated=$child.StartTime.ToUniversalTime().ToString('o');Save $resultFile $result
    $null=$child.Handle;$child.WaitForExit();$child.Refresh();$result.exitCode=$child.ExitCode
    $result.status=if($child.ExitCode -eq 0){'BUILD_PASS_DEVICE_PENDING'}else{'CHECK_EDITOR_REPORT'}
}catch{$result.status='BLOCKED';$result.error=$_.Exception.ToString()}
finally{$result.finishedAt=[DateTime]::UtcNow.ToString('o');Save $resultFile $result}
if($result.status -cne 'BUILD_PASS_DEVICE_PENDING'){exit 2}
