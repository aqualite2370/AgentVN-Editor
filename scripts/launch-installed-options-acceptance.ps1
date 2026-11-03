param(
    [Parameter(Mandatory=$true)][string]$RunRoot,
    [ValidateRange(1024,65535)][int]$CdpPort = 9488,
    [ValidateRange(1024,65535)][int]$BackendPort = 8278
)
$ErrorActionPreference = "Stop"
# The installed host defaults to 8278, but acceptance runs may reserve a
# dedicated port so this session never reuses another user's backend/database.
$Report = Get-Content -LiteralPath (Join-Path $RunRoot "installer-resource-report.json") -Raw -Encoding UTF8 | ConvertFrom-Json
if ($Report.status -ne "PASS") { throw "Installer resource acceptance must pass first." }
$InstallRoot = ($Report.deployments | Where-Object { $_.kind -eq "MSI en-US administrative deployment" }).installedRoot
if (-not $InstallRoot) { throw "Actual MSI deployment not found." }
if ($BackendPort -eq $CdpPort) { throw "Backend and CDP ports must differ." }
foreach ($Port in @($BackendPort, $CdpPort)) {
    $Probe = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $Port)
    try { $Probe.Start() } finally { $Probe.Stop() }
}
$DataRoot = Join-Path $RunRoot "isolated-data"
$BackendData = Join-Path $DataRoot "backend"
New-Item -ItemType Directory -Path $BackendData -Force | Out-Null
$env:AGENTVN_EDITOR_DATA_DIR = $DataRoot
$env:AGENTVN_BACKEND_DATA_DIR = $BackendData
$env:DATABASE_PATH = Join-Path $BackendData "vn_engine.db"
$env:AGENTVN_LEGACY_DATABASE_PATHS = ""
$env:AGENTVN_BACKEND_PORT = [string]$BackendPort
$env:AGENTVN_BACKEND_LOG = Join-Path $RunRoot "installed-backend.log"
$env:AGENTVN_ERROR_LOG_DIR = Join-Path $RunRoot "error_log"
# Start the shipped backend first: this prevents importing legacy user databases.
$Backend = Start-Process -FilePath (Join-Path $InstallRoot "creator-backend.exe") -WorkingDirectory $InstallRoot -WindowStyle Hidden -PassThru
$Ready = $false
for ($Attempt = 0; $Attempt -lt 60; $Attempt++) {
    try {
        $Request = [Net.WebRequest]::Create("http://127.0.0.1:$BackendPort/api/health")
        $Request.Timeout = 1000
        $Response = $Request.GetResponse()
        $Response.Close()
        $Ready = $true
        break
    } catch { Start-Sleep -Milliseconds 500 }
}
if (-not $Ready) {
    Stop-Process -Id $Backend.Id -ErrorAction SilentlyContinue
    throw "Isolated shipped backend did not become healthy."
}
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $RunRoot "webview"
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$CdpPort"
$Editor = Start-Process -FilePath (Join-Path $InstallRoot "agentvn-editor.exe") -WorkingDirectory $InstallRoot -WindowStyle Hidden -PassThru
$State = @{
    installRoot = $InstallRoot
    editorPid = $Editor.Id
    backendPid = $Backend.Id
    databasePath = $env:DATABASE_PATH
    cdpPort = $CdpPort
    backendPort = $BackendPort
    startedAt = [DateTime]::UtcNow.ToString("o")
}
[IO.File]::WriteAllText((Join-Path $RunRoot "installed-processes.json"), ($State | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
$State | ConvertTo-Json
