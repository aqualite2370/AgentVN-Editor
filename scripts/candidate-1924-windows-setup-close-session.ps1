param(
    [ValidateSet('SelfTest','ValidateSource','Install','Uninstall','Cleanup')][string]$Action='SelfTest',
    [Parameter(Mandatory=$true)][string]$RunDirectory
)
$ErrorActionPreference='Stop'
$qaOriginal=Join-Path $PSScriptRoot 'candidate-1924-windows-setup-session.ps1'
$qaHasher=[Security.Cryptography.SHA256]::Create()
$qaStream=[IO.File]::OpenRead($qaOriginal)
try {$qaHash=[BitConverter]::ToString($qaHasher.ComputeHash($qaStream)).Replace('-','').ToLowerInvariant()}
finally {$qaHasher.Dispose();$qaStream.Dispose()}
if($qaHash -cne 'd40f52b5c5576b39e5401e1ab07a47edce70bb53f0bf7508ad7c9182b535ab17'){throw 'Setup supplement source drift'}
$qaText=[IO.File]::ReadAllText($qaOriginal)
if(([regex]::Matches($qaText,'runtime-18')).Count -ne 2){throw 'Exact supplement boundary adaptation required'}
$qaText=$qaText.Replace('runtime-18','runtime-19')
# Keep the original wrapper's script-root context for its pinned source read.
& ([scriptblock]::Create($qaText.Replace("Join-Path `$PSScriptRoot 'windows-setup-session.ps1'",
    "'"+(Join-Path $PSScriptRoot 'windows-setup-session.ps1').Replace("'","''")+"'"))) -Action $Action -RunDirectory $RunDirectory
