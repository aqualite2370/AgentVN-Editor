$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$BackendRoot = Join-Path $RepoRoot "backend"
$LegacyDataDir = Join-Path $BackendRoot "data"
$SharedDataRoot = if ($env:AGENTVN_EDITOR_DATA_DIR) {
    $env:AGENTVN_EDITOR_DATA_DIR
} elseif ($env:APPDATA) {
    Join-Path $env:APPDATA "com.agentvn.editor"
} else {
    Join-Path $env:USERPROFILE "AppData\Roaming\com.agentvn.editor"
}
$SystemDataDir = Join-Path $SharedDataRoot "backend"
$ErrorLogDir = Join-Path $RepoRoot "error_log"
$Port = if ($env:AGENTVN_BACKEND_PORT) { [int]$env:AGENTVN_BACKEND_PORT } else { 8278 }
$HealthUrl = "http://127.0.0.1:$Port/api/health"

function Test-AgentVNBackendHealth {
    param([string]$Url)
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
    } catch {
        return $false
    }
}

function Get-AgentVNPortOwners {
    param([int]$LocalPort)
    try {
        $connections = Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction Stop
    } catch {
        return @()
    }
    $owners = @()
    foreach ($connection in $connections) {
        $processName = ""
        try {
            $processName = (Get-Process -Id $connection.OwningProcess -ErrorAction Stop).ProcessName
        } catch {
            $processName = "unknown"
        }
        $owners += [pscustomobject]@{
            LocalAddress = $connection.LocalAddress
            LocalPort = $connection.LocalPort
            State = $connection.State
            OwningProcess = $connection.OwningProcess
            ProcessName = $processName
        }
    }
    return $owners
}

Set-Location $BackendRoot
$env:DATABASE_PATH = Join-Path $SystemDataDir "vn_engine.db"
$env:AGENTVN_BACKEND_DATA_DIR = $SystemDataDir
$legacyDatabasePaths = @(
    (Join-Path $LegacyDataDir "vn_engine.db"),
    (Join-Path (Join-Path $RepoRoot "data") "backend\vn_engine.db")
) | Where-Object {
    (Test-Path -LiteralPath $_ -PathType Leaf) -and
    ([System.IO.Path]::GetFullPath($_) -ne [System.IO.Path]::GetFullPath($env:DATABASE_PATH))
}
$env:AGENTVN_LEGACY_DATABASE_PATHS = ($legacyDatabasePaths -join [System.IO.Path]::PathSeparator)
New-Item -ItemType Directory -Force -Path $ErrorLogDir | Out-Null
$env:AGENTVN_ERROR_LOG_DIR = $ErrorLogDir
$env:AGENTVN_BACKEND_LOG = Join-Path $ErrorLogDir "backend.log"

if (Test-AgentVNBackendHealth $HealthUrl) {
    Write-Host "AgentVN backend is already healthy: $HealthUrl"
    exit 0
}

$owners = @(Get-AgentVNPortOwners $Port)
if ($owners.Count -gt 0) {
    $ownerText = ($owners | ConvertTo-Json -Compress)
    throw "Backend port $Port is occupied but $HealthUrl is not healthy. Port owners: $ownerText"
}

Write-Host "Starting AgentVN backend on $HealthUrl"
if (Get-Command uv -ErrorAction SilentlyContinue) {
    uv run uvicorn app.main:app --host 127.0.0.1 --port $Port --reload --reload-dir app
} else {
    python -m uvicorn app.main:app --host 127.0.0.1 --port $Port --reload --reload-dir app
}
