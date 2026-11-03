param(
  [string]$CartridgePath = "",
  [string]$OutputDir = "releases\standalone-android",
  [string]$DiagnosticsDir = "",
  [string]$OfflinePackRoot = "",
  [string]$IconPath = "",
  [Parameter(Mandatory = $true)]
  [string]$ReleaseIdentity,
  [ValidateSet("project", "default", "fallback")]
  [string]$IconSource = "default",
  [ValidateSet("balanced", "lossless", "off")]
  [string]$OptimizationProfile = "balanced",
  [string]$RunId = "",
  [switch]$SkipEnvironmentCheck,
  [switch]$SkipSymlinkProbe,
  [switch]$Json
)

$ErrorActionPreference = "Stop"
if (-not $RunId) { $RunId = [guid]::NewGuid().ToString("N") }

$Root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$RuntimeRoot = Join-Path $Root "GameCli_framework"
$SigningHelper = Join-Path $Root "scripts\android-release-signing.ps1"
$AndroidDiagnosticsHelper = Join-Path $Root "scripts\capture-android-build-diagnostics.ps1"
$AndroidGeneratedProjectHelper = Join-Path $Root "scripts\ensure-android-generated-project.cjs"
$MsvcEnvironmentResolver = Join-Path $Root "scripts\resolve-msvc-environment.ps1"
$PowerShellExe = if (Get-Command powershell.exe -ErrorAction SilentlyContinue) { "powershell.exe" } else { "pwsh" }

try {
  $releaseJson = if ($ReleaseIdentity.StartsWith("base64:", [System.StringComparison]::OrdinalIgnoreCase)) {
    $encoded = $ReleaseIdentity.Substring(7)
    [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))
  } else {
    $ReleaseIdentity
  }
  $Release = $releaseJson | ConvertFrom-Json
  $ReleaseIdentityBase64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($releaseJson))
} catch {
  throw "RELEASE_METADATA_INVALID: ReleaseIdentity is not valid JSON."
}
if (
  [int]$Release.schemaVersion -ne 1 -or
  [string]::IsNullOrWhiteSpace([string]$Release.title) -or
  [string]::IsNullOrWhiteSpace([string]$Release.gameId) -or
  [string]::IsNullOrWhiteSpace([string]$Release.versionName) -or
  [int64]$Release.versionCode -le 0 -or
  ([string]$Release.androidApplicationId -notmatch '^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){2,}$')
) {
  throw "RELEASE_METADATA_INVALID: ReleaseIdentity contains unsupported values."
}
$ReleaseTitle = [string]$Release.title
$ReleaseVersionName = [string]$Release.versionName
$ReleaseVersionCode = [int64]$Release.versionCode
$ReleaseApplicationId = [string]$Release.androidApplicationId

