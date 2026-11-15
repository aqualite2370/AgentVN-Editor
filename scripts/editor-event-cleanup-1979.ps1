param([switch]$Elevated)
$ErrorActionPreference='Stop'
$env:PSModulePath=([Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)+'\WindowsPowerShell\Modules;'+$env:WINDIR+'\System32\WindowsPowerShell\v1.0\Modules')
$base='F:\testavn\Windows-Isolated-1979-20261116-03'
$sessions=@('F:\testavn\Windows-Isolated-1979-20261116-01','F:\testavn\Windows-Isolated-1979-20261116-02',$base)
$release='F:\testavn\Editor-Event-Release-1979-20261116-01'
$receipt=Join-Path $base 'artifact-cleanup-01.json'
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
function Keep($artifact){
  if((Sha $artifact.path) -cne $artifact.sha256){throw 'Protected artifact differs'}
  $r.retained+=@{path=$artifact.path;sha256=$artifact.sha256}
}
function Children([string]$directory){
  try{return @(Get-ChildItem -LiteralPath $directory -Force -ErrorAction Stop)}
  catch [UnauthorizedAccessException]{
    $full=[IO.Path]::GetFullPath($directory)
    if($full -cnotmatch '^F:\\testavn\\Windows-Isolated-1979-20261116-0[123]\\qa-temp\\_MEI[0-9]+(?:\\.*)?$'){throw}
    $item=Get-Item -LiteralPath $full -Force
    if(!$item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'No linked ACL repair'}
    & "$env:SystemRoot\System32\takeown.exe" /F $full /A|Out-Null
    if($LASTEXITCODE -ne 0){throw 'Exact temporary directory ownership failed'}
    & "$env:SystemRoot\System32\icacls.exe" $full /grant '*S-1-5-32-544:(OI)(CI)F' /Q|Out-Null
    if($LASTEXITCODE -ne 0){throw 'Exact temporary directory grant failed'}
    $r.aclRepairs+=@{path=$full;recursive=$false};Save
    return @(Get-ChildItem -LiteralPath $full -Force -ErrorAction Stop)
  }
}
try{
  foreach($exact in @($sessions)+@($release)){
    if((Resolve-Path -LiteralPath $exact).ProviderPath -cne $exact -or
      ((Get-Item -LiteralPath $exact -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Exact non-link root required'}
  }
  if((Read "$base\terminal-audit-01.json").status -cne 'PASS_INSTALLED_EVENT_EDITS_NATIVE_TIMELINE_AND_DEFAULT_PROFILE_RESTART'){throw 'Functional audit incomplete'}
  $live=@(Get-CimInstance Win32_Process)
  foreach($session in $sessions){
    $owner=Read "$session\account-controller.json";$retired=Read "$session\account-retirement-01.json"
    $run=Read "$session\resource-01\report.json";$archive=Read "$session\qa-sources.json"
    $expected=if($session -ceq $base){'PASS'}else{'FAILED'}
    if($run.status -cne $expected -or !$run.finishedAt -or $run.cleanupStatus -cne 'PASS' -or
      $owner.status -cne 'FINISHED' -or !$owner.account.createdByThisRun -or
      $retired.status -cne 'PASS' -or !$retired.cleanup.accountDeleted -or !$retired.cleanup.profileDeleted -or
      $retired.account.sid -cne $owner.account.sid -or $archive.status -cne 'PASS' -or !$archive.files.Count){throw 'Owned lifecycle or QA source archive incomplete'}
    if($session -ceq $sessions[0] -and $run.stages[2].error -notmatch 'command-card-summary'){throw 'Original failure differs'}
    if($session -ceq $sessions[1] -and $run.stages[4].error -notmatch 'exact newer graph'){throw 'Partial failure differs'}
    if((Get-LocalUser -SID $owner.account.sid -ErrorAction SilentlyContinue) -or
      (Get-CimInstance Win32_UserProfile|Where-Object SID -CEQ $owner.account.sid) -or
      (Test-Path -LiteralPath $retired.account.profile)){throw 'QA identity remains'}
    if(@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object LocalPort -In @($run.launches|ForEach-Object{$_.ports})).Count){throw 'Owned port remains'}
    foreach($known in $run.editorKnown){
      if(@($live|Where-Object{$_.ProcessId -eq $known.ProcessId -and $_.CreationDate.ToUniversalTime().ToString('o') -ceq $known.Created}).Count){throw 'Owned process remains'}
    }
    foreach($file in @($archive.files)+@($retired.databaseEvidence)){Keep $file}
    foreach($name in @('resource-01\report.json','account-controller.json','account-retirement-01.json','qa-sources.json')){
      $p=Join-Path $session $name;Keep @{path=$p;sha256=(Sha $p)}
    }
    foreach($file in $run.backupEvidence){Keep $file;Keep $file.metadata}
  }
  $capture=Read "$($sessions[1])\backup-diagnostic-01.json"
  if($capture.status -cne 'PASS_CAPTURE_ONLY_NOT_PRODUCT_ASSERTION'){throw 'Native failure evidence missing'}
  foreach($file in $capture.files){Keep $file}
  $build=Read "$release\release\build.json";$checkpoint=Read "$release\checkpoint.json"
  foreach($artifact in @($build.installer,$build.sourceInstaller,$build.payloadReport,$build.dev,$build.source,$checkpoint.daily,$checkpoint.frozenPrevious)){
    Keep $artifact
  }
  $targets=@("$($sessions[0])\installed-editor","$release\release\payload\nsis-payload")
  foreach($session in $sessions){$targets+=@("$session\harness","$session\qa-temp")}
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
  foreach($session in $sessions){
    $temporary="$session\qa-temp"
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
