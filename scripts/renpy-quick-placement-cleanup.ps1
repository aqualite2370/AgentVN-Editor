param([switch]$Elevated)
$ErrorActionPreference='Stop'
$env:PSModulePath=([Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)+'\WindowsPowerShell\Modules;'+$env:WINDIR+'\System32\WindowsPowerShell\v1.0\Modules')
$release='F:\testavn\Editor-Quick-Placement-Release-1981-20261116-01'
$scopes=@('F:\testavn\Windows-Isolated-1981-20261116-01','F:\testavn\Windows-Isolated-1981-20261116-02','F:\testavn\Windows-Isolated-1981-20261116-03','F:\testavn\Windows-Isolated-1981-20261116-04')
$receipt=Join-Path $release 'artifact-cleanup-01.json'
if(Test-Path -LiteralPath $receipt){throw 'Preserve cleanup evidence'}
$admin=([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if(!$Elevated){
  if($admin){throw 'Ordinary origin required'}
  Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Elevated')|Out-Null
  return
}
if(!$admin){throw 'Actual administrator required'}
function Read($p){Get-Content -LiteralPath $p -Raw -Encoding UTF8|ConvertFrom-Json}
function Sha($p){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
$r=@{status='RUNNING';startedAt=[datetime]::UtcNow.ToString('o');administrator=$true;targets=@();files=0;logicalBytes=[int64]0;retained=@();aclRepairs=@();oldRejectedProfilesTouched=$false}
function Save{[IO.File]::WriteAllText($receipt,($r|ConvertTo-Json -Depth 16),[Text.UTF8Encoding]::new($false))}
function Keep($file){
  if((Sha $file.path) -cne $file.sha256){throw "Protected artifact differs: $($file.path)"}
  $r.retained+=@{path=$file.path;sha256=$file.sha256}
}
function Children([string]$directory){
  try{return @(Get-ChildItem -LiteralPath $directory -Force -ErrorAction Stop)}
  catch [UnauthorizedAccessException]{
    $full=[IO.Path]::GetFullPath($directory)
    if($full -cnotmatch '^F:\\testavn\\Windows-Isolated-1981-20261116-(01|03|04)\\qa-temp\\_MEI[0-9]+(?:\\.*)?$'){throw}
    $item=Get-Item -LiteralPath $full -Force
    if(!$item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'No linked ACL repair'}
    & "$env:SystemRoot\System32\takeown.exe" /F $full /A|Out-Null
    if($LASTEXITCODE -ne 0){throw 'Exact temporary ownership failed'}
    & "$env:SystemRoot\System32\icacls.exe" $full /grant '*S-1-5-32-544:(OI)(CI)F' /Q|Out-Null
    if($LASTEXITCODE -ne 0){throw 'Exact temporary grant failed'}
    $r.aclRepairs+=@{path=$full;recursive=$false};Save
    return @(Get-ChildItem -LiteralPath $full -Force -ErrorAction Stop)
  }
}
try{
  if((Read "$release\installed-audit-01.json").status -cne 'PASS1981_INSTALLED_AUTHOR_RESTART_UI_EXPORT_NATIVE032_REAL031_REFUSAL'){throw 'Functional audit incomplete'}
  $targets=@()
  $live=@(Get-CimInstance Win32_Process)
  foreach($scope in $scopes){
    if((Resolve-Path -LiteralPath $scope).ProviderPath -cne $scope -or ((Get-Item -LiteralPath $scope -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Exact unlinked QA root required'}
    $archive=Read "$scope\qa-sources.json"
    if($archive.status -cne 'PASS' -or !$archive.files.Count){throw 'QA source archive missing'}
    foreach($file in $archive.files){Keep $file}
    Keep @{path="$scope\qa-sources.json";sha256=(Sha "$scope\qa-sources.json")}
    $targets+=,"$scope\harness"
    if($scope.EndsWith('-02')){
      if((Read "$scope\preparation-failed-01.json").testAccounts -ne 0 -or (Test-Path -LiteralPath "$scope\account-controller.json")){throw 'Preparation-only scope changed'}
      continue
    }
    $owner=Read "$scope\account-controller.json";$retired=Read "$scope\account-retirement-01.json";$run=Read "$scope\resource-01\report.json"
    if($owner.status -cne 'FINISHED' -or !$owner.account.createdByThisRun -or $retired.status -cne 'PASS' -or
      !$retired.cleanup.accountDeleted -or !$retired.cleanup.profileDeleted -or $owner.account.sid -cne $retired.account.sid -or
      !$run.finishedAt -or $run.cleanupStatus -cne 'PASS'){throw 'QA lifecycle incomplete'}
    if((Get-LocalUser -SID $owner.account.sid -ErrorAction SilentlyContinue) -or
      (Get-CimInstance Win32_UserProfile|Where-Object SID -CEQ $owner.account.sid) -or (Test-Path -LiteralPath $retired.account.profile)){throw 'QA identity remains'}
    $ports=@($run.launches|ForEach-Object{if($_.ports){$_.ports}elseif($_.port){$_.port}})
    if(@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object LocalPort -In $ports).Count){throw 'Owned listener remains'}
    foreach($known in @($run.editorKnown)+@($run.knownProcesses)){
      if($known -and @($live|Where-Object{$_.ProcessId -eq $known.ProcessId -and $_.CreationDate.ToUniversalTime().ToString('o') -ceq $known.Created}).Count){throw 'Owned process remains'}
    }
    Keep $retired.databaseEvidence
    foreach($name in @('resource-01\report.json','account-controller.json','account-retirement-01.json')){Keep @{path="$scope\$name";sha256=(Sha "$scope\$name")}}
    if($run.cartridge){Keep $run.cartridge}
    $targets+=,"$scope\qa-temp"
  }
  $build=Read "$release\release\build.json";$checkpoint=Read "$release\checkpoint.json"
  foreach($file in @($build.installer,$build.sourceInstaller,$build.dev,$build.player,$build.backend,$build.oldPlayer,$build.payloadReport,$checkpoint.daily,$checkpoint.frozen.installer,$checkpoint.frozen.player)){Keep $file}
  foreach($name in @('installed-audit-01.json','release\build.json','checkpoint.json')){Keep @{path="$release\$name";sha256=(Sha "$release\$name")}}
  $targets+=@('F:\testavn\Windows-Isolated-1981-20261116-01\installed-editor',"$release\release\payload\nsis-payload","$release\temp")
  $inventory=[Collections.Generic.List[object]]::new()
  foreach($target in $targets){
    if([IO.Path]::GetFullPath($target) -cne $target -or (Resolve-Path -LiteralPath $target).ProviderPath -cne $target){throw 'Resolved target escaped'}
    $item=Get-Item -LiteralPath $target -Force
    if(!$item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'No linked target'}
    if(@($live|Where-Object{$_.ExecutablePath -and $_.ExecutablePath.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)}).Count){throw 'Target live'}
    $entry=@{path=$target;files=0;logicalBytes=[int64]0;removed=$false};$r.targets+=,$entry
    $pending=[Collections.Generic.Stack[string]]::new();$pending.Push($target)
    while($pending.Count){
      foreach($child in (Children $pending.Pop())){
        if(!$child.FullName.StartsWith($target+'\',[StringComparison]::Ordinal) -or ($child.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Child link or escape'}
        if($child.PSIsContainer){$pending.Push($child.FullName)}
        else{$inventory.Add(@{path=$child.FullName;bytes=[int64]$child.Length});$entry.files++;$entry.logicalBytes+=[int64]$child.Length}
      }
    }
  }
  [IO.File]::WriteAllText("$release\artifact-cleanup-inventory-01.json",($inventory|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
  foreach($entry in $r.targets){
    if($entry.path.EndsWith('\qa-temp')){
      & "$env:SystemRoot\System32\takeown.exe" /F $entry.path /A /R /D Y|Out-Null
      if($LASTEXITCODE -ne 0){throw 'Verified temporary ownership failed'}
      & "$env:SystemRoot\System32\icacls.exe" $entry.path /reset /T /Q|Out-Null
      if($LASTEXITCODE -ne 0){throw 'Verified temporary ACL reset failed'}
      & "$env:SystemRoot\System32\icacls.exe" $entry.path /grant '*S-1-5-32-544:(OI)(CI)F' /T /Q|Out-Null
      if($LASTEXITCODE -ne 0){throw 'Verified temporary ACL grant failed'}
      $r.aclRepairs+=@{path=$entry.path;recursive=$true;verifiedNoLinks=$true}
    }
    Remove-Item -LiteralPath $entry.path -Recurse -Force -ErrorAction Stop
    if(Test-Path -LiteralPath $entry.path){throw 'Target remains'}
    $entry.removed=$true;$r.files+=$entry.files;$r.logicalBytes+=$entry.logicalBytes;Save
  }
  foreach($file in $r.retained){if((Sha $file.path) -cne $file.sha256){throw 'Protected artifact changed'}}
  $r.status='PASS'
}catch{$r.status='FAILED';$r.error=$_.Exception.ToString()}
finally{$r.finishedAt=[datetime]::UtcNow.ToString('o');Save}
