param(
    [ValidateSet('SelfTest','Prepare','Restore')][string]$Action='SelfTest',
    [Parameter(Mandatory=$true)][string]$RunDirectory,
    [switch]$PhysicalPackageCache,
    [switch]$PhysicalEnvironmentCache
)
# Protect physical caches without altering their bytes or recursively deleting
# anything. A completed session retains its test caches on F for diagnostics.
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -Force
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Management\Microsoft.PowerShell.Management.psd1') -Force
$qa='F:\AgentVN\QA\Android-Package-20261021-01'
$run=[IO.Path]::GetFullPath($RunDirectory)
function Boundary($directory){
    $full=[IO.Path]::GetFullPath($directory)
    if([IO.Path]::GetDirectoryName($full) -cne $qa -or
        [IO.Path]::GetFileName($full) -cnotmatch '^editor-\d{2}$'){throw 'Exact Android package session required'}
}
Boundary $run
if($Action -ceq 'SelfTest'){
    foreach($case in @(@($run,$true),@(($qa+'\editor-01'),$true),@($qa,$false),
        @(($qa+'\editor-1'),$false),@(($run+'\nested'),$false),@('C:\Users\1',$false),
        @('D:\AgentVN',$false),@('F:\AgentVN',$false))){
        $accepted=$true;try{Boundary $case[0]}catch{$accepted=$false}
        if($accepted -ne $case[1]){throw 'Android cache boundary test failed'}
    }
    'PASS: eight exact Android cache session boundaries; no mutations';exit
}
if(!(Test-Path -LiteralPath $run -PathType Container)){throw 'Existing fresh session required'}
if(@(Get-CimInstance Win32_Process|Where-Object {
    $_.Name -match '^(agentvn-editor|AgentVN Dev|creator-backend|agentvn-player)\.exe$'
}).Count){throw 'All Editor/backend/Player processes must be stopped before cache changes'}
function Save($file,$value){[IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))}
function Sha($file){
    $stream=[IO.File]::OpenRead($file);$hash=[Security.Cryptography.SHA256]::Create()
    try{([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
    finally{$stream.Dispose();$hash.Dispose()}
}
function Id($directory){
    $value=(& fsutil.exe file queryfileid $directory|Out-String)
    if($LASTEXITCODE -ne 0 -or $value -notmatch '0x[0-9a-fA-F]+'){throw 'Directory identity unavailable'}
    $Matches[0].ToLowerInvariant()
}
function Files($directory){
    $entries=@(Get-Item -LiteralPath $directory -Force)+@(Get-ChildItem -LiteralPath $directory -Recurse -Force)
    if(@($entries|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count){throw 'Original cache contains a link'}
    @(foreach($file in $entries|Where-Object {!$_.PSIsContainer}|Sort-Object FullName){
        @{relative=$file.FullName.Substring($directory.Length+1);bytes=$file.Length;sha256=(Sha $file.FullName)}
    })
}
function VerifyFiles($row,$directory){
    if((Id $directory) -cne $row.directoryId){throw 'Original directory identity changed'}
    $actual=@(Files $directory)
    if($actual.Count -ne @($row.files).Count){throw 'Original cache file count changed'}
    foreach($file in $row.files){
        $target=Join-Path $directory $file.relative
        if(!(Test-Path -LiteralPath $target -PathType Leaf) -or
            (Get-Item -LiteralPath $target).Length -ne $file.bytes -or (Sha $target) -cne $file.sha256){
            throw 'Original cache bytes changed'
        }
    }
}
$journal=Join-Path $run 'cache-protection.json'
$originals=@('C:\Users\1\AppData\Local\com.agentvn.editor\windows-env',
    'C:\Users\1\AppData\Local\com.agentvn.editor\android-env',
    'C:\Users\1\AppData\Local\com.agentvn.editor\standalone-package',
    'C:\Users\1\AppData\Local\AgentVN\environment-cache')
if($Action -ceq 'Prepare'){
    if(Test-Path -LiteralPath $journal){throw 'Never overwrite a cache journal'}
    $state=@{status='JOURNALED';at=[DateTime]::UtcNow.ToString('o');rows=@()}
    foreach($original in $originals){
        $target=Join-Path $run ('native-'+[IO.Path]::GetFileName($original))
        $held=$original+'.qa-hold-android-current-20261021'
        if((Test-Path -LiteralPath $held) -or (Test-Path -LiteralPath $target)){throw 'Fresh cache and hold required'}
        $exists=Test-Path -LiteralPath $original
        $physical=($PhysicalPackageCache -and [IO.Path]::GetFileName($original) -ceq 'standalone-package') -or
            ($PhysicalEnvironmentCache -and [IO.Path]::GetFileName($original) -ceq 'environment-cache')
        $owned=$original+'.qa-tested-android-current-'+[IO.Path]::GetFileName($run)+'-20261021'
        if($physical -and (Test-Path -LiteralPath $owned)){throw 'Fresh retained physical test cache required'}
        $row=@{original=$original;held=$held;target=$target;existed=$exists;files=@();moved=$false;linked=$false
            physical=$physical;owned=$owned}
        if($exists){$row.directoryId=Id $original;$row.files=@(Files $original)}
        $state.rows+=$row
    }
    Save $journal $state
    try{
        foreach($row in $state.rows){
            if($row.existed){[IO.Directory]::Move($row.original,$row.held);$row.moved=$true;Save $journal $state}
            if($row.physical){
                $null=New-Item -ItemType Directory -Path $row.original
                $row.testDirectoryId=Id $row.original
            }else{
                $null=New-Item -ItemType Directory -Path $row.target
                $null=New-Item -ItemType Junction -Path $row.original -Target $row.target
                $row.linked=$true
            }
            Save $journal $state
        }
        $state.status='PASS';Save $journal $state
    }catch{$state.status='FAILED';$state.error=$_.Exception.ToString();Save $journal $state;throw}
    'PASS: four physical originals retained; explicit physical-package exception recorded when requested';exit
}
$state=[IO.File]::ReadAllText($journal,[Text.Encoding]::UTF8)|ConvertFrom-Json
if($state.rows.Count -ne $originals.Count){throw 'Incomplete exact cache journal'}
foreach($row in $state.rows){
    if($row.original -cnotin $originals -or
        $row.held -cne ($row.original+'.qa-hold-android-current-20261021') -or
        $row.target -cne (Join-Path $run ('native-'+[IO.Path]::GetFileName($row.original))) -or
        $row.owned -cne ($row.original+'.qa-tested-android-current-'+[IO.Path]::GetFileName($run)+'-20261021')){
        throw 'Journal restoration boundary mismatch'
    }
    if($row.linked){
        $item=Get-Item -LiteralPath $row.original -Force
        if(!($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
            [IO.Path]::GetFullPath([string]$item.Target) -cne $row.target){throw 'Refuse to unlink an unowned path'}
    }
    if($row.moved){VerifyFiles $row $row.held}
    if($row.physical -and $row.testDirectoryId -and
        ((Id $row.original) -cne $row.testDirectoryId -or
        ((Get-Item -LiteralPath $row.original -Force).Attributes -band [IO.FileAttributes]::ReparsePoint))){
        throw 'Physical test package cache identity changed'
    }
}
$archives=@()
foreach($row in $state.rows){
    # Delete only the validated owned junction; never recurse into its target.
    if($row.linked){(Get-Item -LiteralPath $row.original -Force).Delete()}
    if($row.physical -and $row.testDirectoryId){
        if(Test-Path -LiteralPath $row.owned){throw 'Refuse to overwrite retained physical test cache'}
        [IO.Directory]::Move($row.original,$row.owned)
        $archives+=$row
    }
    if($row.moved){[IO.Directory]::Move($row.held,$row.original);VerifyFiles $row $row.original}
}
foreach($row in $archives){
    # All original caches have already been restored. Only archive this exact
    # newly owned physical test directory, and reject links before any copy.
    $inventory=@(Files $row.owned)
    $null=New-Item -ItemType Directory -Path $row.target
    foreach($entry in Get-ChildItem -LiteralPath $row.owned -Force){
        Copy-Item -LiteralPath $entry.FullName -Destination $row.target -Recurse -Force
    }
    $copied=@(Files $row.target)
    if($copied.Count -ne $inventory.Count){throw 'Physical test archive count mismatch; retained C copy unchanged'}
    foreach($file in $inventory){
        $copy=Join-Path $row.target $file.relative
        if(!(Test-Path -LiteralPath $copy -PathType Leaf) -or (Sha $copy) -cne $file.sha256 -or
            (Get-Item -LiteralPath $copy).Length -ne $file.bytes){
            throw 'Physical test archive bytes mismatch; retained C copy unchanged'
        }
    }
    $absoluteOwned=[IO.Path]::GetFullPath($row.owned)
    if($row.original -cnotin $originals -or $absoluteOwned -cne ($row.original+'.qa-tested-android-current-'+
        [IO.Path]::GetFileName($run)+'-20261021') -or (Id $absoluteOwned) -cne $row.testDirectoryId){
        throw 'Refuse destructive operation outside the exact owned physical test cache'
    }
    # Hash-verified copy retained on F; this is exclusively current-run data.
    Remove-Item -LiteralPath $absoluteOwned -Recurse -Force
    if(Test-Path -LiteralPath $absoluteOwned){throw 'Owned physical test cache remains'}
}
Save (Join-Path $run 'cache-restoration.json') @{
    status='PASS';at=[DateTime]::UtcNow.ToString('o');deletedUserFiles=0
    rows=@($state.rows|ForEach-Object {@{original=$_.original;directoryId=$_.directoryId;files=@($_.files).Count
        testCache=$_.target;physicalTestCache=[bool]$_.physical}})
}
'PASS: all four original caches and their directory identities restored; test bytes retained on F'
