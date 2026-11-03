param(
  [ValidateSet('SelfTest','Prepare','Restore')][string]$Action='SelfTest',
  [Parameter(Mandatory=$true)][string]$RunDirectory,
  [switch]$PhysicalPackageCache,
  [switch]$PhysicalEnvironmentCache
)
$ErrorActionPreference='Stop'
$original=Join-Path $PSScriptRoot 'candidate-1924-android-package-cache.ps1'
$stream=[IO.File]::OpenRead($original);$hash=[Security.Cryptography.SHA256]::Create()
try{$digest=([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
finally{$stream.Dispose();$hash.Dispose()}
if($digest -cne '656f1ca8dc3f1cae3f8c9649f6d2240598492fa4803b5c7680d191dec92c85a5'){throw 'Original cache wrapper changed'}
$source=[IO.File]::ReadAllText($original).Replace('editor-13','editor-16')
$source=$source.Replace('$PSScriptRoot',("'"+$PSScriptRoot+"'"))
& ([ScriptBlock]::Create($source)) -Action $Action -RunDirectory $RunDirectory `
  -PhysicalPackageCache:$PhysicalPackageCache -PhysicalEnvironmentCache:$PhysicalEnvironmentCache
