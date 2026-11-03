param(
    [Parameter(Mandatory = $true)][string]$OutputDir,
    [Parameter(Mandatory = $true)][string]$DiagnosticsDir,
    [Parameter(Mandatory = $true)][string]$LogPath
)

$ErrorActionPreference = "Stop"
$root = "D:\AgentVN"
$identity = [ordered]@{
    schemaVersion = 1
    title = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("6ZqQ5b+N55qE5oiQ6ZW/"))
    gameId = "project_msiz08p7_0_89ebc8a8cb"
    versionName = "0.1.0"
    versionCode = 1
    androidApplicationId = "com.agentvn.hidden.growth"
}
$isElevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogPath) | Out-Null
[IO.File]::WriteAllText($LogPath, "isElevated=$isElevated`n", [Text.UTF8Encoding]::new($false))
if (-not $isElevated) { throw "ADMINISTRATOR_REQUIRED" }

$releaseIdentity = [Convert]::ToBase64String(
    [Text.Encoding]::UTF8.GetBytes(($identity | ConvertTo-Json -Compress))
)
$buildArgs = @(
    (Join-Path $root "scripts\build-runtime-standalone-android.cjs"),
    "--OutputDir", [IO.Path]::GetFullPath($OutputDir),
    "--DiagnosticsDir", [IO.Path]::GetFullPath($DiagnosticsDir),
    "--CartridgePath", (Join-Path $root "output\hidden-growth\hidden-growth.vncart"),
    "--ReleaseIdentity", "base64:$releaseIdentity",
    "--IconSource", "project",
    "--IconPath", (Join-Path $root "data\backend\project_assets\project_msiz08p7_0_89ebc8a8cb\ui\asset-352617a1330feea8.png"),
    "--OfflinePackRoot", (Join-Path $root "android-offline-pack"),
    "--OptimizationProfile", "balanced"
)
& node @buildArgs *>> $LogPath
$exitCode = $LASTEXITCODE
Add-Content -LiteralPath $LogPath -Value "exitCode=$exitCode" -Encoding UTF8
exit $exitCode
