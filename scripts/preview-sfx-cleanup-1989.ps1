param([switch]$Elevated)
$ErrorActionPreference='Stop'
$taskBase='F:\testavn\Windows-Isolated-1989-20261117-01'
$taskRelease='F:\testavn\Preview-Sfx-Release-1989-20261117-01'
$taskOutput=Join-Path $taskBase 'artifact-cleanup.json'
if(Test-Path -LiteralPath $taskOutput){throw 'Preserve prior cleanup receipt'}
if(!$Elevated){
  Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList @(
    '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Elevated')|Out-Null
  return
}
if(!([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole(
 [Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Real administrator required'}
function Read($f){Get-Content -LiteralPath $f -Raw -Encoding UTF8|ConvertFrom-Json}
function Sha($f){(Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLowerInvariant()}
function Files($target){
  if((Get-Item -LiteralPath $target -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked target'}
  $entries=@(Get-ChildItem -LiteralPath $target -Recurse -Force -ErrorAction Stop)
  foreach($entry in $entries){
    if(($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
      !$entry.FullName.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe child'}
  }
  @($entries|Where-Object{!$_.PSIsContainer})
}
$r=@{status='RUNNING';targets=@();files=0;logicalBytes=[int64]0;physicalFreedBytes='NOT_MEASURED';retained=@()}
try{
  $native=Read "$taskBase\resource-01\report.json"
  $retire=Read "$taskBase\account-retirement-01.json"
  $build=Read "$taskRelease\release\build.json"
  if($native.status -cne 'PASS' -or !$native.finishedAt -or $native.cleanupStatus -cne 'PASS' -or
    $retire.status -cne 'PASS' -or !$retire.cleanup.accountDeleted -or !$retire.cleanup.profileDeleted){throw 'Acceptance/retirement incomplete'}
  if(@(Get-CimInstance Win32_Process|Where-Object Name -In @('cargo.exe','rustc.exe','makensis.exe')).Count){throw 'Build active'}
  foreach($f in @($build.installer,$build.dev,$build.player,$build.backend,$build.oldPlayer,$retire.databaseEvidence)){
    if(!$f){continue}
    if((Sha $f.path) -cne $f.sha256){throw 'Retained artifact changed'}
    $r.retained+=@{path=$f.path;sha256=$f.sha256}
  }
  $taskArchive=Join-Path $taskBase 'qa-sources'
  if(Test-Path -LiteralPath $taskArchive){throw 'Preserve archive'}
  $taskSources=Join-Path $taskBase 'harness\scripts';$taskRows=@()
  foreach($file in @(Files $taskSources)){
    $target=Join-Path $taskArchive $file.FullName.Substring($taskSources.Length+1)
    New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force|Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $target
    if((Sha $file.FullName) -cne (Sha $target)){throw 'QA source archive differs'}
    $taskRows+=@{path=$target;sha256=(Sha $target)}
  }
  if($taskRows.Count -lt 200){throw 'Incomplete QA archive'}
  [IO.File]::WriteAllText("$taskBase\qa-sources.json",(@{status='PASS';files=$taskRows}|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
  $taskTargets=@("$taskBase\installed-editor","$taskBase\harness","$taskBase\qa-temp",
    "$taskBase\resource-01\temporary","$taskRelease\temp","$taskRelease\release\payload\nsis-payload")
  foreach($prefix in @('Gallery-Preview-Options-Browser-20261117-','Sfx-Stop-Fade-Browser-20261117-')){
    foreach($entry in @(Get-ChildItem -LiteralPath 'F:\testavn' -Directory -Force)){
      if(!$entry.Name.StartsWith($prefix,[StringComparison]::Ordinal)){continue}
      $test=Read (Join-Path $entry.FullName 'report.json')
      if($test.status -cnotin @('PASS','FAILED') -or !$test.finishedAt -or $test.cleanup -notmatch '^OWNED_.*STOPPED$'){throw 'Browser run not retired'}
      $taskTargets+=Join-Path $entry.FullName 'temporary'
    }
  }
  foreach($target in $taskTargets){
    $resolved=[IO.Path]::GetFullPath($target)
    if($resolved -cne $target -or !$resolved.StartsWith('F:\testavn\',[StringComparison]::OrdinalIgnoreCase) -or
      $resolved -eq $taskBase -or $resolved -eq $taskRelease){throw 'Inexact or broad target'}
    if(!(Test-Path -LiteralPath $resolved)){continue}
    $files=@(Files $resolved);$bytes=[int64]0;foreach($file in $files){$bytes+=$file.Length}
    Remove-Item -LiteralPath $resolved -Recurse -Force
    if(Test-Path -LiteralPath $resolved){throw 'Target remains'}
    $r.files+=$files.Count;$r.logicalBytes+=$bytes;$r.targets+=@{path=$resolved;files=$files.Count;logicalBytes=$bytes;removed=$true}
  }
  foreach($f in $r.retained){if((Sha $f.path) -cne $f.sha256){throw 'Retained artifact changed'}}
  $r.status='PASS'
}catch{$r.status='FAILED';$r.error=$_.Exception.ToString();throw}
finally{[IO.File]::WriteAllText($taskOutput,($r|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))}
