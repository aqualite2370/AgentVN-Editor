param(
    [ValidateSet('Prepare','Restore')][string]$Action,
    [Parameter(Mandatory=$true)][string]$RunDirectory,
    [ValidateSet('Junction','NativeRoaming')][string]$Storage='Junction',
    [switch]$CodexCacheView,
    [switch]$ValidateOnly
)
$ErrorActionPreference='Stop'
$run=[IO.Path]::GetFullPath($RunDirectory)
$taskRoot=[IO.Path]::GetDirectoryName($run)
if([IO.Path]::GetDirectoryName($taskRoot) -ne 'F:\AgentVN\QA' -or
   [IO.Path]::GetFileName($taskRoot) -notmatch '^Native-(Dev-Preview-(Repair-)?|Runtime-State-)20261020-\d{2}$' -or
   !$run.StartsWith($taskRoot+'\',[StringComparison]::OrdinalIgnoreCase) -or
   !(Test-Path -LiteralPath $run -PathType Container)){throw 'Unexpected QA boundary'}
$roots=@('C:\Users\1\AppData\Roaming\com.agentvn.player',
         'C:\Users\1\AppData\Local\com.agentvn.player',
         'C:\Users\1\AppData\Local\com.agentvn.editor\gamecli-preview')
if([IO.Path]::GetFileName($taskRoot) -match '^Native-Runtime-State-') {
    # A library-only acceptance does not touch Editor's external-preview cache.
    $roots=$roots[0..1]
}
if($CodexCacheView) {
    if([IO.Path]::GetFileName($taskRoot) -notmatch '^Native-Runtime-State-'){
        throw 'Explicit Codex profile view is limited to Runtime isolation'
    }
    $roots=@('C:\Users\1\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Roaming\com.agentvn.player',
             'C:\Users\1\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\com.agentvn.player')
    foreach($profileRoot in $roots) {
        if(!(Test-Path -LiteralPath ([IO.Path]::GetDirectoryName($profileRoot)) -PathType Container)){
            throw 'Expected explicit Codex profile parent absent'
        }
    }
}
if($Storage -eq 'NativeRoaming' -and [IO.Path]::GetFileName($taskRoot) -notmatch '^Native-Runtime-State-') {
    throw 'Physical temporary roaming storage is limited to the runtime state suite'
}
if($ValidateOnly) {
    [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
    @{validationOnly=$true;run=$run;storage=$Storage;roots=$roots} | ConvertTo-Json -Depth 3
    return
}
$stateFile=Join-Path $run 'profile-protection.json'
function Save($file,$value) {
    if(Test-Path -LiteralPath $file){throw "Evidence exists: $file"}
    [IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
}
function FileSha($file) {
    $stream=[IO.File]::OpenRead($file)
    $hasher=[Security.Cryptography.SHA256]::Create()
    try{return ([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
    finally{$hasher.Dispose();$stream.Dispose()}
}
function DirectoryId($directory) {
    if(!(Test-Path -LiteralPath $directory)){return $null}
    $result=(& fsutil.exe file queryfileid $directory | Out-String).Trim()
    if($LASTEXITCODE -ne 0 -or $result -notmatch '0x[0-9a-fA-F]+'){throw 'Cannot record NTFS directory identity'}
    return $Matches[0].ToLowerInvariant()
}
function Inventory($directory) {
    if(!(Test-Path -LiteralPath $directory)){return @()}
    $items=@(Get-Item -LiteralPath $directory -Force)+@(Get-ChildItem -LiteralPath $directory -Recurse -Force)
    $rows=@()
    foreach($item in $items) {
        if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked original profile'}
        if(!$item.PSIsContainer) {
            $rows+=@{relative=$item.FullName.Substring($directory.Length+1);bytes=$item.Length;
                sha256=(FileSha $item.FullName)}
        }
    }
    return $rows
}
$active=@(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'agentvn-player.exe' -or
    ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.player')
})
if($active.Count){throw 'Player profile is in use; refuse profile operation'}
if($Action -eq 'Prepare') {
    if(Test-Path -LiteralPath $stateFile){throw 'Protection state already exists'}
    $records=@()
    foreach($original in $roots) {
        $held=$original+'.qa-hold-native-preview-20261020'
        $target=Join-Path $run ('player-'+(Split-Path (Split-Path $original -Parent) -Leaf).ToLowerInvariant())
        if([IO.Path]::GetDirectoryName($held) -ne [IO.Path]::GetDirectoryName($original) -or
           !$target.StartsWith($run+'\',[StringComparison]::OrdinalIgnoreCase) -or
           (Test-Path -LiteralPath $held) -or (Test-Path -LiteralPath $target)){throw 'Protection collision or move boundary'}
        # Edge component-cache children can have protected ACLs. Preserve the
        # entire Local directory untouched, recording its NTFS identity instead.
        $byteInventory=$original -ne $roots[1]
        $files=if($byteInventory){@(Inventory $original)}else{@()}
        $nativeRoaming=$Storage -eq 'NativeRoaming' -and $original -eq $roots[0]
        $retained=$original+'.qa-native-runtime-'+[IO.Path]::GetFileName($run)
        if($nativeRoaming -and (Test-Path -LiteralPath $retained)){throw 'Native test retention collision'}
        $records+=@{original=$original;held=$held;target=$target;existed=(Test-Path -LiteralPath $original);
            directoryId=(DirectoryId $original);byteInventory=$byteInventory;files=@($files);
            storage=$(if($nativeRoaming){'NativeRoaming'}else{'Junction'});retained=$retained}
    }
    # Journal precedes all mutations so partial setup is recoverable.
    Save $stateFile @{status='JOURNALED';at=(Get-Date).ToUniversalTime().ToString('o');records=$records}
    foreach($record in $records) {
        if($record.existed){Move-Item -LiteralPath $record.original -Destination $record.held}
        if($record.storage -eq 'NativeRoaming') {
            New-Item -ItemType Directory -Path $record.original | Out-Null
            Save (Join-Path $run 'native-test-profile-identity.json') @{
                original=$record.original;directoryId=(DirectoryId $record.original)
            }
        } else {
            New-Item -ItemType Directory -Path $record.target | Out-Null
            New-Item -ItemType Junction -Path $record.original -Target $record.target | Out-Null
        }
    }
    Write-Output 'PASS original Player profiles held; test paths redirected to F drive'
} else {
    $state=Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8|ConvertFrom-Json
    $restored=@()
    foreach($record in $state.records) {
        if($record.original -notin $roots -or
           $record.held -ne ($record.original+'.qa-hold-native-preview-20261020') -or
           !$record.target.StartsWith($run+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Restoration boundary mismatch'}
        $item=Get-Item -LiteralPath $record.original -Force -ErrorAction SilentlyContinue
        if($item) {
            if($record.storage -eq 'NativeRoaming') {
                $created=Get-Content -LiteralPath (Join-Path $run 'native-test-profile-identity.json') -Raw -Encoding UTF8|ConvertFrom-Json
                if($record.original -ne $roots[0] -or
                   $record.retained -ne ($record.original+'.qa-native-runtime-'+[IO.Path]::GetFileName($run)) -or
                   (Test-Path -LiteralPath $record.retained) -or
                   $item.Attributes -band [IO.FileAttributes]::ReparsePoint -or
                   $created.original -ne $record.original -or
                   (DirectoryId $record.original) -ne $created.directoryId){throw 'Native test profile identity mismatch'}
                # Same-volume rename first; restore user data before archiving QA bytes.
                Move-Item -LiteralPath $record.original -Destination $record.retained
            } else {
                if(!($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
                   [IO.Path]::GetFullPath([string]$item.Target) -ne $record.target){throw 'Unexpected original path; refuse removal'}
                # Remove only this exact junction, never its target or descendants.
                $item.Delete()
            }
        }
        if($record.existed) {
            if(!(Test-Path -LiteralPath $record.held)){throw 'Original held profile missing'}
            Move-Item -LiteralPath $record.held -Destination $record.original
        }
        if((DirectoryId $record.original) -ne $record.directoryId){throw 'Original NTFS directory identity changed'}
        $actual=if($record.byteInventory){@(Inventory $record.original)}else{@()}
        if($actual.Count -ne $record.files.Count){throw 'Restored original count differs'}
        foreach($file in $record.files) {
            if(@($actual|Where-Object {$_.relative -eq $file.relative -and $_.sha256 -eq $file.sha256}).Count -ne 1) {
                throw 'Restored original bytes differ'
            }
        }
        if($record.storage -eq 'NativeRoaming') {
            if(Test-Path -LiteralPath $record.target){throw 'Native QA archive target already exists'}
            $generated=@(Inventory $record.retained)
            Copy-Item -LiteralPath $record.retained -Destination $record.target -Recurse
            $archived=@(Inventory $record.target)
            if($generated.Count -ne $archived.Count){throw 'Generated profile archive count mismatch'}
            foreach($file in $generated) {
                if(@($archived|Where-Object {$_.relative -eq $file.relative -and $_.sha256 -eq $file.sha256}).Count -ne 1) {
                    throw 'Generated profile archive byte mismatch'
                }
            }
            # Exact bounded QA-only sibling, identified before the same-volume move;
            # user profile has been restored and every generated byte is retained on F.
            $removeTarget=[IO.Path]::GetFullPath($record.retained)
            if($removeTarget -ne ($roots[0]+'.qa-native-runtime-'+[IO.Path]::GetFileName($run)) -or
               [IO.Path]::GetDirectoryName($removeTarget) -ne [IO.Path]::GetDirectoryName($roots[0]) -or
               (DirectoryId $removeTarget) -ne $created.directoryId){throw 'QA-only removal boundary mismatch'}
            Remove-Item -LiteralPath $removeTarget -Recurse -Force
        }
        $restored+=@{original=$record.original;files=@($actual);directoryId=(DirectoryId $record.original);
            byteInventory=$record.byteInventory;testProfileRetained=$record.target}
    }
    Save (Join-Path $run 'profile-restoration.json') @{status='PASS';at=(Get-Date).ToUniversalTime().ToString('o');
        restored=$restored;deletedUserFiles=0;removedOnlyOwnedJunctions=$true}
    Write-Output 'PASS original Player NTFS directories restored; roaming bytes verified; QA profiles retained on F'
}
