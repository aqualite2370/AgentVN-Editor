param(
  [string]$OutputDir = "",
  [string]$ArchivePath = "",
  [string]$ToolRoot = "",
  [string]$GradleUserHome = "",
  [string]$CargoHome = "",
  [string]$RustupHome = "",
  [string]$GradleVersion = "8.14.3",
  [string]$ApiLevel = "36",
  [string]$BuildToolsVersion = "36.0.0",
  [string]$NdkVersion = "27.2.12479018",
  [switch]$AllowIncomplete,
  [switch]$KeepExpanded,
  [switch]$ReuseExpanded
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
if (-not $OutputDir) { $OutputDir = Join-Path $Root "releases\android-environment-pack\expanded" }
if (-not $ArchivePath) { $ArchivePath = Join-Path $Root "releases\android-environment-pack\AgentVN-Android-Environment-$GradleVersion.avnenv" }
if (-not $ToolRoot) { $ToolRoot = Join-Path $env:LOCALAPPDATA "AgentVN\AndroidToolchain" }
if (-not $GradleUserHome) { $GradleUserHome = Join-Path $env:USERPROFILE ".gradle" }
if (-not $CargoHome) { $CargoHome = Join-Path $env:USERPROFILE ".cargo" }
if (-not $RustupHome) { $RustupHome = Join-Path $env:USERPROFILE ".rustup" }

$OutputDir = [System.IO.Path]::GetFullPath($OutputDir)
$ArchivePath = [System.IO.Path]::GetFullPath($ArchivePath)
if ([System.IO.Path]::GetExtension($ArchivePath).ToLowerInvariant() -ne ".avnenv") {
  throw "Android environment archive must use the .avnenv extension: $ArchivePath"
}
if ($ArchivePath.StartsWith($OutputDir.TrimEnd("\", "/") + "\", [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Android environment archive must be outside the expanded payload directory."
}
$PayloadDir = Join-Path $OutputDir "payload"
$ToolchainTarget = Join-Path $PayloadDir "toolchain"
$GradleHomeTarget = Join-Path $PayloadDir "gradle-home"
$ManifestPath = Join-Path $OutputDir "format.json"

function Write-Utf8JsonAtomic {
  param([string]$Path, [object]$Value)
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  $temporary = "$Path.tmp-$([guid]::NewGuid().ToString('N'))"
  $json = $Value | ConvertTo-Json -Depth 12
  [System.IO.File]::WriteAllText($temporary, "$json`n", (New-Object System.Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Assert-SafeOutputPath {
  $rooted = [System.IO.Path]::GetFullPath($OutputDir).TrimEnd("\", "/")
  $driveRoot = [System.IO.Path]::GetPathRoot($rooted).TrimEnd("\", "/")
  if ($rooted.Length -le $driveRoot.Length + 3) {
    throw "Refusing to prepare an offline pack at a broad path: $rooted"
  }
}

function Copy-OfflinePackEntry {
  param([System.IO.FileSystemInfo]$Item, [string]$Destination)
  if ($Item.PSIsContainer) {
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    foreach ($child in Get-ChildItem -LiteralPath $Item.FullName -Force) {
      Copy-OfflinePackEntry -Item $child -Destination (Join-Path $Destination $child.Name)
    }
    return
  }
  if ($Item.Name -match '\.(lock|lck)$') {
    # Gradle/Cargo lock files describe a live local process and never carry
    # an artifact required for an offline build. They may be exclusively
    # locked while the editor is open, so deliberately exclude them.
    return
  }
  $copied = $false
  $lastError = $null
  for ($attempt = 1; $attempt -le 3 -and -not $copied; $attempt++) {
    try {
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
      Copy-Item -LiteralPath $Item.FullName -Destination $Destination -Force -ErrorAction Stop
      $copied = $true
    } catch {
      $lastError = $_
      if ($attempt -lt 3) { Start-Sleep -Milliseconds (250 * $attempt) }
    }
  }
  if (-not $copied) {
    throw "Failed to copy offline-pack source $($Item.FullName): $($lastError.Exception.Message)"
  }
}

function Copy-DirectoryContents {
  param([string]$Source, [string]$Destination)
  if (-not (Test-Path -LiteralPath $Source)) { return $false }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  foreach ($item in Get-ChildItem -LiteralPath $Source -Force) {
    Copy-OfflinePackEntry -Item $item -Destination (Join-Path $Destination $item.Name)
  }
  return $true
}

function Copy-PortableNode {
  param([string]$Destination)
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $node -or -not $npm) { return $false }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Copy-Item -LiteralPath $node.Source -Destination (Join-Path $Destination "node.exe") -Force
  $npmRoot = Split-Path -Parent $npm.Source
  foreach ($name in @("npm", "npm.cmd", "npx", "npx.cmd", "corepack", "corepack.cmd")) {
    $source = Join-Path $npmRoot $name
    if (Test-Path -LiteralPath $source) {
      Copy-Item -LiteralPath $source -Destination (Join-Path $Destination $name) -Force
    }
  }
  $npmModules = Join-Path $npmRoot "node_modules\npm"
  if (Test-Path -LiteralPath $npmModules) {
    New-Item -ItemType Directory -Force -Path (Join-Path $Destination "node_modules") | Out-Null
    Copy-Item -LiteralPath $npmModules -Destination (Join-Path $Destination "node_modules\npm") -Recurse -Force
  }
  return (Test-Path -LiteralPath (Join-Path $Destination "npm.cmd"))
}

function Find-GradleDistribution {
  $name = "gradle-$GradleVersion-bin.zip"
  $preferred = Join-Path $Root "releases\android-offline-sources\$name"
  if (Test-Path -LiteralPath $preferred) { return (Resolve-Path -LiteralPath $preferred).Path }
  $wrapperDists = Join-Path $GradleUserHome "wrapper\dists"
  if (Test-Path -LiteralPath $wrapperDists) {
    $candidate = Get-ChildItem -LiteralPath $wrapperDists -Recurse -Filter $name -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Length -gt 100MB } |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($candidate) { return $candidate.FullName }
  }
  return ""
}

function Relative-PackPath {
  param([string]$Path)
  return $Path.Substring($OutputDir.TrimEnd("\", "/").Length + 1).Replace("\", "/")
}

function Get-Sha256Hex {
  param([string]$Path)
  $stream = $null
  $sha256 = $null
  try {
    $stream = [System.IO.File]::Open(
      $Path,
      [System.IO.FileMode]::Open,
      [System.IO.FileAccess]::Read,
      [System.IO.FileShare]::Read
    )
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
  } finally {
    if ($sha256) { $sha256.Dispose() }
    if ($stream) { $stream.Dispose() }
  }
}

function New-AndroidEnvironmentArchive {
  param([string]$SourceRoot, [string]$DestinationPath)
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $resolvedDestination = [System.IO.Path]::GetFullPath($DestinationPath)
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolvedDestination) | Out-Null
  $temporary = "$resolvedDestination.tmp-$([guid]::NewGuid().ToString('N'))"
  $stream = $null
  $archive = $null
  try {
    $stream = New-Object System.IO.FileStream(
      $temporary,
      [System.IO.FileMode]::CreateNew,
      [System.IO.FileAccess]::ReadWrite,
      [System.IO.FileShare]::None
    )
    $archive = New-Object System.IO.Compression.ZipArchive(
      $stream,
      [System.IO.Compression.ZipArchiveMode]::Create,
      $false,
      [System.Text.Encoding]::UTF8
    )
    foreach ($file in Get-ChildItem -LiteralPath $SourceRoot -Recurse -File | Sort-Object FullName) {
      $entryName = $file.FullName.Substring($SourceRoot.TrimEnd("\", "/").Length + 1).Replace("\", "/")
      $entry = $archive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Fastest)
      $entryStream = $null
      $sourceStream = $null
      try {
        $entryStream = $entry.Open()
        $sourceStream = [System.IO.File]::OpenRead($file.FullName)
        $sourceStream.CopyTo($entryStream, 1MB)
      } finally {
        if ($sourceStream) { $sourceStream.Dispose() }
        if ($entryStream) { $entryStream.Dispose() }
      }
    }
  } finally {
    if ($archive) { $archive.Dispose() }
    if ($stream) { $stream.Dispose() }
  }
  Move-Item -LiteralPath $temporary -Destination $resolvedDestination -Force
  return $resolvedDestination
}

Assert-SafeOutputPath
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$missing = New-Object System.Collections.Generic.List[string]
if ($ReuseExpanded) {
  if (-not (Test-Path -LiteralPath $PayloadDir -PathType Container)) {
    throw "Cannot reuse expanded Android environment because the payload directory is missing: $PayloadDir"
  }
} else {
  if (Test-Path -LiteralPath $PayloadDir) {
    Remove-Item -LiteralPath $PayloadDir -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $ToolchainTarget, $GradleHomeTarget | Out-Null

  if (-not (Copy-DirectoryContents -Source $ToolRoot -Destination $ToolchainTarget)) {
    $missing.Add("AgentVN AndroidToolchain source: $ToolRoot") | Out-Null
  }
  if (-not (Copy-DirectoryContents -Source $CargoHome -Destination (Join-Path $ToolchainTarget "cargo"))) {
    $missing.Add("Cargo home: $CargoHome") | Out-Null
  }
  if (-not (Copy-DirectoryContents -Source $RustupHome -Destination (Join-Path $ToolchainTarget "rustup"))) {
    $missing.Add("Rustup home: $RustupHome") | Out-Null
  }
  if (-not (Copy-PortableNode -Destination (Join-Path $ToolchainTarget "node-portable"))) {
    $missing.Add("Portable Node.js/npm") | Out-Null
  }

  $gradleDistribution = Find-GradleDistribution
  $gradleDistributionTarget = Join-Path $ToolchainTarget "gradle\gradle-$GradleVersion-bin.zip"
  if ($gradleDistribution) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $gradleDistributionTarget) | Out-Null
    Copy-Item -LiteralPath $gradleDistribution -Destination $gradleDistributionTarget -Force
  } else {
    $missing.Add("Gradle $GradleVersion distribution ZIP") | Out-Null
  }

  foreach ($relative in @("caches", "wrapper\dists\gradle-$GradleVersion-bin")) {
    $source = Join-Path $GradleUserHome $relative
    if (-not (Copy-DirectoryContents -Source $source -Destination (Join-Path $GradleHomeTarget $relative))) {
      $missing.Add("Gradle offline cache: $source") | Out-Null
    }
  }
}

$requiredPaths = New-Object System.Collections.Generic.List[string]
foreach ($relative in @(
  "payload/toolchain/jdk-17/bin/java.exe",
  "payload/toolchain/Sdk/cmdline-tools/latest/bin/sdkmanager.bat",
  "payload/toolchain/Sdk/platform-tools/adb.exe",
  "payload/toolchain/Sdk/platforms/android-$ApiLevel/android.jar",
  "payload/toolchain/Sdk/build-tools/$BuildToolsVersion/aapt.exe",
  "payload/toolchain/Sdk/ndk/$NdkVersion/source.properties",
  "payload/toolchain/node-portable/node.exe",
  "payload/toolchain/node-portable/npm.cmd",
  "payload/toolchain/cargo/bin/cargo.exe",
  "payload/toolchain/cargo/bin/rustup.exe",
  "payload/toolchain/gradle/gradle-$GradleVersion-bin.zip"
)) {
  $requiredPaths.Add($relative) | Out-Null
  if (-not (Test-Path -LiteralPath (Join-Path $OutputDir ($relative.Replace("/", "\"))))) {
    $missing.Add($relative) | Out-Null
  }
}

$rustTargets = @(
  "aarch64-linux-android",
  "armv7-linux-androideabi",
  "i686-linux-android",
  "x86_64-linux-android"
)
foreach ($target in $rustTargets) {
  $targetDir = Get-ChildItem -LiteralPath (Join-Path $ToolchainTarget "rustup\toolchains") -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName "lib\rustlib\$target" } |
    Where-Object { Test-Path -LiteralPath $_ } |
    Select-Object -First 1
  if (-not $targetDir) { $missing.Add("Rust target $target") | Out-Null }
}

$files = @(
  Get-ChildItem -LiteralPath $PayloadDir -Recurse -File |
    Sort-Object FullName |
    ForEach-Object {
      [pscustomobject][ordered]@{
        path = Relative-PackPath $_.FullName
        bytes = $_.Length
        sha256 = Get-Sha256Hex -Path $_.FullName
      }
    }
)
$totalBytes = ($files | Measure-Object bytes -Sum).Sum
$complete = $missing.Count -eq 0
$manifest = [ordered]@{
  schemaVersion = 1
  kind = "agentvn-android-environment"
  packageId = "agentvn.android.windows-x86_64.api$ApiLevel"
  packVersion = "2026.08.14"
  complete = $complete
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  platform = "windows-x86_64"
  apiLevel = $ApiLevel
  buildToolsVersion = $BuildToolsVersion
  ndkVersion = $NdkVersion
  gradleVersion = $GradleVersion
  payloadRoot = "payload"
  totalBytes = [int64]$totalBytes
  fileCount = $files.Count
  requiredPaths = @($requiredPaths)
  missing = @($missing | Sort-Object -Unique)
  files = $files
}
Write-Utf8JsonAtomic -Path $ManifestPath -Value $manifest

if (-not $complete -and -not $AllowIncomplete) {
  throw "Android offline pack is incomplete. Missing: $((@($manifest.missing) -join '; ')). Manifest: $ManifestPath"
}
$archiveOutput = New-AndroidEnvironmentArchive -SourceRoot $OutputDir -DestinationPath $ArchivePath
Write-Host "[AgentVN] Android environment archive prepared: $archiveOutput ($($files.Count) payload files, $([math]::Round($totalBytes / 1GB, 2)) GiB expanded, complete=$complete)" -ForegroundColor Green
if (-not $KeepExpanded -and (Test-Path -LiteralPath $OutputDir)) {
  Remove-Item -LiteralPath $OutputDir -Recurse -Force
}
