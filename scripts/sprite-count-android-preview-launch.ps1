param([switch]$Elevated)
$ErrorActionPreference='Stop'
$run='F:\testavn\Android-Sprite-Preview-1975-20261116-01'
$receipt=Join-Path $run 'launcher.json'
$originFile=Join-Path $run 'origin.json'
function ReadJson($f){[IO.File]::ReadAllText($f,[Text.Encoding]::UTF8)|ConvertFrom-Json}
function WriteJson($f,$v){[IO.File]::WriteAllText($f,($v|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))}
function Sha($f){(Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLowerInvariant()}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$admin=([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if(!$Elevated){
 if($admin){throw 'Ordinary origin required'}
 if((Test-Path -LiteralPath $originFile) -or (Test-Path -LiteralPath $receipt)){throw 'Preserve earlier origin and receipts'}
 WriteJson $originFile @{administrator=$false;sid=$identity.User.Value;pid=$PID;at=[datetime]::UtcNow.ToString('o')}
 Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList @(
  '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Elevated')|Out-Null
 return
}
if(!$admin -or (Test-Path -LiteralPath $receipt)){throw 'Unique administrator launch required'}
$origin=ReadJson $originFile
if($origin.administrator -or $origin.sid -cne $identity.User.Value){throw 'Origin identity mismatch'}
$r=@{status='RUNNING';administrator=$true;pid=$PID;startedAt=[datetime]::UtcNow.ToString('o')}
WriteJson $receipt $r
try{
 $prepared=ReadJson (Join-Path $run 'preparation.json')
 foreach($item in $prepared.copies){if((Sha $item.path) -cne $item.sha256){throw 'Sealed harness changed'}}
 & node.exe (Join-Path $PSScriptRoot 'sprite-count-android-preview.cjs') $prepared.attempt 1> (Join-Path $run 'stdout.log') 2> (Join-Path $run 'stderr.log')
 $r.exitCode=$LASTEXITCODE
 $device=ReadJson (Join-Path $run 'report.json')
 if(!$device.finishedAt -or $device.cleanup -cne 'PROCESS_PACKAGE_PORT_RETIREMENT_AWAITING_TEMP_CLEANUP' -or
    @($device.cleanupErrors).Count){throw 'Device retirement is incomplete; do not delete its temporary files'}
 foreach($port in @(5582,5583,5990,5992,5994)){
  if(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue){throw "Owned port remains live: $port"}
 }
 $liveEmulator=Get-CimInstance Win32_Process -Filter "ProcessId=$($device.emulator.pid)"
 if($liveEmulator -and $liveEmulator.CreationDate.ToUniversalTime() -ge ([datetime]$device.at).ToUniversalTime().AddSeconds(-1) -and
    $liveEmulator.CreationDate.ToUniversalTime() -le ([datetime]$device.finishedAt).ToUniversalTime()){throw 'Owned emulator generation remains live'}
 $cleanup=@{status='RUNNING';targets=@();files=0;logicalBytes=0L;startedAt=[datetime]::UtcNow.ToString('o')}
 $cleanupFile=Join-Path $run 'cleanup.json'
 if(Test-Path -LiteralPath $cleanupFile){throw 'Preserve cleanup receipt'}
 try{
  $targets=@((Join-Path $run 'avd'),(Join-Path $run 'temp'))
  $processes=@(Get-CimInstance Win32_Process)
  foreach($target in $targets){
   $full=[IO.Path]::GetFullPath($target)
   if($full -cne $target -or [IO.Path]::GetDirectoryName($full) -cne $run -or
      [IO.Path]::GetFileName($full) -cnotin @('avd','temp')){throw 'Cleanup target scope mismatch'}
   foreach($p in $processes){
    if(($p.ExecutablePath -and $p.ExecutablePath.StartsWith($full+'\',[StringComparison]::OrdinalIgnoreCase)) -or
       ($p.CommandLine -and $p.CommandLine.IndexOf($full,[StringComparison]::OrdinalIgnoreCase) -ge 0)){throw 'Live process references temporary target'}
   }
   $row=@{path=$full;files=0;logicalBytes=0L;removed=$false}
   $pending=[Collections.Generic.Stack[string]]::new();$pending.Push($full)
   while($pending.Count){
    $current=$pending.Pop()
    $item=Get-Item -LiteralPath $current -Force
    if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Unexpected link; never recursively follow it'}
    if($item.PSIsContainer){foreach($child in @(Get-ChildItem -LiteralPath $item.FullName -Force)){$pending.Push($child.FullName)}}
    else{$row.files++;$row.logicalBytes+=$item.Length}
   }
   $cleanup.targets+=,$row
  }
  foreach($row in $cleanup.targets){
   Remove-Item -LiteralPath $row.path -Recurse -Force
   if(Test-Path -LiteralPath $row.path){throw 'Temporary target still present'}
   $row.removed=$true;$cleanup.files+=$row.files;$cleanup.logicalBytes+=$row.logicalBytes
  }
  $cleanup.status='PASS_EXACT_AVD_TEMP_REMOVED_REPORTS_APKS_RETAINED'
 }catch{$cleanup.status='FAILED';$cleanup.error=$_.Exception.ToString();throw}
 finally{$cleanup.finishedAt=[datetime]::UtcNow.ToString('o');WriteJson $cleanupFile $cleanup}
 foreach($item in $prepared.inputs){if((Sha $item.path) -cne $item.sha256){throw 'Source changed during sealed check'}}
 if((Sha $prepared.git.index) -cne $prepared.git.sha256){throw 'Real Git index changed'}
 $sourceRoot=Split-Path (Split-Path $prepared.inputs[0].path -Parent) -Parent
 if((& git -C $sourceRoot rev-parse HEAD) -cne $prepared.git.head){throw 'HEAD changed'}
 $r.status=if($r.exitCode -eq 0){'FINISHED_TARGETED_PREVIEW_AND_CLEANUP_CHECK_REPORT'}else{'FAILED_DEVICE_TEMP_RETIRED'}
}catch{$r.status='FAILED';$r.error=$_.Exception.ToString()}
finally{$r.finishedAt=[datetime]::UtcNow.ToString('o');WriteJson $receipt $r}
