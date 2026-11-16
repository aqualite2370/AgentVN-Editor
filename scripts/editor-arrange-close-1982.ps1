param([switch]$Elevated)
$ErrorActionPreference='Stop'
$base='F:\testavn\Windows-Isolated-1982-20261116-01'
$release='F:\testavn\Editor-Arrange-Release-1982-20261116-01'
$receipt=Join-Path $base 'artifact-cleanup-03.json'
if(Test-Path -LiteralPath $receipt){throw 'Preserve original cleanup receipt'}
$principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if(!$Elevated){
  Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList @(
    '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Elevated')|Out-Null
  return
}
if(!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Actual administrator token required'}
function Read($file){Get-Content -LiteralPath $file -Raw -Encoding UTF8|ConvertFrom-Json}
function Sha($file){(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
function NoLink($file){
  if((Get-Item -LiteralPath $file -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw "Linked path: $file"}
}
function Files($directory){
  $pending=[Collections.Generic.Stack[string]]::new();$pending.Push($directory)
  while($pending.Count){
    $dir=$pending.Pop();NoLink $dir
    try{$entries=@(Get-ChildItem -LiteralPath $dir -Force -ErrorAction Stop)}
    catch [UnauthorizedAccessException]{
      if(!$dir.StartsWith($base+'\qa-temp\',[StringComparison]::Ordinal)){throw}
      NoLink $dir
      & "$env:SystemRoot\System32\takeown.exe" /F $dir /A|Out-Null
      if($LASTEXITCODE -ne 0){throw 'Exact temporary ownership failed'}
      & "$env:SystemRoot\System32\icacls.exe" $dir /grant '*S-1-5-32-544:(OI)(CI)F' /Q|Out-Null
      if($LASTEXITCODE -ne 0){throw 'Exact temporary access failed'}
      $entries=@(Get-ChildItem -LiteralPath $dir -Force -ErrorAction Stop)
    }
    foreach($item in $entries){
      NoLink $item.FullName
      if(!$item.FullName.StartsWith($directory+'\',[StringComparison]::Ordinal)){throw 'Escaped tree'}
      if($item.PSIsContainer){$pending.Push($item.FullName)}else{$item}
    }
  }
}
$result=@{status='RUNNING';startedAt=[datetime]::UtcNow.ToString('o');targets=@();retained=@();files=0;logicalBytes=[int64]0;oldRejectedProfilesTouched=$false}
try{
  foreach($root in @($base,$release)){
    if((Resolve-Path -LiteralPath $root).ProviderPath -cne $root){throw 'Wrong root'};NoLink $root
  }
  $previous=Read "$base\artifact-cleanup-02.json"
  if($previous.status -cne 'FAILED' -or $previous.files -ne 13471 -or
    $previous.error -notmatch 'RemoveFileSystemItem'){throw 'Unexpected prior cleanup state'}
  $result.previousConfirmedRemoved=@{files=$previous.files;logicalBytes=$previous.logicalBytes}
  $run=Read "$base\resource-01\report.json";$owner=Read "$base\account-controller.json"
  $retired=Read "$base\account-retirement-readonly-03.json";$candidate=Read "$base\candidate.json"
  $build=Read "$release\build-stages.json"
  if($run.status -cne 'PASS' -or !$run.finishedAt -or $run.cleanupStatus -cne 'PASS' -or
    $owner.status -cne 'FINISHED' -or !$owner.account.createdByThisRun -or
    $retired.status -cne 'PASS' -or !$retired.cleanup.accountDeleted -or !$retired.cleanup.profileDeleted -or
    $owner.account.sid -cne $retired.account.sid -or (Test-Path -LiteralPath $retired.account.profile) -or
    $build.status -cne 'PASS_BUILD_NOT_INSTALLED' -or $candidate.version -cne '1.9.82'){
    throw 'Lifecycle not terminal'
  }
  if((Get-CimInstance Win32_UserAccount -Filter "SID='$($retired.account.sid)'") -or
    (Get-CimInstance Win32_UserProfile|Where-Object SID -CEQ $retired.account.sid)){throw 'QA identity remains'}
  $live=@(Get-CimInstance Win32_Process)
  foreach($p in $run.editorKnown){
    if(@($live|Where-Object{$_.ProcessId -eq $p.ProcessId -and $_.CreationDate.ToUniversalTime().ToString('o') -ceq $p.Created}).Count){throw 'Owned process remains'}
  }
  $ports=@($run.launches|ForEach-Object{$_.ports})
  if(@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object LocalPort -In $ports).Count){throw 'Owned listener remains'}
  $archive=Join-Path $base 'qa-sources'
  $archived=Read "$base\qa-sources.json"
  if($archived.status -cne 'PASS'){throw 'Original QA archive incomplete'}
  $sources=@($archived.files)
  foreach($entry in $sources){
    if((Sha $entry.path) -cne $entry.sha256){throw 'Archive differs'}
    $result.retained+=,$entry
  }
  if($sources.Count -lt 200){throw 'Incomplete QA archive'}
  foreach($file in @($retired.databaseEvidence,$candidate.installer,$candidate.payloadReport)+@($run.backupEvidence)+@($run.backupEvidence|ForEach-Object{$_.metadata})){
    if((Sha $file.path) -cne $file.sha256){throw 'Protected evidence differs'}
    $result.retained+=@{path=$file.path;sha256=$file.sha256}
  }
  foreach($name in @('resource-01\report.json','account-controller.json','account-retirement-01.json','account-retirement-readonly-02.json','account-retirement-readonly-03.json','metadata-restoration.json','qa-sources.json','artifact-cleanup-01.json','artifact-cleanup-02.json')){
    $file=Join-Path $base $name;$result.retained+=@{path=$file;sha256=(Sha $file)}
  }
  foreach($gone in @("$base\installed-editor","$base\harness")){
    if(Test-Path -LiteralPath $gone){throw 'Previously removed target returned'}
  }
  foreach($target in @("$base\qa-temp","$release\temp","$release\release\payload\nsis-payload")){
    if([IO.Path]::GetFullPath($target) -cne $target -or
      (Resolve-Path -LiteralPath $target).ProviderPath -cne $target){throw 'Target escaped'}
    NoLink $target
    if(@($live|Where-Object{$_.ExecutablePath -and $_.ExecutablePath.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)}).Count){throw 'Target is live'}
    $items=@(Files $target);$bytes=[int64]0
    foreach($item in $items){$bytes+=$item.Length}
    $result.targets+=@{path=$target;files=$items.Count;logicalBytes=$bytes;removed=$false}
  }
  $temporary="$base\qa-temp"
  NoLink $temporary
  & "$env:SystemRoot\System32\takeown.exe" /F $temporary /A /R /D Y|Out-Null
  if($LASTEXITCODE -ne 0){throw 'Exact validated temporary ownership failed'}
  & "$env:SystemRoot\System32\icacls.exe" $temporary /reset /T /Q|Out-Null
  if($LASTEXITCODE -ne 0){throw 'Exact validated temporary ACL reset failed'}
  & "$env:SystemRoot\System32\icacls.exe" $temporary /grant '*S-1-5-32-544:(OI)(CI)F' /T /Q|Out-Null
  if($LASTEXITCODE -ne 0){throw 'Exact validated temporary grant failed'}
  foreach($entry in $result.targets){
    Remove-Item -LiteralPath $entry.path -Recurse -Force
    if(Test-Path -LiteralPath $entry.path){throw 'Target remains'}
    $entry.removed=$true;$result.files+=$entry.files;$result.logicalBytes+=$entry.logicalBytes
  }
  foreach($file in $result.retained){if((Sha $file.path) -cne $file.sha256){throw 'Retained evidence changed'}}
  $result.status='PASS'
}catch{$result.status='FAILED';$result.error=$_.Exception.ToString()}
finally{
  $result.finishedAt=[datetime]::UtcNow.ToString('o')
  [IO.File]::WriteAllText($receipt,($result|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
  $result|Select-Object status,files,logicalBytes,error|ConvertTo-Json -Compress
}
