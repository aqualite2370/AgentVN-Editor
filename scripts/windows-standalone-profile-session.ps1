param(
    [ValidateSet('SelfTest','Prepare','Restore')][string]$Action='SelfTest',
    [Parameter(Mandatory=$true)][string]$RunDirectory
)
$ErrorActionPreference='Stop'
$qa='F:\AgentVN\QA\Windows-Package-20261021-01'
$run=[IO.Path]::GetFullPath($RunDirectory)
function Boundary($directory) {
    $absolute=[IO.Path]::GetFullPath($directory)
    if([IO.Path]::GetDirectoryName($absolute) -cne $qa -or
       [IO.Path]::GetFileName($absolute) -notmatch '^runtime-\d{2}$'){throw 'Exact standalone runtime QA boundary required'}
}
Boundary $run
if($Action -eq 'SelfTest') {
    $tests=@(@($run,$true),@(($qa+'\runtime-02'),$true),@($qa,$false),
      @(($qa+'\runtime-01\child'),$false),@(($qa+'\editor-01'),$false),
      @(($qa+'\runtime-1'),$false),@('D:\AgentVN',$false),@('C:\Users\1',$false))
    foreach($test in $tests) {
        $accepted=$true;try{Boundary $test[0]}catch{$accepted=$false}
        if($accepted -ne $test[1]){throw 'Standalone profile boundary selftest failed'}
    }
    'PASS: eight exact standalone profile boundaries; no profile mutation';exit
}
if(!(Test-Path -LiteralPath $run -PathType Container)){throw 'Existing exact QA directory required'}
# The installed Windows builder currently retains this Tauri identifier.
# Never expose existing real game profiles to the QA binary.
$roots=@('C:\Users\1\AppData\Roaming\com.agentvn.hidden.growth',
         'C:\Users\1\AppData\Local\com.agentvn.hidden.growth')
