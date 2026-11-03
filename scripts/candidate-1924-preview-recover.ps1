param([switch]$InspectOnly)
$ErrorActionPreference='Stop'
$run='F:\AgentVN\QA\Native-Dev-Preview-Repair-20261020-02\installed-03'
$journalFile=Join-Path $run 'profile-protection.json'
$state=Get-Content -LiteralPath $journalFile -Raw -Encoding UTF8|ConvertFrom-Json
$report=Get-Content -LiteralPath (Join-Path $run 'report.json') -Raw -Encoding UTF8|ConvertFrom-Json
if($report.status -ne 'FAILED' -or !$report.cleanupError -or
   @($report.steps|Where-Object {$_.status -ne 'PASS'}).Count -or $report.steps.Count -ne 5){
    throw 'Expected completed business and original cleanup failure'
}
if(@(Get-CimInstance Win32_Process|Where-Object {
    $_.Name -match '^(agentvn-editor|AgentVN Dev|creator-backend|agentvn-player)\.exe$'
}).Count){throw 'Product process active; refuse recovery'}
function Id($directory) {
    $text=(& fsutil.exe file queryfileid $directory|Out-String)
    if($LASTEXITCODE -ne 0 -or $text -notmatch '0x[0-9a-fA-F]+'){throw "No directory ID: $directory"}
    $Matches[0].ToLowerInvariant()
}
function Sha($file) {
    $stream=[IO.File]::OpenRead($file);$h=[Security.Cryptography.SHA256]::Create()
    try{([BitConverter]::ToString($h.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
    finally{$h.Dispose();$stream.Dispose()}
}
function SaveNew($file,$value) {
    if(Test-Path -LiteralPath $file){throw 'Recovery evidence already exists'}
    [IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 15),[Text.UTF8Encoding]::new($false))
}
$expected=@('C:\Users\1\AppData\Roaming\com.agentvn.player',
    'C:\Users\1\AppData\Local\com.agentvn.player',
    'C:\Users\1\AppData\Local\com.agentvn.editor\gamecli-preview')
if($state.records.Count -ne 6){throw 'Expected six journal views'}
$actions=@()
for($i=0;$i -lt 3;$i++) {
    $r=$state.records[$i];$alias=$state.records[$i+3]
    if($r.original -cne $expected[$i] -or $r.held -cne ($r.original+'.qa-hold-native-preview-20261020') -or
       [IO.Path]::GetDirectoryName($r.held) -cne [IO.Path]::GetDirectoryName($r.original) -or
       $alias.directoryId -cne $r.directoryId -or
       $alias.target -cne (Join-Path $run ('profile-'+($i+3))) -or
       !$r.existed -or !$alias.existed){throw 'Exact alias recovery boundary mismatch'}
    if((Id $r.held) -cne $r.directoryId -or (Id $alias.held) -cne $r.directoryId){throw 'Original held identity mismatch'}
    $held=Get-Item -LiteralPath $r.held -Force
    if($held.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Original held directory is a link'}
    $current=Get-Item -LiteralPath $r.original -Force
    if(!($current.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
       [IO.Path]::GetFullPath([string]$current.Target) -cne $alias.target -or
       (Id $r.original) -cne (Id $alias.original)){throw 'Current owned junction mismatch'}
    foreach($f in $r.files){if((Sha (Join-Path $r.held $f.relative)) -cne $f.sha256){throw 'Held bytes changed'}}
    $actions+=@{original=$r.original;alias=$alias.original;held=$r.held;ownedTarget=$alias.target;
        originalDirectoryId=$r.directoryId;currentJunctionId=(Id $r.original);files=$r.files}
}
if($InspectOnly){
    @{status='VERIFIED_RECOVERY_PLAN';uniqueOriginals=3;aliasViews=6;actions=$actions;mutations=0}|ConvertTo-Json -Depth 8
    return
}
$planFile=Join-Path $run 'profile-recovery-plan.json'
SaveNew $planFile @{status='JOURNALED';at=(Get-Date).ToUniversalTime().ToString('o');
    originalJournalSha256=(Sha $journalFile);originalReportSha256=(Sha (Join-Path $run 'report.json'));actions=$actions}
$done=@()
foreach($a in $actions){
    if((Id $a.held) -cne $a.originalDirectoryId -or (Id $a.original) -cne $a.currentJunctionId){throw 'Identity changed since recovery plan'}
    $item=Get-Item -LiteralPath $a.original -Force
    if(!($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
       [IO.Path]::GetFullPath([string]$item.Target) -cne $a.ownedTarget){throw 'Junction changed before unlink'}
    # Remove exactly this verified QA junction itself; retain every target byte.
    $item.Delete()
    Move-Item -LiteralPath $a.held -Destination $a.original
    if((Id $a.original) -cne $a.originalDirectoryId -or (Id $a.alias) -cne $a.originalDirectoryId){throw 'Restored physical identity differs'}
    foreach($f in $a.files){if((Sha (Join-Path $a.original $f.relative)) -cne $f.sha256){throw 'Restored bytes differ'}}
    $done+=@{original=$a.original;alias=$a.alias;directoryId=(Id $a.original);files=$a.files;retainedTestTarget=$a.ownedTarget}
}
foreach($r in $state.records){
    if((Id $r.original) -cne $r.directoryId -or (Test-Path -LiteralPath $r.held)){throw 'Final six-view restoration mismatch'}
}
SaveNew (Join-Path $run 'profile-restoration-recovery.json') @{status='PASS';at=(Get-Date).ToUniversalTime().ToString('o');
    planSha256=(Sha $planFile);restored=$done;aliasViewsVerified=6;uniqueDirectories=3;
    deletedUserFiles=0;removedOwnedJunctions=3;originalFailurePreserved=$true;originalStatus='FAILED'}
Write-Output 'PASS three physical directories restored, six alias views verified; all original files and QA targets retained'
