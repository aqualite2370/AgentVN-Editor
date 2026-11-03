param([ValidateSet('01','02')][string]$Attempt='01')
$ErrorActionPreference='Stop'
$qa='F:\AgentVN\QA\Installed-Candidate-20261021-01'
$reportFile=Join-Path $qa $(if($Attempt -eq '01'){'profile-evidence-migration.json'}else{'profile-evidence-migration-02.json'})
if(Test-Path -LiteralPath $reportFile){throw 'Never overwrite migration evidence'}
$restored=Get-Content -LiteralPath (Join-Path $qa 'profile-restoration.json') -Raw -Encoding UTF8|ConvertFrom-Json
if($restored.status -ne 'PASS' -or $restored.deletedUserFiles -ne 0){throw 'Original user profiles must be restored first'}
if(@(Get-CimInstance Win32_Process|Where-Object {
    $_.Name -match '^(agentvn-editor|AgentVN Dev|creator-backend)\.exe$' -or
    ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.editor')
}).Count){throw 'Editor profile still in use'}
function Sha($path){(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()}
function Files($directory){
    $pending=New-Object 'System.Collections.Generic.Stack[string]'
    $pending.Push($directory)
    $rows=@()
    while($pending.Count){
        foreach($item in (Get-ChildItem -LiteralPath $pending.Pop() -Force)){
            if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw "Linked test entry: $($item.FullName)"}
            if($item.PSIsContainer){$pending.Push($item.FullName)}
            else{$rows+=@{relative=$item.FullName.Substring($directory.Length+1);bytes=$item.Length;sha256=(Sha $item.FullName)}}
        }
    }
    return $rows
}
$report=[ordered]@{status='RUNNING';startedAt=(Get-Date).ToUniversalTime().ToString('o');profiles=@();
    removedTestBytes=0;deletedUserFiles=0;recoverable=$true;error=$null}
function SaveProgress {
    [IO.File]::WriteAllText($reportFile,($report|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
}
try{
    foreach($kind in @('Roaming','Local')){
        $source='C:\Users\1\AppData\'+$kind+'\com.agentvn.editor.qa-tested-installed-20261021-01'
        $target=Join-Path $qa ('retained-profiles\'+$kind)
        if([IO.Path]::GetFileName($source) -cne 'com.agentvn.editor.qa-tested-installed-20261021-01' -or
           [IO.Path]::GetDirectoryName($source) -cne ('C:\Users\1\AppData\'+$kind)){throw 'Unexpected named test directory boundary'}
        if($Attempt -eq '02' -and $kind -eq 'Roaming' -and !(Test-Path -LiteralPath $source) -and (Test-Path -LiteralPath $target)){
            $failedFile=Join-Path $qa 'profile-evidence-migration.json'
            $failed=Get-Content -LiteralPath $failedFile -Raw -Encoding UTF8|ConvertFrom-Json
            $oldScript=Join-Path $qa 'failed-profile-migration-executed.ps1'
            if($failed.status -ne 'FAILED' -or $failed.error -notmatch 'Property' -or !(Test-Path -LiteralPath $oldScript)){
                throw 'Missing original copy/remove/accounting-failure evidence'
            }
            # Previous execution passed source/destination SHA checks and removed
            # this owned source, then failed in Measure-Object. Do not pretend
            # that the original source still exists or was copied on this retry.
            $files=@(Files $target)
            [long]$bytes=0
            foreach($entry in $files){$bytes+=[long]$entry.bytes}
            $report.removedTestBytes+=$bytes
            $report.profiles+=@{source=$source;target=$target;files=$files;bytes=$bytes;cleanup='PASS';
                recoveredAfterAccountingFailure=$true;sourceMissingBeforeRetry=$true;
                originalFailure=@{path=$failedFile;sha256=(Sha $failedFile)};
                failedExecutedScript=@{path=$oldScript;sha256=(Sha $oldScript)}}
            SaveProgress
            continue
        }
        if(!(Test-Path -LiteralPath $source) -or (Test-Path -LiteralPath $target)){throw 'Unexpected source/destination state'}
        if((Get-Item -LiteralPath $source).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked source root'}
        $resolved=(Resolve-Path -LiteralPath $source).ProviderPath
        if([IO.Path]::GetFullPath($resolved) -cne [IO.Path]::GetFullPath($source)){throw 'Resolved deletion target changed'}
        $files=@(Files $source)
        [long]$bytes=0
        foreach($entry in $files){$bytes+=[long]$entry.bytes}
        $row=@{source=$source;target=$target;files=$files;bytes=$bytes;cleanup='COPYING'}
        $report.profiles+=$row
        SaveProgress
        $null=New-Item -ItemType Directory -Path $target -Force
        foreach($file in $files){
            $destination=Join-Path $target $file.relative
            $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force
            Copy-Item -LiteralPath (Join-Path $source $file.relative) -Destination $destination
            if((Sha $destination) -cne $file.sha256){throw 'Evidence copy byte mismatch; leave source intact'}
        }
        if(@(Files $target).Count -ne $files.Count){throw 'Evidence copy file count mismatch'}
        foreach($file in $files){if((Sha (Join-Path $source $file.relative)) -cne $file.sha256){throw 'Test profile changed during copy'}}
        $row.cleanup='COPY_VERIFIED'
        SaveProgress
        # Exact owned test root, with every file copied/hashed and no reparse points.
        Remove-Item -LiteralPath $resolved -Recurse -Force
        if(Test-Path -LiteralPath $source){throw 'Test source cleanup incomplete'}
        $report.removedTestBytes+=$bytes
        $row.cleanup='PASS'
        SaveProgress
    }
    $report.status='PASS'
}catch{$report.status='FAILED';$report.error=$_.Exception.Message;throw}
finally{SaveProgress}
Write-Output "PASS: $($report.removedTestBytes) owned test bytes moved to F after exact copy verification; no user file deleted"