$journal=Join-Path $run 'profile-protection.json'
function Save($file,$value) {
    if(Test-Path -LiteralPath $file){throw "Evidence already exists: $file"}
    [IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 14),[Text.UTF8Encoding]::new($false))
}
function Id($directory) {
    if(!(Test-Path -LiteralPath $directory)){return $null}
    $text=(& fsutil.exe file queryfileid $directory|Out-String)
    if($LASTEXITCODE -ne 0 -or $text -notmatch '0x[0-9a-fA-F]+'){throw 'Directory identity unavailable'}
    $Matches[0].ToLowerInvariant()
}
function Files($directory) {
    if(!(Test-Path -LiteralPath $directory)){return @()}
    $entries=@(Get-Item -LiteralPath $directory -Force)+@(Get-ChildItem -LiteralPath $directory -Recurse -Force)
    if(@($entries|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count){throw 'Reparse point in byte-inventoried profile'}
    @(foreach($file in $entries|Where-Object {!$_.PSIsContainer}) {
        $stream=[IO.File]::OpenRead($file.FullName)
        $hasher=[Security.Cryptography.SHA256]::Create()
        try{$digest=([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
        finally{$hasher.Dispose();$stream.Dispose()}
        @{relative=$file.FullName.Substring($directory.Length+1);bytes=$file.Length;
          sha256=$digest}
    })
}
function AssertFiles($expected,$actual) {
    if(@($expected).Count -ne @($actual).Count){throw 'Profile file count differs'}
    foreach($file in $expected) {
        if(@($actual|Where-Object {$_.relative -ceq $file.relative -and $_.bytes -eq $file.bytes -and
          $_.sha256 -ceq $file.sha256}).Count -ne 1){throw 'Profile bytes differ'}
    }
}
if(@(Get-CimInstance Win32_Process|Where-Object {
    $_.Name -eq 'agentvn-player.exe' -or ($_.Name -eq 'msedgewebview2.exe' -and
      $_.CommandLine -match 'com\.agentvn\.hidden\.growth')
}).Count){throw 'Player profile may be in use; refuse mutation'}
$suffix='.qa-hold-windows-package-20261021'
if($Action -eq 'Prepare') {
    if(Test-Path -LiteralPath $journal){throw 'Fresh profile journal required'}
    $records=@()
    foreach($original in $roots) {
        $held=$original+$suffix
        $retained=$original+'.qa-test-windows-package-'+[IO.Path]::GetFileName($run)
        $archive=Join-Path $run ('profile-'+[IO.Path]::GetFileName([IO.Path]::GetDirectoryName($original)).ToLowerInvariant())
        if((Test-Path -LiteralPath $held) -or (Test-Path -LiteralPath $retained) -or
          (Test-Path -LiteralPath $archive)){throw 'Profile hold/archive collision'}
        $item=Get-Item -LiteralPath $original -Force -ErrorAction SilentlyContinue
        if($item -and $item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked original profile'}
        $byteInventory=$original -ceq $roots[0]
        $records+=@{original=$original;held=$held;retained=$retained;archive=$archive;
          existed=($null -ne $item);directoryId=(Id $original);byteInventory=$byteInventory;
          files=$(if($byteInventory){@(Files $original)}else{@()})}
    }
    Save $journal @{status='JOURNALED';records=$records;at=(Get-Date).ToUniversalTime().ToString('o');
      originalLocalVerification='NTFS identity only; protected browser-cache ACLs are not traversed'}
    foreach($record in $records) {
        if($record.existed){[IO.Directory]::Move($record.original,$record.held)}
        $null=New-Item -ItemType Directory -Path $record.original
        Save (Join-Path $run ('created-'+[IO.Path]::GetFileName($record.archive)+'.json')) @{
          original=$record.original;directoryId=(Id $record.original)}
    }
    'PASS: original profiles held on same volume; physical empty QA profiles created';exit
}
$state=Get-Content -LiteralPath $journal -Raw -Encoding UTF8|ConvertFrom-Json
if(@($state.records).Count -ne 2 -or
  @($state.records.original|Select-Object -Unique).Count -ne 2){throw 'Exactly two distinct original profiles required'}
$results=@()
foreach($record in $state.records) {
    if($record.original -cnotin $roots -or $record.held -cne ($record.original+$suffix) -or
      $record.retained -cne ($record.original+'.qa-test-windows-package-'+[IO.Path]::GetFileName($run)) -or
      [IO.Path]::GetDirectoryName($record.archive) -cne $run){throw 'Profile restore boundary differs'}
    $createdFile=Join-Path $run ('created-'+[IO.Path]::GetFileName($record.archive)+'.json')
    if(!(Test-Path -LiteralPath $createdFile)) {
        # Recover a Prepare stopped before creating the temporary directory.
        # An unknown replacement at the original path is never removed.
        if($record.existed -and !(Test-Path -LiteralPath $record.original) -and
          (Id $record.held) -ceq $record.directoryId){[IO.Directory]::Move($record.held,$record.original)}
        if((Id $record.original) -cne $record.directoryId -or (Test-Path -LiteralPath $record.held)){
            throw 'Incomplete Prepare needs manual recovery; unknown replacement not removed'
        }
        if($record.byteInventory){AssertFiles $record.files @(Files $record.original)}
        $results+=@{original=$record.original;directoryId=(Id $record.original);prepareNotReached=$true}
        continue
    }
    $created=Get-Content -LiteralPath $createdFile -Raw|ConvertFrom-Json
    if($created.original -cne $record.original -or (Id $record.original) -cne $created.directoryId -or
      (Test-Path -LiteralPath $record.retained) -or (Test-Path -LiteralPath $record.archive)){throw 'QA profile identity/collision'}
    if($record.existed -and (Id $record.held) -cne $record.directoryId){throw 'Original held profile identity differs'}
    # Restore user paths before archiving any generated QA bytes.
    [IO.Directory]::Move($record.original,$record.retained)
    if($record.existed){[IO.Directory]::Move($record.held,$record.original)}
    if((Id $record.original) -cne $record.directoryId){throw 'Restored original identity differs'}
    if($record.byteInventory){AssertFiles $record.files @(Files $record.original)}
    $generated=@(Files $record.retained)
    Copy-Item -LiteralPath $record.retained -Destination $record.archive -Recurse
    AssertFiles $generated @(Files $record.archive)
    $removeTarget=[IO.Path]::GetFullPath($record.retained)
    if($removeTarget -cne ($record.original+'.qa-test-windows-package-'+[IO.Path]::GetFileName($run)) -or
      [IO.Path]::GetDirectoryName($removeTarget) -cne [IO.Path]::GetDirectoryName($record.original) -or
      (Id $removeTarget) -cne $created.directoryId){throw 'QA-only removal boundary mismatch'}
    # Exact created QA-only directory; originals already restored and every QA
    # file archived and hash-verified. No user profile is recursively removed.
    Remove-Item -LiteralPath $removeTarget -Recurse -Force
    $results+=@{original=$record.original;directoryId=(Id $record.original);
      originalByteInventory=$record.byteInventory;originalFiles=$(if($record.byteInventory){@($record.files).Count}else{0});
      archive=$record.archive;archivedFiles=$generated.Count;qaRemoved=$true}
}
Save (Join-Path $run 'profile-restoration.json') @{status='PASS';records=$results;deletedUserFiles=0;
  at=(Get-Date).ToUniversalTime().ToString('o')}
'PASS: original NTFS profiles restored; roaming bytes verified; only archived QA profiles removed'
