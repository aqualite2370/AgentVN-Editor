param([switch]$Elevated)
$ErrorActionPreference='Stop'
$env:PSModulePath=([Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)+'\WindowsPowerShell\Modules;'+$env:WINDIR+'\System32\WindowsPowerShell\v1.0\Modules')
$base='F:\testavn\Windows-Isolated-1977-20261116-01'
$principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if(!$Elevated){
  if($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Ordinary origin required'}
  Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Elevated')|Out-Null
  return
}
if(!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Actual administrator required'}
function Read($p){Get-Content -LiteralPath $p -Raw -Encoding UTF8|ConvertFrom-Json}
function Sha($p){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
$output="$base\account-retirement-02.json"
if(Test-Path -LiteralPath $output){throw 'Preserve retirement evidence'}
$r=@{status='RUNNING';at=[datetime]::UtcNow.ToString('o');administrator=$true;productLaunches=0;userFilesDeleted=0}
try{
  if((Resolve-Path -LiteralPath $base).ProviderPath -cne $base -or
    ((Get-Item -LiteralPath $base -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Exact non-link QA root required'}
  $owner=Read "$base\account-controller.json";$run=Read "$base\resource-01\report.json"
  $failed=Read "$base\account-retirement-01.json"
  if($failed.status -cne 'FAILED' -or $failed.error -notmatch 'Product QA cleanup not terminal' -or
    $owner.status -cne 'FINISHED' -or !$owner.account.createdByThisRun -or
    $owner.account.sid -cne 'S-1-5-21-2093805479-91935561-747405786-1126' -or
    $owner.account.name -cne 'AVNQA34C4D845' -or !$owner.cleanup.accountDisabled -or
    $owner.cleanup.profileLoaded -or @($owner.cleanup.ownedProcesses).Count -or
    $run.status -cne 'FAILED' -or $run.error -notmatch 'strict mode violation'){throw 'Original failed QA provenance differs'}
  $r.originalFailure=@{path="$base\resource-01\report.json";sha256=(Sha "$base\resource-01\report.json")}
  $r.originalRetirementFailure=@{path="$base\account-retirement-01.json";sha256=(Sha "$base\account-retirement-01.json")}
  $account=Get-LocalUser -SID $owner.account.sid
  $profile=Get-CimInstance Win32_UserProfile|Where-Object SID -CEQ $owner.account.sid
  $expected="C:\Users\$($owner.account.name)"
  if($account.Enabled -or $account.Name -cne $owner.account.name -or !$profile -or $profile.Loaded -or
    $profile.LocalPath -cne $expected -or (Resolve-Path -LiteralPath $expected).ProviderPath -cne $expected -or
    ((Get-Item -LiteralPath $expected -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Exact unloaded disposable profile required'}
  $live=@(Get-CimInstance Win32_Process)
  foreach($process in $live){
    try{$sid=(Invoke-CimMethod -InputObject $process -MethodName GetOwnerSid -ErrorAction Stop).Sid}catch{continue}
    if($sid -ceq $owner.account.sid){throw 'Owned process still live'}
  }
  $ports=@($run.launches|ForEach-Object{$_.ports})
  if(@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object LocalPort -In $ports).Count){throw 'Owned listener remains'}
  $metadata=Read "$base\metadata-before.json"
  if(@($metadata.registry|Where-Object existed).Count -or @($metadata.shortcuts|Where-Object existed).Count){throw 'Do not remove pre-existing registration'}
  foreach($shortcut in $metadata.shortcuts){
    if(!$shortcut.path.StartsWith($expected+'\',[StringComparison]::Ordinal)){throw 'Unexpected shortcut boundary'}
  }
  $db="$expected\AppData\Roaming\com.agentvn.editor\backend\vn_engine.db"
  $retained="$base\verified-qa-default.db"
  if(Test-Path -LiteralPath $retained){throw 'Preserve database'}
  Copy-Item -LiteralPath $db -Destination $retained -ErrorAction Stop
  if((Sha $db) -cne (Sha $retained)){throw 'Database copy differs'}
  $r.databaseEvidence=@{path=$retained;source=$db;sha256=(Sha $retained)}
  $r.databaseSidecars=@()
  foreach($suffix in @('-wal','-shm')){
    if(Test-Path -LiteralPath ($db+$suffix)){
      if(Test-Path -LiteralPath ($retained+$suffix)){throw 'Preserve sidecar'}
      Copy-Item -LiteralPath ($db+$suffix) -Destination ($retained+$suffix)
      if((Sha ($db+$suffix)) -cne (Sha ($retained+$suffix))){throw 'Sidecar differs'}
      $r.databaseSidecars+=@{path=($retained+$suffix);sha256=(Sha ($retained+$suffix))}
    }
  }
  $r.account=@{name=$account.Name;sid=$owner.account.sid;profile=$expected}
  $profile|Remove-CimInstance -ErrorAction Stop
  Remove-LocalUser -SID $owner.account.sid -ErrorAction Stop
  if((Get-LocalUser -SID $owner.account.sid -ErrorAction SilentlyContinue) -or
    (Get-CimInstance Win32_UserProfile|Where-Object SID -CEQ $owner.account.sid) -or
    (Test-Path -LiteralPath $expected)){throw 'Profile retirement incomplete'}
  $r.cleanup=@{accountDeleted=$true;profileDeleted=$true;ownedProcesses=0;ports=$ports;reportsRetained=$true}
  $r.functionalStatus='FAILED'
  $r.registrationScope='Fresh QA-only registration removed with its profile; original runner restoration NOT_RUN'
  $r.status='PASS'
}catch{$r.status='FAILED';$r.error=$_.Exception.ToString()}
finally{
  $r.finishedAt=[datetime]::UtcNow.ToString('o')
  [IO.File]::WriteAllText($output,($r|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
}
