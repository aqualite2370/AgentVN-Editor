param(
    [ValidateSet('SelfTest','Prepare','Restore')][string]$Action='SelfTest',
    [Parameter(Mandatory=$true)][string]$RunDirectory,
    [switch]$CodexCacheView
)
$ErrorActionPreference='Stop'
$run=[IO.Path]::GetFullPath($RunDirectory)
$qa='F:\AgentVN\QA\Windows-Package-20261021-01'
function Boundary($directory) {
    $absolute=[IO.Path]::GetFullPath($directory)
    if([IO.Path]::GetDirectoryName($absolute) -cne $qa -or
       [IO.Path]::GetFileName($absolute) -notmatch '^editor-\d{2}$'){throw 'Exact Windows package session required'}
}
Boundary $run
if($Action -eq 'SelfTest'){
    $tests=@(@($run,$true),@($qa,$false),@(($qa+'\editor-01'),$true),
      @(($qa+'\editor-01\nested'),$false),@(($qa+'\editor-1'),$false),
      @('D:\AgentVN',$false),@('F:\',$false),@('C:\Users\1',$false))
    foreach($test in $tests){
        $valid=$true;try{Boundary $test[0]}catch{$valid=$false}
        if($valid -ne $test[1]){throw 'Package boundary selftest failed'}
    }
    'PASS: eight exact package-cache boundaries; no mutations';exit
}
if(!(Test-Path -LiteralPath $run -PathType Container)){throw 'Existing QA run required'}
$original='C:\Users\1\AppData\Local\com.agentvn.editor\standalone-package'
if($CodexCacheView){
    $physical='C:\Users\1\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\com.agentvn.editor\standalone-package'
    if(!(Test-Path -LiteralPath ([IO.Path]::GetDirectoryName($physical)) -PathType Container)){throw 'Codex package-cache view absent'}
    $original=$physical
}
$held=$original+'.qa-hold-windows-package-20261021'
$target=Join-Path $run 'package-cache'
$journal=Join-Path $run 'package-cache-protection.json'
function Save($file,$value){[IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))}
function Sha($file){
    $stream=[IO.File]::OpenRead($file);$hasher=[Security.Cryptography.SHA256]::Create()
    try{([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
    finally{$stream.Dispose();$hasher.Dispose()}
}
function Id($directory){
    $text=(& fsutil.exe file queryfileid $directory|Out-String)
    if($LASTEXITCODE -ne 0 -or $text -notmatch '0x[0-9a-fA-F]+'){throw 'Directory identity unavailable'}
    $Matches[0].ToLowerInvariant()
}
function Files($directory){
    $entries=@(Get-Item -LiteralPath $directory -Force)+@(Get-ChildItem -LiteralPath $directory -Recurse -Force)
    if(@($entries|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count){throw 'Linked original package cache'}
    @(foreach($file in $entries|Where-Object {!$_.PSIsContainer}){
        @{relative=$file.FullName.Substring($directory.Length+1);bytes=$file.Length;sha256=(Sha $file.FullName)}
    })
}
if(@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '^(agentvn-editor|AgentVN Dev|creator-backend)\.exe$'}).Count){
    throw 'Editor/backend must be stopped before package-cache operations'
}
if($Action -eq 'Prepare'){
    if((Test-Path -LiteralPath $journal) -or (Test-Path -LiteralPath $held) -or (Test-Path -LiteralPath $target)){throw 'Fresh cache journal required'}
    $exists=Test-Path -LiteralPath $original
    $state=@{status='JOURNALED';original=$original;held=$held;target=$target;existed=$exists;files=@();at=(Get-Date).ToUniversalTime().ToString('o')}
    if($exists){$state.files=@(Files $original);$state.directoryId=Id $original}
    Save $journal $state
    try{
        if($exists){[IO.Directory]::Move($original,$held)}
        $null=New-Item -ItemType Directory -Path $target
        $null=New-Item -ItemType Junction -Path $original -Target $target
        $state.status='PASS';Save $journal $state
    }catch{
        $state.status='FAILED';$state.error=$_.Exception.Message
        if($exists -and (Test-Path -LiteralPath $held) -and !(Test-Path -LiteralPath $original)){[IO.Directory]::Move($held,$original)}
        Save $journal $state;throw
    }
    'PASS: original package cache held; new build bytes redirected to F';exit
}
$state=Get-Content -LiteralPath $journal -Raw -Encoding UTF8|ConvertFrom-Json
if($state.original -cne $original -or $state.held -cne $held -or $state.target -cne $target){throw 'Restore journal boundary mismatch'}
$item=Get-Item -LiteralPath $original -Force
if(!($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or [IO.Path]::GetFullPath([string]$item.Target) -cne $target){throw 'Only owned exact Junction may be removed'}
if($state.existed){
    if((Id $held) -cne $state.directoryId){throw 'Held package directory identity differs'}
    $actual=@(Files $held)
    if($actual.Count -ne $state.files.Count){throw 'Held package count differs'}
    foreach($file in $state.files){if((Sha (Join-Path $held $file.relative)) -cne $file.sha256){throw 'Held package bytes differ'}}
}
# Only unlink the validated junction. No recursive deletion or target traversal.
$item.Delete()
if($state.existed){
    [IO.Directory]::Move($held,$original)
    if((Id $original) -cne $state.directoryId){throw 'Restored package identity differs'}
}
Save (Join-Path $run 'package-cache-restoration.json') @{
    status='PASS';at=(Get-Date).ToUniversalTime().ToString('o');deletedUserFiles=0
    retainedTestCache=$target;originalFiles=$state.files.Count;originalDirectoryId=$state.directoryId
}
'PASS: original package cache restored unchanged; test workspace retained on F'
