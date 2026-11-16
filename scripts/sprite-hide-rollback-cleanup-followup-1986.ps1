param([switch]$Elevated)
$ErrorActionPreference='Stop'
$base='F:\testavn\Windows-Isolated-1986-20261117-03'
$release='F:\testavn\Sprite-Hide-Rollback-Release-1986-20261117-01'
$workspace='C:\Users\1\.codex\worktrees\editor-motion-diagnosis\AgentVN'
$output=Join-Path $base 'artifact-cleanup-02.json'
if(Test-Path -LiteralPath $output){throw 'Preserve receipt'}
if(!$Elevated){
  Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList @(
    '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Elevated')|Out-Null
  return
}
if(!([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Administrator required'}
function Read($f){Get-Content -LiteralPath $f -Raw -Encoding UTF8|ConvertFrom-Json}
function Sha($f){(Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLowerInvariant()}
function NoLink($f){if((Get-Item -LiteralPath $f -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw "Linked path: $f"}}
$r=@{status='RUNNING';files=0;logicalBytes=[int64]0;targets=@();retained=@();physicalFreedBytes='NOT_MEASURED';historicalRejectedScopesTouched=$false}
try{
  if((Read "$base\artifact-cleanup.json").status -cne 'FAILED'){throw 'Follow up original failure only'}
  if((Read "$base\functional-audit.json").status -cne 'PASS'){throw 'Acceptance incomplete'}
  $build=Read "$release\release\build.json"
  foreach($f in @($build.installer,$build.dev,$build.player,$build.backend)){
    if((Sha $f.path) -cne $f.sha256){throw 'Retained artifact mismatch'}
    $r.retained+=@{path=$f.path;sha256=$f.sha256}
  }
  $targets=@()
  foreach($qaRoot in @('F:\testavn\Windows-Isolated-1986-20261117-01','F:\testavn\Windows-Isolated-1986-20261117-02',$base)){
    $retired=Read "$qaRoot\account-retirement-01.json"
    if($retired.status -cne 'PASS' -or !$retired.cleanup.accountDeleted -or !$retired.cleanup.profileDeleted -or
      (Test-Path -LiteralPath $retired.account.profile)){throw 'Account retirement incomplete'}
    $archive=Read "$qaRoot\qa-sources.json"
    if($archive.status -cne 'PASS' -or @($archive.files).Count -lt 200){throw 'Source archive incomplete'}
    foreach($f in $archive.files){if((Sha $f.path) -cne $f.sha256){throw 'Source archive mismatch'}}
    $targets+=@("$qaRoot\installed-editor","$qaRoot\harness","$qaRoot\qa-temp","$qaRoot\resource-01\temporary")
  }
  $targets+=@("$release\temp","$release\temp-02","$release\temp-03","$release\release\payload\nsis-payload")
  foreach($project in @('editor','GameCli_framework')){
    foreach($profile in @('debug','release')){
      foreach($part in @('deps','incremental','build','.fingerprint')){
        $targets+=Join-Path $workspace "$project\src-tauri\target\$profile\$part"
      }
    }
  }
  $live=@(Get-CimInstance Win32_Process)
  if(@($live|Where-Object Name -In @('cargo.exe','rustc.exe','makensis.exe')).Count){throw 'Build active'}
  foreach($target in $targets){
    if(!(Test-Path -LiteralPath $target)){continue}
    if([IO.Path]::GetFullPath($target) -cne $target -or (Resolve-Path -LiteralPath $target).ProviderPath -cne $target){throw 'Inexact target'}
    NoLink $target
    if(@($live|Where-Object{$_.ExecutablePath -and $_.ExecutablePath.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)}).Count){throw 'Target executable active'}
    if($target -match '^F:\\testavn\\Windows-Isolated-1986-20261117-0[123]\\qa-temp$'){
      # Walk without following links, granting only each already-validated item.
      # PyInstaller's protected leaf DACL may block enumeration before cleanup.
      $pending=[Collections.Generic.Queue[string]]::new()
      $pending.Enqueue($target)
      while($pending.Count){
        $itemPath=$pending.Dequeue()
        NoLink $itemPath
        if($itemPath -cne $target -and !$itemPath.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Escaped target'}
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
    foreach($e in $entries){NoLink $e.FullName
      if(!$e.FullName.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Escaped target'}}
    $files=@($entries|Where-Object{!$_.PSIsContainer});$bytes=[int64]0
    foreach($f in $files){$bytes+=$f.Length}
    Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop
    if(Test-Path -LiteralPath $target){throw 'Target remains'}
    $r.targets+=@{path=$target;files=$files.Count;logicalBytes=$bytes;removed=$true}
    $r.files+=$files.Count;$r.logicalBytes+=$bytes
  }
  $old=Read 'F:\testavn\Sprite-Animation-Release-1985-20261116-01\release\build.json'
  foreach($pair in @(
    @($build.sourceInstaller.path,$build.installer),
    @((Join-Path $workspace 'editor\src-tauri\target\release\bundle\nsis\AgentVN Editor_1.9.86_x64-setup.exe'),$build.installer),
    @($old.sourceInstaller.path,$old.installer)
  )){
    $file=[string]$pair[0];$retained=$pair[1]
    if(!(Test-Path -LiteralPath $file)){continue}
    if([IO.Path]::GetFullPath($file) -cne $file){throw 'Inexact duplicate'}
    NoLink $file
    if((Sha $file) -cne $retained.sha256 -or (Sha $retained.path) -cne $retained.sha256){throw 'Duplicate not verified'}
    $bytes=(Get-Item -LiteralPath $file).Length
    Remove-Item -LiteralPath $file -Force -ErrorAction Stop
    $r.files++;$r.logicalBytes+=$bytes;$r.targets+=@{path=$file;files=1;logicalBytes=$bytes;removed=$true}
  }
  foreach($f in $r.retained){if((Sha $f.path) -cne $f.sha256){throw 'Retained bytes changed'}}
  $r.status='PASS'
}catch{$r.status='FAILED';$r.error=$_.Exception.ToString();throw}
finally{[IO.File]::WriteAllText($output,($r|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))}
