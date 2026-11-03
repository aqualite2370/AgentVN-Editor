# Archive the six exact QA-created siblings, preserving original NTFS identities.
$ErrorActionPreference='Stop'
$base='F:\AgentVN\QA\Editor-Cross-1924-20261025-'
$receipt=$base+'03\profiles-cleanup-01.json'
if(Test-Path -LiteralPath $receipt){throw 'Fresh cleanup receipt required'}
if(@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match
    '^(agentvn-editor|AgentVN Dev|agentvn-player|creator-backend)\.exe$'}).Count){throw 'Product active'}
function Read($file){Get-Content -LiteralPath $file -Raw -Encoding UTF8|ConvertFrom-Json}
function Sha($file){
    $s=[IO.File]::OpenRead($file);$h=[Security.Cryptography.SHA256]::Create()
    try{([BitConverter]::ToString($h.ComputeHash($s))).Replace('-','').ToLowerInvariant()}
    finally{$s.Dispose();$h.Dispose()}
}
function Id($directory){
    $text=(& fsutil.exe file queryfileid $directory|Out-String)
    if($LASTEXITCODE -ne 0 -or $text -notmatch '0x[0-9a-fA-F]+'){throw 'Missing identity'}
    $Matches[0].ToLowerInvariant()
}
function Files($directory){
    $items=@(Get-Item -LiteralPath $directory -Force)+@(Get-ChildItem -LiteralPath $directory -Recurse -Force)
    if(@($items|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count){throw 'Linked QA tree'}
    @(foreach($f in $items|Where-Object {!$_.PSIsContainer}){
        @{relative=$f.FullName.Substring($directory.Length+1);bytes=$f.Length;sha256=(Sha $f.FullName)}
    })
}
$result=@{status='RUNNING';at=(Get-Date).ToUniversalTime().ToString('o');records=@();deletedUserFiles=0;bytesRemovedFromC=0;error=$null}
try{
    if((Read ($base+'03\audit-01.json')).status -cne 'PASS'){throw 'Independent audit required'}
    foreach($attempt in @('02','03')){
        $run=$base+$attempt;$state=Read (Join-Path $run 'protection.json')
        if((Read (Join-Path $run 'Restore.json')).status -cne 'PASS'){throw 'Original restoration required'}
        for($i=0;$i -lt 3;$i++){
            $record=$state.records[$i];$created=Read (Join-Path $run ('created-'+$i+'.json'))
            $target=[IO.Path]::GetFullPath([string]$record.retained)
            if($target -cne ($record.original+'.qa-tested-editor-cross-1924-20261025-'+$attempt) -or
                $record.original -cnotin @('C:\Users\1\AppData\Roaming\com.agentvn.editor',
                'C:\Users\1\AppData\Local\com.agentvn.editor','C:\Users\1\AppData\Local\AgentVN\environment-cache')){
                throw 'Unknown deletion boundary'
            }
            if((Id $record.original) -cne $record.directoryId -or (Id $target) -cne $created.directoryId){throw 'Original/QA identity differs'}
            $archive=Join-Path $run ('archived-profile-'+$i)
            if(Test-Path -LiteralPath $archive){throw 'Archive collision'}
            $files=@(Files $target);$bytes=0L;foreach($f in $files){$bytes += [long]$f.bytes}
            Copy-Item -LiteralPath $target -Destination $archive -Recurse
            $actual=@(Files $archive);if($actual.Count -ne $files.Count){throw 'Archive count differs'}
            $lookup=@{};foreach($f in $actual){$lookup[$f.relative]=$f}
            foreach($f in $files){
                if($lookup[$f.relative].sha256 -cne $f.sha256 -or $lookup[$f.relative].bytes -ne $f.bytes){throw 'Archive bytes differ'}
            }
            $result.records+=@{source=$target;archive=$archive;files=$files;bytes=$bytes;removed=$false}
            [IO.File]::WriteAllText($receipt,($result|ConvertTo-Json -Depth 18),[Text.UTF8Encoding]::new($false))
            if((Id $target) -cne $created.directoryId){throw 'Target identity changed'}
            Remove-Item -LiteralPath $target -Recurse -Force
            if((Test-Path -LiteralPath $target) -or (Id $record.original) -cne $record.directoryId){throw 'Deletion/restoration differs'}
            $result.records[-1].removed=$true;$result.bytesRemovedFromC+=$bytes
        }
        foreach($record in $state.records|Where-Object {$_.byteInventory}){
            foreach($f in $record.files){if((Sha (Join-Path $record.original $f.relative)) -cne $f.sha256){throw 'Original byte changed'}}
        }
    }
    $result.status='PASS'
}catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
finally{
    $result.finishedAt=(Get-Date).ToUniversalTime().ToString('o')
    [IO.File]::WriteAllText($receipt,($result|ConvertTo-Json -Depth 18),[Text.UTF8Encoding]::new($false))
}
[pscustomobject]@{status=$result.status;directories=$result.records.Count;removedMiB=[math]::Round($result.bytesRemovedFromC/1MB,2)}|ConvertTo-Json
