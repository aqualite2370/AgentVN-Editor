param([switch]$Elevated,[switch]$LeafAccessFollowup)
$ErrorActionPreference='Stop'
$base='F:\testavn\Windows-Isolated-1985-20261116-03'
$output=Join-Path $base $(if($LeafAccessFollowup){'artifact-cleanup-03.json'}else{'artifact-cleanup-02.json'})
if(Test-Path -LiteralPath $output){throw 'Preserve original receipt'}
if(!$Elevated){
  Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList @(
    '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Elevated',
    $(if($LeafAccessFollowup){'-LeafAccessFollowup'}))|Out-Null
  return
}
$principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if(!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Administrator required'}
$qa=@('F:\testavn\Windows-Isolated-1985-20261116-01','F:\testavn\Windows-Isolated-1985-20261116-02',$base)
$release='F:\testavn\Sprite-Animation-Release-1985-20261116-01'
$result=@{status='RUNNING';targets=@();files=0;logicalBytes=[int64]0;physicalFreedBytes='NOT_MEASURED';historicalRejectedScopesTouched=$false}
function Read($p){Get-Content -LiteralPath $p -Raw -Encoding UTF8|ConvertFrom-Json}
function Sha($p){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
function NoLink($p){
  if((Get-Item -LiteralPath $p -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw "Linked path: $p"}
}
try{
  foreach($root in $qa){
    $r=Read "$root\account-retirement-01.json"
    if($r.status -cne 'PASS' -or !$r.cleanup.accountDeleted -or !$r.cleanup.profileDeleted -or
      (Test-Path -LiteralPath $r.account.profile)){throw 'Account retirement incomplete'}
    $archive=Read "$root\qa-sources.json"
    if($archive.status -cne 'PASS' -or @($archive.files).Count -lt 200){throw 'Source archive missing'}
    foreach($f in $archive.files){if((Sha $f.path) -cne $f.sha256){throw 'Source archive mismatch'}}
  }
  $build=Read "$release\release\build.json"
  if((Sha $build.installer.path) -cne $build.installer.sha256){throw 'Frozen installer mismatch'}
  $targets=@("$($qa[0])\qa-temp","$($qa[1])\harness","$($qa[1])\qa-temp",
    "$($qa[1])\resource-01\temporary","$base\harness","$base\qa-temp","$base\resource-01\temporary",
    "$release\temp","$release\release\payload\nsis-payload")
  $live=@(Get-CimInstance Win32_Process)
  foreach($target in $targets){
    if(!(Test-Path -LiteralPath $target)){continue}
    if([IO.Path]::GetFullPath($target) -cne $target -or (Resolve-Path -LiteralPath $target).ProviderPath -cne $target){throw 'Inexact target'}
    if(@($live|Where-Object{$_.ExecutablePath -and $_.ExecutablePath.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)}).Count){throw 'Target executable active'}
    NoLink $target
    $entries=@(Get-ChildItem -LiteralPath $target -Force -Recurse -ErrorAction Stop)
    foreach($e in $entries){NoLink $e.FullName
      if(!$e.FullName.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Escaped target'}}
    $files=@($entries|Where-Object{!$_.PSIsContainer});$bytes=[int64]0
    foreach($f in $files){$bytes+=$f.Length}
    # Prior run enumerated these exact retired-account temps but deletion hit ACL.
    # Grant only this validated, link-free current QA temp tree, never a profile.
    if($target -in @($qa|ForEach-Object{$_+'\qa-temp'})){
      & "$env:SystemRoot\System32\takeown.exe" /F $target /A /R /D Y|Out-Null
      if($LASTEXITCODE -ne 0){throw 'Exact QA temp ownership failed'}
      # PyInstaller leaves contain protected DACLs; inheritable folder-only
      # grants do not grant leaf access. Grant this exact validated tree's files.
      & "$env:SystemRoot\System32\icacls.exe" $target /grant '*S-1-5-32-544:F' /T /Q|Out-Null
      if($LASTEXITCODE -ne 0){throw 'Exact QA temp ACL failed'}
    }
    Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop
    if(Test-Path -LiteralPath $target){throw 'Target remains'}
    $result.targets+=@{path=$target;files=$files.Count;logicalBytes=$bytes;removed=$true}
    $result.files+=$files.Count;$result.logicalBytes+=$bytes
  }
  $result.status='PASS'
}catch{$result.status='FAILED';$result.error=$_.Exception.ToString();throw}
finally{[IO.File]::WriteAllText($output,($result|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))}
