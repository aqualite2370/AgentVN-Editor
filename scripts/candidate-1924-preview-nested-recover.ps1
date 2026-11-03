$ErrorActionPreference='Stop'
$run='F:\AgentVN\QA\Native-Dev-Preview-Repair-20261020-02\installed-03'
$state=Get-Content -LiteralPath (Join-Path $run 'profile-protection.json') -Raw -Encoding UTF8|ConvertFrom-Json
if(@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '^(agentvn-editor|AgentVN Dev|creator-backend|agentvn-player)\.exe$'}).Count){
    throw 'Product active'
}
function Sha($p){$s=[IO.File]::OpenRead($p);$h=[Security.Cryptography.SHA256]::Create()
    try{([BitConverter]::ToString($h.ComputeHash($s))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose();$s.Dispose()}}
function Id($p){$s=(& fsutil.exe file queryfileid $p|Out-String)
    if($LASTEXITCODE -ne 0 -or $s -notmatch '0x[0-9a-fA-F]+'){throw 'Missing ID'};$Matches[0].ToLowerInvariant()}
function SaveNew($p,$v){if(Test-Path -LiteralPath $p){throw 'Evidence exists'}
    [IO.File]::WriteAllText($p,($v|ConvertTo-Json -Depth 15),[Text.UTF8Encoding]::new($false))}
$expected=@('C:\Users\1\AppData\Roaming\com.agentvn.player','C:\Users\1\AppData\Local\com.agentvn.player',
    'C:\Users\1\AppData\Local\com.agentvn.editor\gamecli-preview')
$links=@()
for($i=0;$i -lt 3;$i++){
    $r=$state.records[$i]
    if($r.original -cne $expected[$i] -or (Id $r.original) -cne $r.directoryId){throw 'Original identity mismatch'}
    $nested=Join-Path $r.original ([IO.Path]::GetFileName($r.original))
    $item=Get-Item -LiteralPath $nested -Force
    if(!($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
       [IO.Path]::GetFullPath([string]$item.Target) -cne $r.target -or
       $r.target -cne (Join-Path $run ('profile-'+$i)) -or
       @($r.files|Where-Object {$_.relative.StartsWith(([IO.Path]::GetFileName($r.original)+'\'))}).Count){
        throw 'Not the exact newly nested QA junction'
    }
    foreach($f in $r.files){if((Sha (Join-Path $r.original $f.relative)) -cne $f.sha256){throw 'Original file changed'}}
    $links+=@{path=$nested;target=$r.target;id=(Id $nested);original=$r.original;directoryId=$r.directoryId}
}
SaveNew (Join-Path $run 'nested-junction-recovery-plan.json') @{status='JOURNALED';links=$links;at=(Get-Date).ToUniversalTime().ToString('o')}
foreach($l in $links){
    $item=Get-Item -LiteralPath $l.path -Force
    if((Id $l.path) -cne $l.id -or !($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
       [IO.Path]::GetFullPath([string]$item.Target) -cne $l.target){throw 'Link changed before unlink'}
    $item.Delete()
    if(Test-Path -LiteralPath $l.path){throw 'Nested QA link not removed'}
    if(!(Test-Path -LiteralPath $l.target -PathType Container)){throw 'QA target bytes not retained'}
}
$verified=@()
foreach($r in $state.records){
    if((Id $r.original) -cne $r.directoryId -or (Test-Path -LiteralPath $r.held)){throw 'Alias restoration mismatch'}
    $actual=@()
    if($r.byteInventory){
        $entries=@(Get-ChildItem -LiteralPath $r.original -Recurse -Force)
        if(@($entries|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count){throw 'Unexpected link remains'}
        $actual=@($entries|Where-Object {!$_.PSIsContainer})
        if($actual.Count -ne $r.files.Count){throw 'Original file count differs'}
        foreach($f in $r.files){if((Sha (Join-Path $r.original $f.relative)) -cne $f.sha256){throw 'Original file bytes differ'}}
    }
    $verified+=@{original=$r.original;directoryId=$r.directoryId;byteInventory=$r.byteInventory;verifiedFiles=$actual.Count}
}
SaveNew (Join-Path $run 'profile-restoration-correction.json') @{
    status='PASS';at=(Get-Date).ToUniversalTime().ToString('o');removedOwnedNestedJunctions=$links;
    finalViews=$verified;deletedUserFiles=0;originalRunStatus='FAILED';
    correction='Earlier recovery verified IDs and expected bytes but missed three newly nested QA links. Prior recovery/audit are incomplete cleanup evidence; this report additionally verifies file counts and rejects links for byte-inventoried roots.'
}
Write-Output 'PASS three exact nested QA links removed; six original identities and strict original file inventories restored; all targets retained'
