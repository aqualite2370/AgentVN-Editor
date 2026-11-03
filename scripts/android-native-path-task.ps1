param(
    [ValidateSet('SelfTest','Launch','Elevated')][string]$Action='SelfTest',
    [ValidatePattern('^\d{2}$')][string]$Attempt='02',
    [ValidatePattern('^\d{2}$')][string]$RecoverAttempt=''
)
# One-shot diagnostic via the Windows task engine. No recurring trigger,
# no APK, and no retained task registration. Avoid packaged-parent inheritance.
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -Force
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Management\Microsoft.PowerShell.Management.psd1') -Force
$run='F:\AgentVN\QA\Android-Package-20261021-01\path-probe-'+$Attempt
$taskName='AgentVN-QA-Android-NativePath-20261021-'+$Attempt
$probe='D:\AgentVN\scripts\android-native-path-probe.ps1'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$admin=([Security.Principal.WindowsPrincipal]::new($identity)).
    IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
function Save($file,$value) {
    [IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
}
if($Action -ceq 'SelfTest') {
    if([IO.Path]::GetDirectoryName($run) -cne 'F:\AgentVN\QA\Android-Package-20261021-01' -or
        [IO.Path]::GetFileName($run) -cne ('path-probe-'+$Attempt) -or
        $taskName -cne ('AgentVN-QA-Android-NativePath-20261021-'+$Attempt)) {throw 'Task boundary mismatch'}
    'PASS: exact one-shot task/path boundaries; no task registered';exit
}
if($Action -ceq 'Launch') {
    if($admin) {throw 'Non-admin origin required'}
    if(Test-Path -LiteralPath $run) {throw 'Fresh task diagnostic root required'}
    $null=New-Item -ItemType Directory -Path $run
    Copy-Item -LiteralPath $PSCommandPath -Destination (Join-Path $run 'task-executed.ps1')
    Copy-Item -LiteralPath $probe -Destination (Join-Path $run 'probe-executed.ps1')
    Save (Join-Path $run 'origin.json') @{status='RUNNING';isElevated=$false;processId=$PID
        userSid=$identity.User.Value;at=[DateTime]::UtcNow.ToString('o')}
    $arguments=@('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),
        '-Action','Elevated','-Attempt',$Attempt)
    if($RecoverAttempt){$arguments+=@('-RecoverAttempt',$RecoverAttempt)}
    $helper=Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -PassThru -ArgumentList $arguments
    Save (Join-Path $run 'task-launch.json') @{status='HELPER_STARTED';helperPid=$helper.Id
        helperCreated=$helper.StartTime.ToUniversalTime().ToString('o');originProcessId=$PID}
    'Task diagnostic helper PID: '+$helper.Id;exit
}
if(!$admin) {throw 'Administrator task registration required'}
$origin=[IO.File]::ReadAllText((Join-Path $run 'origin.json'),[Text.Encoding]::UTF8)|ConvertFrom-Json
if($origin.isElevated -or $origin.userSid -cne $identity.User.Value) {throw 'Origin ownership mismatch'}
$resultFile=Join-Path $run 'task-result.json'
if(Test-Path -LiteralPath $resultFile) {throw 'Never overwrite task evidence'}
$state=@{status='RUNNING';at=[DateTime]::UtcNow.ToString('o');isElevated=$true;processId=$PID
    taskName=$taskName;registered=$false;cleanup='NOT_RUN';error=$null}
Save $resultFile $state
try {
    Import-Module ScheduledTasks -ErrorAction Stop
    if(Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue) {throw 'Existing task must not be changed'}
    if($RecoverAttempt) {
        $recovery=Join-Path $run 'recovery-worker.ps1'
        $source='D:\AgentVN\scripts\android-current-build-recovery.cjs'
        $body="`$ErrorActionPreference='Stop'`r`n& 'C:\Program Files\nodejs\node.exe' '"+$source+"' "+$RecoverAttempt+
            " 1> '"+(Join-Path $run 'recovery-stdout.log')+"' 2> '"+(Join-Path $run 'recovery-stderr.log')+
            "'`r`nexit `$LASTEXITCODE`r`n"
        [IO.File]::WriteAllText($recovery,$body,[Text.UTF8Encoding]::new($false))
        $taskAction=New-ScheduledTaskAction -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' `
            -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+$recovery+'"')
    }else {
        $taskAction=New-ScheduledTaskAction -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' `
            -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+$probe+'" -Action Task -Attempt '+$Attempt)
    }
    $principal=New-ScheduledTaskPrincipal -UserId $identity.User.Value -LogonType Interactive -RunLevel Highest
    $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 4) -MultipleInstances IgnoreNew
    $null=Register-ScheduledTask -TaskName $taskName -TaskPath '\' -Action $taskAction -Principal $principal -Settings $settings
    $state.registered=$true;Save $resultFile $state
    Start-ScheduledTask -TaskName $taskName -TaskPath '\'
    $deadline=[DateTime]::UtcNow.AddHours(4)
    do {
        Start-Sleep -Milliseconds 500
        $task=Get-ScheduledTask -TaskName $taskName -TaskPath '\'
        $info=Get-ScheduledTaskInfo -TaskName $taskName -TaskPath '\'
        $state.taskState=$task.State.ToString()
        $state.lastTaskResult=$info.LastTaskResult
        Save $resultFile $state
        $done=$task.State -ne 'Running' -and $info.LastRunTime.ToUniversalTime() -ge [DateTime]::Parse($state.at).ToUniversalTime()
    }while(!$done -and [DateTime]::UtcNow -lt $deadline)
    if(!$done) {throw 'Task probe did not reach terminal state; preserve running owner'}
    $state.status='OBSERVED'
}catch {$state.status='FAILED';$state.error=$_.Exception.ToString()}
finally {
    if($state.registered) {
        $task=Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
        if($task -and $task.State -eq 'Running') {$state.cleanup='BLOCKED_RUNNING_TASK'}
        else {
            if($task){Unregister-ScheduledTask -TaskName $taskName -TaskPath '\' -Confirm:$false}
            $state.cleanup=if(Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue){'FAILED'}else{'PASS'}
        }
    }
    $state.finishedAt=[DateTime]::UtcNow.ToString('o');Save $resultFile $state
}