function Normalize-AgentVNPath {
  param([AllowNull()][string]$PathValue)
  if ([string]::IsNullOrWhiteSpace($PathValue)) { return "" }
  if ($PathValue.StartsWith('\\?\UNC\')) { return "\\" + $PathValue.Substring(8) }
  if ($PathValue.StartsWith('\\?\')) { return $PathValue.Substring(4) }
  return $PathValue
}

$NormalizedOfflinePackRoot = Normalize-AgentVNPath $OfflinePackRoot
$NormalizedOutputDir = Normalize-AgentVNPath $OutputDir
if ([string]::IsNullOrWhiteSpace($NormalizedOutputDir)) { $NormalizedOutputDir = "releases\standalone-android" }
$ResolvedOutput = if ([System.IO.Path]::IsPathRooted($NormalizedOutputDir)) {
  [System.IO.Path]::GetFullPath($NormalizedOutputDir)
} else {
  [System.IO.Path]::GetFullPath((Join-Path $Root $NormalizedOutputDir))
}
$NormalizedDiagnosticsDir = Normalize-AgentVNPath $DiagnosticsDir
if ([string]::IsNullOrWhiteSpace($NormalizedDiagnosticsDir)) {
  $NormalizedDiagnosticsDir = Join-Path ([System.IO.Path]::GetTempPath()) ("agentvn-standalone-android-" + (Get-Date -Format "yyyyMMdd-HHmmss") + "-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
}
$ResolvedDiagnostics = if ([System.IO.Path]::IsPathRooted($NormalizedDiagnosticsDir)) {
  [System.IO.Path]::GetFullPath($NormalizedDiagnosticsDir)
} else {
  [System.IO.Path]::GetFullPath((Join-Path $Root $NormalizedDiagnosticsDir))
}
$BuildLog = Join-Path $ResolvedDiagnostics "standalone-android-build.log"
$VerifyLog = Join-Path $ResolvedDiagnostics "standalone-android-verify.json"
$SymlinkReportPath = Join-Path $ResolvedDiagnostics "android-symlink-capability-runner.json"
$ManifestPath = Join-Path $ResolvedDiagnostics "package-build-manifest.json"
$GeneratedProjectDiagnosticsPath = Join-Path $ResolvedDiagnostics "android-generated-project-diagnostics.json"
$GeneratedProjectHealthPath = Join-Path $ResolvedDiagnostics "android-generated-project-health.json"
$PublicDir = Join-Path $RuntimeRoot "public"
$EmbeddedDir = Join-Path $PublicDir "embedded-cartridge"
$PackagedEmbeddedDir = Join-Path $RuntimeRoot "src-tauri\resources\embedded-cartridge"
$EmbeddedCartridge = Join-Path $EmbeddedDir "game.vncart"
$RuntimeModePath = Join-Path $PublicDir "runtime-mode.json"
$FixedOnlyPath = Join-Path $PublicDir "fixed-only.json"
$ReleasePackagePath = Join-Path $PublicDir "release-package.json"
$RuntimeIconPngPath = Join-Path $RuntimeRoot "src-tauri\icons\icon.png"
$DefaultRuntimeIconPath = Join-Path $RuntimeRoot "public\logo.png"
$RuntimeTauriConfigPath = Join-Path $RuntimeRoot "src-tauri\tauri.conf.json"
$AndroidResRoot = Join-Path $RuntimeRoot "src-tauri\gen\android\app\src\main\res"
$AndroidLauncherIconNames = @("ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png")
$AndroidManifestPath = Join-Path $RuntimeRoot "src-tauri\gen\android\app\src\main\AndroidManifest.xml"
$AndroidMainActivityPath = Join-Path $RuntimeRoot ("src-tauri\gen\android\app\src\main\java\" + ($ReleaseApplicationId -replace '\.', '\') + "\MainActivity.kt")
$AndroidGradlePath = Join-Path $RuntimeRoot "src-tauri\gen\android\app\build.gradle.kts"
$AndroidGradleWrapperPropertiesPath = Join-Path $RuntimeRoot "src-tauri\gen\android\gradle\wrapper\gradle-wrapper.properties"
$AndroidPropertiesPath = Join-Path $RuntimeRoot "src-tauri\gen\android\app\tauri.properties"
$AndroidStringsPath = Join-Path $RuntimeRoot "src-tauri\gen\android\app\src\main\res\values\strings.xml"
$AndroidGeneratedEmbeddedDir = Join-Path $RuntimeRoot "src-tauri\gen\android\app\src\main\assets\embedded-cartridge"
$AndroidGeneratedBuildDir = Join-Path $RuntimeRoot "src-tauri\gen\android\app\build"
$AndroidGeneratedGradleCacheDir = Join-Path $RuntimeRoot "src-tauri\gen\android\.gradle"
$AndroidLauncherIconSizes = @{
  "mipmap-mdpi" = 48
  "mipmap-hdpi" = 72
  "mipmap-xhdpi" = 96
  "mipmap-xxhdpi" = 144
  "mipmap-xxxhdpi" = 192
}
$AppliedIconSource = ""
$FailureCode = ""
$BuildWarnings = @()
$AudioNormalization = $null
$PostBuildInspection = $null
$OfflineEnvironment = $null
$GeneratedProjectDiagnostics = $null
$AndroidGeneratedProjectHealth = $null

function Write-Utf8Atomic {
  param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][object]$Value)
  $parent = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $temporary = "$Path.tmp-$([guid]::NewGuid().ToString('N'))"
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  $json = if ($Value -is [string]) { $Value } else { $Value | ConvertTo-Json -Depth 12 }
  [System.IO.File]::WriteAllText($temporary, "$json`n", $utf8)
  Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Initialize-Utf8Log {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [AllowEmptyString()][string]$Value = ""
  )
  $parent = Split-Path -Parent $Path
  if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  [System.IO.File]::WriteAllText(
    $Path,
    "$Value`n",
    (New-Object System.Text.UTF8Encoding($false))
  )
}

function Add-Utf8Log {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [AllowEmptyString()][string]$Value = ""
  )
  $parent = Split-Path -Parent $Path
  if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  [System.IO.File]::AppendAllText(
    $Path,
    "$Value`n",
    (New-Object System.Text.UTF8Encoding($false))
  )
}

function Import-AgentVNMsvcEnvironment {
  if (-not (Test-Path -LiteralPath $MsvcEnvironmentResolver -PathType Leaf)) {
    throw "WINDOWS_MSVC_LINKER_MISSING: The bundled MSVC environment resolver is missing: $MsvcEnvironmentResolver"
  }
  try {
    $json = (& $MsvcEnvironmentResolver -Json | Out-String).Trim()
    if ([string]::IsNullOrWhiteSpace($json)) {
      throw "The MSVC environment resolver returned no JSON."
    }
    $resolved = $json | ConvertFrom-Json
  } catch {
    throw "WINDOWS_MSVC_LINKER_MISSING: Failed to resolve the Visual Studio C++ environment: $($_.Exception.Message)"
  }
  if ($resolved.status -ne "PASS") {
    throw "WINDOWS_MSVC_LINKER_MISSING: $($resolved.message)"
  }
  foreach ($property in $resolved.environment.PSObject.Properties) {
    Set-Item -LiteralPath ("Env:\" + $property.Name) -Value ([string]$property.Value)
  }
  if (-not (Get-Command link.exe -ErrorAction SilentlyContinue) -or [string]::IsNullOrWhiteSpace($env:LIB)) {
    throw "WINDOWS_MSVC_LINKER_MISSING: Visual Studio was detected, but link.exe or the Windows SDK LIB environment is unavailable."
  }
  Add-Utf8Log -Path $BuildLog -Value "MSVC host linker environment loaded: $($resolved.linkPath)"
}

function Read-Utf8Text {
  param([Parameter(Mandatory = $true)][string]$Path)
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  if (
    ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) -or
    ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFE -and $bytes[1] -eq 0xFF)
  ) {
    throw "ENCODING_INVALID: UTF-16 text is not allowed: $Path"
  }
  $encoding = New-Object System.Text.UTF8Encoding($false, $true)
  try {
    $text = $encoding.GetString($bytes)
  } catch {
    throw "ENCODING_INVALID: invalid UTF-8 text $Path / $($_.Exception.Message)"
  }
  if ($text.Contains([char]0xFFFD)) {
    throw "ENCODING_INVALID: replacement character found in $Path"
  }
  return $text.TrimStart([char]0xFEFF)
}

function Read-Utf8Json {
  param([Parameter(Mandatory = $true)][string]$Path)
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) {
    throw "Structured JSON is UTF-16LE; expected UTF-8: $Path"
  }
  $text = [System.Text.Encoding]::UTF8.GetString($bytes)
  if ($text.Contains([char]0xFFFD)) {
    throw "Structured JSON contains invalid UTF-8 replacement characters: $Path"
  }
  return ($text.TrimStart([char]0xFEFF) | ConvertFrom-Json)
}

function Remove-AnsiEscape {
  param([AllowNull()][string]$Value)
  if ($null -eq $Value) { return "" }
  return [regex]::Replace($Value, "$([char]27)\[[0-?]*[ -/]*[@-~]", "")
}

function Get-SafePackageFileStem {
  param([string]$Value)
  $safe = $Value -replace '[<>:"/\\|?*\x00-\x1F]', '_' -replace '\s+', ' '
  $safe = $safe.Trim().TrimEnd('.', ' ')
  if ([string]::IsNullOrWhiteSpace($safe)) { $safe = "AgentVN-Game" }
  if ($safe -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$') { $safe = "_$safe" }
  if ($safe.Length -gt 96) { $safe = $safe.Substring(0, 96).TrimEnd('.', ' ') }
  return $safe
}

function Use-AgentVNOfflineGradle {
  param([string]$DistributionPath, [string]$GradleHome)
  if ([string]::IsNullOrWhiteSpace($DistributionPath) -or -not (Test-Path -LiteralPath $DistributionPath)) {
    return $false
  }
  if (-not (Test-Path -LiteralPath $AndroidGradleWrapperPropertiesPath)) {
    throw "ANDROID_OFFLINE_PACK_INCOMPLETE: Gradle wrapper properties were not generated: $AndroidGradleWrapperPropertiesPath"
  }
  $resolvedDistribution = (Resolve-Path -LiteralPath $DistributionPath).Path
  $distributionUri = (New-Object System.Uri($resolvedDistribution)).AbsoluteUri
  $properties = [System.IO.File]::ReadAllText($AndroidGradleWrapperPropertiesPath, [System.Text.Encoding]::UTF8)
  if ($properties -notmatch '(?m)^distributionUrl=') {
    throw "ANDROID_OFFLINE_PACK_INCOMPLETE: Gradle wrapper properties contain no distributionUrl."
  }
  $properties = [regex]::Replace($properties, '(?m)^distributionUrl=.*$', "distributionUrl=$distributionUri")
  [System.IO.File]::WriteAllText(
    $AndroidGradleWrapperPropertiesPath,
    $properties,
    (New-Object System.Text.UTF8Encoding($false))
  )
  if (-not [string]::IsNullOrWhiteSpace($GradleHome)) {
    New-Item -ItemType Directory -Force -Path $GradleHome | Out-Null
    $env:GRADLE_USER_HOME = $GradleHome
  }
  $env:AGENTVN_GRADLE_DISTRIBUTION = $resolvedDistribution
  Add-Utf8Log -Path $BuildLog -Value "Offline Gradle distribution configured: $resolvedDistribution"
  Add-Utf8Log -Path $BuildLog -Value "Offline Gradle user home: $($env:GRADLE_USER_HOME)"
  return $true
}

function Classify-AndroidBuildFailure {
  param([string]$LogPath)
  if (-not (Test-Path -LiteralPath $LogPath)) { return "" }
  $logLines = (Read-Utf8Text -Path $LogPath) -split "\r?\n"
  $text = ($logLines | Select-Object -Last 240) -join "`n"
  if ($text -match '(?i)(different roots:|RelocatableFileToPathConverter|ComplementarySourceFilesMap)') {
    return "ANDROID_KOTLIN_CROSS_DRIVE_CACHE_FAILED"
  }
  if ($text -match '(?i)(Android signing password is unavailable|protected password file|AGENTVN_ANDROID_KEYSTORE_PASSWORD)') {
    return "ANDROID_SIGNING_PASSWORD_UNAVAILABLE"
  }
  if ($text -match 'Downloading from https?://services\.gradle\.org/distributions/.*failed:\s*timeout|SocketTimeoutException:\s*Read timed out') {
    return "GRADLE_DISTRIBUTION_DOWNLOAD_FAILED"
  }
  if ($text -match 'Could not resolve all files|Could not resolve .*dependency|UnknownHostException|ConnectException') {
    return "GRADLE_DEPENDENCY_UNAVAILABLE"
  }
  if ($text -match 'No space left on device|There is not enough space on the disk') {
    return "PROJECT_DISK_FULL"
  }
  if ($text -match 'processUniversalReleaseMainManifest|ManifestMerger2::MergeFailureException|Error parsing .*AndroidManifest\.xml|Manifest merger failed') {
    return "ANDROID_MANIFEST_INVALID"
  }
  if (
    $text -match '(?i)(compile[A-Za-z]*Kotlin|Compilation error\. See log for more details)' -and
    $text -match '(?i)(\.kt:\d+:\d+|KotlinCompiler|GradleKotlinCompilerWorkAction|Unresolved reference)'
  ) {
    return "ANDROID_KOTLIN_COMPILE_FAILED"
  }
  return ""
}

function Set-AndroidKotlinCompilerPolicy {
  param([Parameter(Mandatory = $true)][string]$GradlePropertiesPath)
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  $existing = if (Test-Path -LiteralPath $GradlePropertiesPath -PathType Leaf) {
    [System.IO.File]::ReadAllText($GradlePropertiesPath, $utf8)
  } else {
    ""
  }
  $lines = @(
    $existing -split "\r?\n" |
      Where-Object {
        $_ -notmatch '^(?i:kotlin\.incremental|kotlin\.incremental\.useClasspathSnapshot|kotlin\.compiler\.execution\.strategy)='
      }
  )
  while ($lines.Count -gt 0 -and [string]::IsNullOrWhiteSpace([string]$lines[$lines.Count - 1])) {
    $lines = @($lines[0..($lines.Count - 2)])
  }
  $lines += "kotlin.incremental=false"
  $lines += "kotlin.incremental.useClasspathSnapshot=false"
  $lines += "kotlin.compiler.execution.strategy=in-process"
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $GradlePropertiesPath) | Out-Null
  [System.IO.File]::WriteAllText(
    $GradlePropertiesPath,
    (($lines -join "`n").TrimEnd() + "`n"),
    $utf8
  )
  Add-Utf8Log -Path $BuildLog -Value "Kotlin incremental compilation disabled for cross-drive Android build workspaces."
}

function Test-ImageVisualValidity {
  param([string]$Source)
  Add-Type -AssemblyName System.Drawing
  try {
    $bitmap = New-Object System.Drawing.Bitmap $Source
  } catch {
    return [ordered]@{ valid = $false; reason = "image_decode_failed"; detail = $_.Exception.Message }
  }
  try {
    if ($bitmap.Width -lt 128 -or $bitmap.Height -lt 128) {
      return [ordered]@{ valid = $false; reason = "image_too_small"; detail = "$($bitmap.Width)x$($bitmap.Height)" }
    }
    $stepX = [Math]::Max(1, [int]($bitmap.Width / 48))
    $stepY = [Math]::Max(1, [int]($bitmap.Height / 48))
    $opaque = 0
    $count = 0
    $difference = 0.0
    $colors = New-Object 'System.Collections.Generic.HashSet[int]'
    for ($y = 0; $y -lt $bitmap.Height; $y += $stepY) {
      for ($x = 0; $x -lt $bitmap.Width; $x += $stepX) {
        $pixel = $bitmap.GetPixel($x, $y)
        if ($pixel.A -gt 8) { $opaque++ }
        $colors.Add($pixel.ToArgb()) | Out-Null
        if ($x + $stepX -lt $bitmap.Width) {
          $next = $bitmap.GetPixel($x + $stepX, $y)
          $difference += ([Math]::Abs($pixel.R - $next.R) + [Math]::Abs($pixel.G - $next.G) + [Math]::Abs($pixel.B - $next.B)) / 3.0
        }
        $count++
      }
    }
    $opaqueRatio = $opaque / [Math]::Max(1, $count)
    $averageDifference = $difference / [Math]::Max(1, $count)
    if ($opaqueRatio -lt 0.05) {
      return [ordered]@{ valid = $false; reason = "image_mostly_transparent"; detail = $opaqueRatio }
    }
    if ($colors.Count -lt 4) {
      return [ordered]@{ valid = $false; reason = "image_nearly_monochrome"; detail = $colors.Count }
    }
    if ($averageDifference -gt 58 -and $colors.Count -gt ($count * 0.7)) {
      return [ordered]@{ valid = $false; reason = "image_noise_detected"; detail = [Math]::Round($averageDifference, 2) }
    }
    return [ordered]@{
      valid = $true
      width = $bitmap.Width
      height = $bitmap.Height
      opaqueRatio = [Math]::Round($opaqueRatio, 4)
      sampledColors = $colors.Count
      averageAdjacentDifference = [Math]::Round($averageDifference, 2)
    }
  } finally {
    $bitmap.Dispose()
  }
}

function Apply-ReleaseIdentity {
  try {
    [void][System.Xml.XmlConvert]::VerifyXmlChars($ReleaseTitle)
  } catch {
    throw "RELEASE_METADATA_INVALID: release title contains characters that cannot be written to Android XML: $($_.Exception.Message)"
  }
  $config = Read-Utf8Json -Path $RuntimeTauriConfigPath
  $config.productName = $ReleaseTitle
  $config.version = $ReleaseVersionName
  $config.identifier = $ReleaseApplicationId
  # Android release builds already run the frontend build in the outer Node
  # runner. Leaving Tauri's hook enabled makes the Windows Android generator
  # resolve `npm run build` as `npm.bat`; standard Node installations provide
  # `npm.cmd` instead, so Gradle fails before assembling the APK. Disable the
  # duplicate hook in this temporary release workspace. The source config is
  # restored in the finally block after packaging.
  if ($config.build) {
    $config.build.beforeBuildCommand = ""
  }
  if (-not $config.bundle) { $config | Add-Member -NotePropertyName bundle -NotePropertyValue ([pscustomobject]@{}) }
  if ($config.bundle.PSObject.Properties["android"]) {
    if (-not $config.bundle.android) { $config.bundle.android = [pscustomobject]@{} }
  } else {
    $config.bundle | Add-Member -NotePropertyName android -NotePropertyValue ([pscustomobject]@{})
  }
  if ($config.bundle.android.PSObject.Properties["versionCode"]) {
    $config.bundle.android.versionCode = $ReleaseVersionCode
  } else {
    $config.bundle.android | Add-Member -NotePropertyName versionCode -NotePropertyValue $ReleaseVersionCode
  }
  foreach ($window in @($config.app.windows)) { $window.title = $ReleaseTitle }
  Write-Utf8Atomic -Path $RuntimeTauriConfigPath -Value $config

  if (-not (Test-Path -LiteralPath $AndroidGradlePath)) {
    Add-Utf8Log -Path $BuildLog -Value "Release identity written to Tauri config; generated Android project is not initialized yet."
    return
  }
  $gradle = [System.IO.File]::ReadAllText($AndroidGradlePath, [System.Text.Encoding]::UTF8)
  $namespaceMatches = [regex]::Matches(
    $gradle,
    '(?m)^(?<indent>\s*)namespace\s*=\s*"[^"]+"\s*$'
  )
  if ($namespaceMatches.Count -ne 1) {
    throw "ANDROID_GRADLE_TEMPLATE_INVALID: expected exactly one namespace assignment in $AndroidGradlePath; found $($namespaceMatches.Count)."
  }
  $namespaceMatch = $namespaceMatches[0]
  $namespaceReplacement = $namespaceMatch.Groups["indent"].Value + "namespace = `"$ReleaseApplicationId`""
  $gradle = $gradle.Remove($namespaceMatch.Index, $namespaceMatch.Length).Insert(
    $namespaceMatch.Index,
    $namespaceReplacement
  )
  $applicationIdMatches = [regex]::Matches(
    $gradle,
    '(?m)^(?<indent>\s*)applicationId\s*=\s*"[^"]+"\s*$'
  )
  if ($applicationIdMatches.Count -ne 1) {
    throw "ANDROID_GRADLE_TEMPLATE_INVALID: expected exactly one applicationId assignment in $AndroidGradlePath; found $($applicationIdMatches.Count)."
  }
  $applicationIdMatch = $applicationIdMatches[0]
  $applicationIdReplacement = $applicationIdMatch.Groups["indent"].Value + "applicationId = `"$ReleaseApplicationId`""
  $gradle = $gradle.Remove($applicationIdMatch.Index, $applicationIdMatch.Length).Insert(
    $applicationIdMatch.Index,
    $applicationIdReplacement
  )
  [System.IO.File]::WriteAllText($AndroidGradlePath, $gradle, (New-Object System.Text.UTF8Encoding($false)))

  [System.IO.File]::WriteAllText(
    $AndroidPropertiesPath,
    "tauri.android.versionName=$ReleaseVersionName`ntauri.android.versionCode=$ReleaseVersionCode`n",
    (New-Object System.Text.UTF8Encoding($false))
  )
  $escapedTitle = [System.Security.SecurityElement]::Escape($ReleaseTitle)
  [System.IO.File]::WriteAllText(
    $AndroidStringsPath,
    "<resources>`n    <string name=`"app_name`">$escapedTitle</string>`n    <string name=`"main_activity_title`">$escapedTitle</string>`n</resources>`n",
    (New-Object System.Text.UTF8Encoding($false))
  )

  $javaRoot = Join-Path $RuntimeRoot "src-tauri\gen\android\app\src\main\java"
  $existingActivity = Get-ChildItem -LiteralPath $javaRoot -Recurse -Filter "MainActivity.kt" -File | Select-Object -First 1
  if (-not $existingActivity) { throw "MainActivity.kt was not found after tauri android init." }
  $existingPackageDirectory = $existingActivity.Directory.FullName
  try {
    $existingActivityText = (New-Object System.Text.UTF8Encoding($false, $true)).
      GetString([System.IO.File]::ReadAllBytes($existingActivity.FullName)).
      TrimStart([char]0xFEFF)
  } catch {
    throw "ENCODING_INVALID: generated MainActivity.kt is not strict UTF-8: $($existingActivity.FullName) / $($_.Exception.Message)"
  }
  $existingPackageMatch = [regex]::Match($existingActivityText, '(?m)^package\s+([^\r\n]+)')
  if (-not $existingPackageMatch.Success) {
    throw "ANDROID_KOTLIN_TEMPLATE_INVALID: MainActivity.kt is missing its package declaration: $($existingActivity.FullName)"
  }
  $existingGeneratedPackage = $existingPackageMatch.Groups[1].Value.Trim()
  $packageDirectory = Join-Path $javaRoot ($ReleaseApplicationId -replace '\.', '\')
  if ($existingPackageDirectory -ne $packageDirectory) {
    if (Test-Path -LiteralPath $packageDirectory) { Remove-Item -LiteralPath $packageDirectory -Recurse -Force }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $packageDirectory) | Out-Null
    Copy-Item -LiteralPath $existingPackageDirectory -Destination $packageDirectory -Recurse -Force
    Remove-Item -LiteralPath $existingPackageDirectory -Recurse -Force
  }
  foreach ($kotlinFile in Get-ChildItem -LiteralPath $packageDirectory -Recurse -Filter "*.kt" -File) {
    try {
      $kotlin = (New-Object System.Text.UTF8Encoding($false, $true)).
        GetString([System.IO.File]::ReadAllBytes($kotlinFile.FullName)).
        TrimStart([char]0xFEFF)
    } catch {
      throw "ENCODING_INVALID: generated Kotlin source is not strict UTF-8: $($kotlinFile.FullName) / $($_.Exception.Message)"
    }
    $packageMatches = [regex]::Matches($kotlin, '(?m)^package\s+[^\r\n]+')
    if ($packageMatches.Count -ne 1) {
      throw "ANDROID_KOTLIN_TEMPLATE_INVALID: expected exactly one package declaration in $($kotlinFile.FullName); found $($packageMatches.Count)."
    }
    $packageMatch = $packageMatches[0]
    $kotlin = $kotlin.Remove($packageMatch.Index, $packageMatch.Length).Insert(
      $packageMatch.Index,
      "package $ReleaseApplicationId"
    )
    [System.IO.File]::WriteAllText($kotlinFile.FullName, $kotlin, (New-Object System.Text.UTF8Encoding($false)))
  }
  # Tauri's generated release build enables R8 shrinking. The generated
  # ProGuard rules keep JNI/reflection entry points such as
  # TauriActivity.getPluginManager(), but they are emitted with the template
  # package name. Once the release identity changes, stale package-qualified
  # rules no longer match and R8 strips the method, causing a launch-time
  # NoSuchMethodError. Keep every generated rule in lockstep with the Kotlin
  # package migration.
  $androidAppRoot = Join-Path $RuntimeRoot "src-tauri\gen\android\app"
  foreach ($proguardFile in Get-ChildItem -LiteralPath $androidAppRoot -Recurse -Filter "*.pro" -File |
    Where-Object { $_.Extension -ieq ".pro" }) {
    try {
      $proguard = (New-Object System.Text.UTF8Encoding($false, $true)).
        GetString([System.IO.File]::ReadAllBytes($proguardFile.FullName)).
        TrimStart([char]0xFEFF)
    } catch {
      throw "ENCODING_INVALID: generated ProGuard file is not strict UTF-8: $($proguardFile.FullName) / $($_.Exception.Message)"
    }
    if (-not [string]::IsNullOrWhiteSpace($existingGeneratedPackage)) {
      $proguard = $proguard.Replace($existingGeneratedPackage, $ReleaseApplicationId)
    }
    [System.IO.File]::WriteAllText(
      $proguardFile.FullName,
      $proguard,
      (New-Object System.Text.UTF8Encoding($false))
    )
  }
  $tauriProguardPath = Join-Path $androidAppRoot "proguard-tauri.pro"
  if (Test-Path -LiteralPath $tauriProguardPath -PathType Leaf) {
    $tauriProguard = (New-Object System.Text.UTF8Encoding($false, $true)).
      GetString([System.IO.File]::ReadAllBytes($tauriProguardPath)).
      TrimStart([char]0xFEFF)
    if (
      $tauriProguard -match "getPluginManager" -and
      $tauriProguard -notmatch [regex]::Escape("$ReleaseApplicationId.TauriActivity")
    ) {
      throw "ANDROID_PROGUARD_TEMPLATE_INVALID: Tauri getPluginManager keep rule does not target the release application id."
    }
  }
  Add-Utf8Log -Path $BuildLog -Value "Release identity applied: title=$ReleaseTitle applicationId=$ReleaseApplicationId version=$ReleaseVersionName ($ReleaseVersionCode)"
}

function Get-ProcessElevationState {
  try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  } catch {
    return $false
  }
}

