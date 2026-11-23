param(
    [ValidateSet("all", "editor", "player")]
    [string]$Target = "all",

    [string]$Version,

    [string]$ReleaseRoot = "releases",

    [string]$ExpectedRoot,

    [switch]$SkipClean
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$ReleaseRootPath = $null
$script:VersionFileBackups = @{}

function Write-Utf8NoBom {
    param([string]$Path, [string]$Content)
    [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

function Resolve-PackageVersion {
    param([string]$RequestedVersion)
    $Candidate = if ([string]::IsNullOrWhiteSpace($RequestedVersion)) {
        Read-Host "Enter package version (for example 1.0 or 1.0.0)"
    } else { $RequestedVersion.Trim() }
    if ($Candidate -match '^\d+\.\d+$') { $Candidate = $Candidate + ".0" }
    if ($Candidate -notmatch '^\d+\.\d+\.\d+$') {
        throw "Invalid package version '$Candidate'. Use a value like 1.0 or 1.0.0."
    }
    return $Candidate
}

function Set-PackageVersion {
    param([string]$PackageVersion)
    $VersionPaths = @()
    if ($Target -ne "player") { $VersionPaths += @("editor\src-tauri\tauri.conf.json", "editor\src-tauri\Cargo.toml") }
    if ($Target -ne "editor") { $VersionPaths += @("GameCli_framework\src-tauri\tauri.conf.json", "GameCli_framework\src-tauri\Cargo.toml") }
    foreach ($RelativePath in $VersionPaths) {
        $Path = Resolve-WorkspacePath $RelativePath
        # The Tauri player config can contain a Unicode project title. Windows
        # PowerShell's default Get-Content encoding is locale-dependent and can
        # corrupt that JSON before the build starts. Read every versioned file
        # as UTF-8 explicitly, then write it back with the matching encoding.
        $Original = [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8)
        $script:VersionFileBackups[$Path] = $Original
        if ($Path -like "*.json") {
            $Updated = [regex]::Replace($Original, '("version"\s*:\s*")[^"]+("\s*[,}])', "`${1}$PackageVersion`${2}", 1)
        } else {
            $Updated = [regex]::Replace($Original, '(?m)^version\s*=\s*"[^"]+"', "version = `"$PackageVersion`"", 1)
        }
        Write-Utf8NoBom -Path $Path -Content $Updated
    }
}

function Restore-PackageVersion {
    foreach ($Entry in $script:VersionFileBackups.GetEnumerator()) {
        Write-Utf8NoBom -Path $Entry.Key -Content $Entry.Value
    }
    $script:VersionFileBackups = @{}
}

function Normalize-PathForCompare {
    param([string]$Path)
    return [System.IO.Path]::GetFullPath($Path).TrimEnd("\")
}

function Assert-CanonicalRoot {
    $Actual = Normalize-PathForCompare $Root
    $Expected = if ($ExpectedRoot) { Normalize-PathForCompare $ExpectedRoot } else { $Actual }
    Write-Host "[AgentVN] Actual workspace root: $Actual" -ForegroundColor Cyan
    Write-Host "[AgentVN] Expected workspace root: $Expected" -ForegroundColor Cyan
    if ($Actual -ne $Expected) {
        throw "Refusing to package from a non-canonical workspace. Expected $Expected, got $Actual. If this is intentional, run this script from the workspace you want to package, or pass -ExpectedRoot with that exact path."
    }
    foreach ($Required in @("editor", "GameCli_framework", "scripts", "shared", "backend")) {
        $RequiredPath = Join-Path $Root $Required
        if (-not (Test-Path -LiteralPath $RequiredPath)) {
            throw "Workspace root check failed. Missing required path: $RequiredPath"
        }
    }
}

function Resolve-ReleaseRoot {
    $ReleasePath = if ([System.IO.Path]::IsPathRooted($ReleaseRoot)) {
        [System.IO.Path]::GetFullPath($ReleaseRoot)
    } else {
        [System.IO.Path]::GetFullPath((Join-Path $Root $ReleaseRoot))
    }
    $RootCompare = Normalize-PathForCompare $Root
    $ReleaseCompare = Normalize-PathForCompare $ReleasePath
    if (-not $ReleaseCompare.StartsWith($RootCompare + "\", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "ReleaseRoot must stay inside the canonical workspace. Requested: $ReleasePath"
    }
    New-Item -ItemType Directory -Force -Path $ReleasePath | Out-Null
    return $ReleasePath
}

function Add-CargoToPath {
    $CargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
    if ((Test-Path -LiteralPath $CargoBin) -and ($env:Path -notlike "*$CargoBin*")) {
        $env:Path = "$CargoBin;$env:Path"
    }
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        throw "Missing cargo. Install Rustup and the Windows Rust toolchain before packaging."
    }
}

function Import-VisualStudioBuildEnvironment {
    if (Get-Command link.exe -ErrorAction SilentlyContinue) {
        return
    }

    $VsWhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
    if (-not (Test-Path -LiteralPath $VsWhere)) {
        Write-Host "[AgentVN] vswhere.exe was not found; assuming Visual Studio Build Tools are already on PATH." -ForegroundColor Yellow
        return
    }

    $InstallPath = & $VsWhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if (-not $InstallPath) {
        Write-Host "[AgentVN] Visual Studio C++ Build Tools were not found. Packaging may fail if link.exe is unavailable." -ForegroundColor Yellow
        return
    }

    $VsDevCmd = Join-Path $InstallPath "Common7\Tools\VsDevCmd.bat"
    if (-not (Test-Path -LiteralPath $VsDevCmd)) {
        Write-Host "[AgentVN] VsDevCmd.bat was not found: $VsDevCmd" -ForegroundColor Yellow
        return
    }

    Write-Host "[AgentVN] Loading Visual Studio C++ build environment..." -ForegroundColor Cyan
    $EnvironmentLines = & cmd.exe /c "call `"$VsDevCmd`" -arch=x64 >nul && set"
    foreach ($Line in $EnvironmentLines) {
        $Index = $Line.IndexOf("=")
        if ($Index -gt 0) {
            $Name = $Line.Substring(0, $Index)
            $Value = $Line.Substring($Index + 1)
            [Environment]::SetEnvironmentVariable($Name, $Value, "Process")
        }
    }
}

function Get-NpmCommand {
    $NpmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($NpmCmd) {
        return $NpmCmd.Source
    }
    $Npm = Get-Command npm -ErrorAction SilentlyContinue
    if ($Npm) {
        return $Npm.Source
    }
    throw "Missing npm. Install Node.js/npm before packaging."
}

function Invoke-Npm {
    param(
        [string[]]$Arguments,
        [string]$WorkingDirectory
    )

    Push-Location $WorkingDirectory
    try {
        & $script:NpmCommand @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "npm $($Arguments -join ' ') failed in $WorkingDirectory with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}

function Resolve-WorkspacePath {
    param([string]$RelativePath)
    return Join-Path $Root $RelativePath
}

function Remove-WorkspacePath {
    param([string]$RelativePath)

    $Path = Resolve-WorkspacePath $RelativePath
    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }
    $Resolved = (Resolve-Path -LiteralPath $Path).Path
    $RootCompare = Normalize-PathForCompare $Root
    $ResolvedCompare = Normalize-PathForCompare $Resolved
    if (-not $ResolvedCompare.StartsWith($RootCompare, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove a path outside the workspace: $Resolved"
    }
    for ($Attempt = 1; $Attempt -le 6; $Attempt += 1) {
        try {
            Remove-Item -LiteralPath $Resolved -Recurse -Force -ErrorAction Stop
            return
        }
        catch {
            if ($Attempt -eq 6) {
                throw
            }
            Start-Sleep -Seconds 3
        }
    }
}

function Clear-BundleOutput {
    param([string]$RelativeTauriDir)

    Remove-WorkspacePath (Join-Path $RelativeTauriDir "target\release\bundle")
}

function Copy-InstallerArtifacts {
    param(
        [string]$AppName,
        [string]$BundleRoot,
        [string]$ReleaseSubDir
    )

    $NsisDir = Join-Path $BundleRoot "nsis"
    $NsisInstaller = Get-ChildItem -LiteralPath $NsisDir -Filter "*.exe" -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $NsisInstaller) {
        throw "Missing NSIS installer for $AppName. Expected an .exe under: $NsisDir"
    }

    $ReleaseDir = Join-Path $script:ReleaseRootPath $ReleaseSubDir
    New-Item -ItemType Directory -Force -Path $ReleaseDir | Out-Null

    $FileStem = $AppName -replace '[^A-Za-z0-9._-]', '_'
    $ExeDestination = Join-Path $ReleaseDir "${FileStem}_v$script:PackageVersion`_$Timestamp.exe"
    Copy-Item -LiteralPath $NsisInstaller.FullName -Destination $ExeDestination -Force
    Write-Host "[AgentVN] $AppName NSIS installer: $ExeDestination" -ForegroundColor Green

}

function Sync-EditorPlayerResource {
    param([string]$BuiltPlayerExe)

    $PlayerResource = Resolve-WorkspacePath "editor\src-tauri\binaries\agentvn-player.exe"
    if (-not (Test-Path -LiteralPath $BuiltPlayerExe)) {
        throw "Cannot sync editor preview player; missing built executable: $BuiltPlayerExe"
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $PlayerResource) | Out-Null
    Copy-Item -LiteralPath $BuiltPlayerExe -Destination $PlayerResource -Force
    Write-Host "[AgentVN] Editor preview player updated: $PlayerResource" -ForegroundColor Green
}

function Build-EditorInstaller {
    Write-Host "[AgentVN] Packaging AgentVN Editor installers..." -ForegroundColor Cyan
    Clear-BundleOutput "editor\src-tauri"
    # Editor-only packaging reuses the checked native preview resource. The
    # Editor's static Runtime preview remains part of its frontend build.
    & (Join-Path $PSScriptRoot "build-editor-windows.ps1") -SkipGameCliPlayer:($Target -eq "editor")
    if ($LASTEXITCODE -ne 0) {
        throw "Editor packaging failed with exit code $LASTEXITCODE."
    }
    Copy-InstallerArtifacts `
        -AppName "AgentVN Editor" `
        -BundleRoot (Resolve-WorkspacePath "editor\src-tauri\target\release\bundle") `
        -ReleaseSubDir "editor"
}

function Build-PlayerInstaller {
    Write-Host "[AgentVN] Packaging AgentVN Player installers..." -ForegroundColor Cyan
    $PlayerDir = Resolve-WorkspacePath "GameCli_framework"
    Clear-BundleOutput "GameCli_framework\src-tauri"

    $EditorIcon = Resolve-WorkspacePath "editor\src-tauri\icons\icon.ico"
    $PlayerIcon = Resolve-WorkspacePath "GameCli_framework\src-tauri\icons\icon.ico"
    Copy-Item -LiteralPath $EditorIcon -Destination $PlayerIcon -Force
    Write-Host "[AgentVN] Player installer icon synced from editor icon." -ForegroundColor Green

    if (-not (Test-Path -LiteralPath (Join-Path $PlayerDir "node_modules"))) {
        Invoke-Npm -Arguments @("ci", "--no-audit", "--no-fund") -WorkingDirectory $PlayerDir
    }

    $PublicDir = Join-Path $PlayerDir "public"
    New-Item -ItemType Directory -Force -Path $PublicDir | Out-Null
    [System.IO.File]::WriteAllText(
        (Join-Path $PublicDir "runtime-mode.json"),
        "{ `"mode`": `"library`" }`n",
        (New-Object System.Text.UTF8Encoding($false))
    )

    Invoke-Npm -Arguments @("run", "tauri", "build", "--", "--bundles", "nsis") -WorkingDirectory $PlayerDir
    $BuiltPlayerExe = Join-Path $PlayerDir "src-tauri\target\release\agentvn-player.exe"
    & (Join-Path $PSScriptRoot "assert-windows-gui-subsystem.ps1") -Path $BuiltPlayerExe
    Sync-EditorPlayerResource -BuiltPlayerExe $BuiltPlayerExe
    Copy-InstallerArtifacts `
        -AppName "AgentVN Player" `
        -BundleRoot (Resolve-WorkspacePath "GameCli_framework\src-tauri\target\release\bundle") `
        -ReleaseSubDir "player"
}

function Clear-PackagingArtifacts {
    Write-Host "[AgentVN] Cleaning disposable build artifacts..." -ForegroundColor Cyan
    $Deadline = (Get-Date).AddMinutes(2)
    while ((Get-Date) -lt $Deadline) {
        $BuildProcesses = Get-Process -ErrorAction SilentlyContinue |
            Where-Object { $_.ProcessName -match "^(cargo|rustc|tauri|light|candle|makensis)$" }
        if (-not $BuildProcesses) {
            break
        }
        Start-Sleep -Seconds 5
    }
    foreach ($Path in @(
        "editor\dist",
        "editor\src-tauri\target",
        "GameCli_framework\dist",
        "GameCli_framework\src-tauri\target"
    )) {
        Remove-WorkspacePath $Path
    }
}

Assert-CanonicalRoot
Set-Location $Root
$script:PackageVersion = Resolve-PackageVersion $Version
$Version = $script:PackageVersion
$script:ReleaseRootPath = Resolve-ReleaseRoot
Write-Host "[AgentVN] Packaging timestamp: $Timestamp" -ForegroundColor Cyan
Write-Host "[AgentVN] Target: $Target" -ForegroundColor Cyan
Write-Host "[AgentVN] Version: $script:PackageVersion" -ForegroundColor Cyan
Write-Host "[AgentVN] Release root: $script:ReleaseRootPath" -ForegroundColor Cyan

Set-PackageVersion $script:PackageVersion

try {

Add-CargoToPath
Import-VisualStudioBuildEnvironment
$script:NpmCommand = Get-NpmCommand

if ($Target -eq "all" -or $Target -eq "editor") {
    Build-EditorInstaller
}

if ($Target -eq "all" -or $Target -eq "player") {
    Build-PlayerInstaller
}

if (-not $SkipClean) {
    Clear-PackagingArtifacts
}

Write-Host "[AgentVN] Packaging complete. Release installers are under $script:ReleaseRootPath." -ForegroundColor Green
} finally {
    Restore-PackageVersion
}
