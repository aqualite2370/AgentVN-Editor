param([ValidateSet('en-US','zh-CN')][string]$Language='en-US')
$ErrorActionPreference='Stop'
$reportRoot='D:\AgentVN\output\host-msi-next-20261018-01\cross-generation'
$workRoot='F:\AgentVN-QA-HostMSINext-20261018-01\cross-generation'
$source='D:\agentvntest\AgentVN Editor\data'
$target=Join-Path $workRoot ($Language+'\legacy-install-data-retained')
$receipt=Join-Path $reportRoot ($Language+'\qa-legacy-retained.json')
if([IO.Path]::GetFullPath($source) -ne 'D:\agentvntest\AgentVN Editor\data' -or
    [IO.Path]::GetFullPath($target) -ne ($workRoot+'\'+$Language+'\legacy-install-data-retained')){
    throw 'Exact QA legacy archive boundary required'
}
if((Test-Path -LiteralPath $target) -or (Test-Path -LiteralPath $receipt)){throw 'No overwrite of archive/evidence'}
$active=@(Get-CimInstance Win32_Process|Where-Object {
    $_.Name -match '(?i)creator-backend|agentvn.*\.exe' -or
    ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.(editor|player)')
})
if($active.Count){throw 'Idle required'}
$registrations=@(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue|
    Where-Object {$_.DisplayName -match 'AgentVN' -and $_.WindowsInstaller -eq 1})
if($registrations.Count){throw 'Uninstall test MSI before moving QA data'}
$original=Get-Content -LiteralPath 'D:\AgentVN\output\host-msi-next-20261018-01\HoldLegacy.json' -Raw -Encoding UTF8|ConvertFrom-Json
if($original.status -ne 'PASS' -or !(Test-Path -LiteralPath $original.to)){throw 'Original historical data must remain protected'}
$snapshot=Get-Content -LiteralPath (Join-Path $reportRoot ($Language+'\before-uninstall-snapshot.json')) -Raw -Encoding UTF8|ConvertFrom-Json
$verified=Get-Content -LiteralPath (Join-Path $reportRoot ($Language+'\after-uninstall-verify.json')) -Raw -Encoding UTF8|ConvertFrom-Json
if($snapshot.status -ne 'PASS' -or $verified.status -ne 'PASS'){throw 'Actual uninstall preservation evidence required'}
$files=@($snapshot.files|Where-Object {$_.source.StartsWith($source+'\',[StringComparison]::OrdinalIgnoreCase)})
if(!$files.Count){throw 'No owned QA data baseline'}
$entries=@((Get-Item -LiteralPath $source))+@(Get-ChildItem -LiteralPath $source -Recurse -Force)
if(@($entries|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count){throw 'Linked data'}
if(@($entries|Where-Object {!$_.PSIsContainer}).Count -ne $files.Count){throw 'Unrecorded file in QA data'}
foreach($file in $files){
    if((Get-FileHash -LiteralPath $file.source).Hash.ToLowerInvariant() -ne $file.sha256){throw 'QA data changed'}
}
$null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force
# Both absolute directories and every source file have been validated above.
Move-Item -LiteralPath $source -Destination $target
$checks=@(foreach($file in $files){
    $retained=Join-Path $target $file.source.Substring($source.Length+1)
    $sha=(Get-FileHash -LiteralPath $retained).Hash.ToLowerInvariant()
    if($sha -ne $file.sha256){throw 'Retained QA byte mismatch'}
    @{source=$file.source;retained=$retained;sha256=$sha}
})
$result=@{status='PASS';at=(Get-Date).ToUniversalTime().ToString('o');source=$source;target=$target;
    files=$checks;deletedFiles=0;originalHistoricalDataStillHeld=$original.to}
[IO.File]::WriteAllText($receipt,($result|ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding($false)))
Write-Output "PASS: $($checks.Count) owned QA legacy file(s) retained on F with SHA checks; no user files deleted"
