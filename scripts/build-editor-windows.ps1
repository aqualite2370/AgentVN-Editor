param(
    [switch]$SkipBackendSidecar,
    [switch]$SkipGameCliPlayer
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$EditorDir = Join-Path $Root "editor"
$BackendSidecar = Join-Path $EditorDir "src-tauri\binaries\creator-backend.exe"
$PlayerResource = Join-Path $EditorDir "src-tauri\binaries\agentvn-player.exe"

function Add-CargoToPath {
    $CargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
    if ((Test-Path $CargoBin) -and ($env:Path -notlike "*$CargoBin*")) {
        $env:Path = "$CargoBin;$env:Path"
    }
}

function Import-VisualStudioBuildEnvironment {
    if (Get-Command link.exe -ErrorAction SilentlyContinue) { return }
    $VsWhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
    if (-not (Test-Path $VsWhere)) {
        Write-Host "[AgentVN] vswhere.exe was not found; assuming Visual Studio Build Tools are already on PATH." -ForegroundColor Yellow
        return
    }
    $InstallPath = & $VsWhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if (-not $InstallPath) { throw "Visual Studio C++ Build Tools were not found." }
    $VsDevCmd = Join-Path $InstallPath "Common7\Tools\VsDevCmd.bat"
    if (-not (Test-Path $VsDevCmd)) { throw "VsDevCmd.bat was not found: $VsDevCmd" }
    $EnvironmentLines = & cmd.exe /c "call `"$VsDevCmd`" -arch=x64 >nul && set"
    if ($LASTEXITCODE -ne 0) { throw "Visual Studio build environment failed." }
    foreach ($Line in $EnvironmentLines) {
        $Index = $Line.IndexOf("=")
        if ($Index -gt 0) {
            [Environment]::SetEnvironmentVariable($Line.Substring(0, $Index), $Line.Substring($Index + 1), "Process")
        }
    }
}

Add-CargoToPath
Import-VisualStudioBuildEnvironment
if (-not $SkipBackendSidecar) {
    & (Join-Path $PSScriptRoot "build-backend-sidecar.ps1")
    if ($LASTEXITCODE -ne 0) { throw "Backend sidecar build failed." }
}

# Dev, direct Tauri and Release all use the same resource manifest and preparation.
& (Join-Path $PSScriptRoot "prepare-editor-runtime-resources.ps1") -SkipGameCliPlayer:$SkipGameCliPlayer
if (-not (Test-Path -LiteralPath $BackendSidecar -PathType Leaf)) {
    throw "Missing backend sidecar: $BackendSidecar"
}

Push-Location $EditorDir
try {
    if (-not (Test-Path (Join-Path $EditorDir "node_modules"))) {
        npm ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "Editor locked dependency installation failed." }
    }
    Write-Host "[AgentVN] Building AgentVN Editor Windows package..." -ForegroundColor Cyan
    $PreviousPreparedFlag = $env:AGENTVN_EDITOR_RUNTIME_RESOURCES_PREPARED
    $env:AGENTVN_EDITOR_RUNTIME_RESOURCES_PREPARED = "1"
    try {
        npm.cmd run tauri build -- --bundles nsis
        if ($LASTEXITCODE -ne 0) { throw "Editor release packaging failed (exit $LASTEXITCODE)." }
    } finally {
        $env:AGENTVN_EDITOR_RUNTIME_RESOURCES_PREPARED = $PreviousPreparedFlag
    }
} finally {
    Pop-Location
}

$EditorExe = Join-Path $EditorDir "src-tauri\target\release\agentvn-editor.exe"
& (Join-Path $PSScriptRoot "assert-windows-gui-subsystem.ps1") -Path @(
    $EditorExe,
    $BackendSidecar,
    $PlayerResource
)
