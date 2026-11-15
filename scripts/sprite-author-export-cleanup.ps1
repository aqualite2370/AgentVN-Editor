param()
$ErrorActionPreference='Stop'
$root='F:\testavn\Sprite-Author-Export-1975-20261116-03'
$receipt=Join-Path $root 'artifact-cleanup.json'
if(Test-Path -LiteralPath $receipt){throw 'Preserve original cleanup receipt'}
function Sha($f){(Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLowerInvariant()}
$r=@{status='RUNNING';startedAt=[datetime]::UtcNow.ToString('o');targets=@();files=0;logicalBytes=0L}
try{
 $author=[IO.File]::ReadAllText((Join-Path $root 'report.json'),[Text.Encoding]::UTF8)|ConvertFrom-Json
 $player=[IO.File]::ReadAllText((Join-Path $root 'formal-player\report.json'),[Text.Encoding]::UTF8)|ConvertFrom-Json
 if($author.status -cne 'PASS_SOURCE_AUTHOR_UI_PERSISTENCE_AND_TWO_NORMAL_CARTRIDGES' -or
    $player.status -cne 'PASS_TWO_UNCHANGED_UI_EXPORTS_FORMAL_FIXED_PLAYER_GEOMETRY'){throw 'Do not retire incomplete evidence'}
 $targets=@(
  'F:\testavn\Sprite-Author-Export-1975-20261116-02\temp',
  (Join-Path $root 'temp'),
  (Join-Path $root 'formal-player\temp-agentvn'),
  (Join-Path $root 'formal-player\temp-renpy'),
  (Join-Path $root 'formal-player\webview-agentvn'),
  (Join-Path $root 'formal-player\webview-renpy'),
  (Join-Path $root 'formal-player\agentvn-player.exe')
 )
 $processes=@(Get-CimInstance Win32_Process)
 foreach($target in $targets){
  $full=[IO.Path]::GetFullPath($target)
  if($full -cne $target -or $target -cnotin $targets -or
     !($target.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase) -or
       $target -ceq 'F:\testavn\Sprite-Author-Export-1975-20261116-02\temp')){throw 'Exact target guard failed'}
  $row=@{path=$target;existed=(Test-Path -LiteralPath $target);files=0;logicalBytes=0L;removed=$false}
  if(!$row.existed){$r.targets+=,$row;continue}
  foreach($p in $processes){
   if(($p.ExecutablePath -and ($p.ExecutablePath -ieq $target -or $p.ExecutablePath.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase))) -or
      ($p.CommandLine -and $p.CommandLine.IndexOf($target,[StringComparison]::OrdinalIgnoreCase) -ge 0)){throw "Live process references $target"}
  }
  $pending=[Collections.Generic.Stack[string]]::new();$pending.Push($target)
  while($pending.Count){
   $item=Get-Item -LiteralPath $pending.Pop() -Force
   if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Never follow a link in cleanup'}
   if($item.PSIsContainer){foreach($child in @(Get-ChildItem -LiteralPath $item.FullName -Force)){$pending.Push($child.FullName)}}
   else{$row.files++;$row.logicalBytes+=$item.Length}
  }
  if([IO.Path]::GetFileName($target) -ceq 'agentvn-player.exe' -and
    (Sha $target) -cne $player.executable.sha256){throw 'Copied Player hash mismatch'}
  $r.targets+=,$row
 }
 foreach($row in $r.targets){
  if(!$row.existed){continue}
  if((Get-Item -LiteralPath $row.path -Force).PSIsContainer){Remove-Item -LiteralPath $row.path -Recurse -Force}
  else{Remove-Item -LiteralPath $row.path -Force}
  if(Test-Path -LiteralPath $row.path){throw 'Exact temporary target remains'}
  $row.removed=$true;$r.files+=$row.files;$r.logicalBytes+=$row.logicalBytes
 }
 foreach($export in $author.exports){if((Sha $export.path) -cne $export.sha256){throw 'Source cartridge changed'}}
 $r.status='PASS_EXACT_AUTHOR_TEST_TEMP_AND_PLAYER_COPY_REMOVED_EVIDENCE_RETAINED'
}catch{$r.status='FAILED';$r.error=$_.Exception.ToString();throw}
finally{
 $r.finishedAt=[datetime]::UtcNow.ToString('o')
 [IO.File]::WriteAllText($receipt,($r|ConvertTo-Json -Depth 9),[Text.UTF8Encoding]::new($false))
 [pscustomobject]$r|Select-Object status,files,logicalBytes|ConvertTo-Json -Compress
}
