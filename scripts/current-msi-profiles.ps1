param([ValidateSet('SelfTest','Prepare','Restore')][string]$Action='SelfTest',
    [ValidateSet('incident','recent-en','recent-zh','cross-en','cross-zh','nsis-recent')][string]$Chain='incident')
$ErrorActionPreference='Stop'
$run='F:\AgentVN\QA\Current-MSI-Upgrade-20261021-01\session-01'
$roots=@('C:\Users\1\AppData\Roaming\com.agentvn.editor','C:\Users\1\AppData\Local\com.agentvn.editor')
$suffix='.qa-hold-current-msi-20261021'
$testedSuffix='.qa-tested-current-msi-20261021'
if($Chain -cne 'incident'){
    $run='F:\AgentVN\QA\Current-MSI-Upgrade-20261021-02\'+$Chain
    if($Chain -ceq 'nsis-recent'){$run='F:\AgentVN\QA\Current-NSIS-Upgrade-20261021-01'}
    $suffix+="-"+$Chain
    $testedSuffix+="-"+$Chain
}
$journal=Join-Path $run 'profile-protection.json'
function Save($file,$value){
    if(Test-Path -LiteralPath $file){throw 'Do not overwrite profile evidence'}
    [IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 14),[Text.UTF8Encoding]::new($false))
}
function Boundary($original,$held,$retained){
    if($original -cnotin $roots -or $held -cne ($original+$suffix) -or
        $retained -cne ($original+$testedSuffix)){throw 'Exact Editor profile boundary required'}
}
function Id($directory){
    if(!(Test-Path -LiteralPath $directory)){return $null}
    $text=(& fsutil.exe file queryfileid $directory|Out-String)
    if($LASTEXITCODE -ne 0 -or $text -notmatch '0x[0-9a-fA-F]+'){throw 'NTFS identity unavailable'}
    $Matches[0].ToLowerInvariant()
}
function Files($directory){
    $entries=@(Get-Item -LiteralPath $directory -Force)+@(Get-ChildItem -LiteralPath $directory -Recurse -Force)
    if(@($entries|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count){throw 'Reparse point in inventoried profile'}
    @(foreach($file in $entries|Where-Object {!$_.PSIsContainer}){
        @{relative=$file.FullName.Substring($directory.Length+1);bytes=$file.Length
          sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
    })
}
function VerifyFiles($expected,$actual){
    if(@($expected).Count -ne @($actual).Count){throw 'Profile file count differs'}
    $lookup=@{};foreach($file in $actual){$lookup[$file.relative]=$file}
    foreach($file in $expected){
        $other=$lookup[$file.relative]
        if(!$other -or $other.sha256 -cne $file.sha256 -or $other.bytes -ne $file.bytes){throw 'Profile bytes differ'}
    }
}
if($Action -ceq 'SelfTest'){
    $expectedRun=if($Chain -ceq 'incident'){'F:\AgentVN\QA\Current-MSI-Upgrade-20261021-01\session-01'}
        elseif($Chain -ceq 'nsis-recent'){'F:\AgentVN\QA\Current-NSIS-Upgrade-20261021-01'}
        else{'F:\AgentVN\QA\Current-MSI-Upgrade-20261021-02\'+$Chain}
    if($run -cne $expectedRun -or $journal -cne ($expectedRun+'\profile-protection.json')){
        throw 'Profile journal must belong to the selected current session'
    }
    foreach($original in $roots){Boundary $original ($original+$suffix) ($original+$testedSuffix)}
    foreach($original in @('C:\Users\1','C:\Users\1\AppData','D:\AgentVN',
        ($roots[0]+'\nested'),($roots[1]+'\..'),'F:\AgentVN')){
        $accepted=$true;try{Boundary $original ($original+$suffix) ($original+$testedSuffix)}catch{$accepted=$false}
        if($accepted){throw 'Profile boundary accepted an unrelated directory'}
    }
    'PASS: eight Editor profile boundaries and selected-session journal, no profile mutation';exit
}
if(!(Test-Path -LiteralPath $run -PathType Container)){throw 'Current MSI session must exist'}
if(@(Get-CimInstance Win32_Process|Where-Object {
    $_.Name -match '^(agentvn-editor|AgentVN Dev|creator-backend|agentvn-player)\.exe$' -or
    ($_.Name -ceq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.editor')
}).Count){throw 'Editor/Player/backend may be using original profiles'}
if($Action -ceq 'Prepare'){
    if(Test-Path -LiteralPath $journal){throw 'Fresh profile journal required'}
    $records=@()
    foreach($original in $roots){
        $held=$original+$suffix;$retained=$original+$testedSuffix
        Boundary $original $held $retained
        $item=Get-Item -LiteralPath $original -Force
        if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked original Editor profile'}
        $archive=Join-Path $run ('profile-'+[IO.Path]::GetFileName([IO.Path]::GetDirectoryName($original)).ToLowerInvariant())
        if((Test-Path -LiteralPath $held) -or (Test-Path -LiteralPath $retained) -or (Test-Path -LiteralPath $archive)){
            throw 'Hold/retained/archive collision'
        }
        $record=@{original=$original;held=$held;retained=$retained;archive=$archive;directoryId=(Id $original)
            byteInventory=($original -ceq $roots[0]);files=@()}
        if($record.byteInventory){$record.files=@(Files $original)}
        $records+=$record
    }
    Save $journal @{status='JOURNALED';at=(Get-Date).ToUniversalTime().ToString('o');records=$records
        originalLocalVerification='Original Local cache NTFS identity only: protected cache ACLs are not traversed'}
    foreach($record in $records){
        [IO.Directory]::Move($record.original,$record.held)
        $null=New-Item -ItemType Directory -Path $record.original
        Save (Join-Path $run ('created-'+[IO.Path]::GetFileName($record.archive)+'.json')) @{
            original=$record.original;directoryId=(Id $record.original)}
    }
    'PASS: two original Editor profiles held on same volume; physical blank defaults created';exit
}
$state=Get-Content -LiteralPath $journal -Raw -Encoding UTF8|ConvertFrom-Json
if($state.records.Count -ne 2 -or @($state.records.original|Select-Object -Unique).Count -ne 2){
    throw 'Two distinct original profile records required'
}
$result=[ordered]@{status='RUNNING';records=@();deletedUserFiles=0;originalsRestored=$false
    at=(Get-Date).ToUniversalTime().ToString('o');error=$null}
try{
    # Return both user directories before inspecting or archiving any QA cache.
    foreach($record in $state.records){
        Boundary $record.original $record.held $record.retained
        $createdFile=Join-Path $run ('created-'+[IO.Path]::GetFileName($record.archive)+'.json')
        if(!(Test-Path -LiteralPath $createdFile)){
            if(!(Test-Path -LiteralPath $record.original) -and (Id $record.held) -ceq $record.directoryId){
                [IO.Directory]::Move($record.held,$record.original)
            }
            if((Id $record.original) -cne $record.directoryId){throw 'Interrupted preparation needs explicit recovery'}
            $result.records+=@{original=$record.original;directoryId=$record.directoryId;prepareNotReached=$true}
            continue
        }
        $created=Get-Content -LiteralPath $createdFile -Raw -Encoding UTF8|ConvertFrom-Json
        if($created.original -cne $record.original -or (Id $record.held) -cne $record.directoryId -or
            (Id $record.original) -cne $created.directoryId -or (Test-Path -LiteralPath $record.retained)){
            throw 'Original/created profile identity or collision differs'
        }
        [IO.Directory]::Move($record.original,$record.retained)
        [IO.Directory]::Move($record.held,$record.original)
        if((Id $record.original) -cne $record.directoryId){throw 'Restored user profile identity differs'}
        if($record.byteInventory){VerifyFiles $record.files @(Files $record.original)}
        $result.records+=@{original=$record.original;directoryId=$record.directoryId;retained=$record.retained
            archive=$record.archive;createdId=$created.directoryId;byteInventory=$record.byteInventory
            originalFiles=@($record.files).Count;qaRemoved=$false}
    }
    $result.originalsRestored=$true
    foreach($record in $result.records|Where-Object {!$_.prepareNotReached}){
        if(Test-Path -LiteralPath $record.archive){throw 'Existing QA archive; do not overwrite'}
        $files=@(Files $record.retained)
        Copy-Item -LiteralPath $record.retained -Destination $record.archive -Recurse
        VerifyFiles $files @(Files $record.archive)
        $target=[IO.Path]::GetFullPath($record.retained)
        Boundary $record.original ($record.original+$suffix) $target
        if((Id $target) -cne $record.createdId){throw 'QA-only cleanup identity differs'}
        # Only the created QA sibling, after source directories are restored and
        # every QA byte archived; never recursively remove the original profile.
        Remove-Item -LiteralPath $target -Recurse -Force
        $record.qaRemoved=$true;$record.archivedFiles=$files.Count
    }
    $result.status='PASS'
}catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
finally{Save (Join-Path $run 'profile-restoration.json') $result}
[pscustomobject]$result|Select-Object status,originalsRestored,deletedUserFiles|ConvertTo-Json
