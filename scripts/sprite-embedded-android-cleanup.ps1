param([switch]$Elevated,[switch]$RenpyFollowup)
$ErrorActionPreference='Stop'
$base='F:\testavn\Sprite-Embedded-Android-1975-20261116-01'
$receipt=Join-Path $base 'artifact-cleanup-01.json'
function Read($f){Get-Content -LiteralPath $f -Raw -Encoding UTF8|ConvertFrom-Json}
function Sha($f){(Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLowerInvariant()}
function WriteJson($f,$v){[IO.File]::WriteAllText($f,($v|ConvertTo-Json -Depth 15),[Text.UTF8Encoding]::new($false))}
if(Test-Path -LiteralPath $receipt){throw 'Keep prior cleanup evidence'}
$admin=([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if(!$Elevated){
  if($admin){throw 'Ordinary origin required'}
  $arguments=@('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Elevated')
  if($RenpyFollowup){$arguments+='-RenpyFollowup'}
  Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList $arguments|Out-Null
  return
}
if(!$admin){throw 'Actual administrator required'}
$r=@{status='RUNNING';startedAt=[datetime]::UtcNow.ToString('o');administrator=$true;links=@();targets=@();retained=@();files=0;logicalBytes=0L}
function Save{WriteJson $receipt $r}
try{
  $root=Get-Item -LiteralPath $base -Force
  if($root.FullName -cne $base -or ($root.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Exact non-link root required'}
  $prep=Read "$base\preparation.json"
  $build=Read "$base\administrator.json"
  $audit=Read "$base\package-audit-01.json"
  $deviceName=if($RenpyFollowup){'device-02'}else{'device-01'}
  $r.device=$deviceName
  $device=Read "$base\$deviceName\report.json"
  $launcher=Read "$base\$deviceName\launcher.json"
  $deviceCleanup=Read "$base\$deviceName\cleanup.json"
  if($RenpyFollowup){
    $original=Read "$base\device-01\report.json"
    $originalCleanup=Read "$base\device-01\cleanup.json"
    if($original.status -cne 'FAILED' -or $original.error -notmatch 'Retained sprite changed size between counts' -or
      $originalCleanup.status -cne 'PASS_EXACT_AVD_TEMP_REMOVED_REPORTS_APKS_RETAINED' -or
      $device.inheritedDefaultComplete.originalTotalStatus -cne 'FAILED' -or
      $device.inheritedDefaultComplete.case.status -cne 'PASS' -or
      (Sha "$base\device-01\report.json") -cne $device.inheritedDefaultComplete.sha256){throw 'Exact original failed report and passing default case required'}
  }
  if($build.status -cne 'PASS_TWO_INSTALLED_RESOURCE_APK_BUILDS_DEVICE_PENDING' -or !$build.finishedAt -or
    $audit.status -cne 'PASS_TWO_EMBEDDED_UI_AUTHOR_CARTRIDGES_FOUR_ABIS_SPRITE_PIXELS_DEVICE_PENDING' -or
    !$device.finishedAt -or $device.cleanup -cne 'PROCESS_PACKAGE_PORT_RETIREMENT_AWAITING_TEMP_CLEANUP' -or
    @($device.cleanupErrors).Count -or !$launcher.finishedAt -or
    $deviceCleanup.status -cne 'PASS_EXACT_AVD_TEMP_REMOVED_REPORTS_APKS_RETAINED'){throw 'Build, device and retirement must be actually terminal'}
  if(@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object LocalPort -In @(5582,5583,5990,5992,5994)).Count){throw 'Owned device port remains'}
  $live=@(Get-CimInstance Win32_Process)
  foreach($hostReceipt in @($build,$launcher)){
    $row=@($live|Where-Object ProcessId -EQ $hostReceipt.pid)
    if($row.Count -and $row[0].CreationDate.ToUniversalTime() -ge ([datetime]$hostReceipt.startedAt).ToUniversalTime().AddSeconds(-5) -and
      $row[0].CreationDate.ToUniversalTime() -le ([datetime]$hostReceipt.finishedAt).ToUniversalTime()){throw 'Owned administrator generation remains'}
  }
  foreach($e in @($prep.installer,$prep.protected.dailyDev,$prep.protected.index)){
    if((Sha $e.path) -cne $e.sha256){throw 'Protected artifact changed'}
    $r.retained+=@{path=$e.path;sha256=$e.sha256}
  }
  foreach($b in $prep.builds){
    if((Sha $b.cartridge.path) -cne $b.cartridge.sha256){throw 'Author export changed'}
    $r.retained+=@{path=$b.cartridge.path;sha256=$b.cartridge.sha256}
  }
  foreach($c in $audit.cases){
    if((Sha $c.apk.path) -cne $c.apk.sha256){throw 'Signed APK changed'}
    $r.retained+=@{path=$c.apk.path;sha256=$c.apk.sha256}
  }
  $evidence=@('preparation.json','administrator.json','package-audit-01.json',"$deviceName\report.json","$deviceName\launcher.json","$deviceName\cleanup.json",'tools\recovery.json')
  if($RenpyFollowup){$evidence+=@('device-01\report.json','device-01\launcher.json','device-01\cleanup.json')}
  foreach($name in $evidence){
    $f=Join-Path $base $name
    $r.retained+=@{path=$f;sha256=(Sha $f)}
  }
  $source="$base\source"
  if([IO.Path]::GetFullPath($prep.sourceRoot) -cne $source -or @($audit.links).Count -ne 4){throw 'Exact build source/link seal required'}
  # Validate every generated file link before removing any of them. Never
  # follow a link recursively or accept a target outside this build source.
  foreach($link in $audit.links){
    $p=[IO.Path]::GetFullPath($link.path)
    $target=[IO.Path]::GetFullPath($link.target)
    if(!$p.StartsWith("$source\GameCli_framework\src-tauri\gen\android\app\src\main\jniLibs\",[StringComparison]::Ordinal) -or
      !$target.StartsWith("$source\GameCli_framework\src-tauri\target\",[StringComparison]::Ordinal) -or
      [IO.Path]::GetFileName($p) -cne 'libagentvn_player_lib.so'){throw 'Generated link escaped'}
    $item=Get-Item -LiteralPath $p -Force
    if(!($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.LinkType -cne 'SymbolicLink' -or $item.PSIsContainer){throw 'Expected generated file symbolic link'}
    $actual=[IO.Path]::GetFullPath([string]$item.Target)
    if($actual -ine $target -or (Sha $target) -cne $link.sha256){throw 'Generated link target/bytes changed'}
    $r.links+=@{path=$p;target=$target;sha256=$link.sha256;removed=$false}
  }
  foreach($link in $r.links){
    Remove-Item -LiteralPath $link.path -Force
    if(Test-Path -LiteralPath $link.path){throw 'Link remains'}
    $link.removed=$true
  }
  Save
  $targets=@("$base\source","$base\temp","$base\tools\local","$base\tools\archive")
  foreach($target in $targets){
    if([IO.Path]::GetFullPath($target) -cne $target -or
      (Resolve-Path -LiteralPath $target).ProviderPath -cne $target -or
      !$target.StartsWith($base+'\',[StringComparison]::Ordinal)){throw 'Resolved target escaped'}
    foreach($p in $live){
      if(($p.ExecutablePath -and $p.ExecutablePath.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)) -or
        ($p.CommandLine -and $p.CommandLine.IndexOf($target,[StringComparison]::OrdinalIgnoreCase) -ge 0)){throw 'Target referenced by live process'}
    }
    $row=@{path=$target;files=0;logicalBytes=0L;removed=$false}
    $pending=[Collections.Generic.Stack[string]]::new();$pending.Push($target)
    while($pending.Count){
      $item=Get-Item -LiteralPath $pending.Pop() -Force
      if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Unverified descendant link'}
      if($item.PSIsContainer){foreach($child in @(Get-ChildItem -LiteralPath $item.FullName -Force)){$pending.Push($child.FullName)}}
      else{$row.files++;$row.logicalBytes+=$item.Length}
    }
    $r.targets+=,$row
  }
  Save
  foreach($row in $r.targets){
    Remove-Item -LiteralPath $row.path -Recurse -Force
    if(Test-Path -LiteralPath $row.path){throw 'Temporary tree remains'}
    $row.removed=$true;$r.files+=$row.files;$r.logicalBytes+=$row.logicalBytes;Save
  }
  foreach($e in $r.retained){if((Sha $e.path) -cne $e.sha256){throw 'Protected evidence changed'}}
  $r.status='PASS_EXACT_BUILD_AND_TOOL_TEMP_REMOVED_SOURCE_EXPORTS_APKS_REPORTS_RETAINED'
}catch{$r.status='FAILED';$r.error=$_.Exception.ToString()}
finally{$r.finishedAt=[datetime]::UtcNow.ToString('o');Save}