function Get-SymbolicLinkPrivilegeState {
  if (-not ("AgentVNSymlinkPrivilegeProbe" -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class AgentVNSymlinkPrivilegeProbe {
  private const UInt32 TOKEN_QUERY = 0x0008;
  private const Int32 TokenPrivileges = 3;
  private const UInt32 SE_PRIVILEGE_ENABLED = 0x00000002;
  private const Int32 ERROR_INSUFFICIENT_BUFFER = 122;

  [StructLayout(LayoutKind.Sequential)]
  private struct LUID {
    public UInt32 LowPart;
    public Int32 HighPart;
  }

  [DllImport("kernel32.dll")]
  private static extern IntPtr GetCurrentProcess();

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool CloseHandle(IntPtr handle);

  [DllImport("advapi32.dll", SetLastError = true)]
  private static extern bool OpenProcessToken(IntPtr processHandle, UInt32 desiredAccess, out IntPtr tokenHandle);

  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool LookupPrivilegeValue(string systemName, string name, out LUID luid);

  [DllImport("advapi32.dll", SetLastError = true)]
  private static extern bool GetTokenInformation(
    IntPtr tokenHandle,
    Int32 tokenInformationClass,
    IntPtr tokenInformation,
    Int32 tokenInformationLength,
    out Int32 returnLength
  );

  public static int GetState() {
    IntPtr token;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, out token)) {
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    try {
      LUID target;
      if (!LookupPrivilegeValue(null, "SeCreateSymbolicLinkPrivilege", out target)) {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }
      Int32 required = 0;
      GetTokenInformation(token, TokenPrivileges, IntPtr.Zero, 0, out required);
      if (required <= 0 && Marshal.GetLastWin32Error() != ERROR_INSUFFICIENT_BUFFER) {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }
      IntPtr buffer = Marshal.AllocHGlobal(required);
      try {
        if (!GetTokenInformation(token, TokenPrivileges, buffer, required, out required)) {
          throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        Int32 count = Marshal.ReadInt32(buffer);
        for (Int32 index = 0; index < count; index++) {
          IntPtr entry = IntPtr.Add(buffer, 4 + (index * 12));
          UInt32 low = unchecked((UInt32)Marshal.ReadInt32(entry, 0));
          Int32 high = Marshal.ReadInt32(entry, 4);
          UInt32 attributes = unchecked((UInt32)Marshal.ReadInt32(entry, 8));
          if (low == target.LowPart && high == target.HighPart) {
            return (attributes & SE_PRIVILEGE_ENABLED) != 0 ? 2 : 1;
          }
        }
        return 0;
      } finally {
        Marshal.FreeHGlobal(buffer);
      }
    } finally {
      CloseHandle(token);
    }
  }
}
'@
  }
  try {
    $state = [AgentVNSymlinkPrivilegeProbe]::GetState()
    return [ordered]@{
      present = ($state -ge 1)
      enabled = ($state -eq 2)
      queryError = ""
    }
  } catch {
    return [ordered]@{
      present = $false
      enabled = $false
      queryError = $_.Exception.Message
    }
  }
}

function Test-AndroidSymlinkCapability {
  param([Parameter(Mandatory = $true)][string]$ProbeRoot)
  $probeDir = Join-Path $ProbeRoot (".agentvn-symlink-probe-" + [guid]::NewGuid().ToString("N"))
  $source = Join-Path $probeDir "source.txt"
  $link = Join-Path $probeDir "link.txt"
  $win32Code = 0
  $errorText = ""
  $success = $false
  try {
    New-Item -ItemType Directory -Force -Path $probeDir | Out-Null
    [System.IO.File]::WriteAllText($source, "agentvn-symlink-probe", (New-Object System.Text.UTF8Encoding($false)))
    New-Item -ItemType SymbolicLink -Path $link -Target $source -ErrorAction Stop | Out-Null
    $success = (Get-Content -LiteralPath $link -Raw) -eq "agentvn-symlink-probe"
  } catch {
    $errorText = $_.Exception.Message
    if ($_.Exception.HResult) { $win32Code = $_.Exception.HResult -band 0xFFFF }
  } finally {
    Remove-Item -LiteralPath $probeDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  $developerMode = $null
  try {
    $developerMode = [int](Get-ItemPropertyValue -LiteralPath "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" -Name "AllowDevelopmentWithoutDevLicense" -ErrorAction Stop)
  } catch {}
  $privilege = Get-SymbolicLinkPrivilegeState
  $report = [ordered]@{
    schemaVersion = 2
    probeRoot = $ProbeRoot
    sourcePath = $source
    linkPath = $link
    success = $success
    win32ErrorCode = $win32Code
    error = $errorText
    windowsBuild = [Environment]::OSVersion.Version.ToString()
    checkedAt = (Get-Date).ToUniversalTime().ToString("o")
    developerModeEnabled = ($developerMode -eq 1)
    developerModeRegistryValue = $developerMode
    isElevated = Get-ProcessElevationState
    symbolicLinkPrivilegePresent = $privilege.present
    symbolicLinkPrivilegeEnabled = $privilege.enabled
    symbolicLinkPrivilegeQueryError = $privilege.queryError
  }
  Write-Utf8Atomic -Path $SymlinkReportPath -Value $report
  return [pscustomobject]$report
}

function ConvertTo-AgentVNExtendedPath {
  param([Parameter(Mandatory = $true)][string]$Path)
  if ($Path.StartsWith("\\?\")) { return $Path }
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  if ($fullPath.StartsWith("\\")) {
    return "\\?\UNC\" + $fullPath.TrimStart("\")
  }
  return "\\?\" + $fullPath
}

function Get-AgentVNDirectoryFileCount {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return 0 }
  $count = 0
  $extendedRoot = ConvertTo-AgentVNExtendedPath -Path $Path
  foreach ($unused in [System.IO.Directory]::EnumerateFiles(
    $extendedRoot,
    "*",
    [System.IO.SearchOption]::AllDirectories
  )) {
    $count += 1
  }
  return $count
}

function Copy-AgentVNDirectoryContents {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
  )
  if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
    throw "WINDOWS_LONG_PATH_COPY_FAILED: Source directory does not exist: $Source"
  }
  $sourceRoot = (ConvertTo-AgentVNExtendedPath -Path $Source).TrimEnd("\")
  $destinationRoot = (ConvertTo-AgentVNExtendedPath -Path $Destination).TrimEnd("\")
  try {
    [void][System.IO.Directory]::CreateDirectory($destinationRoot)
    foreach ($sourceFile in [System.IO.Directory]::EnumerateFiles(
      $sourceRoot,
      "*",
      [System.IO.SearchOption]::AllDirectories
    )) {
      $relativePath = $sourceFile.Substring($sourceRoot.Length).TrimStart("\")
      $destinationFile = "$destinationRoot\$relativePath"
      $destinationParent = [System.IO.Path]::GetDirectoryName($destinationFile)
      [void][System.IO.Directory]::CreateDirectory($destinationParent)
      [System.IO.File]::Copy($sourceFile, $destinationFile, $true)
    }
  } catch {
    throw "WINDOWS_LONG_PATH_COPY_FAILED: Could not copy Android packaged resources from '$Source' to '$Destination': $($_.Exception.Message)"
  }
}

function Remove-AgentVNDirectoryTree {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return }
  try {
    [System.IO.Directory]::Delete((ConvertTo-AgentVNExtendedPath -Path $Path), $true)
  } catch {
    throw "WINDOWS_LONG_PATH_CLEANUP_FAILED: Could not remove '$Path': $($_.Exception.Message)"
  }
}

function Reset-AndroidPackagedResourceOutputs {
  # Tauri/Gradle copy resources incrementally. Removed PNG/TTF files otherwise
  # survive beside their optimized WebP/WOFF2 replacements in the next APK.
  if (Test-Path -LiteralPath $AndroidGeneratedEmbeddedDir) {
    Remove-AgentVNDirectoryTree -Path $AndroidGeneratedEmbeddedDir
  }
  Add-Utf8Log -Path $BuildLog -Value "Android generated resource outputs reset before packaging."
}

function Reset-AndroidCompiledOutputs {
  # Release identity changes rewrite Kotlin packages and R8 keep rules in the
  # generated project. Gradle's app output and local cache must not survive
  # across identities, otherwise an APK can contain stale classes that compile
  # successfully but crash at launch with JNI/reflection NoSuchMethodError.
  if (Test-Path -LiteralPath $AndroidGeneratedBuildDir) {
    Remove-AgentVNDirectoryTree -Path $AndroidGeneratedBuildDir
  }
  if (Test-Path -LiteralPath $AndroidGeneratedGradleCacheDir) {
    Remove-AgentVNDirectoryTree -Path $AndroidGeneratedGradleCacheDir
  }
  Add-Utf8Log -Path $BuildLog -Value "Android compiled outputs reset before Tauri build."
}

function Sync-AndroidPackagedResources {
  if (-not (Test-Path -LiteralPath $PackagedEmbeddedDir)) {
    throw "PACKAGED_RESOURCE_SMOKE_FAILED: prepared embedded cartridge directory is missing: $PackagedEmbeddedDir"
  }
  foreach ($required in @("manifest.json", "script.json", "checksum.json", "startup-index.json")) {
    $sourceRequired = Join-Path $PackagedEmbeddedDir $required
    if (-not (Test-Path -LiteralPath $sourceRequired)) {
      throw "PACKAGED_RESOURCE_SMOKE_FAILED: prepared embedded cartridge is missing $required"
    }
  }

  Copy-AgentVNDirectoryContents `
    -Source $PackagedEmbeddedDir `
    -Destination $AndroidGeneratedEmbeddedDir

  $sourceFileCount = Get-AgentVNDirectoryFileCount -Path $PackagedEmbeddedDir
  $generatedFileCount = Get-AgentVNDirectoryFileCount -Path $AndroidGeneratedEmbeddedDir
  if ($sourceFileCount -eq 0 -or $generatedFileCount -ne $sourceFileCount) {
    throw "PACKAGED_RESOURCE_SMOKE_FAILED: Android generated cartridge file count mismatch. source=$sourceFileCount generated=$generatedFileCount"
  }
  foreach ($required in @("manifest.json", "script.json", "checksum.json", "startup-index.json")) {
    if (-not (Test-Path -LiteralPath (Join-Path $AndroidGeneratedEmbeddedDir $required))) {
      throw "PACKAGED_RESOURCE_SMOKE_FAILED: Android generated assets are missing $required"
    }
  }
  Add-Utf8Log -Path $BuildLog -Value "Android packaged resources synchronized: $generatedFileCount files -> $AndroidGeneratedEmbeddedDir"
}

function Apply-AndroidRuntimePolicy {
  if (-not (Test-Path -LiteralPath $AndroidManifestPath)) { throw "AndroidManifest.xml not found after tauri android init: $AndroidManifestPath" }
  try {
    $manifestBytes = [System.IO.File]::ReadAllBytes($AndroidManifestPath)
    $manifestText = (New-Object System.Text.UTF8Encoding($false, $true)).
      GetString($manifestBytes).
      TrimStart([char]0xFEFF)
  } catch {
    throw "ENCODING_INVALID: AndroidManifest.xml is not strict UTF-8: $AndroidManifestPath / $($_.Exception.Message)"
  }
  $manifestDocument = New-Object System.Xml.XmlDocument
  $manifestDocument.PreserveWhitespace = $true
  try {
    $manifestDocument.LoadXml($manifestText)
  } catch {
    throw "ANDROID_MANIFEST_INVALID: AndroidManifest.xml is invalid before applying runtime policy: $AndroidManifestPath / $($_.Exception.Message)"
  }
  $androidNamespace = "http://schemas.android.com/apk/res/android"
  $mainActivity = @($manifestDocument.SelectNodes("/manifest/application/activity")) |
    Where-Object {
      $activityName = $_.GetAttribute("name", $androidNamespace)
      $activityName -eq ".MainActivity" -or $activityName.EndsWith(".MainActivity", [System.StringComparison]::Ordinal)
    } |
    Select-Object -First 1
  if (-not $mainActivity) {
    throw "ANDROID_MANIFEST_INVALID: MainActivity was not found in generated AndroidManifest.xml: $AndroidManifestPath"
  }
  $orientationAttribute = $mainActivity.GetAttributeNode("screenOrientation", $androidNamespace)
  if (-not $orientationAttribute) {
    $orientationAttribute = $manifestDocument.CreateAttribute("android", "screenOrientation", $androidNamespace)
    [void]$mainActivity.Attributes.Append($orientationAttribute)
  }
  $orientationAttribute.Value = "sensorLandscape"
  Write-Utf8Atomic -Path $AndroidManifestPath -Value $manifestDocument.OuterXml
  if (-not (Test-Path -LiteralPath $AndroidMainActivityPath)) { throw "MainActivity.kt not found after applying release identity: $AndroidMainActivityPath" }
  $activity = @'
package com.agentvn.player

import android.os.Bundle
import android.content.res.Configuration
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.app.AlertDialog
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
  companion object {
    @Volatile private var runtimeRestorationReady = false
  }
  private var insetRevision = 0
  private var runtimeWebView: WebView? = null
  private var confirmedRuntimeExit = false
  private var runtimeRestoreDialog: AlertDialog? = null
  private external fun runtimeActivityCreated(id: Int): Boolean
  private external fun runtimeActivityDestroyed(id: Int, changingConfiguration: Boolean)

  // Native registration completes only after the initial real WebView exists.
  fun enableRuntimeRestoration() {
    runtimeRestorationReady = true
  }

  fun showRuntimeRestoreError(message: String) {
    runOnUiThread {
      if (isFinishing || isDestroyed || runtimeRestoreDialog?.isShowing == true) return@runOnUiThread
      runtimeRestoreDialog = AlertDialog.Builder(this)
        .setTitle("无法恢复游戏")
        .setMessage(message)
        .setCancelable(false)
        .setPositiveButton("重试") { _, _ ->
          runtimeRestoreDialog = null
          requestRuntimeRestoration()
        }
        .setNegativeButton("关闭") { _, _ -> finish() }
        .show()
    }
  }

  private fun requestRuntimeRestoration() {
    val requested = try { runtimeActivityCreated(id) } catch (error: LinkageError) { false }
    if (!requested) showRuntimeRestoreError("游戏窗口恢复请求失败。可以重试或关闭游戏。")
  }

  // Called only by the native confirmed-exit command after the save barrier.
  // JNI dispatch already runs on this Activity's UI thread.
  fun finishConfirmedRuntime() {
    if (confirmedRuntimeExit) return
    check(runtimeRestorationReady) { "游戏窗口恢复尚未就绪，请稍后重试退出。" }
    confirmedRuntimeExit = true
    try {
      finish()
    } catch (error: Throwable) {
      confirmedRuntimeExit = false
      throw error
    }
  }

  override fun onDestroy() {
    super.onDestroy()
    val webView = runtimeWebView
    runtimeWebView = null
    if (!isChangingConfigurations && webView != null) {
      (webView.parent as? ViewGroup)?.removeView(webView)
      webView.destroy()
    }
    runtimeRestoreDialog?.dismiss()
    runtimeRestoreDialog = null
    if (runtimeRestorationReady) runtimeActivityDestroyed(id, isChangingConfigurations)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    if (runtimeRestorationReady) requestRuntimeRestoration()
    applyImmersiveLandscape()
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val webView = runtimeWebView
        if (webView == null) {
          isEnabled = false
          onBackPressedDispatcher.onBackPressed()
          isEnabled = true
          return
        }
        webView.post {
          webView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('agentvn:system-back',{cancelable:true}))",
            null
          )
        }
      }
    })
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    runtimeWebView = webView
    webView.addJavascriptInterface(object {
      @JavascriptInterface
      fun requestInsets() {
        // JS-interface calls arrive off the UI thread. Replay even unchanged
        // insets after the frontend listener has mounted.
        webView.post {
          val current = ViewCompat.getRootWindowInsets(webView)
          if (current != null) dispatchInsets(webView, current)
          ViewCompat.requestApplyInsets(webView)
        }
      }
    }, "AgentVNViewport")
    ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
      dispatchInsets(webView, insets)
      insets
    }
    ViewCompat.requestApplyInsets(webView)
    dispatchSurfaceReady(webView)
  }

  private fun dispatchInsets(webView: WebView, insets: WindowInsetsCompat) {
    val safe = insets.getInsets(
      WindowInsetsCompat.Type.systemBars() or
        WindowInsetsCompat.Type.displayCutout() or
        WindowInsetsCompat.Type.mandatorySystemGestures()
    )
    insetRevision += 1
    val script = "window.dispatchEvent(new CustomEvent('agentvn:android-insets',{detail:{top:${safe.top},right:${safe.right},bottom:${safe.bottom},left:${safe.left},coordinateSpace:'physical',revision:${insetRevision}}}))"
    webView.post { webView.evaluateJavascript(script, null) }
  }

  override fun onResume() {
    super.onResume()
    requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
    applyImmersiveLandscape()
    runtimeWebView?.let { webView ->
      webView.post {
        ViewCompat.requestApplyInsets(webView)
        webView.evaluateJavascript(
          "window.dispatchEvent(new CustomEvent('agentvn:android-resume'))",
          null
        )
      }
      dispatchSurfaceReady(webView)
    }
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) {
      requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
      applyImmersiveLandscape()
      runtimeWebView?.let { webView -> dispatchSurfaceReady(webView) }
    }
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
    applyImmersiveLandscape()
    runtimeWebView?.let { webView -> dispatchSurfaceReady(webView) }
  }

  private fun dispatchSurfaceReady(webView: WebView, attempt: Int = 0) {
    webView.postDelayed({
      val landscape = webView.width >= webView.height && webView.width > 0 && webView.height > 0
      if (landscape) {
        webView.evaluateJavascript(
          "window.dispatchEvent(new CustomEvent('agentvn:android-surface-ready',{detail:{width:${webView.width},height:${webView.height}}}))",
          null
        )
      } else if (attempt < 12) {
        dispatchSurfaceReady(webView, attempt + 1)
      }
    }, if (attempt == 0) 0L else 80L)
  }

  private fun applyImmersiveLandscape() {
    window.statusBarColor = Color.BLACK
    window.navigationBarColor = Color.BLACK
    window.decorView.setBackgroundColor(Color.BLACK)
    WindowCompat.setDecorFitsSystemWindows(window, false)
    val controller = WindowInsetsControllerCompat(window, window.decorView)
    controller.isAppearanceLightStatusBars = false
    controller.isAppearanceLightNavigationBars = false
    controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    controller.hide(WindowInsetsCompat.Type.systemBars())
    window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
      View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
      View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
  }
}
'@
  $activity = [regex]::Replace($activity, '(?m)^package\s+[^\r\n]+', "package $ReleaseApplicationId", 1)
  Write-Utf8Atomic -Path $AndroidMainActivityPath -Value $activity
  if (-not (Test-Path -LiteralPath $AndroidGradlePath)) { throw "Android app build.gradle.kts not found after tauri android init: $AndroidGradlePath" }
  $gradle = Get-Content -Raw -LiteralPath $AndroidGradlePath
  $legacyNoCompressPattern = '(?ms)^\s*// AgentVN packaged media noCompress: keep APK assets seekable for Range reads\.\r?\n\s*androidResources\s*\{.*?^\s*\}\r?\n'
  $withoutLegacyNoCompress = [regex]::Replace($gradle, $legacyNoCompressPattern, "", 1)
  if ($withoutLegacyNoCompress -ne $gradle) {
    $gradle = $withoutLegacyNoCompress
  }
  if ($gradle -notmatch '(?m)^\s*androidResources\s*\{') {
    $androidResources = @'
    // AgentVN Android assets must be compressed. Tauri's Android fs plugin
    // loses AssetFileDescriptor.startOffset for stored APK assets; compression
    // makes it use its cache-copy path and preserves the real file bytes.
    androidResources {
        noCompress.clear()
    }

'@
    if ($gradle -notmatch [regex]::Escape("    kotlinOptions {")) {
      throw "Unable to locate kotlinOptions block while applying Android compression policy."
    }
    $gradle = $gradle.Replace("    kotlinOptions {", $androidResources + "    kotlinOptions {")
  } elseif ($gradle -notmatch 'noCompress\.clear\(\)') {
    $androidResourcesMatch = [regex]::Match(
      $gradle,
      '(?m)^(?<indent>\s*)androidResources\s*\{'
    )
    if (-not $androidResourcesMatch.Success) {
      throw "Unable to locate androidResources block while applying Android compression policy."
    }
    $insertion = [Environment]::NewLine +
      $androidResourcesMatch.Groups["indent"].Value +
      "    noCompress.clear()"
    $gradle = $gradle.Insert(
      $androidResourcesMatch.Index + $androidResourcesMatch.Length,
      $insertion
    )
  }
  Write-Utf8Atomic -Path $AndroidGradlePath -Value $gradle
  # AgentVN managed exit JNI keep rules begin
  # R8 cannot see the native call_method entry point. The release Gradle
  # configuration consumes every .pro file in the app directory.
  $managedExitKeepPath = Join-Path (Split-Path -Parent $AndroidGradlePath) "proguard-agentvn-runtime.pro"
  $managedExitKeep = @"
