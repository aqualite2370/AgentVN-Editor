param(
    [ValidateSet('Launch','Elevated','Task')][string]$Action='Launch',
    [ValidatePattern('^\d{2}$')][string]$Attempt='01',
    [string]$PreviousReport=''
)
# QA only: real non-admin -> RunAs -> highest interactive one-shot task; no product hooks.
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -Force
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Management\Microsoft.PowerShell.Management.psd1') -Force
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$run='F:\AgentVN\QA\Android-Package-20261021-01\device-aspect-37-'+$Attempt
$build='F:\AgentVN\QA\Android-Package-20261021-01\editor-37\report.json'
function Read($file){[IO.File]::ReadAllText($file,[Text.Encoding]::UTF8)|ConvertFrom-Json}
function Save($file,$value){[IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 16),[Text.UTF8Encoding]::new($false))}
function Sha($file){
    $stream=[IO.File]::OpenRead($file);$hash=[Security.Cryptography.SHA256]::Create()
    try{([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
    finally{$stream.Dispose();$hash.Dispose()}
}
$tools=@($PSCommandPath,(Join-Path $PSScriptRoot 'player-aspect-android-device.cjs'),
    (Join-Path $PSScriptRoot 'android-cold-boot.ps1'),(Join-Path $PSScriptRoot 'android-acceptance-preflight.ps1'),
    (Join-Path $PSScriptRoot 'android-acceptance-evidence.cjs'),(Join-Path $PSScriptRoot 'android-runtime-log-analysis.cjs'),
    (Join-Path $PSScriptRoot 'visible-control-geometry.cjs'))
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$elevated=([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$originFile=Join-Path $run 'origin.json'
if($Action -ceq 'Launch'){
    if($elevated){throw 'Non-admin origin required'}
    if(Test-Path -LiteralPath $run){throw 'Fresh bounded device attempt required'}
    $b=Read $build
    if($b.status -cne 'PASS' -or $b.cleanup -cne 'PASS'){throw 'Current actual APK build/cleanup must pass'}
    if(@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '^(emulator|qemu-system-x86_64|agentvn-editor|creator-backend|adb)\.exe$'}).Count){
        throw 'Existing user process protected'
    }
    $null=New-Item -ItemType Directory -Path $run
    $current=Get-CimInstance Win32_Process -Filter "ProcessId=$PID"
    $portsJson=& node.exe -e "require('./scripts/lib/android-device-ports.cjs').allocateAndroidDevicePorts().then(p=>console.log(JSON.stringify(p)))"
    $ports=ConvertFrom-Json -InputObject ($portsJson -join '')
    if($ports.Count -ne 4){throw 'Four distinct free ports required'}
    $request=@{scope='current-player-aspect';package='com.agentvn.qa.playeraspect1936';outputDir=$run;
        sdk='D:\Android_dev\Sdk';serial='emulator-5554';adbPort=$ports[0];cdpPort=$ports[1];
        build=@{path=$build;sha256=(Sha $build)};
        coldBoot=@{avd='AgentVN_API35';avdHome='D:\Android_dev\avd';adbPort=$ports[2];grpcPort=$ports[3];
            discoveryRoot='C:\Users\1\AppData\Local\Temp\avd\running';mediaVolumeTarget=13}}
    if($PreviousReport){
        $expected='F:\AgentVN\QA\Android-Package-20261021-01\device-aspect-37-02\runtime-report.json'
        if([IO.Path]::GetFullPath($PreviousReport) -cne $expected){throw 'Only explicit first-current-device continuation allowed'}
        $previous=Read $expected
        if($previous.status -cne 'FAILED' -or $previous.cleanup -cne 'PASS' -or @($previous.cases).Count -ne 5 -or
            @($previous.cases|Select-Object -First 4|Where-Object {$_.status -cne 'PASS'}).Count -or
            $previous.error -notmatch '137 !== 0' -or $previous.apk.sha256 -cne $b.apk.sha256){
            throw 'Previous passing stages/QA interruption/source do not match'
        }
        $request.previousReport=@{path=$expected;sha256=(Sha $expected)}
    }
    Save (Join-Path $run 'request.json') $request
    $state=@{status='AWAITING_RUNAS';originIsElevated=$false;originProcessId=$PID;
        originCreated=$current.CreationDate.ToUniversalTime().ToString('o');userSid=$identity.User.Value;
        runDirectory=$run;requestedAt=[DateTime]::UtcNow.ToString('o');requestSha256=(Sha (Join-Path $run 'request.json'));
        tools=@($tools|ForEach-Object {@{path=$_;sha256=(Sha $_)}})}
    Save $originFile $state
    $child=Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -PassThru -ArgumentList @(
        '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Action','Elevated','-Attempt',$Attempt)
    $state.status='HELPER_STARTED';$state.helperPid=$child.Id;$state.helperCreated=$child.StartTime.ToUniversalTime().ToString('o')
    Save $originFile $state
    [pscustomobject]$state|Select-Object status,helperPid,runDirectory|ConvertTo-Json
    exit
}
if(!$elevated){throw 'Actual administrator token required'}
$origin=Read $originFile
if($origin.originIsElevated -or $origin.userSid -cne $identity.User.Value -or $origin.runDirectory -cne $run){throw 'Same-user origin differs'}
if(@($origin.tools).Count -ne $tools.Count){throw 'Missing source binding'}
foreach($f in $origin.tools){if($f.path -cnotin $tools -or (Sha $f.path) -cne $f.sha256){throw 'QA source changed'}}
$requestFile=Join-Path $run 'request.json'
if((Sha $requestFile) -cne $origin.requestSha256){throw 'Request changed'}
$request=Read $requestFile
if((Sha $request.build.path) -cne $request.build.sha256){throw 'Current build changed'}
if($Action -ceq 'Elevated'){
    Import-Module ScheduledTasks -ErrorAction Stop
    $taskName='AgentVN-QA-Player-Aspect-Device-37-'+$Attempt
    $taskFile=Join-Path $run 'task-engine.json'
    if((Test-Path -LiteralPath $taskFile) -or (Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue)){throw 'Existing task protected'}
    $state=@{status='RUNNING';taskName=$taskName;registered=$false;cleanup='PENDING';startedAt=[DateTime]::UtcNow.ToString('o')}
    Save $taskFile $state
    try{
        $argsText='-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+$PSCommandPath+'" -Action Task -Attempt '+$Attempt
        $taskAction=New-ScheduledTaskAction -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -Argument $argsText
        $principal=New-ScheduledTaskPrincipal -UserId $identity.User.Value -LogonType Interactive -RunLevel Highest
        $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
        $null=Register-ScheduledTask -TaskName $taskName -TaskPath '\' -Action $taskAction -Principal $principal -Settings $settings
        $state.registered=$true;Save $taskFile $state
        Start-ScheduledTask -TaskName $taskName -TaskPath '\'
        do{
            Start-Sleep -Seconds 2
            $task=Get-ScheduledTask -TaskName $taskName -TaskPath '\'
            $info=Get-ScheduledTaskInfo -TaskName $taskName -TaskPath '\'
            $started=$info.LastRunTime.ToUniversalTime() -ge [DateTime]::Parse($state.startedAt).ToUniversalTime().AddSeconds(-1)
        }while(!$started -or $task.State -eq 'Running')
        $state.lastTaskResult=$info.LastTaskResult
        $result=Read (Join-Path $run 'administrator.json');$state.status=$result.status
    }catch{$state.status='FAILED';$state.error=$_.Exception.ToString()}
    finally{
        if($state.registered){
            $task=Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
            if($task -and $task.State -eq 'Running'){$state.cleanup='LIVE_TASK_PRESERVED'}
            else{
                Unregister-ScheduledTask -TaskName $taskName -TaskPath '\' -Confirm:$false
                $state.cleanup=if(Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue){'FAILED'}else{'PASS'}
            }
        }
        $state.finishedAt=[DateTime]::UtcNow.ToString('o');Save $taskFile $state
    }
    exit
}
$resultFile=Join-Path $run 'administrator.json'
if(Test-Path -LiteralPath $resultFile){throw 'Existing receipt protected'}
$current=Get-CimInstance Win32_Process -Filter "ProcessId=$PID"
$result=@{status='RUNNING';isElevated=$true;userSid=$identity.User.Value;processId=$PID;
    created=$current.CreationDate.ToUniversalTime().ToString('o');originProcessId=$origin.originProcessId;
    startedAt=[DateTime]::UtcNow.ToString('o');cleanup='PENDING'}
$context=[ordered]@{}
Save $resultFile $result
try{
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'android-acceptance-preflight.ps1') -OutputDir $run
    if($LASTEXITCODE -ne 0){throw 'Elevated symlink gate failed'}
    . (Join-Path $PSScriptRoot 'android-cold-boot.ps1')
    Start-AndroidAcceptanceBoot $request $context
    $node=(Get-Command node.exe -ErrorAction Stop).Source
    $argsText=@(('"'+(Join-Path $PSScriptRoot 'player-aspect-android-device.cjs')+'"'),('"'+$requestFile+'"'))
    $child=Start-Process $node -WorkingDirectory $repo -WindowStyle Hidden -PassThru -ArgumentList $argsText `
        -RedirectStandardOutput (Join-Path $run 'stdout.log') -RedirectStandardError (Join-Path $run 'stderr.log')
    $result.nodePid=$child.Id;$result.nodeCreated=$child.StartTime.ToUniversalTime().ToString('o');Save $resultFile $result
    $null=$child.Handle;$child.WaitForExit();$child.Refresh();$result.exitCode=$child.ExitCode
    $runtime=Read (Join-Path $run 'runtime-report.json');$result.status=$runtime.status
}catch{$result.status='BLOCKED';$result.error=$_.Exception.ToString()}
finally{
    if($context.outputDir){Stop-AndroidAcceptanceBoot $context;$result.emulatorCleanup=$context.emulatorCleanupStatus}
    $result.cleanup=if($result.emulatorCleanup -ceq 'PASS'){'PASS'}else{'FAILED'}
    if($result.cleanup -cne 'PASS'){$result.status='FAILED'}
    $result.finishedAt=[DateTime]::UtcNow.ToString('o');Save $resultFile $result
}
