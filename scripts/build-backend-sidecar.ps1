param(
    [string]$Configuration = "release",
    [switch]$KeepPyInstallerArtifacts
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$BackendDir = Join-Path $Root "backend"
$EditorBinariesDir = Join-Path $Root "editor\src-tauri\binaries"
$OutputExe = Join-Path $EditorBinariesDir "creator-backend.exe"

function Test-CommandExists {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

New-Item -ItemType Directory -Force -Path $EditorBinariesDir | Out-Null

Push-Location $BackendDir
try {
    Write-Host "[AgentVN] Preparing backend Python environment..." -ForegroundColor Cyan
    if (Test-CommandExists "uv") {
        uv sync --extra dev
        $PythonRunner = @("uv", "run")
    } else {
        python -m pip install -e ".[dev]"
        $PythonRunner = @("python", "-m")
    }

    Write-Host "[AgentVN] Building creator-backend.exe with PyInstaller..." -ForegroundColor Cyan
    if ($PythonRunner[0] -eq "uv") {
        uv run pyinstaller `
            --noconfirm `
            --clean `
            --onefile `
            --noconsole `
            --name creator-backend `
            --paths . `
            --hidden-import sqlite_vec `
            --collect-binaries sqlite_vec `
            --exclude-module torch `
            --exclude-module torchvision `
            --exclude-module torchaudio `
            --exclude-module pandas `
            --exclude-module scipy `
            --exclude-module sklearn `
            --exclude-module numba `
            --exclude-module matplotlib `
            --exclude-module pygame `
            --exclude-module playwright `
            --exclude-module onnxruntime `
            backend_launcher.py
    } else {
        python -m PyInstaller `
            --noconfirm `
            --clean `
            --onefile `
            --noconsole `
            --name creator-backend `
            --paths . `
            --hidden-import sqlite_vec `
            --collect-binaries sqlite_vec `
            --exclude-module torch `
            --exclude-module torchvision `
            --exclude-module torchaudio `
            --exclude-module pandas `
            --exclude-module scipy `
            --exclude-module sklearn `
            --exclude-module numba `
            --exclude-module matplotlib `
            --exclude-module pygame `
            --exclude-module playwright `
            --exclude-module onnxruntime `
            backend_launcher.py
    }

    $BuiltExe = Join-Path $BackendDir "dist\creator-backend.exe"
    if (-not (Test-Path $BuiltExe)) {
        throw "PyInstaller did not produce expected file: $BuiltExe"
    }

    & (Join-Path $PSScriptRoot "assert-windows-gui-subsystem.ps1") -Path $BuiltExe
    Copy-Item -Force $BuiltExe $OutputExe
    Write-Host "[AgentVN] Backend sidecar copied to $OutputExe" -ForegroundColor Green

    if (-not $KeepPyInstallerArtifacts) {
        Remove-Item -Recurse -Force -LiteralPath (Join-Path $BackendDir "build") -ErrorAction SilentlyContinue
        Remove-Item -Recurse -Force -LiteralPath (Join-Path $BackendDir "dist") -ErrorAction SilentlyContinue
        Remove-Item -Force -LiteralPath (Join-Path $BackendDir "creator-backend.spec") -ErrorAction SilentlyContinue
    }
} finally {
    Pop-Location
}
