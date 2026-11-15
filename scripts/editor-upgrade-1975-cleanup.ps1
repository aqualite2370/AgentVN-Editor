param([switch]$Elevated)
$ErrorActionPreference='Stop'
$env:PSModulePath=([Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)+'\WindowsPowerShell\Modules;'+$env:WINDIR+'\System32\WindowsPowerShell\v1.0\Modules')
$base='F:\testavn\Windows-Isolated-1975-20261116-02'
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
$r=@{status='RUNNING';startedAt=[datetime]::UtcNow.ToString('o');administrator=$true;targets=@();files=0;logicalBytes=[int64]0;retained=@();aclRepairs=@()}
function Save{[IO.File]::WriteAllText($receipt,($r|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))}
function Children([string]$directory){
  try{return @(Get-ChildItem -LiteralPath $directory -Force -ErrorAction Stop)}
  catch [UnauthorizedAccessException]{
    $full=[IO.Path]::GetFullPath($directory)
    if(!$full.StartsWith("$base\qa-temp\",[StringComparison]::Ordinal) -or
      $full -cnotmatch '^F:\\testavn\\Windows-Isolated-1975-20261116-02\\qa-temp\\_MEI[0-9]+(?:\\.*)?$'){throw}
    $item=Get-Item -LiteralPath $full -Force
    if(!$item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'No link ACL repair'}
    $take=@(& "$env:SystemRoot\System32\takeown.exe" /F $full /A 2>&1)
    if($LASTEXITCODE -ne 0){throw 'Exact directory ownership failed'}
    $grant=@(& "$env:SystemRoot\System32\icacls.exe" $full /grant '*S-1-5-32-544:(OI)(CI)F' /Q 2>&1)
    if($LASTEXITCODE -ne 0){throw 'Exact directory grant failed'}
    $r.aclRepairs+=@{path=$full;recursive=$false};Save
    return @(Get-ChildItem -LiteralPath $full -Force -ErrorAction Stop)
  }
}
try{
  $root=Get-Item -LiteralPath $base -Force
  if($root.FullName -cne $base -or ($root.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Exact non-link base required'}
  $audit=Read "$base\terminal-audit-02.json"
  $run=Read "$base\resource-01\report.json"
  $control=Read "$base\account-controller.json"
  $retired=Read "$base\account-retirement-01.json"
  if($audit.status -cne 'PASS_RECENT_EDITOR_CLOSED_HOST_UPGRADE' -or
    $audit.scope -cne 'REAL_RECENT_EDITOR_UPGRADE_1974_TO_1975_NOT_CROSS_GENERATION_OR_GAME_UPGRADE' -or
    $run.status -cne 'PASS' -or $run.cleanupStatus -cne 'PASS' -or !$run.finishedAt -or
    $control.status -cne 'FINISHED' -or $retired.status -cne 'PASS' -or
    $control.account.sid -cne 'S-1-5-21-2093805479-91935561-747405786-1121' -or
    $control.account.name -cne 'AVNQA4A710FAF' -or
    $retired.account.sid -cne $control.account.sid -or
    !$retired.cleanup.accountDeleted -or !$retired.cleanup.profileDeleted){throw 'Exact completed upgrade and retirement required'}
  if((Get-LocalUser -SID $retired.account.sid -ErrorAction SilentlyContinue) -or
    (Get-CimInstance Win32_UserProfile|Where-Object SID -CEQ $retired.account.sid)){throw 'QA identity remains'}
  if(@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object LocalPort -In @($run.launches|ForEach-Object{$_.ports})).Count){throw 'Owned port remains'}
  $live=@(Get-CimInstance Win32_Process)
  foreach($known in $run.editorKnown){
    if(@($live|Where-Object{$_.ProcessId -eq $known.ProcessId -and $_.CreationDate.ToUniversalTime().ToString('o') -ceq $known.Created}).Count){throw 'Owned process remains'}
  }
  $seal=Read "$base\upgrade-candidate.json"
  foreach($artifact in @($seal.old,$seal.current,$retired.databaseEvidence,$run.oldPortable,$run.newPortable)){
    if((Sha $artifact.path) -cne $artifact.sha256){throw 'Protected artifact differs'}
    $r.retained+=@{path=$artifact.path;sha256=$artifact.sha256}
  }
  foreach($p in @("$base\terminal-audit-01.json","$base\terminal-audit-02.json","$base\resource-01\report.json","$base\account-controller.json","$base\account-retirement-01.json","$base\qa-sources.json")){
    $r.retained+=@{path=$p;sha256=(Sha $p)}
  }
  $sourceSeal=Read "$base\qa-sources.json"
  foreach($file in $sourceSeal.files){if((Sha $file.path) -cne $file.sha256){throw 'Sealed QA source differs'}}
  $targets=@("$base\installed-editor","$base\harness","$base\qa-temp")
  $inventory=[Collections.Generic.List[object]]::new()
  foreach($target in $targets){
    if([IO.Path]::GetFullPath($target) -cne $target -or
      (Resolve-Path -LiteralPath $target).ProviderPath -cne $target -or
      !$target.StartsWith($base+'\',[StringComparison]::Ordinal)){throw 'Resolved target escaped'}
    $item=Get-Item -LiteralPath $target -Force
    if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'No linked root'}
    if(@($live|Where-Object{$_.ExecutablePath -and $_.ExecutablePath.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)}).Count){throw 'Target live'}
    $entry=@{path=$target;files=0;logicalBytes=[int64]0;removed=$false};$r.targets+=,$entry
    $pending=[Collections.Generic.Stack[string]]::new();$pending.Push($target)
    while($pending.Count){
      foreach($child in (Children $pending.Pop())){
        if(!$child.FullName.StartsWith($target+'\',[StringComparison]::Ordinal) -or
          ($child.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Child link or escape'}
        if($child.PSIsContainer){$pending.Push($child.FullName)}
        else{$inventory.Add(@{path=$child.FullName;bytes=[int64]$child.Length});$entry.files++;$entry.logicalBytes+=[int64]$child.Length}
      }
    }
  }
  [IO.File]::WriteAllText("$base\artifact-cleanup-inventory-01.json",($inventory|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
  $temporary="$base\qa-temp"
  $take=@(& "$env:SystemRoot\System32\takeown.exe" /F $temporary /A /R /D Y 2>&1)
  if($LASTEXITCODE -ne 0){throw 'Verified temporary ownership failed'}
  $reset=@(& "$env:SystemRoot\System32\icacls.exe" $temporary /reset /T /Q 2>&1)
  if($LASTEXITCODE -ne 0){throw 'Verified temporary ACL reset failed'}
  $grant=@(& "$env:SystemRoot\System32\icacls.exe" $temporary /grant '*S-1-5-32-544:(OI)(CI)F' /T /Q 2>&1)
  if($LASTEXITCODE -ne 0){throw 'Verified temporary ACL grant failed'}
  $r.aclRepairs+=@{path=$temporary;recursive=$true;verifiedNoLinks=$true};Save
  foreach($entry in $r.targets){
    Remove-Item -LiteralPath $entry.path -Recurse -Force -ErrorAction Stop
    if(Test-Path -LiteralPath $entry.path){throw 'Target remains'}
    $entry.removed=$true;$r.files+=$entry.files;$r.logicalBytes+=$entry.logicalBytes;Save
  }
  foreach($artifact in $r.retained){if((Sha $artifact.path) -cne $artifact.sha256){throw 'Protected artifact changed'}}
  $r.status='PASS'
}catch{$r.status='FAILED';$r.error=$_.Exception.ToString()}
finally{$r.finishedAt=[datetime]::UtcNow.ToString('o');Save}
