param([switch]$Elevated)
# Recover only the failed, never-started editor-14 task. No product execution.
$ErrorActionPreference='Stop'
$run='F:\AgentVN\QA\Android-Package-20261021-01\administrator-14'
$receipt=Join-Path $run 'independent-task-recovery.json'
$name='AgentVN-QA-Android-Build-20261021-14'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$admin=([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if(!$Elevated){
  if($admin){throw 'Non-admin origin required'}
  if(Test-Path -LiteralPath $receipt){throw 'Existing recovery receipt must remain'}
  Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList @(
    '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Elevated')|Out-Null
  exit
}
if(!$admin){throw 'Administrator required'}
if(Test-Path -LiteralPath $receipt){throw 'Do not repeat recovery'}
function Sha($file){
  $stream=[IO.File]::OpenRead($file);$hash=[Security.Cryptography.SHA256]::Create()
  try{([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
  finally{$stream.Dispose();$hash.Dispose()}
}
try {
$origin=[IO.File]::ReadAllText((Join-Path $run 'origin.json'))|ConvertFrom-Json
$state=[IO.File]::ReadAllText((Join-Path $run 'task-engine.json'))|ConvertFrom-Json
if($origin.userSid -cne $identity.User.Value -or $state.taskName -cne $name){throw 'Ownership mismatch'}
if((Test-Path -LiteralPath (Join-Path $run 'result.json')) -or
  (Test-Path -LiteralPath 'F:\AgentVN\QA\Android-Package-20261021-01\editor-14')){
  throw 'Product helper may have started; this recovery is no longer applicable'
}
$task=Get-ScheduledTask -TaskName $name -TaskPath '\'
$info=Get-ScheduledTaskInfo -TaskName $name -TaskPath '\'
if($task.State.ToString() -cne 'Ready' -or $info.LastTaskResult -ne 1 -or
  @($task.Actions).Count -ne 1 -or
  $task.Actions[0].Arguments -cne '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "D:\AgentVN\scripts\candidate-1924-android-task-launch.ps1" -Action Task -Attempt 14 -NativeUpgrade'){
  throw 'Exact failed nonrunning task required'
}
$parent=Get-CimInstance Win32_Process -Filter "ProcessId=$($state.processId)"
$expectedCreated=[DateTime]::Parse($origin.helperCreated).ToUniversalTime()
$expectedCreated=$expectedCreated.AddTicks(-($expectedCreated.Ticks%10))
if(!$parent -or $parent.Name -cne 'powershell.exe' -or
  $parent.CreationDate.ToUniversalTime() -ne $expectedCreated -or
  $parent.CommandLine -notlike '*candidate-1924-android-task-launch.ps1*'){throw 'Parent identity mismatch'}
$result=@{status='RUNNING';at=[DateTime]::UtcNow.ToString('o');isElevated=$true;parentProcessId=$parent.ProcessId
  lastTaskResult=$info.LastTaskResult;lastRunTime=$info.LastRunTime.ToUniversalTime().ToString('o')
  taskObserverAt=$state.at;productLaunches=0;protectedFiles=@()}
Export-ScheduledTask -TaskName $name -TaskPath '\' |
  Out-File -LiteralPath (Join-Path $run 'task-before-independent-recovery.xml') -Encoding utf8
$candidate=[IO.File]::ReadAllText('F:\AgentVN\QA\Editor-1.9.24-20261024-01\installation.json')|ConvertFrom-Json
foreach($file in $candidate.protectedFiles){
  $exists=Test-Path -LiteralPath $file.path -PathType Leaf
  $actual=if($exists){Sha $file.path}else{$null}
  $result.protectedFiles+=@{path=$file.path;expected=$file.sha256;exists=$exists;actual=$actual;matches=($actual -ceq $file.sha256)}
}
# This task never started the helper, created QA cache directories or ran APKs.
# Its observer compares a second-granularity LastRunTime to a subsecond start.
Unregister-ScheduledTask -TaskName $name -TaskPath '\' -Confirm:$false
$result.taskCleanup=if(Get-ScheduledTask -TaskName $name -TaskPath '\' -ErrorAction SilentlyContinue){'FAILED'}else{'PASS'}
$result.status=if($result.taskCleanup -ceq 'PASS'){'PASS'}else{'FAILED'}
[IO.File]::WriteAllText($receipt,($result|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
} catch {
  $errorFile=Join-Path $run 'independent-task-recovery-error.json'
  if(!(Test-Path -LiteralPath $errorFile)){
    [IO.File]::WriteAllText($errorFile,(@{status='FAILED';at=[DateTime]::UtcNow.ToString('o');
      error=$_.Exception.ToString();stack=$_.ScriptStackTrace}|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
  }
  exit 2
}
