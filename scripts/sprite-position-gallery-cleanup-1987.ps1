param([switch]$Elevated)
$ErrorActionPreference='Stop'
$base='F:\testavn\Windows-Isolated-1987-20261117-01'
$release='F:\testavn\Sprite-Position-Gallery-Release-1987-20261117-01'
$workspace='C:\Users\1\.codex\worktrees\editor-motion-diagnosis\AgentVN'
$output=Join-Path $base 'artifact-cleanup.json'
if(Test-Path -LiteralPath $output){throw 'Preserve prior receipt'}
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
function Files($target){
  NoLink $target
  $entries=@(Get-ChildItem -LiteralPath $target -Recurse -Force -ErrorAction Stop)
  foreach($e in $entries){
    NoLink $e.FullName
    if(!$e.FullName.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Escaped target'}
  }
  @($entries|Where-Object{!$_.PSIsContainer})
}
$r=@{status='RUNNING';files=0;logicalBytes=[int64]0;targets=@();retained=@();physicalFreedBytes='NOT_MEASURED';historicalRejectedScopesTouched=$false}
try{
  $audit=Read "$base\functional-audit.json";$retired=Read "$base\account-retirement-02.json";$build=Read "$release\release\build.json"
  if($audit.status -cne 'PASS' -or $retired.status -cne 'PASS' -or !$retired.cleanup.accountDeleted -or
    !$retired.cleanup.profileDeleted -or (Test-Path -LiteralPath $retired.account.profile)){throw 'Acceptance/retirement incomplete'}
  $live=@(Get-CimInstance Win32_Process)
  if(@($live|Where-Object Name -In @('cargo.exe','rustc.exe','makensis.exe')).Count){throw 'Build still active'}
  foreach($f in @($build.installer,$build.dev,$build.player,$build.backend,$build.oldPlayer,$retired.databaseEvidence)){
    if(!$f){continue}
    if((Sha $f.path) -cne $f.sha256){throw 'Retained artifact mismatch'}
    $r.retained+=@{path=$f.path;sha256=$f.sha256}
  }
  $sources="$base\harness\scripts";$archive="$base\qa-sources"
  if(Test-Path -LiteralPath $archive){throw 'Preserve QA archive'}
  $rows=@()
  foreach($f in @(Files $sources)){
    $destination=Join-Path $archive $f.FullName.Substring($sources.Length+1)
    New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force|Out-Null
    Copy-Item -LiteralPath $f.FullName -Destination $destination
    if((Sha $f.FullName) -cne (Sha $destination)){throw 'QA archive mismatch'}
    $rows+=@{path=$destination;sha256=(Sha $destination)}
  }
  if($rows.Count -lt 200){throw 'QA archive incomplete'}
  [IO.File]::WriteAllText("$base\qa-sources.json",(@{status='PASS';files=$rows}|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
  $targets=@("$base\installed-editor","$base\harness","$base\qa-temp","$base\resource-01\temporary",
    "$release\temp","$release\release\payload\nsis-payload")
  foreach($evidence in @(
    'Sprite-Position-Browser-20261117-01','Sprite-Position-Browser-20261117-02',
    'Gallery-Preview-Browser-20261117-02','Gallery-Preview-Browser-20261117-03','Gallery-Preview-Browser-20261117-04'
  )){
    $evidenceRoot=Join-Path 'F:\testavn' $evidence
    $report=Read "$evidenceRoot\report.json"
    if($report.status -cnotin @('PASS','FAILED')){throw 'Browser run not terminal'}
    if($report.cleanup -cnotin @('OWNED_CONTEXT_SERVER_STOPPED','OWNED_BROWSER_SERVER_STOPPED')){throw 'Missing browser cleanup'}
    foreach($part in @('temporary','profile-agentvn-external-preview','profile-agentvn-cartridge-message',
      'profile-renpy-external-preview','profile-renpy-cartridge-message')){
      $targets+=Join-Path $evidenceRoot $part
    }
  }
  foreach($project in @('editor','GameCli_framework')){foreach($profile in @('debug','release')){
    foreach($part in @('deps','incremental','build','.fingerprint')){
      $targets+=Join-Path $workspace "$project\src-tauri\target\$profile\$part"
    }
  }}
  foreach($target in $targets){
    if(!(Test-Path -LiteralPath $target)){continue}
    if([IO.Path]::GetFullPath($target) -cne $target -or (Resolve-Path -LiteralPath $target).ProviderPath -cne $target){throw 'Inexact target'}
    NoLink $target
    if(@($live|Where-Object{$_.ExecutablePath -and $_.ExecutablePath.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)}).Count){throw 'Target still active'}
    if($target -ceq "$base\qa-temp"){
      $pending=[Collections.Generic.Queue[string]]::new();$pending.Enqueue($target)
      while($pending.Count){
        $item=$pending.Dequeue();NoLink $item
        if($item -cne $target -and !$item.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Escaped QA temp'}
        & "$env:SystemRoot\System32\takeown.exe" /F $item /A|Out-Null
        if($LASTEXITCODE -ne 0){throw 'Exact QA item ownership failed'}
        & "$env:SystemRoot\System32\icacls.exe" $item /grant '*S-1-5-32-544:F' /Q|Out-Null
        if($LASTEXITCODE -ne 0){throw 'Exact QA item ACL failed'}
        if((Get-Item -LiteralPath $item -Force).PSIsContainer){
          foreach($child in @(Get-ChildItem -LiteralPath $item -Force)){$pending.Enqueue($child.FullName)}
        }
      }
    }
    $files=@(Files $target);$bytes=[int64]0;foreach($f in $files){$bytes+=$f.Length}
    Remove-Item -LiteralPath $target -Recurse -Force
    if(Test-Path -LiteralPath $target){throw 'Target remains'}
    $r.files+=$files.Count;$r.logicalBytes+=$bytes;$r.targets+=@{path=$target;removed=$true;files=$files.Count;logicalBytes=$bytes}
  }
  foreach($pair in @(
    @($build.sourceInstaller.path,$build.installer),
    @((Join-Path $workspace 'editor\src-tauri\target\release\bundle\nsis\AgentVN Editor_1.9.87_x64-setup.exe'),$build.installer)
  )){
    $file=[string]$pair[0];$copy=$pair[1]
    if(!(Test-Path -LiteralPath $file)){continue}
    if([IO.Path]::GetFullPath($file) -cne $file){throw 'Inexact duplicate path'};NoLink $file
    if((Sha $file) -cne $copy.sha256 -or (Sha $copy.path) -cne $copy.sha256){throw 'Unverified duplicate'}
    $length=(Get-Item -LiteralPath $file).Length;Remove-Item -LiteralPath $file -Force
    $r.files++;$r.logicalBytes+=$length;$r.targets+=@{path=$file;removed=$true;files=1;logicalBytes=$length}
  }
  foreach($f in $r.retained){if((Sha $f.path) -cne $f.sha256){throw 'Retained bytes changed'}}
  $r.status='PASS'
}catch{$r.status='FAILED';$r.error=$_.Exception.ToString();throw}
finally{[IO.File]::WriteAllText($output,($r|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))}
