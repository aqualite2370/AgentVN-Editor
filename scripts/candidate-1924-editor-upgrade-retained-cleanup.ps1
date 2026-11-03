# Archive only the twelve exact QA-created profile directories. Original user
# paths and historic reports are never deleted.
param([switch]$SelfTest)
$ErrorActionPreference='Stop'
$base='F:\AgentVN\QA\Editor-Upgrade-1924-20261025-'
$receipt=$base+'05\retained-cleanup-02.json'
function TotalBytes($entries){
    $total=0L
    foreach($entry in $entries){$total += [long]$entry.bytes}
    $total
}
if($SelfTest){
    if((TotalBytes @(@{bytes=12},@{bytes=7})) -ne 19 -or
        (TotalBytes @()) -ne 0 -or (TotalBytes @(@{bytes=4294967296L})) -ne 4294967296L){
        throw 'Byte accounting regression'
    }
    '{"status":"PASS","cases":3,"scope":"PowerShell hashtable byte accounting"}'
    exit 0
}
if(Test-Path -LiteralPath $receipt){throw 'Fresh cleanup receipt required'}
if(@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match
    '^(agentvn-editor|AgentVN Dev|agentvn-player|creator-backend)\.exe$'}).Count){throw 'Product still active'}
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
    foreach($attempt in @('02','03','04','05')){
        $run=$base+$attempt
        $state=Read (Join-Path $run 'protection.json')
        $restoration=Read (Join-Path $run $(if($attempt -ceq '02'){'recovery-02.json'}else{'Restore.json'}))
        if($restoration.status -cne 'PASS'){throw 'Successful original restoration required'}
        for($i=0;$i -lt 3;$i++){
            $record=$state.records[$i]
            $created=Read (Join-Path $run ('created-'+$i+'.json'))
            $target=[IO.Path]::GetFullPath([string]$record.retained)
            if($target -cne ($record.original+'.qa-tested-editor-upgrade-1924-20261025-'+$attempt) -or
                $record.original -cnotin @('C:\Users\1\AppData\Roaming\com.agentvn.editor',
                'C:\Users\1\AppData\Local\com.agentvn.editor','C:\Users\1\AppData\Local\AgentVN\environment-cache')){
                throw 'Unknown cleanup boundary'
            }
            if((Id $record.original) -cne $record.directoryId){throw 'Original identity differs'}
            $archive=Join-Path $run ('archived-profile-'+$i)
            if($attempt -ceq '02' -and $i -eq 0 -and !(Test-Path -LiteralPath $target)){
                $previous=Read ($base+'05\retained-cleanup-01.json')
                if($previous.status -cne 'FAILED' -or
                    $previous.error -notmatch 'Property' -or !(Test-Path -LiteralPath $archive)){
                    throw 'Unknown prior cleanup state'
                }
                $archived=@(Files $archive)
                $result.records+=@{source=$target;archive=$archive;files=$archived;
                    bytes=(TotalBytes $archived);removed=$true;
                    priorAttempt='retained-cleanup-01.json';
                    note='Prior attempt verified archive then deleted this QA source before accounting failed; no second deletion'}
                $result.bytesRemovedFromC+=(TotalBytes $archived)
                continue
            }
            if((Id $target) -cne $created.directoryId){throw 'QA identity differs'}
            if(Test-Path -LiteralPath $archive){throw 'Archive collision'}
            $files=@(Files $target)
            $bytes=TotalBytes $files
            Copy-Item -LiteralPath $target -Destination $archive -Recurse
            $actual=@(Files $archive);if($actual.Count -ne $files.Count){throw 'Archive count differs'}
            $lookup=@{};foreach($f in $actual){$lookup[$f.relative]=$f}
            foreach($f in $files){
                if($lookup[$f.relative].sha256 -cne $f.sha256 -or $lookup[$f.relative].bytes -ne $f.bytes){throw 'Archive bytes differ'}
            }
            if((Id $target) -cne $created.directoryId){throw 'Target identity changed during archive'}
            $result.records+=@{source=$target;archive=$archive;files=$files;bytes=$bytes;removed=$false}
            [IO.File]::WriteAllText($receipt,($result|ConvertTo-Json -Depth 18),[Text.UTF8Encoding]::new($false))
            # Exact resolved QA sibling checked above, after all bytes are
            # verified in F. Never recurse through a compatibility Junction.
            Remove-Item -LiteralPath $target -Recurse -Force
            if(Test-Path -LiteralPath $target){throw 'QA residue remains'}
            if((Id $record.original) -cne $record.directoryId){throw 'Original directory changed'}
            $result.bytesRemovedFromC+=$bytes
            $result.records[-1].removed=$true
        }
    }
    $result.status='PASS'
}catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
finally{
    $result.finishedAt=(Get-Date).ToUniversalTime().ToString('o')
    [IO.File]::WriteAllText($receipt,($result|ConvertTo-Json -Depth 18),[Text.UTF8Encoding]::new($false))
}
[pscustomobject]@{status=$result.status;archivedDirectories=$result.records.Count;removedMiB=[math]::Round($result.bytesRemovedFromC/1MB,2)}|ConvertTo-Json
