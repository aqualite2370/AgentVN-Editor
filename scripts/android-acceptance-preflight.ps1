param([Parameter(Mandatory=$true)][string]$OutputDir)
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$probe = [ordered]@{ isElevated = $elevated; success = $false; checkedAt = (Get-Date).ToUniversalTime().ToString('o'); processId = $PID; error = $null }
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$target = Join-Path ([IO.Path]::GetFullPath($OutputDir)) ('probe-' + [guid]::NewGuid().ToString('N'))
try {
  if (-not $elevated) { throw 'ANDROID_ADMIN_REQUIRED' }
  New-Item -ItemType Directory -Path $target | Out-Null
  $source = Join-Path $target 'source.txt'
  $link = Join-Path $target 'link.txt'
  [IO.File]::WriteAllText($source, 'agentvn')
  New-Item -ItemType SymbolicLink -Path $link -Target $source | Out-Null
  $probe.success = [IO.File]::ReadAllText($link) -eq 'agentvn'
  $probe.probeRoot = $target
} catch { $probe.error = $_.Exception.Message }
finally {
  # Exact probe children only; never recursively remove a caller's directory.
  if (Test-Path -LiteralPath (Join-Path $target 'link.txt')) { Remove-Item -LiteralPath (Join-Path $target 'link.txt') -Force }
  if (Test-Path -LiteralPath (Join-Path $target 'source.txt')) { Remove-Item -LiteralPath (Join-Path $target 'source.txt') -Force }
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force }
  [IO.File]::WriteAllText((Join-Path $OutputDir 'acceptance-permission.json'), ($probe | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
}
if (-not $probe.success) { exit 2 }
