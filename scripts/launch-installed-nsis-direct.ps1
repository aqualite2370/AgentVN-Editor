param(
  [Parameter(Mandatory = $true)][string]$RunRoot,
  [Parameter(Mandatory = $true)][string]$InstallRoot,
  [ValidateRange(1024, 65535)][int]$CdpPort = 9496,
  [ValidateRange(1024, 65535)][int]$BackendPort = 9386
)

$ErrorActionPreference = "Stop"
$RunRoot = [IO.Path]::GetFullPath($RunRoot)
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
if (-not (Test-Path -LiteralPath (Join-Path $InstallRoot "agentvn-editor.exe"))) {
  throw "Explicit NSIS installation is missing agentvn-editor.exe: $InstallRoot"
}
if ($CdpPort -eq $BackendPort) { throw "CDP and backend ports must differ." }

$dataRoot = Join-Path $RunRoot "isolated-data"
$backendData = Join-Path $dataRoot "backend"
$webviewRoot = Join-Path $RunRoot "webview"
New-Item -ItemType Directory -Force -Path $backendData, $webviewRoot | Out-Null

$env:AGENTVN_EDITOR_DATA_DIR = $dataRoot
$env:AGENTVN_BACKEND_DATA_DIR = $backendData
$env:DATABASE_PATH = Join-Path $backendData "vn_engine.db"
$env:AGENTVN_LEGACY_DATABASE_PATHS = ""
$env:AGENTVN_BACKEND_PORT = [string]$BackendPort
$env:AGENTVN_BACKEND_LOG = Join-Path $RunRoot "installed-backend.log"
$env:AGENTVN_ERROR_LOG_DIR = Join-Path $RunRoot "error_log"
$env:WEBVIEW2_USER_DATA_FOLDER = $webviewRoot
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$CdpPort"

$backend = $null
$editor = $null
try {
  $backend = Start-Process -FilePath (Join-Path $InstallRoot "creator-backend.exe") `
    -WorkingDirectory $InstallRoot -WindowStyle Hidden -PassThru
  $deadline = [DateTime]::UtcNow.AddSeconds(60)
  $ready = $false
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($backend.HasExited) { throw "Installed backend exited before readiness." }
    try {
      $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 `
        -Uri "http://127.0.0.1:$BackendPort/api/health"
      if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
    Start-Sleep -Milliseconds 250
  }
  if (-not $ready) { throw "Installed backend readiness timed out." }
  $editor = Start-Process -FilePath (Join-Path $InstallRoot "agentvn-editor.exe") `
    -WorkingDirectory $InstallRoot -WindowStyle Hidden -PassThru
  $state = [ordered]@{
    installRoot = $InstallRoot
    editorPid = $editor.Id
    backendPid = $backend.Id
    databasePath = $env:DATABASE_PATH
    webviewRoot = $webviewRoot
    cdpPort = $CdpPort
    backendPort = $BackendPort
    startedAt = [DateTime]::UtcNow.ToString("o")
  }
  [IO.File]::WriteAllText(
    (Join-Path $RunRoot "installed-processes.json"),
    ($state | ConvertTo-Json),
    [Text.UTF8Encoding]::new($false)
  )
  $state | ConvertTo-Json
} catch {
  foreach ($process in @($editor, $backend)) {
    if ($process -and -not $process.HasExited) {
      & taskkill.exe /PID $process.Id /T /F | Out-Null
    }
  }
  throw
}
