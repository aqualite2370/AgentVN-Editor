param([switch]$Apply)
$ErrorActionPreference='Stop'
$run='F:\AgentVN\QA\Installed-Layout-20261021-01\editor-32'
$journal=Get-Content -LiteralPath (Join-Path $run 'native-cache-protection.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$physicalParent='C:\Users\1\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\com.agentvn.editor'
$held=Join-Path $physicalParent 'windows-env.qa-hold-installed-layout-20261021'
$target=Join-Path $physicalParent 'windows-env'
if($journal.status -cne 'FAILED' -or !$journal.existed){throw 'Expected failed preparation journal'}
if($journal.original -cne 'C:\Users\1\AppData\Local\com.agentvn.editor\windows-env'){throw 'Wrong original'}
if(@(Get-CimInstance Win32_Process | Where-Object {$_.Name -match '^(agentvn-editor|AgentVN Dev|creator-backend)\.exe$'}).Count){throw 'Application still running'}
if(Test-Path -LiteralPath $target){throw 'Physical destination already exists; do not overwrite'}
function Identity($directory){
    $value=(& fsutil.exe file queryfileid $directory | Out-String)
    if($LASTEXITCODE -ne 0 -or $value -notmatch '0x[0-9a-fA-F]+'){throw 'No identity'}
    $Matches[0].ToLowerInvariant()
}
if((Identity $held) -cne $journal.directoryId){throw 'Held identity differs'}
$all=@(Get-Item -LiteralPath $held -Force)+@(Get-ChildItem -LiteralPath $held -Recurse -Force)
if(@($all | Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count){throw 'Linked source'}
$files=@($all | Where-Object {!$_.PSIsContainer})
if($files.Count -ne $journal.files.Count){throw 'File count differs'}
foreach($entry in $journal.files){
    if((Get-FileHash -LiteralPath (Join-Path $held $entry.relative) -Algorithm SHA256).Hash.ToLowerInvariant() -cne $entry.sha256){throw 'Held bytes differ'}
}
if(!$Apply){
    [pscustomobject]@{status='READY';source=$held;destination=$target;directoryId=$journal.directoryId;files=$files.Count} | ConvertTo-Json
    exit
}
# Explicit MSIX physical target: moving via the lexical path sees an unrelated
# fallback directory. Never move, overwrite, or delete that fallback.
[IO.Directory]::Move($held,$target)
if((Identity $target) -cne $journal.directoryId){throw 'Restored physical identity differs'}
if((Identity $journal.original) -cne $journal.directoryId){throw 'Lexical view did not restore'}
foreach($entry in $journal.files){
    if((Get-FileHash -LiteralPath (Join-Path $target $entry.relative) -Algorithm SHA256).Hash.ToLowerInvariant() -cne $entry.sha256){throw 'Restored bytes differ'}
}
$result=@{status='PASS';at=(Get-Date).ToUniversalTime().ToString('o');source=$held;destination=$target;
    lexicalOriginal=$journal.original;directoryId=$journal.directoryId;verifiedFiles=$files.Count;
    deletedFiles=0;fallbackDirectoryModified=$false;originalFailedReportPreserved=$true}
$out=Join-Path $run 'native-cache-recovery.json'
if(Test-Path -LiteralPath $out){throw 'Fresh recovery report required'}
[IO.File]::WriteAllText($out,($result | ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
$result | ConvertTo-Json -Depth 6
