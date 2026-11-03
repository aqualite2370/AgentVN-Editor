param(
  [ValidateSet('SelfTest','Prepare','Restore')][string]$Action='SelfTest',
  [Parameter(Mandatory=$true)][string]$RunDirectory,
  [switch]$PhysicalPackageCache,
  [switch]$PhysicalEnvironmentCache
)
# Keep every cache physical: a cross-volume link changes atomic Move-Item.
$ErrorActionPreference='Stop'
$original=Join-Path $PSScriptRoot 'android-current-cache-session.ps1'
$stream=[IO.File]::OpenRead($original);$hash=[Security.Cryptography.SHA256]::Create()
try{$digest=([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
finally{$stream.Dispose();$hash.Dispose()}
if($digest -cne 'b9409011b6b77ff0ac603bdc9cc7ddacf8dc65974ad1fb7122fa22de8978dcad'){throw 'Cache tool provenance changed'}
if([IO.Path]::GetFullPath($RunDirectory) -cne 'F:\AgentVN\QA\Android-Package-20261021-01\editor-13'){
  throw 'Only the new editor-13 cache session is authorized'
}
$source=[IO.File]::ReadAllText($original)
$before='$physical=($PhysicalPackageCache'
if($source.Split(@($before),[StringSplitOptions]::None).Count -ne 2){throw 'Unique physical-mode adaptation required'}
$source=$source.Replace($before,'$physical=$true -or ($PhysicalPackageCache')
& ([ScriptBlock]::Create($source)) -Action $Action -RunDirectory $RunDirectory `
  -PhysicalPackageCache:$PhysicalPackageCache -PhysicalEnvironmentCache:$PhysicalEnvironmentCache
