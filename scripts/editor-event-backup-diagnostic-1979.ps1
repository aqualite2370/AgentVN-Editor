param([switch]$Elevated)
$ErrorActionPreference='Stop'
$env:PSModulePath=([Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)+'\WindowsPowerShell\Modules;'+$env:WINDIR+'\System32\WindowsPowerShell\v1.0\Modules')
$base='F:\testavn\Windows-Isolated-1979-20261116-02'
$receipt=Join-Path $base 'backup-diagnostic-01.json'
$admin=([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if(!$Elevated){
  if($admin){throw 'Ordinary origin required'}
  Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Elevated')|Out-Null
  return
}
if(!$admin -or (Test-Path -LiteralPath $receipt)){throw 'Fresh actual administrator observation required'}
function Read($p){Get-Content -LiteralPath $p -Raw -Encoding UTF8|ConvertFrom-Json}
function Sha($p){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
$r=@{status='RUNNING';at=[datetime]::UtcNow.ToString('o');files=@();productLaunches=0;administrator=$true}
try{
  $owner=Read "$base\account-controller.json"
  $run=Read "$base\resource-01\report.json"
  if(!$owner.account.createdByThisRun -or $owner.account.sid -cne 'S-1-5-21-2093805479-91935561-747405786-1131' -or
    $owner.account.name -cne 'AVNQABDF49C5C' -or $run.status -cne 'FAILED' -or
    $run.error -notmatch 'exact newer graph'){throw 'Exact failed QA ownership required'}
  $source="C:\Users\$($owner.account.name)\AppData\Roaming\com.agentvn.editor\backup-timeline"
  $target=Join-Path $base 'diagnostic-native-backups'
  if(Test-Path -LiteralPath $target){throw 'Preserve diagnostic backup evidence'}
  New-Item -ItemType Directory -Path $target|Out-Null
  if((Resolve-Path -LiteralPath $source).ProviderPath -cne $source -or
    ((Get-Item -LiteralPath $source -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Exact non-link backup directory required'}
  foreach($file in (Get-ChildItem -LiteralPath $source -File)){
    if($file.Name -cnotmatch '^qa-editor-event-integrity-1979__[0-9]+__[0-9]+\.vnproj(?:\.meta\.json)?$' -or
      ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Unexpected native backup'}
    $copy=Join-Path $target $file.Name
    Copy-Item -LiteralPath $file.FullName -Destination $copy -ErrorAction Stop
    if((Sha $copy) -cne (Sha $file.FullName)){throw 'Native backup bytes differ'}
    $r.files+=@{path=$copy;source=$file.FullName;sha256=(Sha $copy)}
  }
  if(!$r.files.Count){throw 'No native backups captured'}
  $r.status='PASS_CAPTURE_ONLY_NOT_PRODUCT_ASSERTION'
}catch{$r.status='FAILED';$r.error=$_.Exception.ToString()}
finally{$r.finishedAt=[datetime]::UtcNow.ToString('o');[IO.File]::WriteAllText($receipt,($r|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))}
