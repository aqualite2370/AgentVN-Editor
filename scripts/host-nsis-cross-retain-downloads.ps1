$ErrorActionPreference='Stop'
$run='D:\AgentVN\output\host-nsis-cross-20261018-01'
$archive='F:\AgentVN-QA-NSISCross-20261018-01\retained-download-packages'
$downloads='C:\Users\1\Downloads'
$receipt=Join-Path $run 'downloads-retention.json'
if((Test-Path -LiteralPath $receipt) -or (Test-Path -LiteralPath $archive)){throw 'Never overwrite retention evidence'}
function Sha($file){(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
if(@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)creator-backend|agentvn.*\.exe' -or
    ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.(editor|player)')}).Count){throw 'Idle required'}
$audit=Get-Content -LiteralPath (Join-Path $run 'terminal-audit-01.json') -Raw -Encoding UTF8|ConvertFrom-Json
$restoration=Get-Content -LiteralPath (Join-Path $run 'profile-restoration.json') -Raw -Encoding UTF8|ConvertFrom-Json
if($audit.evidenceStatus -ne 'PASS' -or $restoration.status -ne 'PASS'){throw 'Independent evidence/restoration audit required'}
$old=Get-Content -LiteralPath (Join-Path $run 'en-US\old-ui-data-created.json') -Raw -Encoding UTF8|ConvertFrom-Json
$new=Get-Content -LiteralPath (Join-Path $run 'en-US\new-project-export.json') -Raw -Encoding UTF8|ConvertFrom-Json
$inputs=@(@{proof=$new;path=$new.package.path;receipt=(Join-Path $run 'en-US\new-project-export.json')})
$oldDownload=Join-Path $downloads $old.package.suggestedFilename
$absentOld=!(Test-Path -LiteralPath $oldDownload)
if(!$absentOld){$inputs+=@{proof=$old;path=$oldDownload;receipt=(Join-Path $run 'en-US\old-ui-data-created.json')}}
$rows=@()
foreach($input in $inputs){
    if($input.proof.status -ne 'PASS'){throw 'Actual successful export receipt required'}
    $source=[IO.Path]::GetFullPath($input.path)
    if([IO.Path]::GetDirectoryName($source) -ne $downloads -or
        [IO.Path]::GetFileName($source) -notlike 'NSIS*20261018*.vnproj'){throw 'Exact generated Downloads path required'}
    if((Get-Item -LiteralPath $source).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked generated package'}
    if((Sha $source) -ne $input.proof.package.sha256){throw 'Generated source SHA differs'}
    $target=Join-Path $archive ([IO.Path]::GetFileName($source))
    if([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($target)) -ne $archive){throw 'Archive target boundary mismatch'}
    $rows+=@{source=$source;retained=$target;sha256=$input.proof.package.sha256;bytes=(Get-Item -LiteralPath $source).Length;
        exportReceipt=$input.receipt;exportReceiptSha256=(Sha $input.receipt);copyVerified=$false;sourceRemoved=$false}
}
$result=@{status='RUNNING';at=(Get-Date).ToUniversalTime().ToString('o');rows=$rows;oldDownloadAbsent=$absentOld;
    scope='Only exact NSIS cross-generation export receipts and source SHA; no general Downloads cleanup';error=$null}
function Save{[IO.File]::WriteAllText($receipt,($result|ConvertTo-Json -Depth 10),(New-Object Text.UTF8Encoding($false)))}
Save
try{
    $null=New-Item -ItemType Directory -Path $archive
    foreach($row in $rows){
        Copy-Item -LiteralPath $row.source -Destination $row.retained
        if((Sha $row.source) -ne $row.sha256 -or (Sha $row.retained) -ne $row.sha256){throw 'Archive/source copy mismatch'}
        $row.copyVerified=$true;Save
    }
    # Exact absolute paths and both original/archive bytes verified above.
    # No wildcard deletion, no recursion and no unrelated Downloads entries.
    foreach($row in $rows){
        if((Sha $row.source) -ne $row.sha256 -or (Sha $row.retained) -ne $row.sha256){throw 'Byte change before cleanup'}
        Remove-Item -LiteralPath $row.source
        $row.sourceRemoved=!(Test-Path -LiteralPath $row.source)
        if(!$row.sourceRemoved){throw 'Test download remains'}
        Save
    }
    $result.status='PASS'
}catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
finally{$result.finishedAt=(Get-Date).ToUniversalTime().ToString('o');Save}
Write-Output "PASS: $($rows.Count) exact Downloads test package(s) SHA-retained on F, then source copies removed"
