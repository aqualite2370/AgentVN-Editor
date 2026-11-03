param([ValidateSet('Prepare','Restore')][string]$Action,[ValidatePattern('^\d{2}$')][string]$Cycle='01')
$ErrorActionPreference='Stop'
$qa='F:\AgentVN\QA\Portrait-Old-Runtime-20261020-01'
$original='C:\Users\1\AppData\Roaming\com.agentvn.player'
$held='C:\Users\1\AppData\Roaming\com.agentvn.player.qa-hold-portrait-old-runtime-20261020-01'
$suffix=if($Cycle -eq '01'){''}else{'-'+$Cycle}
$tested=Join-Path $qa ('tested-roaming-profile'+$suffix)
$stateFile=Join-Path $qa ('profile-protection'+$suffix+'.json')
function Save($file,$value) {
    if(Test-Path -LiteralPath $file){throw "Do not overwrite evidence: $file"}
    [IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 10),[Text.UTF8Encoding]::new($false))
}
function Idle {
    $players=@(Get-CimInstance Win32_Process|Where-Object {
        $_.Name -eq 'agentvn-player.exe' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.player')
    })
    if($players.Count){throw 'Existing player/default-profile WebView active; leave data untouched'}
}
function Inventory($directory) {
    if(!(Test-Path -LiteralPath $directory)){return @()}
    $root=(Get-Item -LiteralPath $directory -Force)
    if($root.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked profile root'}
    $rows=@()
    foreach($item in (Get-ChildItem -LiteralPath $directory -Recurse -Force)) {
        if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked profile child'}
        if(!$item.PSIsContainer){
            $rows+=@{relative=$item.FullName.Substring($directory.Length+1);
                sha256=(Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant();
                bytes=$item.Length}
        }
    }
    return $rows
}
# Exact, resolved targets: never derive a move from environment variables/globs.
if([IO.Path]::GetFullPath($original) -ne $original -or
   [IO.Path]::GetDirectoryName($held) -ne 'C:\Users\1\AppData\Roaming' -or
   [IO.Path]::GetFullPath($tested) -ne $tested -or
   !$tested.StartsWith($qa+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid move boundary'}
Idle
if($Action -eq 'Prepare'){
    if((Test-Path -LiteralPath $stateFile) -or (Test-Path -LiteralPath $held) -or
       (Test-Path -LiteralPath $tested)){throw 'Profile protection collision'}
    $rows=@(Inventory $original)
    if(!(Test-Path -LiteralPath $original)){throw 'Original player profile missing'}
    $backup=Join-Path $qa ('original-roaming-backup'+$suffix)
    if(Test-Path -LiteralPath $backup){throw 'Backup collision'}
    Copy-Item -LiteralPath $original -Destination $backup -Recurse
    $copied=@(Inventory $backup)
    if($rows.Count -ne $copied.Count){throw 'Backup file count mismatch'}
    foreach($row in $rows){
        $match=@($copied|Where-Object {$_.relative -eq $row.relative -and $_.sha256 -eq $row.sha256})
        if($match.Count -ne 1){throw 'Backup byte mismatch'}
    }
    $state=@{status='PREPARED';at=(Get-Date).ToUniversalTime().ToString('o');
        original=$original;held=$held;backup=$backup;files=$rows;webviewOverride='Fresh F-drive profile, not default-path acceptance'}
    Save $stateFile $state
    Move-Item -LiteralPath $original -Destination $held
    if((Test-Path -LiteralPath $original) -or !(Test-Path -LiteralPath $held)){throw 'Profile hold did not complete'}
    Write-Output 'PASS original roaming profile backed up byte-for-byte and held'
} else {
    $state=Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8|ConvertFrom-Json
    if($state.original -ne $original -or $state.held -ne $held -or
       !(Test-Path -LiteralPath $held) -or (Test-Path -LiteralPath $tested)){throw 'Unexpected restoration state'}
    $testFiles=@(Inventory $original)
    if(Test-Path -LiteralPath $original){
        Move-Item -LiteralPath $original -Destination $tested
        if(Test-Path -LiteralPath $original){throw 'Test profile move did not finish'}
    }
    Move-Item -LiteralPath $held -Destination $original
    $actual=@(Inventory $original)
    if($actual.Count -ne $state.files.Count){throw 'Original profile file count changed'}
    foreach($row in $state.files) {
        $match=@($actual|Where-Object {$_.relative -eq $row.relative -and $_.sha256 -eq $row.sha256})
        if($match.Count -ne 1){throw 'Original profile bytes changed'}
    }
    Save (Join-Path $qa ('profile-restoration'+$suffix+'.json')) @{
        status='PASS';at=(Get-Date).ToUniversalTime().ToString('o');original=$original;
        restoredFiles=$actual;testedProfile=$tested;testFiles=$testFiles;deletedFiles=0
    }
    Write-Output 'PASS original roaming profile restored; test profile retained on F drive'
}
