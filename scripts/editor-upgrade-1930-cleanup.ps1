# No desktop input. Archive only the three exact QA profiles created by this run.
param([switch]$VerifyOnly)
$ErrorActionPreference='Stop'
$run='F:\AgentVN\QA\Editor-Upgrade-1930-20261026-01'
$receipt=Join-Path $run 'retained-cleanup-01.json'
function Read($f){Get-Content -LiteralPath $f -Raw -Encoding UTF8|ConvertFrom-Json}
function Sha($f){
    $s=[IO.File]::OpenRead($f);$h=[Security.Cryptography.SHA256]::Create()
    try{([BitConverter]::ToString($h.ComputeHash($s))).Replace('-','').ToLowerInvariant()}
    finally{$h.Dispose();$s.Dispose()}
}
function Id($p){
    $text=(& fsutil.exe file queryfileid $p|Out-String)
    if($LASTEXITCODE -ne 0 -or $text -notmatch '0x[0-9a-fA-F]+'){throw "Missing directory identity: $p"}
    $Matches[0].ToLowerInvariant()
}
function Files($p){
    $items=@(Get-Item -LiteralPath $p -Force)+@(Get-ChildItem -LiteralPath $p -Recurse -Force)
    if(@($items|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count){throw 'Linked QA tree'}
    @(foreach($f in $items|Where-Object {!$_.PSIsContainer}){
        @{relative=$f.FullName.Substring($p.Length+1);bytes=$f.Length;sha256=(Sha $f.FullName)}
    })
}
function Verify($p,$files){
    $actual=@(Files $p)
    if($actual.Count -ne @($files).Count){throw "File count mismatch: $p"}
    $byPath=[Collections.Generic.Dictionary[string,object]]::new([StringComparer]::Ordinal)
    foreach($entry in $actual){$byPath.Add([string]$entry.relative,$entry)}
    $expectedPaths=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach($f in $files){
        $match=$null
        if(!$expectedPaths.Add([string]$f.relative) -or
            !$byPath.TryGetValue([string]$f.relative,[ref]$match) -or
            $match.bytes -ne $f.bytes -or $match.sha256 -cne $f.sha256){
            throw "File byte mismatch: $p\$($f.relative)"
        }
    }
}
if(@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '^(agentvn-editor|agentvn-player|creator-backend|AgentVN Dev)\.exe$'}).Count){
    throw 'Product still active'
}
$state=Read (Join-Path $run 'protection.json')
$restored=Read (Join-Path $run 'Restore.json')
$raw=Read (Join-Path $run 'report.json')
if($restored.status -cne 'PASS' -or $raw.cleanupStatus -cne 'PASS' -or $state.records.Count -ne 3){throw 'Restoration incomplete'}
$roots=@('C:\Users\1\AppData\Roaming\com.agentvn.editor','C:\Users\1\AppData\Local\com.agentvn.editor',
    'C:\Users\1\AppData\Local\AgentVN\environment-cache')
foreach($r in $state.records){
    if($r.original -cnotin $roots -or (Id $r.original) -cne $r.directoryId){throw 'Original directory mismatch'}
    if($r.byteInventory){Verify $r.original $r.files}
}
foreach($f in $state.protectedFiles){if((Sha $f.path) -cne $f.sha256){throw 'Frozen file changed'}}
foreach($link in $state.links){if((Sha $link.path) -cne $link.sha256){throw 'Shortcut changed'}}
Verify $state.originalInstallation $state.originalInstallationFiles
foreach($r in $state.registry){
    $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($r.path)
    if(!$key){throw 'Original registry key missing'}
    try{
        if($key.GetValueNames().Count -ne @($r.values).Count){throw 'Registry value count differs'}
        foreach($v in $r.values){
            $value=$key.GetValue($v.name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
            if(($value|ConvertTo-Json -Compress) -cne ($v.value|ConvertTo-Json -Compress)){throw 'Registry value differs'}
            if($key.GetValueKind($v.name).ToString() -cne $v.kind){throw 'Registry value kind differs'}
        }
    }finally{$key.Dispose()}
}
if($VerifyOnly){
    $result=Read $receipt
    if($result.status -cne 'PASS' -or $result.records.Count -ne 3 -or $result.deletedUserFiles -ne 0){throw 'Invalid cleanup receipt'}
    foreach($r in $result.records){
        if(!$r.removed -or (Test-Path -LiteralPath $r.source)){throw 'QA source remains'}
        Verify $r.archive $r.files
    }
    [PSCustomObject]@{status='PASS';verifiedArchives=3;originalProfiles=3;originalRegistry='PASS';desktopInput=0}|ConvertTo-Json -Compress
    exit
}
if(Test-Path -LiteralPath $receipt){throw 'Fresh cleanup receipt required'}
$result=@{status='RUNNING';startedAt=(Get-Date).ToUniversalTime().ToString('o');records=@();deletedUserFiles=0;bytesRemovedFromC=0L}
try{
    for($i=0;$i -lt 3;$i++){
        $r=$state.records[$i];$created=Read (Join-Path $run ('created-'+$i+'.json'))
        $target=[IO.Path]::GetFullPath([string]$r.retained)
        if($target -cne ($r.original+'.qa-tested-editor-upgrade-1930-20261026-01') -or
            [IO.Path]::GetDirectoryName($target) -cne [IO.Path]::GetDirectoryName($r.original) -or
            (Id $target) -cne $created.directoryId){throw 'Exact QA deletion boundary mismatch'}
        $archive=Join-Path $run ('archived-profile-'+$i)
        if(Test-Path -LiteralPath $archive){throw 'Archive already exists'}
        $files=@(Files $target);Copy-Item -LiteralPath $target -Destination $archive -Recurse
        Verify $archive $files
        if((Id $target) -cne $created.directoryId){throw 'QA identity changed before removal'}
        $bytes=0L;foreach($f in $files){$bytes += [long]$f.bytes}
        $result.records+=@{source=$target;archive=$archive;files=$files;bytes=$bytes;removed=$false}
        [IO.File]::WriteAllText($receipt,($result|ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))
        Remove-Item -LiteralPath $target -Recurse -Force
        if(Test-Path -LiteralPath $target){throw 'QA source remains'}
        if((Id $r.original) -cne $r.directoryId){throw 'Original identity changed'}
        $result.records[-1].removed=$true;$result.bytesRemovedFromC += $bytes
    }
    $result.status='PASS'
}catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
finally{
    $result.finishedAt=(Get-Date).ToUniversalTime().ToString('o')
    [IO.File]::WriteAllText($receipt,($result|ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))
}
[PSCustomObject]@{status=$result.status;archived=3;removedMiB=[Math]::Round($result.bytesRemovedFromC/1MB,2);deletedUserFiles=0}|ConvertTo-Json -Compress