# Generated AgentVN native lifecycle entry points.
# Keep the inherited original JNI entry point in this package-owned file too.
# Tauri may regenerate its separate rule file during the nested Cargo build.
-keep class $ReleaseApplicationId.TauriActivity {
    public app.tauri.plugin.PluginManager getPluginManager();
}
-keepclassmembers class $ReleaseApplicationId.MainActivity {
    public void finishConfirmedRuntime();
    public void enableRuntimeRestoration();
    public void showRuntimeRestoreError(java.lang.String);
    private native boolean runtimeActivityCreated(int);
    private native void runtimeActivityDestroyed(int, boolean);
}
"@
  Write-Utf8Atomic -Path $managedExitKeepPath -Value $managedExitKeep
  # AgentVN managed exit JNI keep rules end
  Add-Utf8Log -Path $BuildLog -Value "Android runtime policy applied: sensorLandscape + immersive edge-to-edge; packaged assets force compressed AssetManager copy path"
}

function Set-AndroidRuntimeActivityRestoration {
  param([string]$HelperPath = (Join-Path $PSScriptRoot "android-runtime-activity.gradle"))
  $androidRoot = Join-Path $RuntimeRoot "src-tauri\gen\android"
  $helper = $HelperPath
  $settingsPath = Join-Path $androidRoot "settings.gradle"
  if (-not (Test-Path -LiteralPath $helper) -or -not (Test-Path -LiteralPath $settingsPath)) {
    throw "ANDROID_ACTIVITY_RESTORATION_MISSING: Gradle helper or generated settings missing."
  }
  Copy-Item -LiteralPath $helper -Destination (Join-Path $androidRoot "agentvn-runtime-activity.gradle") -Force
  $settings = [System.IO.File]::ReadAllText($settingsPath)
  $hook = "apply from: 'agentvn-runtime-activity.gradle'"
  if (-not $settings.Contains($hook)) {
    Write-Utf8Atomic -Path $settingsPath -Value ($settings + [Environment]::NewLine + $hook + [Environment]::NewLine)
  }
  Add-Utf8Log -Path $BuildLog -Value "Android cached Activity plugin restoration configured; Cargo registry remains unchanged."
}

function Test-Tool($Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-ToolPath($Name) {
  return (Get-Command $Name -ErrorAction Stop).Source
}

function Write-PackageManifest {
  param(
    [string]$Status,
    [string]$Message,
    [array]$Artifacts = @(),
    [array]$Warnings = @(),
    [object]$Verify = $null,
    [string]$FailureCode = ""
  )

  $filteredWarnings = @(@($Warnings) | Where-Object { $_ })
  $manifest = [ordered]@{
    ok = $Status -eq "PASS"
    status = $Status
    staticStatus = if ($Status -eq "PASS") { "PASS" } else { "FAIL" }
    runtimeStatus = "NOT_RUN"
    overallStatus = if ($Status -eq "PASS") { "STATIC_ONLY" } else { "FAIL" }
    runtimeSmokeReportPath = $null
    platform = "android"
    runId = if ($RunId) { $RunId } else { $null }
    message = $Message
    outputDir = $ResolvedOutput
    diagnosticsDir = $ResolvedDiagnostics
    artifacts = @($Artifacts)
    warnings = $filteredWarnings
    verifyReportPath = $VerifyLog
    buildLogPath = $BuildLog
    manifestPath = $ManifestPath
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    verify = $Verify
    failureCode = if ($FailureCode) { $FailureCode } else { $null }
    permissionDetails = $SymlinkProbe
    releaseIdentity = $Release
    iconSource = $IconSource
    audioNormalization = $AudioNormalization
    postBuildInspection = $PostBuildInspection
    offlineEnvironment = $OfflineEnvironment
    androidGeneratedProjectDiagnostics = if (Test-Path -LiteralPath $GeneratedProjectDiagnosticsPath) { $GeneratedProjectDiagnosticsPath } else { $null }
    androidGeneratedProjectHealth = if (Test-Path -LiteralPath $GeneratedProjectHealthPath) { $GeneratedProjectHealthPath } else { $null }
  }
  New-Item -ItemType Directory -Force -Path $ResolvedDiagnostics | Out-Null
  $jsonText = $manifest | ConvertTo-Json -Depth 12
  Write-Utf8Atomic -Path $ManifestPath -Value $jsonText
  if ($Json) {
    Write-Output $jsonText
  }
}

function Finish-PackageBuild {
  param([string]$Status, [string]$Message, [array]$Artifacts = @(), [array]$Warnings = @(), [object]$Verify = $null, [string]$FailureCode = "")
  if ($FailureCode) { $script:FailureCode = $FailureCode }
  Write-PackageManifest -Status $Status -Message $Message -Artifacts $Artifacts -Warnings $Warnings -Verify $Verify -FailureCode $script:FailureCode
  if ($Status -eq "PASS") { exit 0 }
  if ($Status -eq "BLOCKED") { exit 2 }
  exit 1
}

function Copy-IfExists($Source, $Destination) {
  if (Test-Path -LiteralPath $Source) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
    for ($attempt = 1; $attempt -le 20; $attempt += 1) {
      try {
        Copy-Item -LiteralPath $Source -Destination $Destination -Force
        return
      } catch {
        if ($attempt -eq 20) { throw }
        Start-Sleep -Milliseconds ([Math]::Min(1000, $attempt * 100))
      }
    }
  }
}

