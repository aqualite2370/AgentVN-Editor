param([switch]$Elevated)
$ErrorActionPreference='Stop'
$taskBase='F:\testavn\Windows-Isolated-1989-20261117-01'
$taskRelease='F:\testavn\Preview-Sfx-Release-1989-20261117-01'
$taskOutput=Join-Path $taskBase 'artifact-cleanup-02.json'
if(Test-Path -LiteralPath $taskOutput){throw 'Preserve prior receipt'}
if(!$Elevated){
  Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList @(
    '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Elevated')|Out-Null
  return
}
if(!([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Administrator required'}
function Read($f){Get-Content -LiteralPath $f -Raw -Encoding UTF8|ConvertFrom-Json}
function Sha($f){(Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLowerInvariant()}
function NoLink($f){if((Get-Item -LiteralPath $f -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked path'}}
$r=@{status='RUNNING';files=0;logicalBytes=[int64]0;targets=@();retained=@();physicalFreedBytes='NOT_MEASURED';historicalRejectedScopesTouched=$false}
try{
  $prior=Read "$taskBase\artifact-cleanup.json"
  if($prior.status -cne 'FAILED' -or $prior.error -notmatch '_MEI572962'){throw 'Unexpected prior cleanup failure'}
  if((Read "$taskRelease\functional-audit.json").status -cne 'PASS'){throw 'Acceptance incomplete'}
  $retire=Read "$taskBase\account-retirement-01.json"
  if($retire.status -cne 'PASS' -or !$retire.cleanup.accountDeleted -or !$retire.cleanup.profileDeleted -or
    (Test-Path -LiteralPath $retire.account.profile)){throw 'Retirement incomplete'}
  $archive=Read "$taskBase\qa-sources.json"
  if($archive.status -cne 'PASS' -or @($archive.files).Count -lt 200){throw 'Missing source archive'}
  foreach($f in $archive.files){if((Sha $f.path) -cne $f.sha256){throw 'Source archive changed'}}
  $build=Read "$taskRelease\release\build.json"
  foreach($f in @($build.installer,$build.dev,$build.player,$build.backend,$build.oldPlayer,$retire.databaseEvidence)){
    if((Sha $f.path) -cne $f.sha256){throw 'Retained artifact changed'}
    $r.retained+=@{path=$f.path;sha256=$f.sha256}
  }
  $live=@(Get-CimInstance Win32_Process)
  if(@($live|Where-Object Name -In @('cargo.exe','rustc.exe','makensis.exe')).Count){throw 'Build active'}
  $targets=@("$taskBase\qa-temp","$taskBase\resource-01\temporary","$taskRelease\temp","$taskRelease\release\payload\nsis-payload")
  foreach($prefix in @('Gallery-Preview-Options-Browser-20261117-','Sfx-Stop-Fade-Browser-20261117-')){
    foreach($entry in @(Get-ChildItem -LiteralPath 'F:\testavn' -Directory -Force)){
      if(!$entry.Name.StartsWith($prefix,[StringComparison]::Ordinal)){continue}
      $test=Read (Join-Path $entry.FullName 'report.json')
      if($test.status -cnotin @('PASS','FAILED') -or !$test.finishedAt -or $test.cleanup -notmatch '^OWNED_.*STOPPED$'){throw 'Browser not terminal'}
      $targets+=Join-Path $entry.FullName 'temporary'
    }
  }
  foreach($target in $targets){
    if(!(Test-Path -LiteralPath $target)){continue}
    if([IO.Path]::GetFullPath($target) -cne $target -or (Resolve-Path -LiteralPath $target).ProviderPath -cne $target -or
      !$target.StartsWith('F:\testavn\',[StringComparison]::OrdinalIgnoreCase) -or
      $target -eq $taskBase -or $target -eq $taskRelease){throw 'Inexact/broad target'}
    NoLink $target
    if(@($live|Where-Object{$_.ExecutablePath -and $_.ExecutablePath.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)}).Count){throw 'Target process active'}
    if($target -ceq "$taskBase\qa-temp"){
      # Only this retired account's exact temporary tree. Never follow a link.
      $pending=[Collections.Generic.Queue[string]]::new()
      $pending.Enqueue($target)
      while($pending.Count){
        $itemPath=$pending.Dequeue()
        if($itemPath -cne $target -and !$itemPath.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Escaped target'}
        NoLink $itemPath
        & "$env:SystemRoot\System32\takeown.exe" /F $itemPath /A|Out-Null
        if($LASTEXITCODE -ne 0){throw 'Exact item ownership failed'}
        & "$env:SystemRoot\System32\icacls.exe" $itemPath /grant '*S-1-5-32-544:F' /Q|Out-Null
        if($LASTEXITCODE -ne 0){throw 'Exact item ACL failed'}
        if((Get-Item -LiteralPath $itemPath -Force).PSIsContainer){
          foreach($child in @(Get-ChildItem -LiteralPath $itemPath -Force -ErrorAction Stop)){$pending.Enqueue($child.FullName)}
        }
      }
    }
    $entries=@(Get-ChildItem -LiteralPath $target -Recurse -Force -ErrorAction Stop)
    foreach($entry in $entries){
      NoLink $entry.FullName
      if(!$entry.FullName.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Escaped target'}
    }
    $files=@($entries|Where-Object{!$_.PSIsContainer});$bytes=[int64]0
    foreach($f in $files){$bytes+=$f.Length}
    Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop
    if(Test-Path -LiteralPath $target){throw 'Target remains'}
    $r.files+=$files.Count;$r.logicalBytes+=$bytes
    $r.targets+=@{path=$target;files=$files.Count;logicalBytes=$bytes;removed=$true}
  }
  foreach($f in $r.retained){if((Sha $f.path) -cne $f.sha256){throw 'Retained artifact changed'}}
  $r.status='PASS'
}catch{$r.status='FAILED';$r.error=$_.Exception.ToString();throw}
finally{[IO.File]::WriteAllText($taskOutput,($r|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))}
