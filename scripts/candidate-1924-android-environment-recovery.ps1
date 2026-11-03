param([switch]$Restore)
$ErrorActionPreference='Stop'
$qaRun='F:\AgentVN\QA\Android-Environment-1924-20261025-02'
$source='C:\Users\1\AppData\Local\AgentVN\environment-cache'
$held=$source+'.qa-hold-android-environment-1924-20261025-02'
$target=Join-Path $qaRun 'cache-2'
$state=Get-Content -LiteralPath (Join-Path $qaRun 'cache-protection.json') -Raw -Encoding UTF8|ConvertFrom-Json
$record=@($state.records|Where-Object {$_.original -ceq $source})
if($record.Count -ne 1){throw 'One exact remaining record required'}
function Sha($file){
  $s=[IO.File]::OpenRead($file);$h=[Security.Cryptography.SHA256]::Create()
  try{([BitConverter]::ToString($h.ComputeHash($s))).Replace('-','').ToLowerInvariant()}
  finally{$s.Dispose();$h.Dispose()}
}
$item=Get-Item -LiteralPath $source -Force
$description=@{source=$source;attributes=$item.Attributes.ToString();targets=@($item.Target);heldExists=(Test-Path -LiteralPath $held);
  originalExpectedTarget=$target;resolvedString=[IO.Path]::GetFullPath([string]$item.Target)}
if(!$Restore){$description|ConvertTo-Json -Depth 8;exit}
if(@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '^(agentvn-editor|AgentVN Dev|creator-backend)\.exe$'}).Count){throw 'Product active'}
if(!($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or @($item.Target).Count -ne 1 -or
  [IO.Path]::GetFullPath([string]@($item.Target)[0]) -cne $target){throw 'Not the exact owned junction'}
$id=(& fsutil.exe file queryfileid $held|Out-String)
if($LASTEXITCODE -ne 0 -or $id -notmatch [regex]::Escape($record[0].directoryId)){throw 'Held identity differs'}
$files=@(Get-ChildItem -LiteralPath $held -Recurse -File -Force)
if($files.Count -ne @($record[0].files).Count){throw 'Held file count differs'}
foreach($file in $record[0].files){
  if((Sha (Join-Path $held $file.relative)) -cne $file.sha256){throw 'Held file bytes differ'}
}
$item.Delete()
[IO.Directory]::Move($held,$source)
$id=(& fsutil.exe file queryfileid $source|Out-String)
if($LASTEXITCODE -ne 0 -or $id -notmatch [regex]::Escape($record[0].directoryId)){throw 'Restored identity differs'}
foreach($file in $record[0].files){
  if((Sha (Join-Path $source $file.relative)) -cne $file.sha256){throw 'Restored file bytes differ'}
}
$result=@{status='PASS';at=(Get-Date).ToUniversalTime().ToString('o');source=$source;directoryId=$record[0].directoryId;
  files=$record[0].files;deletedUserFiles=0;originalReportUnchanged=$true}
$file=Join-Path $qaRun 'remaining-cache-recovery.json'
if(Test-Path -LiteralPath $file){throw 'Existing recovery evidence'}
[IO.File]::WriteAllText($file,($result|ConvertTo-Json -Depth 15),[Text.UTF8Encoding]::new($false))
$result|ConvertTo-Json -Depth 6