function Convert-ImageToSquarePng {
  param(
    [string]$Source,
    [string]$Destination,
    [int]$Size = 512,
    [double]$ContentScale = 1.0
  )
  Add-Type -AssemblyName System.Drawing
  $image = [System.Drawing.Image]::FromFile($Source)
  try {
    $canvas = New-Object System.Drawing.Bitmap $Size, $Size
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($canvas)
      try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $targetSize = [Math]::Max(1, [int][Math]::Round($Size * [Math]::Max(0.1, [Math]::Min(1.0, $ContentScale))))
        $scale = [Math]::Min($targetSize / [double]$image.Width, $targetSize / [double]$image.Height)
        $width = [Math]::Max(1, [int][Math]::Round($image.Width * $scale))
        $height = [Math]::Max(1, [int][Math]::Round($image.Height * $scale))
        $graphics.DrawImage($image, [int][Math]::Round(($Size - $width) / 2), [int][Math]::Round(($Size - $height) / 2), $width, $height)
      } finally {
        $graphics.Dispose()
      }
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
      $canvas.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $canvas.Dispose()
    }
  } finally {
    $image.Dispose()
  }
}

function Get-AndroidLauncherIconPaths {
  $paths = @()
  foreach ($density in $AndroidLauncherIconSizes.Keys) {
    foreach ($name in $AndroidLauncherIconNames) {
      $paths += (Join-Path $AndroidResRoot (Join-Path $density $name))
    }
  }
  return $paths
}

function Get-CompatibleRelativePath {
  param(
    [Parameter(Mandatory = $true)][string]$BasePath,
    [Parameter(Mandatory = $true)][string]$TargetPath
  )
  $baseFull = [System.IO.Path]::GetFullPath($BasePath).TrimEnd([char[]]@('\', '/'))
  $targetFull = [System.IO.Path]::GetFullPath($TargetPath)
  $prefix = $baseFull + [System.IO.Path]::DirectorySeparatorChar
  if (-not $targetFull.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Target path is outside the expected Android resource root: $targetFull"
  }
  return $targetFull.Substring($prefix.Length)
}

function Backup-AndroidLauncherIcons {
  param([string]$BackupDir)
  foreach ($path in Get-AndroidLauncherIconPaths) {
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $relative = Get-CompatibleRelativePath -BasePath $AndroidResRoot -TargetPath $path
    $target = Join-Path $BackupDir $relative
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    Copy-Item -LiteralPath $path -Destination $target -Force
  }
}

function Restore-AndroidLauncherIcons {
  param([string]$BackupDir)
  foreach ($path in Get-AndroidLauncherIconPaths) {
    $relative = Get-CompatibleRelativePath -BasePath $AndroidResRoot -TargetPath $path
    $backup = Join-Path $BackupDir $relative
    if (Test-Path -LiteralPath $backup) {
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
      Copy-Item -LiteralPath $backup -Destination $path -Force
    } elseif (Test-Path -LiteralPath $path) {
      Remove-Item -LiteralPath $path -Force
    }
  }
}

function Sync-AndroidLauncherIcons {
  param([string]$Source)
  if ([string]::IsNullOrWhiteSpace($Source)) { return $false }
  if (-not (Test-Path -LiteralPath $AndroidResRoot)) { return $false }
  foreach ($density in $AndroidLauncherIconSizes.Keys) {
    $size = [int]$AndroidLauncherIconSizes[$density]
    foreach ($name in $AndroidLauncherIconNames) {
      $destination = Join-Path $AndroidResRoot (Join-Path $density $name)
      $outputSize = if ($name -eq "ic_launcher_foreground.png") { [int][Math]::Round($size * 2.25) } else { $size }
      $contentScale = if ($name -eq "ic_launcher_foreground.png") { 0.66 } else { 1.0 }
      Convert-ImageToSquarePng -Source $Source -Destination $destination -Size $outputSize -ContentScale $contentScale
    }
  }
  return $true
}

function Set-RuntimePackageIcon {
  param([string]$Source)
  if ([string]::IsNullOrWhiteSpace($Source)) { return $false }
  if (-not (Test-Path -LiteralPath $Source)) { throw "IconPath does not exist: $Source" }
  $resolved = (Resolve-Path -LiteralPath $Source).Path
  $script:AppliedIconSource = $resolved
  Convert-ImageToSquarePng -Source $resolved -Destination $RuntimeIconPngPath -Size 512
  Sync-AndroidLauncherIcons -Source $resolved | Out-Null
  return $true
}

function Join-ProcessArguments([string[]]$ArgumentList) {
  return ($ArgumentList | ForEach-Object {
    $arg = [string]$_
    if ($arg.Length -gt 0 -and $arg -notmatch '[\s"]') {
      return $arg
    }
    $builder = New-Object System.Text.StringBuilder
    [void]$builder.Append([char]0x22)
    $backslashes = 0
    for ($index = 0; $index -lt $arg.Length; $index += 1) {
      $character = $arg[$index]
      if ($character -eq [char]0x5C) {
        $backslashes += 1
        continue
      }
      if ($character -eq [char]0x22) {
        [void]$builder.Append([char]0x5C, ($backslashes * 2) + 1)
        [void]$builder.Append([char]0x22)
        $backslashes = 0
        continue
      }
      if ($backslashes -gt 0) {
        [void]$builder.Append([char]0x5C, $backslashes)
        $backslashes = 0
      }
      [void]$builder.Append($character)
    }
    if ($backslashes -gt 0) {
      [void]$builder.Append([char]0x5C, $backslashes * 2)
    }
    [void]$builder.Append([char]0x22)
    return $builder.ToString()
  }) -join " "
}

function Invoke-LoggedCommand {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList,
    [string]$WorkingDirectory,
    [string]$LogPath
  )
  Add-Utf8Log -Path $LogPath -Value "`n== $FilePath $($ArgumentList -join ' ') =="
  $processFilePath = $FilePath
  $processArgumentList = $ArgumentList
  $processArgumentString = $null
  $commandScriptPath = $null
  if ([System.IO.Path]::GetExtension($FilePath) -in @(".cmd", ".bat")) {
    $processFilePath = if ($env:ComSpec) { $env:ComSpec } else { "cmd.exe" }
    # Pass the script path through the child environment. cmd.exe expands the
    # variable once and does not recursively expand percent-delimited text in
    # its value, so a literal path such as "tool %PATH%" remains intact.
    $commandScriptPath = $FilePath
    $commandLine = '"%AGENTVN_COMMAND_SCRIPT%"'
    if ($ArgumentList.Count -gt 0) {
      $commandLine += " " + (Join-ProcessArguments $ArgumentList)
    }
    # cmd.exe requires the outer /c quotes to wrap the complete command while
    # preserving the inner quotes around a script path that contains spaces.
    $processArgumentString = "/d /v:off /s /c `"$commandLine`""
  }
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $processFilePath
  $startInfo.Arguments = if ($null -ne $processArgumentString) {
    $processArgumentString
  } else {
    Join-ProcessArguments $processArgumentList
  }
  $startInfo.WorkingDirectory = $WorkingDirectory
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  if ($commandScriptPath) {
    $startInfo.EnvironmentVariables["AGENTVN_COMMAND_SCRIPT"] = $commandScriptPath
  }
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  $startInfo.StandardOutputEncoding = $utf8
  $startInfo.StandardErrorEncoding = $utf8
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  if (-not $process.Start()) {
    throw "Failed to start command: $FilePath"
  }
  # Begin both reads before waiting so large Rust/Gradle output cannot fill a
  # pipe and deadlock the build. WaitForExit tracks only this direct process,
  # unlike Windows PowerShell 5.1 Start-Process process-tree waiting.
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  $exitCode = $process.ExitCode
  $stdout = Remove-AnsiEscape $stdoutTask.GetAwaiter().GetResult()
  $stderr = Remove-AnsiEscape $stderrTask.GetAwaiter().GetResult()
  if ($stdout) {
    Add-Utf8Log -Path $LogPath -Value "`n-- stdout --"
    Add-Utf8Log -Path $LogPath -Value $stdout
  }
  if ($stderr) {
    Add-Utf8Log -Path $LogPath -Value "`n-- stderr --"
    Add-Utf8Log -Path $LogPath -Value $stderr
  }
  return $exitCode
}

function Invoke-AndroidGeneratedDiagnostics {
  param(
    [ValidateSet("prebuild", "postbuild", "failure")]
    [string]$Phase = "prebuild"
  )
  if (-not (Test-Path -LiteralPath $AndroidDiagnosticsHelper -PathType Leaf)) {
    throw "ANDROID_BUILD_DIAGNOSTICS_CAPTURE_FAILED: helper was not found: $AndroidDiagnosticsHelper"
  }
  $exitCode = Invoke-LoggedCommand -FilePath $PowerShellExe -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $AndroidDiagnosticsHelper,
    "-RuntimeRoot",
    $RuntimeRoot,
    "-DiagnosticsDir",
    $ResolvedDiagnostics,
    "-ReleaseIdentityBase64",
    $ReleaseIdentityBase64,
    "-Phase",
    $Phase
  ) -WorkingDirectory $Root -LogPath $BuildLog
  if (Test-Path -LiteralPath $GeneratedProjectDiagnosticsPath -PathType Leaf) {
    try {
      $script:GeneratedProjectDiagnostics = Read-Utf8Json -Path $GeneratedProjectDiagnosticsPath
    } catch {
      if (@("prebuild", "postbuild") -contains $Phase) {
        throw "ANDROID_BUILD_DIAGNOSTICS_CAPTURE_FAILED: generated Android diagnostics report is invalid during $Phase`: $($_.Exception.Message)"
      }
    }
  }
  if ($exitCode -ne 0 -and @("prebuild", "postbuild") -contains $Phase) {
    $code = if ($script:GeneratedProjectDiagnostics.failureCode) {
      [string]$script:GeneratedProjectDiagnostics.failureCode
    } else {
      "ANDROID_BUILD_DIAGNOSTICS_CAPTURE_FAILED"
    }
    $detail = if ($script:GeneratedProjectDiagnostics.message) {
      [string]$script:GeneratedProjectDiagnostics.message
    } else {
      "Generated Android project diagnostics failed during $Phase."
    }
    $script:FailureCode = $code
    throw "$code`: $detail"
  }
  return $exitCode
}

function Ensure-AndroidGeneratedProject {
  param(
    [Parameter(Mandatory = $true)][string]$NodeExecutable,
    [Parameter(Mandatory = $true)][string]$NpmExecutable
  )
  if (-not (Test-Path -LiteralPath $AndroidGeneratedProjectHelper -PathType Leaf)) {
    throw "ANDROID_GENERATED_PROJECT_CHECK_FAILED: helper was not found: $AndroidGeneratedProjectHelper"
  }
  $initArgumentsJson = @("run", "tauri", "--", "android", "init", "--ci", "--skip-targets-install") | ConvertTo-Json -Compress
  $initArgumentsBase64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($initArgumentsJson))
  $exitCode = Invoke-LoggedCommand -FilePath $NodeExecutable -ArgumentList @(
    $AndroidGeneratedProjectHelper,
    "--runtime-root",
    $RuntimeRoot,
    "--report",
    $GeneratedProjectHealthPath,
    "--init-command",
    $NpmExecutable,
    "--init-args-base64",
    $initArgumentsBase64,
    "--required-stage",
    "bootstrap"
  ) -WorkingDirectory $Root -LogPath $BuildLog
  if (Test-Path -LiteralPath $GeneratedProjectHealthPath -PathType Leaf) {
    $script:AndroidGeneratedProjectHealth = Read-Utf8Json -Path $GeneratedProjectHealthPath
    $missingBefore = @($script:AndroidGeneratedProjectHealth.missingFilesBefore)
    $missingAfter = @($script:AndroidGeneratedProjectHealth.missingFilesAfter)
    Add-Utf8Log -Path $BuildLog -Value (
      "Android generated project health: missingBefore=[$($missingBefore -join ', ')] " +
      "reinitialized=$([bool]$script:AndroidGeneratedProjectHealth.reinitialized) " +
      "complete=$([bool]$script:AndroidGeneratedProjectHealth.finalProjectComplete) " +
      "missingAfter=[$($missingAfter -join ', ')]"
    )
  }
  if ($exitCode -ne 0) {
    $code = if ($script:AndroidGeneratedProjectHealth.failureCode) {
      [string]$script:AndroidGeneratedProjectHealth.failureCode
    } else {
      "ANDROID_GENERATED_PROJECT_CHECK_FAILED"
    }
    $detail = if ($script:AndroidGeneratedProjectHealth.message) {
      [string]$script:AndroidGeneratedProjectHealth.message
    } else {
      "Generated Android project completeness check failed."
    }
    $script:FailureCode = $code
    throw "$code`: $detail"
  }
  if (-not $script:AndroidGeneratedProjectHealth.finalProjectComplete) {
    $script:FailureCode = "ANDROID_GENERATED_PROJECT_INCOMPLETE"
    throw "ANDROID_GENERATED_PROJECT_INCOMPLETE: generated Android project remained incomplete after initialization."
  }
}

function Capture-AndroidFailureDiagnostics {
  try {
    [void](Invoke-AndroidGeneratedDiagnostics -Phase "failure")
  } catch {
    $script:BuildWarnings += "ANDROID_BUILD_DIAGNOSTICS_CAPTURE_FAILED: $($_.Exception.Message)"
  }
  if (-not (Test-Path -LiteralPath $BuildLog -PathType Leaf)) { return }
  $buildLines = (Read-Utf8Text -Path $BuildLog) -split "\r?\n"
  $buildText = ($buildLines | Select-Object -Last 320) -join "`n"
  if ($buildText -notmatch 'processUniversalReleaseMainManifest|ManifestMerger2|AndroidManifest\.xml|Manifest merger') {
    return
  }
  $gradleWrapper = Join-Path $RuntimeRoot "src-tauri\gen\android\gradlew.bat"
  if (-not (Test-Path -LiteralPath $gradleWrapper -PathType Leaf)) {
    $script:BuildWarnings += "ANDROID_GRADLE_MANIFEST_DIAGNOSTICS_UNAVAILABLE: gradlew.bat was not generated."
    return
  }
  $stacktraceLog = Join-Path $ResolvedDiagnostics "android-gradle-manifest-stacktrace.log"
  try {
    [void](Invoke-LoggedCommand -FilePath $gradleWrapper -ArgumentList @(
      ":app:processUniversalReleaseMainManifest",
      "--stacktrace",
      "--info",
      "--console=plain",
      "--no-daemon"
    ) -WorkingDirectory (Split-Path -Parent $gradleWrapper) -LogPath $stacktraceLog)
  } catch {
    $script:BuildWarnings += "ANDROID_GRADLE_MANIFEST_DIAGNOSTICS_FAILED: $($_.Exception.Message)"
  }
  if (Test-Path -LiteralPath $stacktraceLog -PathType Leaf) {
    $script:BuildWarnings += "ANDROID_GRADLE_MANIFEST_DIAGNOSTICS_CAPTURED: $stacktraceLog"
  }
}

