param([switch]$Elevated)
$ErrorActionPreference='Stop'
$base='F:\testavn\Windows-Isolated-1983-20261116-02'
$prior='F:\testavn\Windows-Isolated-1983-20261116-01'
$release='F:\testavn\Editor-Save-Guard-Release-1983-20261116-01'
$output=Join-Path $base 'artifact-cleanup.json'
if(Test-Path -LiteralPath $output){throw 'Preserve previous cleanup receipt'}
$principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if(!$Elevated){
  Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList @(
    '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Elevated')|Out-Null
  return
}
if(!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Actual administrator required'}
function Read($file){Get-Content -LiteralPath $file -Raw -Encoding UTF8|ConvertFrom-Json}
function Sha($file){(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
function NoLink($file){
  if((Get-Item -LiteralPath $file -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw "Linked path: $file"}
}
function Files($directory){
  $pending=[Collections.Generic.Stack[string]]::new()
  $pending.Push($directory)
  while($pending.Count){
    $current=$pending.Pop();NoLink $current
    try{$children=@(Get-ChildItem -LiteralPath $current -Force -ErrorAction Stop)}
    catch [UnauthorizedAccessException]{
      if(!$current.StartsWith($prior+'\qa-temp',[StringComparison]::Ordinal) -and
         !$current.StartsWith($base+'\qa-temp',[StringComparison]::Ordinal)){throw}
      NoLink $current
      & "$env:SystemRoot\System32\takeown.exe" /F $current /A|Out-Null
      if($LASTEXITCODE -ne 0){throw 'Exact temporary directory ownership failed'}
      & "$env:SystemRoot\System32\icacls.exe" $current /grant '*S-1-5-32-544:(OI)(CI)F' /Q|Out-Null
      if($LASTEXITCODE -ne 0){throw 'Exact temporary directory access failed'}
      $children=@(Get-ChildItem -LiteralPath $current -Force -ErrorAction Stop)
    }
    foreach($child in $children){
      NoLink $child.FullName
      if(!$child.FullName.StartsWith($directory+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Escaped target'}
      if($child.PSIsContainer){$pending.Push($child.FullName)}else{$child}
    }
  }
}
$result=@{status='RUNNING';startedAt=[datetime]::UtcNow.ToString('o');targets=@();retained=@();archives=@();
  files=0;logicalBytes=[int64]0;physicalFreedBytes='NOT_MEASURED';historicalRejectedScopesTouched=$false}
try{
  foreach($root in @($base,$prior,$release)){
    if([IO.Path]::GetFullPath($root) -cne $root -or (Resolve-Path -LiteralPath $root).ProviderPath -cne $root){throw 'Wrong batch root'}
    NoLink $root
  }
  $audit=Read "$base\functional-audit.json"
  $run=Read "$base\resource-01\report.json"
  $build=Read "$release\release\build.json"
  if($audit.status -cne 'PASS' -or @($audit.groups).Count -ne 5 -or $run.status -cne 'PASS' -or
    $run.cleanupStatus -cne 'PASS' -or @($run.stages).Count -ne 9 -or $build.version -cne '1.9.83'){throw 'Product or independent audit incomplete'}
  $live=@(Get-CimInstance Win32_Process)
  $ports=@()
  foreach($entry in @(@{root=$prior;file='aborted-qa-retirement-02.json'},@{root=$base;file='account-retirement-01.json'})){
    $retired=Read (Join-Path $entry.root $entry.file)
    $controller=Read (Join-Path $entry.root 'account-controller.json')
    if($retired.status -cne 'PASS' -or !$retired.cleanup.accountDeleted -or !$retired.cleanup.profileDeleted -or
      $controller.status -cne 'FINISHED' -or $controller.account.sid -cne $retired.account.sid -or
      (Test-Path -LiteralPath $retired.account.profile)){throw 'QA retirement incomplete'}
    if((Get-CimInstance Win32_UserAccount -Filter "SID='$($retired.account.sid)'") -or
      (Get-CimInstance Win32_UserProfile|Where-Object SID -CEQ $retired.account.sid)){throw 'QA identity remains'}
    $oldRun=Read (Join-Path $entry.root 'resource-01\report.json')
    foreach($process in $oldRun.editorKnown){
      if(@($live|Where-Object{$_.ProcessId -eq $process.ProcessId -and $_.CreationDate.ToUniversalTime().ToString('o') -ceq $process.Created}).Count){throw 'Recorded product process remains'}
    }
    $ports+=@($oldRun.launches|ForEach-Object{$_.ports})
    $scripts=Join-Path $entry.root 'harness\scripts'
    $archive=Join-Path $entry.root 'qa-sources'
    $manifest=Join-Path $entry.root 'qa-sources.json'
    if((Test-Path -LiteralPath $archive) -or (Test-Path -LiteralPath $manifest)){throw 'Source archive already exists'}
    $rows=@()
    foreach($source in @(Files $scripts)){
      $relative=$source.FullName.Substring($scripts.Length+1)
      $target=Join-Path $archive $relative
      New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force|Out-Null
      Copy-Item -LiteralPath $source.FullName -Destination $target
      $digest=Sha $target
      if($digest -cne (Sha $source.FullName)){throw 'QA archive bytes differ'}
      $rows+=@{source=$source.FullName;path=$target;sha256=$digest}
    }
    if($rows.Count -lt 200){throw 'QA archive is incomplete'}
    [IO.File]::WriteAllText($manifest,(@{status='PASS';files=$rows}|ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
    $result.archives+=@{path=$manifest;sha256=(Sha $manifest);files=$rows.Count}
    $result.retained+=@{path=$manifest;sha256=(Sha $manifest)}
  }
  if(@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object LocalPort -In $ports).Count){throw 'Recorded listener remains'}
  foreach($file in @($build.installer,$build.payloadReport)+@($run.backupEvidence)+@($run.backupEvidence|ForEach-Object{$_.metadata})+@($run.screenshots)){
    if((Sha $file.path) -cne $file.sha256){throw 'Evidence bytes changed'}
    $result.retained+=@{path=$file.path;sha256=$file.sha256}
  }
  foreach($file in @("$base\resource-01\report.json","$base\verified-qa-default.db","$base\functional-audit.json",
    "$base\account-retirement-01.json","$prior\resource-01\report.json","$prior\job-01\stderr.log",
    "$prior\aborted-qa-retirement-02.json","$release\checkpoint.json","$release\seal-01-failure.json","$release\release\build.json")){
    $result.retained+=@{path=$file;sha256=(Sha $file)}
  }
  $targets=@("$prior\installed-editor","$prior\harness","$prior\qa-temp",
    "$base\harness","$base\qa-temp","$release\temp","$release\release\payload\nsis-payload")
  foreach($target in $targets){
    if([IO.Path]::GetFullPath($target) -cne $target -or (Resolve-Path -LiteralPath $target).ProviderPath -cne $target){throw 'Target not exact'}
    NoLink $target
    if(@($live|Where-Object{$_.ExecutablePath -and $_.ExecutablePath.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)}).Count){throw 'Target executable is live'}
    $entries=@(Files $target);$bytes=[int64]0
    foreach($entry in $entries){$bytes+=$entry.Length}
    $result.targets+=@{path=$target;files=$entries.Count;logicalBytes=$bytes;removed=$false}
  }
  foreach($entry in $result.targets){
    if($entry.path -like '*\qa-temp'){
      & "$env:SystemRoot\System32\takeown.exe" /F $entry.path /A /R /D Y|Out-Null
      if($LASTEXITCODE -ne 0){throw 'Validated temporary tree ownership failed'}
      & "$env:SystemRoot\System32\icacls.exe" $entry.path /reset /T /Q|Out-Null
      if($LASTEXITCODE -ne 0){throw 'Validated temporary ACL reset failed'}
      & "$env:SystemRoot\System32\icacls.exe" $entry.path /grant '*S-1-5-32-544:(OI)(CI)F' /T /Q|Out-Null
      if($LASTEXITCODE -ne 0){throw 'Validated temporary ACL grant failed'}
    }
    Remove-Item -LiteralPath $entry.path -Recurse -Force
    if(Test-Path -LiteralPath $entry.path){throw 'Target remains'}
    $entry.removed=$true;$result.files+=$entry.files;$result.logicalBytes+=$entry.logicalBytes
  }
  foreach($entry in $result.retained){if((Sha $entry.path) -cne $entry.sha256){throw 'Retained evidence changed'}}
  $result.status='PASS'
}catch{$result.status='FAILED';$result.error=$_.Exception.ToString()}
finally{
  $result.finishedAt=[datetime]::UtcNow.ToString('o')
  [IO.File]::WriteAllText($output,($result|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
  $result|Select-Object status,files,logicalBytes,error|ConvertTo-Json -Compress
}
