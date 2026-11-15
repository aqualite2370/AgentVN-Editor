param([switch]$Elevated,[switch]$HomeOrdering)
$ErrorActionPreference='Stop'
$env:PSModulePath=([Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)+'\WindowsPowerShell\Modules;'+$env:WINDIR+'\System32\WindowsPowerShell\v1.0\Modules')
$base='F:\testavn\Windows-Isolated-1976-20261116-05'
$prior='F:\testavn\Windows-Isolated-1976-20261116-01'
$prep='F:\testavn\Windows-Isolated-1976-20261116-02'
$failedFollowup='F:\testavn\Windows-Isolated-1976-20261116-03'
$metadataFollowup='F:\testavn\Windows-Isolated-1976-20261116-04'
$release='F:\testavn\Editor-Autosave-Release-1976-20261116-01'
if($HomeOrdering){
  $base='F:\testavn\Windows-Isolated-1977-20261116-02'
  $prior='F:\testavn\Windows-Isolated-1977-20261116-01'
  $release='F:\testavn\Editor-Home-Save-Release-1977-20261116-01'
}
$sessions=if($HomeOrdering){@($prior,$base)}else{@($prior,$failedFollowup,$metadataFollowup,$base)}
$roots=if($HomeOrdering){@($prior,$base,$release)}else{@($base,$prior,$prep,$failedFollowup,$metadataFollowup,$release)}
$browserBase='F:\testavn\Editor-Home-Save-Ordering-20261116-01'
if($HomeOrdering){$roots+=,$browserBase}
$receipt=Join-Path $base 'artifact-cleanup-01.json'
if(Test-Path -LiteralPath $receipt){throw 'Preserve cleanup evidence'}
$admin=([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if(!$Elevated){
  if($admin){throw 'Ordinary origin required'}
  $arguments=@('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Elevated')
  if($HomeOrdering){$arguments+='-HomeOrdering'}
  Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList $arguments|Out-Null
  return
}
if(!$admin){throw 'Actual administrator required'}
function Read($p){Get-Content -LiteralPath $p -Raw -Encoding UTF8|ConvertFrom-Json}
function Sha($p){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
$r=@{status='RUNNING';startedAt=[datetime]::UtcNow.ToString('o');administrator=$true;targets=@();files=0;logicalBytes=[int64]0;retained=@();aclRepairs=@();oldRejectedProfilesTouched=$false}
function Save{[IO.File]::WriteAllText($receipt,($r|ConvertTo-Json -Depth 16),[Text.UTF8Encoding]::new($false))}
function Children([string]$directory){
  try{return @(Get-ChildItem -LiteralPath $directory -Force -ErrorAction Stop)}
  catch [UnauthorizedAccessException]{
    $full=[IO.Path]::GetFullPath($directory)
    $ownedTemporary=if($HomeOrdering){$full -cmatch '^F:\\testavn\\Windows-Isolated-1977-20261116-0[12]\\qa-temp\\_MEI[0-9]+(?:\\.*)?$'}
      else{$full -cmatch '^F:\\testavn\\Windows-Isolated-1976-20261116-0[1345]\\qa-temp\\_MEI[0-9]+(?:\\.*)?$'}
    if(!$ownedTemporary){throw}
    $item=Get-Item -LiteralPath $full -Force
    if(!$item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'No link ACL repair'}
    & "$env:SystemRoot\System32\takeown.exe" /F $full /A|Out-Null
    if($LASTEXITCODE -ne 0){throw 'Exact temporary directory ownership failed'}
    & "$env:SystemRoot\System32\icacls.exe" $full /grant '*S-1-5-32-544:(OI)(CI)F' /Q|Out-Null
    if($LASTEXITCODE -ne 0){throw 'Exact temporary directory grant failed'}
    $r.aclRepairs+=@{path=$full;recursive=$false};Save
    return @(Get-ChildItem -LiteralPath $full -Force -ErrorAction Stop)
  }
}
try{
  foreach($exact in $roots){
    if((Resolve-Path -LiteralPath $exact).ProviderPath -cne $exact -or
      ((Get-Item -LiteralPath $exact -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Exact non-link root required'}
  }
  $audit=Read "$base\terminal-audit-01.json"
  $expectedAudit=if($HomeOrdering){'PASS_INSTALLED_HOME_SAVE_ORDERING_AND_DEFAULT_PROFILE_RESTART'}else{'PASS_TARGETED_REUSED_INSTALL_DEFAULT_PROFILE_METADATA_RECOVERY'}
  if($audit.status -cne $expectedAudit){throw 'Completed exact functional audit required'}
  foreach($session in $sessions){
    $run=Read "$session\resource-01\report.json"
    $control=Read "$session\account-controller.json"
    $retiredPath=if($HomeOrdering -and $session -ceq $prior){"$session\account-retirement-02.json"}else{"$session\account-retirement-01.json"}
    $retired=Read $retiredPath
    if($control.status -cne 'FINISHED' -or !$control.account.createdByThisRun -or
      $retired.status -cne 'PASS' -or !$retired.cleanup.accountDeleted -or !$retired.cleanup.profileDeleted -or
      $retired.account.sid -cne $control.account.sid){throw 'Owned lifecycle not retired'}
    if($HomeOrdering -and $session -ceq $prior){
      if($run.status -cne 'FAILED' -or $retired.functionalStatus -cne 'FAILED' -or
        $run.error -notmatch 'strict mode violation' -or
        (Sha "$session\resource-01\report.json") -cne $retired.originalFailure.sha256){throw 'Original failed cleanup evidence differs'}
    }elseif(!$run.finishedAt -or $run.cleanupStatus -cne 'PASS'){throw 'Owned product cleanup not terminal'}
    if((Get-LocalUser -SID $control.account.sid -ErrorAction SilentlyContinue) -or
      (Get-CimInstance Win32_UserProfile|Where-Object SID -CEQ $control.account.sid)){throw 'QA identity remains'}
    if(@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object LocalPort -In @($run.launches|ForEach-Object{$_.ports})).Count){throw 'Owned port remains'}
    $live=@(Get-CimInstance Win32_Process)
    foreach($known in $run.editorKnown){
      if(@($live|Where-Object{$_.ProcessId -eq $known.ProcessId -and $_.CreationDate.ToUniversalTime().ToString('o') -ceq $known.Created}).Count){throw 'Owned process remains'}
    }
    foreach($artifact in @($retired.databaseEvidence)){
      if((Sha $artifact.path) -cne $artifact.sha256){throw 'Retained database differs'}
      $r.retained+=@{path=$artifact.path;sha256=$artifact.sha256}
    }
    foreach($file in @('resource-01\report.json','account-controller.json','account-retirement-01.json')){
      $p=Join-Path $session $file;$r.retained+=@{path=$p;sha256=(Sha $p)}
    }
    $source=Read "$session\qa-sources.json"
    foreach($file in $source.files){if((Sha $file.path) -cne $file.sha256){throw 'Archived QA source differs'}}
  }
  if(!$HomeOrdering){
  if((Test-Path -LiteralPath "$prep\account-controller.json") -or (Test-Path -LiteralPath "$prep\elevation-request.json") -or
    (Read "$prep\preflight-failure-01.json").accountsCreated -ne 0){throw 'Unexpected preparation lifecycle'}
  $source=Read "$prep\qa-sources.json"
  foreach($file in $source.files){if((Sha $file.path) -cne $file.sha256){throw 'Failed preparation source differs'}}
  }
  $build=Read "$release\release\build.json"
  foreach($artifact in @($build.installer,$build.sourceInstaller,$build.payloadReport,$build.dev,$build.source)){
    if((Sha $artifact.path) -cne $artifact.sha256){throw 'Protected release differs'}
    $r.retained+=@{path=$artifact.path;sha256=$artifact.sha256}
  }
  $targets=@("$prior\installed-editor","$prior\harness","$prior\qa-temp","$prep\harness","$failedFollowup\harness","$failedFollowup\qa-temp","$metadataFollowup\harness","$metadataFollowup\qa-temp","$base\harness","$base\qa-temp","$release\release\payload\nsis-payload")
  if($HomeOrdering){
    $targets=@("$prior\installed-editor","$prior\harness","$prior\qa-temp","$base\harness","$base\qa-temp","$release\release\payload\nsis-payload")
    foreach($name in @('before-01','before-home-01','after-home-01','after-autosave-01')){
      $reportPath="$browserBase\$name\report.json";$browser=Read $reportPath
      if(!$browser.finishedAt -or $browser.cleanupStatus -cne 'PROCESSES_STOPPED_TEMP_PENDING'){throw 'Browser lifecycle incomplete'}
      $ports=@(([uri]$browser.service.url).Port,([uri]$browser.service.backendUrl).Port)
      if(@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object LocalPort -In $ports).Count){throw 'Browser test service remains'}
      $r.retained+=@{path=$reportPath;sha256=(Sha $reportPath)}
      $targets+=,"$browserBase\$name\temp"
    }
  }
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
  [IO.File]::WriteAllText("$base\artifact-cleanup-inventory-01.json",($inventory|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
  $temporaryRoots=if($HomeOrdering){@("$prior\qa-temp","$base\qa-temp")}else{@("$prior\qa-temp","$failedFollowup\qa-temp","$metadataFollowup\qa-temp","$base\qa-temp")}
  foreach($temporary in $temporaryRoots){
    & "$env:SystemRoot\System32\takeown.exe" /F $temporary /A /R /D Y|Out-Null
    if($LASTEXITCODE -ne 0){throw 'Verified temporary ownership failed'}
    & "$env:SystemRoot\System32\icacls.exe" $temporary /reset /T /Q|Out-Null
    if($LASTEXITCODE -ne 0){throw 'Verified temporary ACL reset failed'}
    & "$env:SystemRoot\System32\icacls.exe" $temporary /grant '*S-1-5-32-544:(OI)(CI)F' /T /Q|Out-Null
    if($LASTEXITCODE -ne 0){throw 'Verified temporary ACL grant failed'}
    $r.aclRepairs+=@{path=$temporary;recursive=$true;verifiedNoLinks=$true}
  }
  foreach($entry in $r.targets){
    Remove-Item -LiteralPath $entry.path -Recurse -Force -ErrorAction Stop
    if(Test-Path -LiteralPath $entry.path){throw 'Target remains'}
    $entry.removed=$true;$r.files+=$entry.files;$r.logicalBytes+=$entry.logicalBytes;Save
  }
  foreach($artifact in $r.retained){if((Sha $artifact.path) -cne $artifact.sha256){throw 'Protected artifact changed'}}
  $r.status='PASS'
}catch{$r.status='FAILED';$r.error=$_.Exception.ToString()}
finally{$r.finishedAt=[datetime]::UtcNow.ToString('o');Save}