function Ensure-AndroidCargoTargetDirs {
  param([string]$TauriDir)
  foreach ($target in @("aarch64-linux-android", "armv7-linux-androideabi", "i686-linux-android", "x86_64-linux-android")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $TauriDir "target\$target\release\deps") | Out-Null
  }
}

New-Item -ItemType Directory -Force -Path $ResolvedOutput | Out-Null
New-Item -ItemType Directory -Force -Path $ResolvedDiagnostics | Out-Null
foreach ($legacyName in @(
  "standalone-android-build.log",
  "standalone-android-verify.json",
  "package-build-manifest.json",
  "standalone-package-command.log",
  "android-env-check.json"
)) {
  Remove-Item -LiteralPath (Join-Path $ResolvedOutput $legacyName) -Force -ErrorAction SilentlyContinue
}

$missingTools = @()
foreach ($tool in @("node", "npm")) {
  if (-not (Test-Tool $tool)) { $missingTools += $tool }
}
if ($missingTools.Count -gt 0) {
  Finish-PackageBuild -Status "BLOCKED" -Message ("Missing required tools for cartridge verification: " + ($missingTools -join ", ")) -Warnings $missingTools
}
$NpmPath = Get-ToolPath "npm.cmd"

if (-not (Test-Path -LiteralPath (Join-Path $RuntimeRoot "package.json"))) {
  Finish-PackageBuild -Status "BLOCKED" -Message "Bundled GameCLI runtime template was not found: $RuntimeRoot" -Warnings @("Reinstall AgentVN Editor with the bundled standalone build workspace, or run this command from the full AgentVN source workspace.")
}

$ResolvedCartridge = $null
$NormalizedCartridgePath = Normalize-AgentVNPath $CartridgePath
if ($NormalizedCartridgePath) {
  if (-not (Test-Path -LiteralPath $NormalizedCartridgePath)) {
    Finish-PackageBuild -Status "FAIL" -Message "CartridgePath does not exist: $NormalizedCartridgePath"
  }
  $ResolvedCartridge = (Resolve-Path -LiteralPath $NormalizedCartridgePath).Path
} elseif (Test-Path -LiteralPath $EmbeddedCartridge) {
  $ResolvedCartridge = (Resolve-Path -LiteralPath $EmbeddedCartridge).Path
} else {
  Finish-PackageBuild -Status "FAIL" -Message "No cartridge was provided. Pass -CartridgePath or place game.vncart under GameCli_framework/public/embedded-cartridge."
}

$ResolvedIcon = ""
$NormalizedIconPath = Normalize-AgentVNPath $IconPath
if ($NormalizedIconPath) {
  if (-not (Test-Path -LiteralPath $NormalizedIconPath)) {
    Finish-PackageBuild -Status "FAIL" -Message "IconPath does not exist: $NormalizedIconPath"
  }
  $ResolvedIcon = (Resolve-Path -LiteralPath $NormalizedIconPath).Path
}

Initialize-Utf8Log -Path $BuildLog -Value "== AgentVN Android standalone package build =="
Add-Utf8Log -Path $BuildLog -Value "Runtime root: $RuntimeRoot"
Add-Utf8Log -Path $BuildLog -Value "Cartridge: $ResolvedCartridge"
Add-Utf8Log -Path $BuildLog -Value "Icon: $(if ($ResolvedIcon) { $ResolvedIcon } else { 'default AgentVN Player icon' })"
Add-Utf8Log -Path $BuildLog -Value "Output: $ResolvedOutput"
Add-Utf8Log -Path $BuildLog -Value "Diagnostics: $ResolvedDiagnostics"

if (-not (Test-Path -LiteralPath (Join-Path $RuntimeRoot "node_modules"))) {
  $installExit = Invoke-LoggedCommand -FilePath $NpmPath -ArgumentList @("install") -WorkingDirectory $RuntimeRoot -LogPath $BuildLog
  if ($installExit -ne 0) {
    Finish-PackageBuild -Status "BLOCKED" -Message "npm install failed while preparing the bundled GameCLI runtime. See $BuildLog" -Warnings @("Check network access and npm availability, then retry the standalone package build.")
  }
}

$VerifyScript = Join-Path $Root "scripts\verify-vncart.cjs"
if (-not (Test-Path -LiteralPath $VerifyScript)) {
  Finish-PackageBuild -Status "FAIL" -Message "verify-vncart.cjs was not found: $VerifyScript"
}

$NodePath = Get-ToolPath "node"
$verifyExit = Invoke-LoggedCommand -FilePath $NodePath -ArgumentList @($VerifyScript, "--allow-placeholder-assets", "--report", $VerifyLog, $ResolvedCartridge) -WorkingDirectory $Root -LogPath $BuildLog
if ($verifyExit -ne 0) {
  Finish-PackageBuild -Status "FAIL" -Message "verify-vncart failed before Android package build. See $VerifyLog and $BuildLog"
}

try {
  $VerifyReport = Read-Utf8Json -Path $VerifyLog
} catch {
  Finish-PackageBuild -Status "FAIL" -Message $_.Exception.Message -Warnings @("The cartridge verification report was not valid UTF-8 JSON.") -FailureCode "ENCODING_INVALID"
}
if (-not $VerifyReport.ok) {
  Finish-PackageBuild -Status "FAIL" -Message "verify-vncart returned a failed report. See $VerifyLog" -Verify $VerifyReport
}
$VerifyWarnings = @(if ($VerifyReport) { @($VerifyReport.warnings) | Where-Object { $_ } })

$EnvSetupScript = Join-Path $Root "scripts\setup-android-build-env.ps1"
$EnvReport = Join-Path $ResolvedDiagnostics "android-env-check.json"
$EnvPassCache = Join-Path $env:LOCALAPPDATA "AgentVN\environment-cache\android-pass.json"
if (-not (Test-Path -LiteralPath $EnvSetupScript)) {
  Finish-PackageBuild -Status "BLOCKED" -Message "Android environment helper was not found: $EnvSetupScript" -Warnings @("Run scripts\setup-android-build-env.ps1 -Install, or install Android SDK/JDK/NDK/Rust targets manually.") -Verify $VerifyReport
}

$EnvResult = $null
if ($SkipEnvironmentCheck) {
  if ($env:AGENTVN_ANDROID_ELEVATED_HELPER -ne "1") {
    Finish-PackageBuild -Status "BLOCKED" -Message "SkipEnvironmentCheck is restricted to the elevated Android helper." -Warnings @("Run the Android build through the normal UAC flow; do not bypass the environment check from a regular process.") -Verify $VerifyReport -FailureCode "ADMINISTRATOR_REQUIRED"
  }
  if ((Get-ProcessElevationState) -ne $true) {
    Finish-PackageBuild -Status "BLOCKED" -Message "The Android helper did not receive an elevated Administrator token." -Warnings @("The ordinary process must wait for the UAC helper instead of starting a second Android runner.") -Verify $VerifyReport -FailureCode "ADMINISTRATOR_REQUIRED"
  }
  try {
    $EnvResult = Read-Utf8Json -Path $EnvPassCache
    if (
      $EnvResult.status -ne "PASS" -or
      $EnvResult.ok -ne $true -or
      [int]$EnvResult.cacheSchemaVersion -ne 1 -or
      [string]$EnvResult.cachePlatform -ne "android"
    ) {
      throw "The cached Android environment result is not a valid PASS record."
    }
    $EnvExit = 0
    Add-Utf8Log -Path $BuildLog -Value "Android environment PASS cache reused; full toolchain check skipped: $EnvPassCache"
  } catch {
    Finish-PackageBuild -Status "BLOCKED" -Message ("Cached Android environment validation failed: " + $_.Exception.Message) -Warnings @("Run the editor environment check again.") -Verify $VerifyReport
  }
} else {
  $EnvExit = Invoke-LoggedCommand -FilePath $PowerShellExe -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $EnvSetupScript,
    "-ReportPath",
    $EnvReport,
    "-PassCachePath",
    $EnvPassCache,
    "-UseCachedPass",
    "-OfflinePackRoot",
    $(if ($NormalizedOfflinePackRoot) { $NormalizedOfflinePackRoot } else { (Join-Path $Root "android-offline-pack") })
  ) -WorkingDirectory $Root -LogPath $BuildLog
  try {
    if (Test-Path -LiteralPath $EnvReport) {
      $EnvResult = Read-Utf8Json -Path $EnvReport
    }
  } catch {
    Finish-PackageBuild -Status "BLOCKED" -Message $_.Exception.Message -Warnings @("Android environment report is not valid UTF-8 JSON.") -Verify $VerifyReport -FailureCode "ENCODING_INVALID"
  }
}

if ($null -eq $EnvResult) {
  Finish-PackageBuild -Status "BLOCKED" -Message "Android environment check did not produce a readable report. See $EnvReport" -Warnings @("Run scripts\setup-android-build-env.ps1 -Install -Json for details.") -Verify $VerifyReport
}

if ($EnvResult.jdkHome) { $env:JAVA_HOME = [string]$EnvResult.jdkHome; $env:Path = (Join-Path $env:JAVA_HOME "bin") + ";$env:Path" }
if ($EnvResult.sdkRoot) {
  $env:ANDROID_HOME = [string]$EnvResult.sdkRoot
  $env:ANDROID_SDK_ROOT = [string]$EnvResult.sdkRoot
  $env:Path = (Join-Path $env:ANDROID_HOME "cmdline-tools\latest\bin") + ";" + (Join-Path $env:ANDROID_HOME "platform-tools") + ";$env:Path"
}
if ($EnvResult.ndkHome) { $env:NDK_HOME = [string]$EnvResult.ndkHome }
$OfflineEnvironment = $EnvResult.offlinePack
$offlineGradleDistribution = [string]$EnvResult.gradleDistributionPath
$offlineGradleHome = [string]$EnvResult.gradleUserHome

if ($EnvExit -ne 0 -or $EnvResult.status -ne "PASS") {
  $missing = @($EnvResult.missing) | Where-Object { $_ }
  $manual = @($EnvResult.manualFix) | Where-Object { $_ }
  $warnings = @($VerifyWarnings) + @("Android environment report: $EnvReport") + @($missing) + @($manual)
  Finish-PackageBuild -Status "BLOCKED" -Message ("Missing required Android build environment: " + ($missing -join ", ") + ". Use the editor Android environment repair button or run scripts\setup-android-build-env.ps1 -Install.") -Warnings $warnings -Verify $VerifyReport
}

Import-AgentVNMsvcEnvironment

$androidSdk = [string]$EnvResult.sdkRoot
$ndkHome = [string]$EnvResult.ndkHome

$actualSymlinkProbeRoot = Join-Path $RuntimeRoot "src-tauri"
if ($SkipSymlinkProbe) {
  Finish-PackageBuild -Status "BLOCKED" -Message "Android symbolic-link capability must be probed in the actual build workspace; cached probe bypass is disabled." -Warnings @("Remove -SkipSymlinkProbe and rerun from an elevated Administrator PowerShell.") -Verify $VerifyReport -FailureCode "SYMLINK_PROBE_REQUIRED"
} else {
  $SymlinkProbe = Test-AndroidSymlinkCapability -ProbeRoot $actualSymlinkProbeRoot
}
if (-not $SymlinkProbe.success) {
  $permissionLike = @(5, 1314) -contains [int]$SymlinkProbe.win32ErrorCode
  $failureCode = if ($permissionLike -or -not $SymlinkProbe.isElevated) { "SYMLINK_PRIVILEGE_REQUIRED" } else { "ELEVATED_SYMLINK_DENIED" }
  $message = if ($SymlinkProbe.isElevated) {
    "The elevated Android build process still cannot create a symbolic link in the actual build workspace. Check account policy or filesystem restrictions. Win32 error: $($SymlinkProbe.win32ErrorCode)."
  } else {
    "The current Android build process cannot create a symbolic link in the actual build workspace. Administrator elevation may resolve this; Windows Developer Mode is only one possible source of this capability. Win32 error: $($SymlinkProbe.win32ErrorCode)."
  }
  Finish-PackageBuild -Status "BLOCKED" -Message $message -Warnings @("Symlink capability report: $SymlinkReportPath", $SymlinkProbe.error) -Verify $VerifyReport -FailureCode $failureCode
}
if ($SymlinkProbe.isElevated -ne $true) {
  Finish-PackageBuild -Status "BLOCKED" -Message "The elevated Android helper did not pass an elevated PowerShell token to the build process." -Warnings @("The cached toolchain report is not authoritative for elevation.", "Retry and approve the UAC prompt.") -Verify $VerifyReport -FailureCode "ADMINISTRATOR_REQUIRED"
}

if ($SkipEnvironmentCheck) {
  # The environment cache is only a toolchain shortcut. Once the elevated
  # helper has run the real probe, publish that authoritative result instead
  # of copying the normal desktop process's isElevated=false report.
  # Cached JSON is a PSCustomObject; older reports may omit these properties.
  $EnvResult | Add-Member -MemberType NoteProperty -Name isElevated -Value ([bool]$SymlinkProbe.isElevated) -Force
  $EnvResult | Add-Member -MemberType NoteProperty -Name symlinkCapability -Value $SymlinkProbe -Force
  $EnvResult | Add-Member -MemberType NoteProperty -Name symlinkElevation -Value ([ordered]@{
    attempted = $true
    status = "PASS"
    reason = "The elevated Android helper completed the authoritative symbolic-link probe."
    reportPath = $SymlinkReportPath
  }) -Force
  Write-Utf8Atomic -Path $EnvReport -Value $EnvResult
  Add-Utf8Log -Path $BuildLog -Value "Elevated Android helper published authoritative environment elevation state: isElevated=$($EnvResult.isElevated)"
}

$BackupRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("agentvn-standalone-backup-" + [guid]::NewGuid().ToString("N"))
$EmbeddedDirectoryBackup = Join-Path $BackupRoot "embedded-cartridge"
$PackagedEmbeddedDirectoryBackup = Join-Path $BackupRoot "packaged-embedded-cartridge"
$RuntimeBackup = Join-Path $BackupRoot "runtime-mode.json"
$FixedOnlyBackup = Join-Path $BackupRoot "fixed-only.json"
$ReleasePackageBackup = Join-Path $BackupRoot "release-package.json"
$RuntimeIconPngBackup = Join-Path $BackupRoot "icon.png"
$RuntimeTauriConfigBackup = Join-Path $BackupRoot "tauri.conf.json"
$AndroidIconBackupRoot = Join-Path $BackupRoot "android-launcher-icons"
$HadRuntimeMode = Test-Path -LiteralPath $RuntimeModePath
$HadFixedOnly = Test-Path -LiteralPath $FixedOnlyPath
$HadReleasePackage = Test-Path -LiteralPath $ReleasePackagePath
$HadCartridge = Test-Path -LiteralPath $EmbeddedCartridge
$HadEmbeddedDir = Test-Path -LiteralPath $EmbeddedDir
$HadPackagedEmbeddedDir = Test-Path -LiteralPath $PackagedEmbeddedDir
$HadRuntimeIconPng = Test-Path -LiteralPath $RuntimeIconPngPath
$HadRuntimeTauriConfig = Test-Path -LiteralPath $RuntimeTauriConfigPath
$PreviousRuntimeModeEnv = $env:VITE_AGENTVN_RUNTIME_MODE
$PreviousFixedOnlyEnv = $env:VITE_AGENTVN_FIXED_ONLY
$PreviousReleasePackageEnv = $env:VITE_AGENTVN_RELEASE_PACKAGE
$PreviousGradleOptsEnv = $env:GRADLE_OPTS
$PreviousGradleUserHomeEnv = $env:GRADLE_USER_HOME
$PreviousGradleDistributionEnv = $env:AGENTVN_GRADLE_DISTRIBUTION
$PreviousCargoBuildJobsEnv = $env:CARGO_BUILD_JOBS
$PreviousRustflagsEnv = $env:RUSTFLAGS

New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
if ($HadRuntimeMode) { Copy-Item -LiteralPath $RuntimeModePath -Destination $RuntimeBackup -Force }
if ($HadFixedOnly) { Copy-Item -LiteralPath $FixedOnlyPath -Destination $FixedOnlyBackup -Force }
if ($HadReleasePackage) { Copy-Item -LiteralPath $ReleasePackagePath -Destination $ReleasePackageBackup -Force }
if ($HadEmbeddedDir) { Copy-Item -LiteralPath $EmbeddedDir -Destination $EmbeddedDirectoryBackup -Recurse -Force }
if ($HadPackagedEmbeddedDir) { Copy-Item -LiteralPath $PackagedEmbeddedDir -Destination $PackagedEmbeddedDirectoryBackup -Recurse -Force }
if ($HadRuntimeIconPng) { Copy-Item -LiteralPath $RuntimeIconPngPath -Destination $RuntimeIconPngBackup -Force }
if ($HadRuntimeTauriConfig) { Copy-Item -LiteralPath $RuntimeTauriConfigPath -Destination $RuntimeTauriConfigBackup -Force }
Backup-AndroidLauncherIcons -BackupDir $AndroidIconBackupRoot

