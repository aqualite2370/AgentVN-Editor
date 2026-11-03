param([ValidateSet('Inventory','Archive')][string]$Action='Inventory')
$ErrorActionPreference='Stop'
$run='D:\AgentVN\output\host-msi-next-20261018-01'
$archive='F:\AgentVN-QA-HostMSINext-20261018-01\retained-download-packages'
$downloads='C:\Users\1\Downloads'
$receipt=Join-Path $run ('downloads-'+$Action.ToLowerInvariant()+'.json')
if(Test-Path -LiteralPath $receipt){throw 'Fresh download evidence required'}
function Sha($file){(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
if(@(Get-CimInstance Win32_Process|Where-Object {
    $_.Name -match '(?i)creator-backend|agentvn.*\.exe' -or
    ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.(editor|player)')
}).Count){throw 'Finish current native session before retaining downloads'}
$restoration=Get-Content -LiteralPath (Join-Path $run 'profile-restoration.json') -Raw -Encoding UTF8|ConvertFrom-Json
if($restoration.status -ne 'PASS'){throw 'Restore original profiles first'}
$sources=@(
    'clean\en-US\created-ui-data.json',
    'clean\zh-CN\created-ui-data.json',
    'cross-generation\en-US\chain02\old-ui-data-created.json',
    'cross-generation\en-US\chain02\new-project-export.json',
    'cross-generation\zh-CN\old-ui-data-created.json',
    'cross-generation\zh-CN\new-project-export.json'
)
$rows=@();$skipped=@()
foreach($relative in $sources){
    $sourceReceipt=Join-Path $run $relative
    $proof=Get-Content -LiteralPath $sourceReceipt -Raw -Encoding UTF8|ConvertFrom-Json
    if($proof.status -ne 'PASS' -or !$proof.package.path -or !$proof.package.sha256){throw 'Successful export receipt required'}
    $file=[IO.Path]::GetFullPath($proof.package.path)
    if([IO.Path]::GetDirectoryName($file) -ne $downloads){
        $skipped+=@{path=$file;reason='Not in default Downloads; original evidence kept in place'}
        continue
    }
    if([IO.Path]::GetExtension($file) -ne '.vnproj' -or
        [IO.Path]::GetFileName($file) -notlike 'MSI*20261018*.vnproj'){throw 'Unexpected generated package name'}
    if((Get-Item -LiteralPath $file).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked export'}
    if((Sha $file) -ne $proof.package.sha256){throw 'Download no longer matches generated receipt'}
    $target=Join-Path $archive ([IO.Path]::GetFileName($file))
    if([IO.Path]::GetFullPath([IO.Path]::GetDirectoryName($target)) -ne $archive){throw 'Archive boundary mismatch'}
    $rows+=@{source=$file;sha256=$proof.package.sha256;bytes=(Get-Item -LiteralPath $file).Length;
        generatedReceipt=$sourceReceipt;generatedReceiptSha256=(Sha $sourceReceipt);
        retained=$target;copyVerified=$false;sourceRemoved=$false}
}
if($rows.Count -ne 4 -or @($rows.source|Select-Object -Unique).Count -ne 4){throw 'Expected four exact MSI-generated Downloads files'}
$result=@{status='RUNNING';startedAt=(Get-Date).ToUniversalTime().ToString('o');action=$Action;
    scope='Only four exact receipt/SHA-attributed MSI test exports, not a general Downloads cleanup';
    rows=$rows;skipped=$skipped;error=$null}
function Save { [IO.File]::WriteAllText($receipt,($result|ConvertTo-Json -Depth 10),(New-Object Text.UTF8Encoding($false))) }
Save
try{
    if($Action -eq 'Archive'){
        $audit=Get-Content -LiteralPath (Join-Path $run 'terminal-audit-01.json') -Raw -Encoding UTF8|ConvertFrom-Json
        if($audit.evidenceStatus -ne 'PASS'){throw 'Independent terminal evidence audit required before cleanup'}
        if(Test-Path -LiteralPath $archive){throw 'Do not overwrite archive'}
        $null=New-Item -ItemType Directory -Path $archive
        foreach($row in $rows){
            Copy-Item -LiteralPath $row.source -Destination $row.retained
            if((Sha $row.retained) -ne $row.sha256 -or (Sha $row.source) -ne $row.sha256){throw 'Copy/source SHA mismatch'}
            $row.copyVerified=$true
            Save
        }
        # All four original/target absolute paths and bytes were checked above.
        # Never enumerate or delete other Downloads entries or recurse.
        foreach($row in $rows){
            if((Sha $row.source) -ne $row.sha256 -or (Sha $row.retained) -ne $row.sha256){throw 'Changed file before removal'}
            Remove-Item -LiteralPath $row.source
            $row.sourceRemoved=!(Test-Path -LiteralPath $row.source)
            if(!$row.sourceRemoved){throw 'Download copy remains'}
            Save
        }
    }
    $result.status='PASS'
}catch{$result.status='FAILED';$result.error=$_.Exception.Message;throw}
finally{$result.finishedAt=(Get-Date).ToUniversalTime().ToString('o');Save}
Write-Output "PASS: $Action, $($rows.Count) exact generated exports; source bytes recoverable from F archive after cleanup"
