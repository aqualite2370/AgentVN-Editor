param(
  [ValidateSet('Launch','Elevated')][string]$Action='Launch',
  [ValidatePattern('^\d{2}$')][string]$Attempt='01'
)
# Source QA build only. Actual non-admin -> RunAs boundary; no permission cache fabrication.
$ErrorActionPreference='Stop'
$run=[IO.Path]::GetFullPath("F:\AgentVN\QA\Android-Exit-20261024-01\apk-build-$Attempt")
$originFile=Join-Path $run 'origin.json'
$receipt=Join-Path $run 'administrator.json'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$elevated=([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
function Save($file,$data) {
  [IO.File]::WriteAllText($file,($data|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
}
if(!(Test-Path -LiteralPath (Join-Path $run 'preparation.json'))) {throw 'Prepared isolated source clone required'}
if($Action -ceq 'Launch') {
  if($elevated) {throw 'Non-administrator origin required'}
  if((Test-Path -LiteralPath $originFile) -or (Test-Path -LiteralPath $receipt)) {throw 'Fresh elevation receipt required'}
  $self=Get-CimInstance Win32_Process -Filter "ProcessId=$PID"
  $r=@{status='AWAITING_RUNAS';originIsElevated=$false;processId=$PID
    created=$self.CreationDate.ToUniversalTime().ToString('o');userSid=$identity.User.Value
    attempt=$Attempt;run=$run;startedAt=[DateTime]::UtcNow.ToString('o')}
  Save $originFile $r
  try {
    $child=Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -PassThru -ArgumentList @(
      '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),
      '-Action','Elevated','-Attempt',$Attempt)
    $r.status='HELPER_STARTED';$r.helperPid=$child.Id
    $r.helperCreated=$child.StartTime.ToUniversalTime().ToString('o')
  }catch {$r.status='BLOCKED';$r.error=$_.Exception.ToString();throw}
  finally {Save $originFile $r}
  $r|ConvertTo-Json -Depth 5
  exit
}
if(!$elevated) {throw 'Genuine administrator token required'}
if(Test-Path -LiteralPath $receipt) {throw 'Never overwrite elevation evidence'}
$origin=[IO.File]::ReadAllText($originFile)|ConvertFrom-Json
if($origin.originIsElevated -or $origin.userSid -cne $identity.User.Value -or
    $origin.attempt -cne $Attempt -or $origin.run -cne $run) {throw 'Origin identity mismatch'}
$self=Get-CimInstance Win32_Process -Filter "ProcessId=$PID"
$r=@{status='RUNNING';startedAt=[DateTime]::UtcNow.ToString('o');isElevated=$true
  originProcessId=$origin.processId;processId=$PID;created=$self.CreationDate.ToUniversalTime().ToString('o')
  userSid=$identity.User.Value;parentBoundary='non-admin-to-RunAs';attempt=$Attempt}
Save $receipt $r
try {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\AgentVN\scripts\android-acceptance-preflight.ps1 `
    -OutputDir (Join-Path $run 'permission')
  if($LASTEXITCODE -ne 0) {throw 'Administrator symbolic link probe failed'}
  $r.permission=[IO.File]::ReadAllText((Join-Path $run 'permission\acceptance-permission.json'))|ConvertFrom-Json
  Save $receipt $r
  $node=(Get-Command node.exe -ErrorAction Stop).Source
  $child=Start-Process -FilePath $node -WindowStyle Hidden -WorkingDirectory D:\AgentVN -PassThru `
    -ArgumentList @('D:\AgentVN\scripts\android-exit-source-package.cjs','build',$Attempt) `
    -RedirectStandardOutput (Join-Path $run 'stdout.log') -RedirectStandardError (Join-Path $run 'stderr.log')
  $r.nodePid=$child.Id;$r.nodeCreated=$child.StartTime.ToUniversalTime().ToString('o');Save $receipt $r
  $null=$child.Handle;$child.WaitForExit();$child.Refresh()
  $r.exitCode=$child.ExitCode
  $r.status=if($child.ExitCode -eq 0){'SOURCE_APKS_BUILT_DEVICE_NOT_RUN'}else{'CHECK_BUILD_REPORT'}
}catch {$r.status='BLOCKED';$r.error=$_.Exception.ToString()}
finally {$r.finishedAt=[DateTime]::UtcNow.ToString('o');Save $receipt $r}
