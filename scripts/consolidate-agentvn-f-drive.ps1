param([ValidateSet('Prepare','Move','Verify')][string]$Action='Prepare',
    [ValidateRange(1,9)][int]$Attempt=1,
    [ValidateRange(1,9)][int]$VerificationAttempt=1)
$ErrorActionPreference='Stop'
$reportRoot='D:\AgentVN\output\f-drive-consolidation-20261019-01'
if($Attempt -gt 1){$reportRoot=$reportRoot -replace '-01$',('-'+$Attempt.ToString('00'))}
$destinationRoot='F:\AgentVN'
$utf8=New-Object Text.UTF8Encoding($false)
function Save($file,$value){
    if(Test-Path -LiteralPath $file){throw "Evidence exists: $file"}
    [IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 16),$utf8)
}
function Sha($file){
    $stream=[IO.File]::OpenRead($file);$algorithm=[Security.Cryptography.SHA256]::Create()
    try{[BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}
    finally{$algorithm.Dispose();$stream.Dispose()}
}
function Idle{
    $rows=@(Get-CimInstance Win32_Process|Where-Object {
        $_.Name -match '(?i)creator-backend|agentvn.*\.exe' -or
        ($_.ExecutablePath -like 'F:\AgentVN-QA-*\*') -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.(editor|player)') -or
        ($_.Name -eq 'node.exe' -and $_.CommandLine -match 'live-model-relay-session\.cjs')
    })
    if($rows.Count){throw 'Related processes still active; refuse move'}
}
function Boundary($row){
    $source=[IO.Path]::GetFullPath($row.source)
    $target=[IO.Path]::GetFullPath($row.target)
    if([IO.Path]::GetDirectoryName($source) -ne 'F:\' -or
        [IO.Path]::GetFileName($source) -notmatch '^AgentVN-QA-[A-Za-z0-9-]+$' -or
        $target -ne (Join-Path (Join-Path $destinationRoot $row.category) ([IO.Path]::GetFileName($source))) -or
        $row.category -notin @('QA','Checkpoints','Backups')){
        throw "Unsafe exact move boundary: $source -> $target"
    }
    if($target.StartsWith($source+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Nested move target'}
}
function Snapshot($root){
    # Do not follow any link, junction, mount point or unknown reparse directory.
    $stack=New-Object 'System.Collections.Generic.Stack[string]'
    $stack.Push($root)
    $records=New-Object 'System.Collections.Generic.List[object]'
    while($stack.Count){
        $directory=$stack.Pop()
        foreach($item in (Get-ChildItem -LiteralPath $directory -Force)){
            $relative=$item.FullName.Substring($root.Length+1)
            if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){
                $records.Add(@{relative=$relative;kind='link';attributes=[int]$item.Attributes;target=@($item.Target)})
            }elseif($item.PSIsContainer){
                $records.Add(@{relative=$relative;kind='directory';attributes=[int]$item.Attributes})
                $stack.Push($item.FullName)
            }else{
                $records.Add(@{relative=$relative;kind='file';bytes=$item.Length;
                    modifiedUtc=$item.LastWriteTimeUtc.ToString('o');attributes=[int]$item.Attributes})
            }
        }
    }
    @($records|Sort-Object { $_.relative })
}
Idle
if($Action -eq 'Prepare'){
    if((Test-Path -LiteralPath $reportRoot) -or (Test-Path -LiteralPath $destinationRoot)){
        throw 'Fresh destination/evidence directory required'
    }
    $sources=@(Get-ChildItem -LiteralPath 'F:\' -Directory -Force|Where-Object {$_.Name -like 'AgentVN-QA-*'}|Sort-Object Name)
    if(!$sources.Count){throw 'No exact AgentVN QA roots'}
    $null=New-Item -ItemType Directory -Path $reportRoot
    $rows=@()
    foreach($source in $sources){
        if($source.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Source root already linked'}
        $category=if($source.Name -match '-Checkpoint-'){'Checkpoints'}
            elseif($source.Name -match 'Backup|Preserved'){'Backups'}else{'QA'}
        $row=@{source=$source.FullName;category=$category;
            target=(Join-Path (Join-Path $destinationRoot $category) $source.Name);
            originalAttributes=[int]$source.Attributes}
        Boundary $row
        $snapshot=@(Snapshot $row.source)
        $files=@($snapshot|Where-Object {$_.kind -eq 'file'})
        $row.files=$files.Count
        $row.bytes=[long]0
        foreach($entry in $files){$row.bytes+=[long]$entry.bytes}
        $row.entries=$snapshot.Count
        $snapshotFile=Join-Path $reportRoot ($source.Name+'.json')
        Save $snapshotFile $snapshot
        $row.snapshot=$snapshotFile;$row.snapshotSha256=Sha $snapshotFile
        # Same-volume directory rename is the move operation (not copy/delete).
        # Hash bounded samples and every executable/version/fixture of interest.
        $samples=@($files|Select-Object -First 1)
        $samples+=@($files|Select-Object -Last 1)
        $samples+=@($files|Where-Object {
            $_.relative -match '(^|\\)(agentvn-editor\.exe|AgentVN Dev\.exe|build-versions\.json)$' -or
            ($_.relative -notmatch '\\' -and $_.relative -match '\.vnproj$')
        })
        $row.samples=@($samples|Sort-Object { $_.relative } -Unique|ForEach-Object {
            @{relative=$_.relative;sha256=(Sha (Join-Path $row.source $_.relative));bytes=$_.bytes}
        })
        $rows+=$row
        Write-Output ("SNAPSHOT "+$source.Name+" files="+$row.files)
    }
    Save (Join-Path $reportRoot 'plan.json') @{status='PREPARED';at=[DateTime]::UtcNow.ToString('o');
        destinationRoot=$destinationRoot;roots=$rows;rootCount=$rows.Count;
        method='Same-volume Directory.Move + hidden old-path compatibility junction, no deletions';
        protected='Unrelated F roots, user profiles, source checkout and historical report bytes unchanged'}
    Write-Output ("PREPARED "+$rows.Count+" exact roots")
    exit
}
$plan=Get-Content -LiteralPath (Join-Path $reportRoot 'plan.json') -Raw -Encoding UTF8|ConvertFrom-Json
if($plan.status -ne 'PREPARED' -or $plan.destinationRoot -ne $destinationRoot){throw 'Unexpected consolidation plan'}
foreach($row in $plan.roots){Boundary $row;if((Sha $row.snapshot) -ne $row.snapshotSha256){throw 'Snapshot modified'}}
if($Action -eq 'Move'){
    if(Test-Path -LiteralPath (Join-Path $reportRoot 'moves.json')){throw 'Moves already attempted; inspect journal'}
    if(Test-Path -LiteralPath $destinationRoot){throw 'Destination appeared since preflight'}
    foreach($row in $plan.roots){
        if(!(Test-Path -LiteralPath $row.source) -or (Test-Path -LiteralPath $row.target)){throw 'Source/destination changed'}
        if((Get-Item -LiteralPath $row.source -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Source changed to link'}
    }
    $null=New-Item -ItemType Directory -Path $destinationRoot
    foreach($category in @('QA','Checkpoints','Backups')){
        $null=New-Item -ItemType Directory -Path (Join-Path $destinationRoot $category)
    }
    $journal=@{status='RUNNING';at=[DateTime]::UtcNow.ToString('o');operations=@();error=$null}
    $journalFile=Join-Path $reportRoot 'journal.json'
    function Journal{[IO.File]::WriteAllText($journalFile,($journal|ConvertTo-Json -Depth 16),$utf8)}
    Journal
    try{
        foreach($row in $plan.roots){
            Idle;Boundary $row
            # Journal the exact recoverable endpoints BEFORE mutation.
            $operation=@{source=$row.source;target=$row.target;moved=$false;junction=$false;hidden=$false}
            $journal.operations+=$operation;Journal
            [IO.Directory]::Move($row.source,$row.target)
            $operation.moved=$true;Journal
            $null=New-Item -ItemType Junction -Path $row.source -Target $row.target
            $operation.junction=$true;Journal
            $link=Get-Item -LiteralPath $row.source -Force
            if($link.LinkType -ne 'Junction' -or @($link.Target)[0] -ne $row.target){throw 'Compatibility junction mismatch'}
            [IO.File]::SetAttributes($row.source,($link.Attributes -bor [IO.FileAttributes]::Hidden))
            $operation.hidden=$true;Journal
            Write-Output ("MOVED "+$row.source+" -> "+$row.target)
        }
        $journal.status='PASS'
    }catch{$journal.status='FAILED';$journal.error=$_.Exception.Message;throw}
    finally{Journal;Save (Join-Path $reportRoot 'moves.json') $journal}
    exit
}
$result=@{status='RUNNING';at=[DateTime]::UtcNow.ToString('o');roots=@();error=$null;
    originalDataDeleted=$false;historicalReportsRewritten=$false}
try{
    $moves=Get-Content -LiteralPath (Join-Path $reportRoot 'moves.json') -Raw -Encoding UTF8|ConvertFrom-Json
    if($moves.status -ne 'PASS' -or $moves.operations.Count -ne $plan.roots.Count){throw 'Move incomplete'}
    foreach($row in $plan.roots){
        Boundary $row
        $link=Get-Item -LiteralPath $row.source -Force
        $physical=Get-Item -LiteralPath $row.target -Force
        if($link.LinkType -ne 'Junction' -or @($link.Target)[0] -ne $row.target -or
            !($link.Attributes -band [IO.FileAttributes]::Hidden)){throw 'Old path must be hidden exact junction'}
        if($physical.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Destination not physical'}
        # Normalize zero, one and many entries explicitly. PS5's pipeline JSON
        # array and a one-entry PSCustomObject do not share Count semantics.
        $parsed=Get-Content -LiteralPath $row.snapshot -Raw -Encoding UTF8|ConvertFrom-Json
        $before=@(foreach($record in $parsed){$record})
        $after=@(Snapshot $row.target)
        if($before.Count -ne $after.Count){throw ("Entry count changed: "+$row.source+" before="+$before.Count+" after="+$after.Count)}
        $byPath=@{};foreach($item in $after){$byPath[$item.relative]=$item}
        foreach($item in $before){
            $now=$byPath[$item.relative]
            if(!$now -or $now.kind -ne $item.kind -or $now.attributes -ne $item.attributes){throw 'Entry metadata changed'}
            if($item.kind -eq 'file' -and ($now.bytes -ne $item.bytes -or $now.modifiedUtc -ne $item.modifiedUtc)){throw 'File bytes/mtime metadata changed'}
            if($item.kind -eq 'link' -and (@($now.target) -join '|') -ne (@($item.target) -join '|')){throw 'Internal link target changed'}
        }
        foreach($sample in $row.samples){
            if((Sha (Join-Path $row.target $sample.relative)) -ne $sample.sha256 -or
                (Sha (Join-Path $row.source $sample.relative)) -ne $sample.sha256){throw 'Physical/old-path SHA mismatch'}
        }
        $result.roots+=@{source=$row.source;target=$row.target;files=$row.files;bytes=$row.bytes;entries=$row.entries;
            shaSamples=$row.samples.Count;metadataMatch=$true;oldPathAccessible=$true;oldLinkHidden=$true;
            physicalRootHidden=[bool]($physical.Attributes -band [IO.FileAttributes]::Hidden)}
        Write-Output ("VERIFIED "+$row.target)
    }
    $visible=@(Get-ChildItem -LiteralPath 'F:\'|Where-Object {$_.Name -like 'AgentVN*'})
    if($visible.Count -ne 1 -or $visible[0].FullName -ne $destinationRoot){throw 'Expected one visible AgentVN root'}
    $result.status='PASS';$result.visibleRoot=$destinationRoot
}catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
finally{
    $verificationName=if($VerificationAttempt -eq 1){'verification.json'}else{'verification-'+$VerificationAttempt.ToString('00')+'.json'}
    Save (Join-Path $reportRoot $verificationName) $result
}
Write-Output ("PASS: "+$result.roots.Count+" roots consolidated, no file deletion")
