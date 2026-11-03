param(
  [ValidateSet('SelfTest','Prepare','Restore')][string]$Action='SelfTest',
  [Parameter(Mandatory=$true)][string]$RunDirectory,
  [switch]$PhysicalPackageCache,
  [switch]$PhysicalEnvironmentCache
)
$ErrorActionPreference='Stop'
if([IO.Path]::GetFullPath($RunDirectory) -cne 'F:\AgentVN\QA\Android-Package-20261021-01\editor-18'){
  throw 'Only the new Renpy editor-18 cache session is authorized'
}
$original=Join-Path $PSScriptRoot 'android-current-cache-session.ps1'
$stream=[IO.File]::OpenRead($original);$hasher=[Security.Cryptography.SHA256]::Create()
try{$digest=([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
finally{$stream.Dispose();$hasher.Dispose()}
if($digest -cne 'b9409011b6b77ff0ac603bdc9cc7ddacf8dc65974ad1fb7122fa22de8978dcad'){
  throw 'Original cache source changed'
}
$source=[IO.File]::ReadAllText($original)
$before='$physical=($PhysicalPackageCache'
if($source.Split(@($before),[StringSplitOptions]::None).Count -ne 2){throw 'Unique adaptation required'}
$source=$source.Replace($before,'$physical=$true -or ($PhysicalPackageCache')
& ([ScriptBlock]::Create($source)) -Action $Action -RunDirectory $RunDirectory `
  -PhysicalPackageCache:$PhysicalPackageCache -PhysicalEnvironmentCache:$PhysicalEnvironmentCache
