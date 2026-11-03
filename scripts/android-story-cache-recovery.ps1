param([Parameter(Mandatory=$true)][string]$RunDirectory)
$ErrorActionPreference='Stop'
$run=[IO.Path]::GetFullPath($RunDirectory)
$expected=[IO.Path]::GetFullPath('F:/AgentVN/QA/Android-Package-20261021-01/editor-36')
if($run -cne $expected){throw 'Only the inspected editor-36 recovery is authorized'}
$out=Join-Path $run 'cache-recovery-02'
if(Test-Path -LiteralPath $out){throw 'Never overwrite a recovery receipt'}
$null=New-Item -ItemType Directory -Path $out
$r=[ordered]@{status='RUNNING';startedAt=[DateTime]::UtcNow.ToString('o');originalWorkflowStatus='FAILED_QA_ARCHIVE_COLLISION';deletedUserFiles=0;rows=@();protected=@();error=$null}
function Save { [IO.File]::WriteAllText((Join-Path $out 'report.json'),($r|ConvertTo-Json -Depth 14),[Text.UTF8Encoding]::new($false)) }
function Id($p){$text=(& fsutil.exe file queryfileid $p|Out-String);if($LASTEXITCODE -ne 0 -or $text -notmatch '0x[0-9a-fA-F]+'){throw 'Directory identity unavailable'};$Matches[0].ToLowerInvariant()}
function Files($p){
  $entries=@(Get-Item -LiteralPath $p -Force)+@(Get-ChildItem -LiteralPath $p -Recurse -Force)
  if(@($entries|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count){throw 'Links are not allowed in a test archive'}
  @(foreach($f in $entries|Where-Object {!$_.PSIsContainer}){[ordered]@{relative=$f.FullName.Substring($p.Length+1);bytes=$f.Length;sha256=(Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}})
}
Save
try {
  $state=[IO.File]::ReadAllText((Join-Path $run 'cache-protection.json'),[Text.Encoding]::UTF8)|ConvertFrom-Json
  $build=[IO.File]::ReadAllText((Join-Path $run 'report.json'),[Text.Encoding]::UTF8)|ConvertFrom-Json
  if($build.status -cne 'FAILED' -or $build.featureStatus -cne 'PASS' -or $build.builds -ne 1 -or
    $build.cleanupError -notmatch 'New-Item' -or $build.cleanupError -notmatch 'native-standalone-package'){throw 'Unexpected original failure'}
  if(@(Get-CimInstance Win32_Process|Where-Object {$_.Name -in @('agentvn-editor.exe','creator-backend.exe','agentvn-player.exe','AgentVN Dev.exe')}).Count){throw 'Product processes must be stopped'}
  $originals=@('C:/Users/1/AppData/Local/com.agentvn.editor/windows-env','C:/Users/1/AppData/Local/com.agentvn.editor/android-env',
    'C:/Users/1/AppData/Local/com.agentvn.editor/standalone-package','C:/Users/1/AppData/Local/AgentVN/environment-cache')|ForEach-Object {[IO.Path]::GetFullPath($_)}
  if($state.rows.Count -ne 4){throw 'Four cache rows required'}
  foreach($row in $state.rows){
    if($row.original -cnotin $originals -or $row.owned -cne ($row.original+'.qa-tested-android-current-editor-36-20261021') -or
      $row.target -cne (Join-Path $run ('native-'+[IO.Path]::GetFileName($row.original)))){throw 'Unexpected recovery boundary'}
    if(Test-Path -LiteralPath $row.held){throw 'Original hold still exists; do not guess restoration state'}
    $before=Id $row.original
    if($before -ceq $row.testDirectoryId){throw 'Test cache still occupies original path'}
    $record=[ordered]@{original=$row.original;originalIdBefore=$before;owned=$row.owned;testDirectoryId=$row.testDirectoryId;files=@();archive=$null;deletedOwnedFiles=0;status='RUNNING'}
    $r.rows+=$record;Save
    if(Test-Path -LiteralPath $row.owned){
      $absolute=[IO.Path]::GetFullPath($row.owned)
      if($absolute -cne $row.owned -or (Id $absolute) -cne $row.testDirectoryId){throw 'Owned test directory identity changed'}
      $inventory=@(Files $absolute);$destination=Join-Path $out ([IO.Path]::GetFileName($row.original))
      $null=New-Item -ItemType Directory -Path $destination
      foreach($entry in Get-ChildItem -LiteralPath $absolute -Force){Copy-Item -LiteralPath $entry.FullName -Destination $destination -Recurse}
      $copied=@(Files $destination);if($copied.Count -ne $inventory.Count){throw 'Recovery archive file count differs'}
      foreach($f in $inventory){$copy=Join-Path $destination $f.relative;if(!(Test-Path -LiteralPath $copy -PathType Leaf) -or
        (Get-Item -LiteralPath $copy).Length -ne $f.bytes -or (Get-FileHash -LiteralPath $copy).Hash.ToLowerInvariant() -cne $f.sha256){throw 'Recovery archive bytes differ'}}
      $record.files=$inventory;$record.archive=$destination;Save
      if((Id $absolute) -cne $row.testDirectoryId -or $absolute -cne ($row.original+'.qa-tested-android-current-editor-36-20261021')){throw 'Final delete boundary changed'}
      Remove-Item -LiteralPath $absolute -Recurse -Force
      if(Test-Path -LiteralPath $absolute){throw 'Owned test cache remains'}
      $record.deletedOwnedFiles=$inventory.Count
    }else{
      if(!(Test-Path -LiteralPath $row.target)){throw 'Previously archived test cache missing'}
      $record.files=@(Files $row.target);$record.archive=$row.target
    }
    $record.originalIdAfter=Id $row.original
    if($record.originalIdAfter -cne $before){throw 'Original directory changed during recovery'}
    $record.status='PASS';Save
  }
  foreach($f in $build.protectedFiles){if((Get-FileHash -LiteralPath $f.path).Hash.ToLowerInvariant() -cne $f.sha256){throw 'Protected installed file changed'};$r.protected+=@{path=$f.path;sha256=$f.sha256}}
  $r.status='PASS_RECOVERED_QA_CACHE_ARCHIVE'
}catch{$r.status='FAILED';$r.error=$_.Exception.ToString();throw 'Recovery failed; inspect its preserved report.json'}
finally{$r.finishedAt=[DateTime]::UtcNow.ToString('o');Save}
$r|ConvertTo-Json -Depth 4
