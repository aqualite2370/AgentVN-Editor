$ErrorActionPreference='Stop'
$root='D:\AgentVN\output\host-msi-continuation-20261018-02'
$receipt=Join-Path $root 'legacy-data-restoration.json'
if(Test-Path -LiteralPath $receipt){throw 'Legacy restoration already recorded'}
$source='F:\AgentVN-QA-HostMSI-20261018-02\original-legacy-data'
$target='D:\agentvntest\AgentVN Editor\data'
if([IO.Path]::GetFullPath($source) -ne 'F:\AgentVN-QA-HostMSI-20261018-02\original-legacy-data' -or
    [IO.Path]::GetFullPath($target) -ne 'D:\agentvntest\AgentVN Editor\data'){throw 'Unexpected exact restoration boundary'}
if((Test-Path -LiteralPath $target) -or !(Test-Path -LiteralPath $source)){throw 'Legacy restoration collision'}
$active=@(Get-CimInstance Win32_Process|Where-Object {
    $_.Name -match '(?i)creator-backend|agentvn.*\.exe' -or
    ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\.agentvn\.(editor|player)')
})
if($active.Count){throw 'AgentVN active'}
$registrations=@(Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue|
    Where-Object {$_.DisplayName -match 'AgentVN' -and $_.WindowsInstaller -eq 1})
if($registrations.Count){throw 'Complete owned MSI uninstall before returning historical legacy data'}
$stage=Get-Content -LiteralPath (Join-Path $root 'legacy-data-staged.json') -Raw -Encoding UTF8|ConvertFrom-Json
if($stage.status -ne 'PASS' -or $stage.source -ne $target -or $stage.target -ne $source){throw 'Legacy source journal mismatch'}
foreach($file in $stage.checks){
    $relative=$file.relative.Substring(5)
    if((Get-FileHash -LiteralPath (Join-Path $source $relative) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256){throw 'Historical file changed'}
}
Move-Item -LiteralPath $source -Destination $target
$checks=@(foreach($file in $stage.checks){
    $path=Join-Path $target $file.relative.Substring(5)
    $hash=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    if($hash -ne $file.sha256){throw 'Returned historical file mismatch'}
    @{path=$path;sha256=$hash}
})
$result=@{status='PASS';at=(Get-Date).ToUniversalTime().ToString('o');checks=$checks;source=$source;target=$target;
    originalBackupRetained='F:\AgentVN-QA-HostMSI-AuthorizedBackup-20261018-02\installation';
    warning='MSI test program has been uninstalled; original current-state full backup retained, not reinstalling unregistered old binaries'}
[IO.File]::WriteAllText($receipt,($result|ConvertTo-Json -Depth 7),(New-Object Text.UTF8Encoding($false)))
Write-Output "PASS: $($checks.Count) historical legacy file(s) returned unchanged, independent full backup retained"
