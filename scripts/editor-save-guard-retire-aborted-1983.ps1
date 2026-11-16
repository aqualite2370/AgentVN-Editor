param([switch]$Elevated)
$ErrorActionPreference='Stop'
$base='F:\testavn\Windows-Isolated-1983-20261116-01'
$receipt=Join-Path $base 'aborted-qa-retirement-02.json'
if(Test-Path -LiteralPath $receipt){throw 'Keep prior retirement receipt'}
$principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if(!$Elevated){
  Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList @(
    '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Elevated')|Out-Null
  return
}
if(!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Actual administrator required'}
function Read($file){Get-Content -LiteralPath $file -Raw -Encoding UTF8|ConvertFrom-Json}
function Sha($file){(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
$result=@{status='RUNNING';startedAt=[datetime]::UtcNow.ToString('o');productLaunches=0;originalReportChanged=$false}
try{
  $owner=Read "$base\account-controller.json"
  $run=Read "$base\resource-01\report.json"
  $failed=Read "$base\account-retirement-01.json"
  if($owner.status -cne 'FINISHED' -or !$owner.account.createdByThisRun -or
    !$owner.cleanup.accountDisabled -or $owner.cleanup.profileLoaded -or @($owner.cleanup.ownedProcesses).Count -ne 0 -or
    $owner.account.sid -cne 'S-1-5-21-2093805479-91935561-747405786-1139' -or
    $owner.account.name -cne 'AVNQA1416A67D' -or $failed.status -cne 'FAILED' -or
    $failed.error -notmatch 'Product QA cleanup not terminal' -or $run.status -cne 'RUNNING'){throw 'Unexpected aborted scope'}
  $stderr=Get-Content -LiteralPath "$base\job-01\stderr.log" -Raw
  if($stderr -notmatch "Cannot read properties of undefined" -or $stderr -notmatch 'project_metadata.title'){throw 'Unexpected QA failure'}
  $live=@(Get-CimInstance Win32_Process)
  foreach($record in $run.editorKnown){
    if(@($live|Where-Object{$_.ProcessId -eq $record.ProcessId -and $_.CreationDate.ToUniversalTime().ToString('o') -ceq $record.Created}).Count){throw 'Recorded product process remains'}
  }
  $ports=@($run.launches|ForEach-Object{$_.ports})
  if(@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object LocalPort -In $ports).Count){throw 'Recorded port remains'}
  if(@(Get-Process -IncludeUserName -ErrorAction SilentlyContinue|Where-Object UserName -IEQ "$env:COMPUTERNAME\$($owner.account.name)").Count){throw 'QA account owns processes'}
  $account=Get-LocalUser -SID $owner.account.sid
  if($account.Enabled -or $account.Name -cne $owner.account.name){throw 'QA account mismatch'}
  $profile=Get-CimInstance Win32_UserProfile|Where-Object SID -CEQ $owner.account.sid
  $expected="C:\Users\$($owner.account.name)"
  if(!$profile -or $profile.Loaded -or $profile.LocalPath -cne $expected -or
    (Resolve-Path -LiteralPath $expected).ProviderPath -cne $expected -or
    ((Get-Item -LiteralPath $expected -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Unsafe QA profile'}
  $result.retained=@()
  $database=Join-Path $expected 'AppData\Roaming\com.agentvn.editor\backend\vn_engine.db'
  foreach($suffix in @('','-wal','-shm')){
    $source=$database+$suffix
    if(Test-Path -LiteralPath $source){
      $destination=Join-Path $base ('verified-qa-default.db'+$suffix)
      if(Test-Path -LiteralPath $destination){throw 'Database backup exists'}
      if((Get-Item -LiteralPath $source -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked database'}
      Copy-Item -LiteralPath $source -Destination $destination
      if((Sha $source) -cne (Sha $destination)){throw 'Database copy differs'}
      $result.retained+=@{source=$source;path=$destination;sha256=(Sha $destination)}
    }
  }
  foreach($file in @("$base\resource-01\report.json","$base\job-01\stderr.log","$base\account-retirement-01.json")){
    $result.retained+=@{path=$file;sha256=(Sha $file)}
  }
  $result.account=@{name=$owner.account.name;sid=$owner.account.sid;profile=$expected}
  $profile|Remove-CimInstance -ErrorAction Stop
  Remove-LocalUser -SID $owner.account.sid -ErrorAction Stop
  if((Get-LocalUser -SID $owner.account.sid -ErrorAction SilentlyContinue) -or
    (Get-CimInstance Win32_UserProfile|Where-Object SID -CEQ $owner.account.sid) -or
    (Test-Path -LiteralPath $expected)){throw 'QA profile/account retirement incomplete'}
  foreach($file in $result.retained){if((Sha $file.path) -cne $file.sha256){throw 'Evidence changed'}}
  $result.cleanup=@{accountDeleted=$true;profileDeleted=$true;ownedProcesses=0;ports=$ports}
  $result.functionalStatus='QA_ABORTED_AFTER_INSTALL_NOT_FUNCTIONAL_ACCEPTANCE'
  $result.status='PASS'
}catch{$result.status='FAILED';$result.error=$_.Exception.ToString()}
finally{
  $result.finishedAt=[datetime]::UtcNow.ToString('o')
  [IO.File]::WriteAllText($receipt,($result|ConvertTo-Json -Depth 9),[Text.UTF8Encoding]::new($false))
  $result|Select-Object status,error|ConvertTo-Json -Compress
}