try {
  New-Item -ItemType Directory -Force -Path $PackagedEmbeddedDir | Out-Null
  $unpackLog = Join-Path $ResolvedDiagnostics "standalone-unpack.log"
  $unpackExit = Invoke-LoggedCommand -FilePath $NodePath -ArgumentList @((Join-Path $Root "scripts\unpack-vncart.cjs"), $ResolvedCartridge, $PackagedEmbeddedDir) -WorkingDirectory $Root -LogPath $unpackLog
  if ($unpackExit -ne 0) { throw "vncart unpack failed. See $unpackLog" }
  $AudioNormalizationReport = Join-Path $ResolvedDiagnostics "android-audio-normalization.json"
  $audioNormalizationLog = Join-Path $ResolvedDiagnostics "android-audio-normalization.log"
  $audioNormalizationExit = Invoke-LoggedCommand -FilePath $NodePath -ArgumentList @(
    (Join-Path $Root "scripts\normalize-android-opening-audio.cjs"),
    $PackagedEmbeddedDir,
    "--report",
    $AudioNormalizationReport
  ) -WorkingDirectory $Root -LogPath $audioNormalizationLog
  if ($audioNormalizationExit -ne 0) {
    $script:FailureCode = "AUDIO_TRANSCODE_FAILED"
    throw "Android opening audio normalization failed. See $AudioNormalizationReport and $audioNormalizationLog"
  }
  $AudioNormalization = Read-Utf8Json -Path $AudioNormalizationReport
  $OptimizationReport = Join-Path $ResolvedDiagnostics "release-optimization-report.json"
  $optimizationLog = Join-Path $ResolvedDiagnostics "release-optimization.log"
  $optimizationExit = Invoke-LoggedCommand -FilePath $NodePath -ArgumentList @((Join-Path $Root "scripts\build-release-runtime-assets.cjs"), $PackagedEmbeddedDir, "--profile", $OptimizationProfile, "--report", $OptimizationReport) -WorkingDirectory $Root -LogPath $optimizationLog
  if ($optimizationExit -ne 0) { throw "release resource optimization/index generation failed. See $optimizationLog" }
  Add-Utf8Log -Path $BuildLog -Value "Release resource profile: $OptimizationProfile; report: $OptimizationReport"
  Write-Utf8Atomic -Path $RuntimeModePath -Value ([ordered]@{ mode = "fixed" })
  Write-Utf8Atomic -Path $FixedOnlyPath -Value ([ordered]@{ fixedOnly = $true })
  Write-Utf8Atomic -Path $ReleasePackagePath -Value ([ordered]@{ schemaVersion = 1; presentationMode = "release" })
  $env:VITE_AGENTVN_RUNTIME_MODE = "fixed"
  $env:VITE_AGENTVN_FIXED_ONLY = "true"
  $env:VITE_AGENTVN_RELEASE_PACKAGE = "true"
  # Bound LLVM memory while Tauri codegen packages a large fixed cartridge.
  $env:CARGO_BUILD_JOBS = "1"
  # Android 16 KB page-size devices require native ELF LOAD segments to be
  # aligned for 16 KB pages. Pass the flags through the environment as well
  # as the runtime Cargo config because Tauri invokes Cargo from its generated
  # Gradle workspace, whose working directory is not stable across CLI versions.
  $android16KbRustflags = "-C link-arg=-Wl,-z,max-page-size=16384 -C link-arg=-Wl,-z,common-page-size=16384"
  $env:RUSTFLAGS = if ([string]::IsNullOrWhiteSpace($PreviousRustflagsEnv)) {
    $android16KbRustflags
  } else {
    "$PreviousRustflagsEnv $android16KbRustflags"
  }
  Add-Utf8Log -Path $BuildLog -Value "Android native ELF alignment: 16 KB linker flags enabled."
  Add-Utf8Log -Path $BuildLog -Value "Large-cartridge Rust profile: player opt-level=0, codegen-units=256, jobs=1"
  # Avoid inheriting a wedged daemon/registry lock from an interrupted desktop
  # build. Release packaging is isolated and deterministic in CI mode.
  $env:GRADLE_OPTS = (($PreviousGradleOptsEnv, "") | Where-Object { $_ }) -join " "
  if ($env:GRADLE_OPTS -notmatch "-Dorg.gradle.daemon=false") { $env:GRADLE_OPTS = ($env:GRADLE_OPTS + " -Dorg.gradle.daemon=false").Trim() }
  if ($ResolvedIcon) {
    $projectIconProbe = Test-ImageVisualValidity -Source $ResolvedIcon
    if ($projectIconProbe.valid) {
      Set-RuntimePackageIcon -Source $ResolvedIcon | Out-Null
      $IconSource = "project"
      Add-Utf8Log -Path $BuildLog -Value "Standalone package icon applied: $ResolvedIcon"
    } else {
      $BuildWarnings += "ICON_FALLBACK_USED: Project icon was rejected ($($projectIconProbe.reason)); default AgentVN icon was used."
      $IconSource = "fallback"
      Add-Utf8Log -Path $BuildLog -Value "Project icon rejected; falling back to default icon: $($projectIconProbe | ConvertTo-Json -Compress)"
      Set-RuntimePackageIcon -Source $DefaultRuntimeIconPath | Out-Null
    }
  } else {
    $defaultIconProbe = Test-ImageVisualValidity -Source $DefaultRuntimeIconPath
    if (-not $defaultIconProbe.valid) {
      throw "APK_ICON_INVALID: Default AgentVN icon failed visual validation: $($defaultIconProbe.reason)"
    }
    Set-RuntimePackageIcon -Source $DefaultRuntimeIconPath | Out-Null
    $IconSource = if ($IconSource -eq "fallback") { "fallback" } else { "default" }
    Add-Utf8Log -Path $BuildLog -Value "Default AgentVN package icon applied: $DefaultRuntimeIconPath"
  }
  Add-Utf8Log -Path $BuildLog -Value "`n== Build embedded GameCLI Android package =="
  Add-Utf8Log -Path $BuildLog -Value "Android SDK: $androidSdk"
  Add-Utf8Log -Path $BuildLog -Value "Android NDK: $ndkHome"

  Push-Location $RuntimeRoot
  try {
    if (-not (Test-Path -LiteralPath (Join-Path $RuntimeRoot "node_modules"))) {
      $installExit = Invoke-LoggedCommand -FilePath $NpmPath -ArgumentList @("install") -WorkingDirectory $RuntimeRoot -LogPath $BuildLog
      if ($installExit -ne 0) { throw "npm install failed with exit code $installExit. See $BuildLog" }
    }

    Ensure-AndroidGeneratedProject -NodeExecutable $NodePath -NpmExecutable $NpmPath
    Set-AndroidKotlinCompilerPolicy -GradlePropertiesPath (Join-Path $RuntimeRoot "src-tauri\gen\android\gradle.properties")
    $offlineGradleConfigured = Use-AgentVNOfflineGradle -DistributionPath $offlineGradleDistribution -GradleHome $offlineGradleHome
    if (-not $offlineGradleConfigured) {
      Add-Utf8Log -Path $BuildLog -Value "Bundled Gradle distribution was not available; Gradle Wrapper may use the network."
    }
    Apply-ReleaseIdentity
    Apply-AndroidRuntimePolicy
    Set-AndroidRuntimeActivityRestoration
    Reset-AndroidPackagedResourceOutputs
    Reset-AndroidCompiledOutputs
    Sync-AndroidPackagedResources
    [void](Invoke-AndroidGeneratedDiagnostics -Phase "prebuild")
    if ($AppliedIconSource) {
      if (Sync-AndroidLauncherIcons -Source $AppliedIconSource) {
        Add-Utf8Log -Path $BuildLog -Value "Android launcher mipmap icons applied from: $AppliedIconSource"
      } else {
        Add-Utf8Log -Path $BuildLog -Value "Android launcher mipmap icon sync skipped because Android res directory was not found."
      }
    } elseif (Test-Path -LiteralPath $RuntimeIconPngPath) {
      # Reconcile generated resources on every build, including the default icon.
      # This repairs stale Tauri-generated density files without changing source assets.
      Sync-AndroidLauncherIcons -Source $RuntimeIconPngPath | Out-Null
      Add-Utf8Log -Path $BuildLog -Value "Android launcher mipmap icons reconciled from canonical runtime icon."
    }

    # Apply-ReleaseIdentity disables Tauri's duplicate beforeBuildCommand in
    # this temporary workspace. Build the web assets explicitly so a freshly
    # copied editor runtime has dist/index.html before Gradle/Tauri starts.
    $frontendBuildExit = Invoke-LoggedCommand -FilePath $NpmPath -ArgumentList @("run", "build") -WorkingDirectory $RuntimeRoot -LogPath $BuildLog
    if ($frontendBuildExit -ne 0) {
      throw "npm run build failed with exit code $frontendBuildExit. See $BuildLog"
    }
    $frontendIndex = Join-Path $RuntimeRoot "dist\index.html"
    if (-not (Test-Path -LiteralPath $frontendIndex)) {
      throw "PACKAGED_RESOURCE_SMOKE_FAILED: Frontend build completed without dist\\index.html: $frontendIndex"
    }
    Add-Utf8Log -Path $BuildLog -Value "Android frontend assets built explicitly: $frontendIndex"

    Ensure-AndroidCargoTargetDirs -TauriDir (Join-Path $RuntimeRoot "src-tauri")
    $buildExit = Invoke-LoggedCommand -FilePath $NpmPath -ArgumentList @("run", "tauri", "--", "android", "build", "--apk", "--ci") -WorkingDirectory $RuntimeRoot -LogPath $BuildLog
    if ($buildExit -ne 0) {
      $classifiedFailure = Classify-AndroidBuildFailure -LogPath $BuildLog
      if ($classifiedFailure) { $script:FailureCode = $classifiedFailure }
      throw "npm run tauri android build failed with exit code $buildExit. See $BuildLog"
    }
    [void](Invoke-AndroidGeneratedDiagnostics -Phase "postbuild")
  } finally {
    Pop-Location
  }

  # Do not recursively scan the entire generated Android tree: Gradle leaves
  # millions of intermediates there and the publisher would appear hung after
  # the APK had already been produced. Search only the output directories that
  # Tauri/Gradle actually use, with the target fallback kept for older layouts.
  $ApkSearchRoots = @(
    (Join-Path $RuntimeRoot "src-tauri\gen\android\app\build\outputs\apk"),
    (Join-Path $RuntimeRoot "src-tauri\target\android")
  ) | Where-Object { Test-Path -LiteralPath $_ }
  $ApkFiles = @()
  foreach ($rootPath in $ApkSearchRoots) {
    $ApkFiles += Get-ChildItem -LiteralPath $rootPath -Recurse -Filter "*.apk" -File
  }
  $ApkFiles = @($ApkFiles | Sort-Object FullName -Unique)
  if ($ApkFiles.Count -eq 0) {
    throw "Android APK (*.apk) was not found under generated Android output folders."
  }

  if (-not (Test-Path -LiteralPath $SigningHelper)) {
    throw "Android signing helper was not found: $SigningHelper"
  }
  $signingTempRoot = Join-Path $ResolvedDiagnostics "signing-temp"
  New-Item -ItemType Directory -Force -Path $signingTempRoot | Out-Null
  $ensureSigningReport = Join-Path $signingTempRoot "android-signing-ensure.json"
  $ensureSigningExit = Invoke-LoggedCommand `
    -FilePath $PowerShellExe `
    -ArgumentList @(
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $SigningHelper,
      "-Action", "ensure", "-ReportPath", $ensureSigningReport
    ) `
    -WorkingDirectory $Root `
    -LogPath $BuildLog
  if ($ensureSigningExit -ne 0) {
    $script:FailureCode = "ANDROID_SIGNING_PASSWORD_UNAVAILABLE"
    throw "Android signing material could not be initialized. See $BuildLog"
  }
  $Artifacts = @()
  foreach ($file in $ApkFiles) {
    $targetName = (Get-SafePackageFileStem -Value $ReleaseTitle) + "-" + $ReleaseVersionName
    if ($ApkFiles.Count -gt 1) {
      $variant = ([System.IO.Path]::GetFileNameWithoutExtension($file.Name) -replace "-unsigned", "" -replace "-release", "").Trim("-")
      if ($variant) { $targetName += "-$variant" }
    }
    $target = Join-Path $ResolvedOutput ($targetName + ".apk")
    $temporaryUnsigned = Join-Path $signingTempRoot ("agentvn-unsigned-" + [guid]::NewGuid().ToString("N") + ".apk")
    $temporarySigned = Join-Path $signingTempRoot ("agentvn-signed-" + [guid]::NewGuid().ToString("N") + ".apk")
    $temporarySigningReport = Join-Path $signingTempRoot ("agentvn-signing-" + [guid]::NewGuid().ToString("N") + ".json")
    $temporaryInspectionReport = Join-Path $signingTempRoot ("agentvn-inspection-" + [guid]::NewGuid().ToString("N") + ".json")
    $temporaryInspectionLog = Join-Path $signingTempRoot ("agentvn-inspection-" + [guid]::NewGuid().ToString("N") + ".log")
    Copy-Item -LiteralPath $file.FullName -Destination $temporaryUnsigned -Force
    try {
      $signingReportPath = Join-Path $ResolvedDiagnostics ("android-signing-" + [System.IO.Path]::GetFileNameWithoutExtension($target) + ".json")
      $signingExit = Invoke-LoggedCommand -FilePath $PowerShellExe -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $SigningHelper, "-Action", "sign", "-ApkPath", $temporaryUnsigned, "-OutputPath", $temporarySigned, "-ReportPath", $temporarySigningReport) -WorkingDirectory $Root -LogPath $BuildLog
      if ($signingExit -ne 0) { throw "Android APK signing failed. See $BuildLog" }
      if (-not (Test-Path -LiteralPath $temporarySigningReport)) { throw "Android signing helper returned no signing report." }
      $signingReport = Read-Utf8Json -Path $temporarySigningReport
      if (-not $signingReport.signed -or -not (Test-Path -LiteralPath $temporarySigned)) { throw "Android signing helper returned no signed APK." }
      Write-Utf8Atomic -Path $signingReportPath -Value $signingReport
      $inspectionReportPath = Join-Path $ResolvedDiagnostics ("android-apk-inspection-" + [System.IO.Path]::GetFileNameWithoutExtension($target) + ".json")
      $inspectionLogPath = Join-Path $ResolvedDiagnostics ("android-apk-inspection-" + [System.IO.Path]::GetFileNameWithoutExtension($target) + ".log")
      $inspectionExit = Invoke-LoggedCommand -FilePath $NodePath -ArgumentList @(
        (Join-Path $Root "scripts\inspect-android-apk.cjs"),
        $temporarySigned,
        "--release-identity-base64",
        $ReleaseIdentityBase64,
        "--report",
        $temporaryInspectionReport
      ) -WorkingDirectory $Root -LogPath $temporaryInspectionLog
      if ($inspectionExit -ne 0) {
        $inspectionFailure = if (Test-Path -LiteralPath $temporaryInspectionReport) { Read-Utf8Json -Path $temporaryInspectionReport } else { $null }
        $script:FailureCode = if ($inspectionFailure.error -match '^([A-Z_]+):') { $Matches[1] } else { "PACKAGED_RESOURCE_SMOKE_FAILED" }
        if (Test-Path -LiteralPath $temporaryInspectionReport) { Copy-Item -LiteralPath $temporaryInspectionReport -Destination $inspectionReportPath -Force }
        if (Test-Path -LiteralPath $temporaryInspectionLog) { Copy-Item -LiteralPath $temporaryInspectionLog -Destination $inspectionLogPath -Force }
        throw "Final Android APK inspection failed. See $inspectionReportPath and $inspectionLogPath"
      }
      $PostBuildInspection = Read-Utf8Json -Path $temporaryInspectionReport
      Write-Utf8Atomic -Path $inspectionReportPath -Value $PostBuildInspection
      if (Test-Path -LiteralPath $temporaryInspectionLog) { Copy-Item -LiteralPath $temporaryInspectionLog -Destination $inspectionLogPath -Force }
      Move-Item -LiteralPath $temporarySigned -Destination $target -Force
      $evidenceInputPath = Join-Path $ResolvedDiagnostics ($targetName + "-evidence-input.json")
      $editorVersionPath = Join-Path $Root "editor\src-tauri\tauri.conf.json"
      $evidenceEditorVersion = if (Test-Path -LiteralPath $editorVersionPath) {
        (Read-Utf8Json -Path $editorVersionPath).version
      } else { (Read-Utf8Json -Path (Join-Path $Root "build-versions.json")).editorVersion }
      Write-Utf8Atomic -Path $evidenceInputPath -Value ([ordered]@{
        apk = $target
        source = $ResolvedCartridge
        layout = (Join-Path $PackagedEmbeddedDir "ui\layout.json")
        runId = $RunId
        packageName = $ReleaseApplicationId
        editorVersion = $evidenceEditorVersion
        # Tauri's version is the user's game identity, not the engine version.
        # The evidence writer resolves the engine/protocol from exact bundled sources.
        gameVersion = $ReleaseVersionName
        runtimeCargoToml = (Join-Path $RuntimeRoot "src-tauri\Cargo.toml")
        runtimeProtocolConstants = (Join-Path $Root "shared\cartridge\constants.ts")
        symlinkProbe = $SymlinkProbe
      })
      $evidenceExit = Invoke-LoggedCommand -FilePath $NodePath -ArgumentList @(
        (Join-Path $Root "scripts\android-acceptance-evidence.cjs"), $evidenceInputPath
      ) -WorkingDirectory $Root -LogPath $BuildLog
      if ($evidenceExit -ne 0) { throw "APK_PROVENANCE_FAILED: could not record build evidence for $target" }
      $Artifacts += [ordered]@{
        kind = "android_apk_signed";
        path = (Resolve-Path -LiteralPath $target).Path;
        bytes = (Get-Item -LiteralPath $target).Length;
        certificateSha256 = $signingReport.certificateSha256;
        versionName = $ReleaseVersionName;
        versionCode = $ReleaseVersionCode;
        applicationId = $ReleaseApplicationId;
        applicationLabel = $ReleaseTitle;
        inspectionReportPath = $inspectionReportPath;
        acceptanceMetadataPath = ($target + ".acceptance.json");
      }
    } finally {
      Remove-Item -LiteralPath @($temporaryUnsigned, $temporarySigned, $temporarySigningReport, $temporaryInspectionReport, $temporaryInspectionLog) -Force -ErrorAction SilentlyContinue
    }
  }
  if (Test-Path -LiteralPath $OptimizationReport) {
    $OptimizationReportTarget = Join-Path $ResolvedOutput "release-optimization-report.json"
    Copy-Item -LiteralPath $OptimizationReport -Destination $OptimizationReportTarget -Force
    $Artifacts += [ordered]@{
      kind = "release_optimization_report";
      path = (Resolve-Path -LiteralPath $OptimizationReportTarget).Path;
      bytes = (Get-Item -LiteralPath $OptimizationReportTarget).Length;
    }
  }

  Finish-PackageBuild -Status "PASS" -Message "Android standalone package build completed." -Artifacts $Artifacts -Warnings (@($VerifyWarnings) + @($BuildWarnings)) -Verify $VerifyReport
} catch {
  $message = $_.Exception.Message
  Capture-AndroidFailureDiagnostics
  if (-not $script:FailureCode) {
    if ($message -match '^([A-Z][A-Z0-9_]+):') {
      $script:FailureCode = $Matches[1]
    } else {
      $script:FailureCode = Classify-AndroidBuildFailure -LogPath $BuildLog
    }
  }
  if (Test-Path -LiteralPath $BuildLog) {
    $buildLines = (Read-Utf8Text -Path $BuildLog) -split "\r?\n"
    $tail = ($buildLines | Select-Object -Last 60) -join "`n"
    $message = "$message`n$tail"
  }
  Finish-PackageBuild -Status "FAIL" -Message $message -Warnings $VerifyWarnings -Verify $VerifyReport
} finally {
  Copy-IfExists $RuntimeBackup $RuntimeModePath
  Copy-IfExists $FixedOnlyBackup $FixedOnlyPath
  Copy-IfExists $ReleasePackageBackup $ReleasePackagePath
  if (Test-Path -LiteralPath $EmbeddedDir) { Remove-Item -LiteralPath $EmbeddedDir -Recurse -Force }
  if ($HadEmbeddedDir) { Copy-Item -LiteralPath $EmbeddedDirectoryBackup -Destination $EmbeddedDir -Recurse -Force }
  if (Test-Path -LiteralPath $PackagedEmbeddedDir) { Remove-Item -LiteralPath $PackagedEmbeddedDir -Recurse -Force }
  if ($HadPackagedEmbeddedDir) { Copy-Item -LiteralPath $PackagedEmbeddedDirectoryBackup -Destination $PackagedEmbeddedDir -Recurse -Force }
  Copy-IfExists $RuntimeIconPngBackup $RuntimeIconPngPath
  Copy-IfExists $RuntimeTauriConfigBackup $RuntimeTauriConfigPath
  Restore-AndroidLauncherIcons -BackupDir $AndroidIconBackupRoot
  if (-not $HadRuntimeMode -and (Test-Path -LiteralPath $RuntimeModePath)) { Remove-Item -LiteralPath $RuntimeModePath -Force }
  if (-not $HadFixedOnly -and (Test-Path -LiteralPath $FixedOnlyPath)) { Remove-Item -LiteralPath $FixedOnlyPath -Force }
  if (-not $HadReleasePackage -and (Test-Path -LiteralPath $ReleasePackagePath)) { Remove-Item -LiteralPath $ReleasePackagePath -Force }
  if (-not $HadRuntimeIconPng -and (Test-Path -LiteralPath $RuntimeIconPngPath)) { Remove-Item -LiteralPath $RuntimeIconPngPath -Force }
  if (-not $HadRuntimeTauriConfig -and (Test-Path -LiteralPath $RuntimeTauriConfigPath)) { Remove-Item -LiteralPath $RuntimeTauriConfigPath -Force }
  if ($null -eq $PreviousRuntimeModeEnv) { Remove-Item Env:\VITE_AGENTVN_RUNTIME_MODE -ErrorAction SilentlyContinue } else { $env:VITE_AGENTVN_RUNTIME_MODE = $PreviousRuntimeModeEnv }
  if ($null -eq $PreviousFixedOnlyEnv) { Remove-Item Env:\VITE_AGENTVN_FIXED_ONLY -ErrorAction SilentlyContinue } else { $env:VITE_AGENTVN_FIXED_ONLY = $PreviousFixedOnlyEnv }
  if ($null -eq $PreviousReleasePackageEnv) { Remove-Item Env:\VITE_AGENTVN_RELEASE_PACKAGE -ErrorAction SilentlyContinue } else { $env:VITE_AGENTVN_RELEASE_PACKAGE = $PreviousReleasePackageEnv }
  if ($null -eq $PreviousGradleOptsEnv) { Remove-Item Env:\GRADLE_OPTS -ErrorAction SilentlyContinue } else { $env:GRADLE_OPTS = $PreviousGradleOptsEnv }
  if ($null -eq $PreviousGradleUserHomeEnv) { Remove-Item Env:\GRADLE_USER_HOME -ErrorAction SilentlyContinue } else { $env:GRADLE_USER_HOME = $PreviousGradleUserHomeEnv }
  if ($null -eq $PreviousGradleDistributionEnv) { Remove-Item Env:\AGENTVN_GRADLE_DISTRIBUTION -ErrorAction SilentlyContinue } else { $env:AGENTVN_GRADLE_DISTRIBUTION = $PreviousGradleDistributionEnv }
  if ($null -eq $PreviousCargoBuildJobsEnv) { Remove-Item Env:\CARGO_BUILD_JOBS -ErrorAction SilentlyContinue } else { $env:CARGO_BUILD_JOBS = $PreviousCargoBuildJobsEnv }
  if ($null -eq $PreviousRustflagsEnv) { Remove-Item Env:\RUSTFLAGS -ErrorAction SilentlyContinue } else { $env:RUSTFLAGS = $PreviousRustflagsEnv }
  if (Test-Path -LiteralPath $BackupRoot) { Remove-Item -LiteralPath $BackupRoot -Recurse -Force }
  foreach ($artifact in @($Artifacts)) {
    if ($artifact.kind -ne "android_apk_signed" -or -not $artifact.acceptanceMetadataPath) { continue }
    $evidence = Read-Utf8Json -Path $artifact.acceptanceMetadataPath
    foreach ($entry in @($evidence.sourceCartridge, $evidence.prepackageLayout)) {
      if ($entry.present -eq $false) { continue }
      $entry.cleaned = -not (Test-Path -LiteralPath $entry.path -PathType Leaf)
      if (-not $entry.cleaned) {
        $entry.cleaned = (Get-FileHash -LiteralPath $entry.path -Algorithm SHA256).Hash -ne $entry.sha256
      }
    }
    Write-Utf8Atomic -Path $artifact.acceptanceMetadataPath -Value $evidence
  }
}
