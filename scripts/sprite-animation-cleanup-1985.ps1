param([switch]$Elevated)
$ErrorActionPreference='Stop'
$base='F:\testavn\Windows-Isolated-1985-20261116-03'
$authorBase='F:\testavn\Windows-Isolated-1985-20261116-02'
$prior='F:\testavn\Windows-Isolated-1985-20261116-01'
$release='F:\testavn\Sprite-Animation-Release-1985-20261116-01'
$workspace='C:\Users\1\.codex\worktrees\editor-motion-diagnosis\AgentVN'
$output=Join-Path $base 'artifact-cleanup.json'
if(Test-Path -LiteralPath $output){throw 'Preserve prior cleanup receipt'}
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
  if((Get-Item -LiteralPath $file -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw "Linked target: $file"}
}
function Files($directory){
  $pending=[Collections.Generic.Stack[string]]::new();$pending.Push($directory)
  while($pending.Count){
    $current=$pending.Pop();NoLink $current
    try{$children=@(Get-ChildItem -LiteralPath $current -Force -ErrorAction Stop)}
    catch [UnauthorizedAccessException]{
      if(!$current.StartsWith($base+'\qa-temp',[StringComparison]::Ordinal) -and
        !$current.StartsWith($authorBase+'\qa-temp',[StringComparison]::Ordinal) -and
        !$current.StartsWith($prior+'\qa-temp',[StringComparison]::Ordinal)){throw}
      & "$env:SystemRoot\System32\takeown.exe" /F $current /A|Out-Null
      if($LASTEXITCODE -ne 0){throw 'Exact current temp ownership failed'}
      & "$env:SystemRoot\System32\icacls.exe" $current /grant '*S-1-5-32-544:(OI)(CI)F' /Q|Out-Null
      if($LASTEXITCODE -ne 0){throw 'Exact current temp access failed'}
      $children=@(Get-ChildItem -LiteralPath $current -Force -ErrorAction Stop)
    }
    foreach($child in $children){
      NoLink $child.FullName
      if(!$child.FullName.StartsWith($directory+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Escaped target'}
      if($child.PSIsContainer){$pending.Push($child.FullName)}else{$child}
    }
  }
}
$result=@{status='RUNNING';startedAt=[datetime]::UtcNow.ToString('o');targets=@();retained=@();
  files=0;logicalBytes=[int64]0;physicalFreedBytes='NOT_MEASURED';historicalRejectedScopesTouched=$false}
try{
  $audit=Read "$base\functional-audit-02.json";$run=Read "$base\resource-01\report.json"
  $build=Read "$release\release\build.json";$retired=Read "$base\account-retirement-01.json"
  if($audit.status -cne 'PASS' -or @($audit.groups).Count -ne 5 -or $run.status -cne 'PASS' -or
    $run.cleanupStatus -cne 'PASS' -or @($run.cases).Count -ne 2 -or $build.version -cne '1.9.85' -or
    $retired.status -cne 'PASS' -or !$retired.cleanup.accountDeleted -or !$retired.cleanup.profileDeleted){throw 'Acceptance incomplete'}
  if(Test-Path -LiteralPath $retired.account.profile){throw 'QA profile remains'}
  $live=@(Get-CimInstance Win32_Process)
  if(@($live|Where-Object Name -In @('cargo.exe','rustc.exe','makensis.exe')).Count){throw 'Build process remains'}
  $original=Read "$prior\resource-01\report.json"
  $oldRetired=Read "$prior\account-retirement-01.json"
  $authorRun=Read "$authorBase\resource-01\report.json"
  $authorRetired=Read "$authorBase\account-retirement-01.json"
  if($original.status -cne 'FAILED' -or $oldRetired.status -cne 'PASS' -or
    !$oldRetired.cleanup.accountDeleted -or !$oldRetired.cleanup.profileDeleted -or $authorRetired.status -cne 'PASS' -or
    !$authorRetired.cleanup.accountDeleted -or !$authorRetired.cleanup.profileDeleted){throw 'Original evidence or retirement missing'}
  $ports=@(@($run.launches)+@($authorRun.launches)+@($original.launches)|ForEach-Object{if($_.ports){$_.ports}else{$_.port}})
  if(@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object LocalPort -In $ports).Count){throw 'Owned listener remains'}
  foreach($known in @($run.knownProcesses)+@($authorRun.editorKnown)+@($authorRun.knownProcesses)+@($original.editorKnown)){
    if(@($live|Where-Object{$_.ProcessId -eq $known.ProcessId -and $_.CreationDate.ToUniversalTime().ToString('o') -ceq $known.Created}).Count){throw 'Owned process remains'}
  }
  foreach($qaRoot in @($base,$authorBase,$prior)){
  $sources=Join-Path $qaRoot 'harness\scripts';$archive=Join-Path $qaRoot 'qa-sources'
  if(Test-Path -LiteralPath $archive){throw 'Preserve source archive'}
  $rows=@()
  foreach($source in @(Files $sources)){
    $relative=$source.FullName.Substring($sources.Length+1);$target=Join-Path $archive $relative
    New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force|Out-Null
    Copy-Item -LiteralPath $source.FullName -Destination $target
    if((Sha $target) -cne (Sha $source.FullName)){throw 'Archive bytes differ'}
    $rows+=@{path=$target;sha256=(Sha $target)}
  }
  if($rows.Count -lt 200){throw 'Incomplete source archive'}
  [IO.File]::WriteAllText("$qaRoot\qa-sources.json",(@{status='PASS';files=$rows}|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
  $result.retained+=@{path="$qaRoot\qa-sources.json";sha256=(Sha "$qaRoot\qa-sources.json")}
  }
  foreach($file in @($build.installer,$build.dev,$build.player,$build.backend,$authorRetired.databaseEvidence)+@($authorRun.exports)+@($run.screenshots)){
    if((Sha $file.path) -cne $file.sha256){throw 'Retained artifact bytes differ'}
    $result.retained+=@{path=$file.path;sha256=$file.sha256}
  }
  foreach($file in @("$base\functional-audit-02.json","$base\functional-audit.json","$base\resource-01\report.json","$authorBase\resource-01\authored.vnproj",
    "$base\account-retirement-01.json","$authorBase\resource-01\report.json","$authorBase\account-retirement-01.json",
    "$prior\resource-01\report.json","$prior\verified-qa-default.db",
    "$prior\account-retirement-01.json","$release\checkpoint.json","$release\release\build.json")){
    $result.retained+=@{path=$file;sha256=(Sha $file)}
  }
  $targets=@("$prior\installed-editor","$prior\harness","$prior\qa-temp","$authorBase\harness","$authorBase\qa-temp",
    "$authorBase\resource-01\temporary","$base\harness","$base\qa-temp","$base\resource-01\temporary",
    "$release\temp","$release\release\payload\nsis-payload")
  foreach($profile in @('debug','release')){
    foreach($part in @('deps','incremental','build','.fingerprint')){
      $targets+=Join-Path $workspace "editor\src-tauri\target\$profile\$part"
    }
  }
  foreach($target in $targets){
    if(!(Test-Path -LiteralPath $target)){continue}
    if([IO.Path]::GetFullPath($target) -cne $target -or (Resolve-Path -LiteralPath $target).ProviderPath -cne $target){throw 'Target not exact'}
    NoLink $target
    if(@($live|Where-Object{$_.ExecutablePath -and $_.ExecutablePath.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)}).Count){throw 'Target executable remains'}
    $entries=@(Files $target);$bytes=[int64]0;foreach($entry in $entries){$bytes+=$entry.Length}
    $result.targets+=@{path=$target;files=$entries.Count;logicalBytes=$bytes;removed=$false}
  }
  foreach($entry in $result.targets){
    Remove-Item -LiteralPath $entry.path -Recurse -Force -ErrorAction Stop
    if(Test-Path -LiteralPath $entry.path){throw 'Target remains'}
    $entry.removed=$true;$result.files+=$entry.files;$result.logicalBytes+=$entry.logicalBytes
  }
  foreach($file in @($build.sourceInstaller.path,(Join-Path $workspace 'editor\src-tauri\target\release\bundle\nsis\AgentVN Editor_1.9.85_x64-setup.exe'))){
    if(!(Test-Path -LiteralPath $file)){continue}
    if([IO.Path]::GetFullPath($file) -cne $file){throw 'Duplicate target not exact'}
    NoLink $file
    if((Sha $file) -cne $build.installer.sha256){throw 'Duplicate has no verified retained copy'}
    $bytes=(Get-Item -LiteralPath $file).Length
    Remove-Item -LiteralPath $file -Force -ErrorAction Stop
    $result.targets+=@{path=$file;files=1;logicalBytes=$bytes;removed=$true}
    $result.files++;$result.logicalBytes+=$bytes
  }
  foreach($file in $result.retained){if((Sha $file.path) -cne $file.sha256){throw 'Retained evidence changed'}}
  $result.status='PASS'
}catch{$result.status='FAILED';$result.error=$_.Exception.ToString();throw}
finally{
  $result.finishedAt=[datetime]::UtcNow.ToString('o')
  [IO.File]::WriteAllText($output,($result|ConvertTo-Json -Depth 9),[Text.UTF8Encoding]::new($false))
}
