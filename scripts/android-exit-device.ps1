param([Parameter(Mandatory=$true)][string]$RequestPath,[switch]$Elevated)
$ErrorActionPreference='Stop'
$requestFile=[IO.Path]::GetFullPath($RequestPath)
$q=[IO.File]::ReadAllText($requestFile)|ConvertFrom-Json
$out=[IO.Path]::GetFullPath([string]$q.outputDir)
$expected="F:\AgentVN\QA\Android-Exit-20261024-01\device-$($q.attempt)\runtime"
$scope=if($q.lifecycleDebugger){'SOURCE_APK_BOUNDED_NATIVE_LIFECYCLE_DIAGNOSTIC'}else{'SOURCE_APK_UNINSTRUMENTED_CONFIRMED_EXIT'}
if($q.scope -cne $scope -or $out -cne $expected) {throw 'Exact current exit QA request required'}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$admin=([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
function Save($file,$value) {[IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))}
if(!$Elevated) {
  if($admin) {throw 'Actual non-admin origin required'}
  $file=Join-Path ([IO.Path]::GetDirectoryName($out)) 'origin.json'
  if(Test-Path -LiteralPath $file) {throw 'Fresh launch required'}
  $r=@{originIsElevated=$false;originPid=$PID;userSid=$identity.User.Value}
  Save $file $r
  $child=Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -PassThru -ArgumentList @(
    '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),
    '-RequestPath',('"'+$requestFile+'"'),'-Elevated')
  $r.helperPid=$child.Id;$r.helperCreated=$child.StartTime.ToUniversalTime().ToString('o');Save $file $r
  exit
}
if(!$admin) {throw 'ANDROID_ADMIN_REQUIRED'}
$origin=[IO.File]::ReadAllText((Join-Path ([IO.Path]::GetDirectoryName($out)) 'origin.json'))|ConvertFrom-Json
if($origin.originIsElevated -or $origin.userSid -cne $identity.User.Value) {throw 'Wrong elevation origin'}
$receipt=Join-Path $out 'acceptance-launch.json'
if(Test-Path -LiteralPath $receipt) {throw 'Fresh terminal report required'}
$r=@{isElevated=$true;processId=$PID;parentBoundary='non-admin-to-RunAs';status='RUNNING'
  startedAt=[DateTime]::UtcNow.ToString('o')}
Save $receipt $r
$boot=[ordered]@{}
try {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\AgentVN\scripts\android-acceptance-preflight.ps1 -OutputDir $out
  if($LASTEXITCODE -ne 0) {throw 'ANDROID_SYMLINK_REQUIRED'}
  . D:\AgentVN\scripts\android-cold-boot.ps1
  Start-AndroidAcceptanceBoot $q $boot
  $previous=$ErrorActionPreference
  $ErrorActionPreference='Continue'
  try {
    & node D:\AgentVN\scripts\android-exit-device.cjs run $requestFile `
      1> (Join-Path $out 'stdout.log') 2> (Join-Path $out 'stderr.log')
    $r.exitCode=$LASTEXITCODE
  }finally {$ErrorActionPreference=$previous}
  $r.status=if($r.exitCode -eq 0){'CHECK_RUNTIME_SCOPE'}else{'CHECK_RUNTIME_REPORT'}
}catch {$r.status='BLOCKED';$r.error=$_.Exception.ToString()}
finally {
  if($boot.outputDir) {
    Stop-AndroidAcceptanceBoot $boot
    $r.emulatorCleanupStatus=$boot.emulatorCleanupStatus
    if($boot.emulatorCleanupStatus -cne 'PASS') {$r.status='FAILED';$r.cleanupError=$boot.cleanupError}
  }
  $r.finishedAt=[DateTime]::UtcNow.ToString('o');Save $receipt $r
}
