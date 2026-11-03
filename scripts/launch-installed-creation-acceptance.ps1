param(
    [Parameter(Mandatory=$true)][string]$RunRoot,
    [ValidateRange(1024,65535)][int]$CdpPort=9496,
    [ValidateRange(1024,65535)][int]$BackendPort=9386
)
$ErrorActionPreference='Stop'
$RunRoot=[IO.Path]::GetFullPath($RunRoot)
$Resources=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $RunRoot 'installer-resource-report.json')|ConvertFrom-Json
if ($Resources.status -ne 'PASS') {throw 'Installer resources must pass.'}
$Installation=@($Resources.deployments|Where-Object {$_.kind -eq 'NSIS actual isolated installation'})
if ($Installation.Count -ne 1) {throw 'Expected the exact actual NSIS installation.'}
$InstallRoot=$Installation[0].installedRoot
if ((Get-FileHash -LiteralPath (Join-Path $InstallRoot 'agentvn-editor.exe') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Installation[0].executable.sha256) {throw 'Installed executable mismatch.'}
if ($CdpPort -eq $BackendPort) {throw 'Ports must differ.'}
foreach ($Port in @($CdpPort,$BackendPort)) {
    $Probe=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$Port)
    try {$Probe.Start()} finally {$Probe.Stop()}
}
$Data=Join-Path $RunRoot 'isolated-data'
$BackendData=Join-Path $Data 'backend'
New-Item -ItemType Directory -Path $BackendData -ErrorAction Stop|Out-Null
$env:AGENTVN_EDITOR_DATA_DIR=$Data
$env:AGENTVN_BACKEND_DATA_DIR=$BackendData
$env:DATABASE_PATH=Join-Path $BackendData 'vn_engine.db'
$env:AGENTVN_LEGACY_DATABASE_PATHS=''
$env:AGENTVN_BACKEND_PORT=[string]$BackendPort
$env:AGENTVN_BACKEND_LOG=Join-Path $RunRoot 'installed-backend.log'
$env:AGENTVN_ERROR_LOG_DIR=Join-Path $RunRoot 'error_log'
$env:WEBVIEW2_USER_DATA_FOLDER=Join-Path $RunRoot 'webview'
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=$CdpPort"
$Backend=$null
$Editor=$null
try {
    $Backend=Start-Process -FilePath (Join-Path $InstallRoot 'creator-backend.exe') -WorkingDirectory $InstallRoot -WindowStyle Hidden -PassThru
    $Deadline=[DateTime]::UtcNow.AddSeconds(45)
    $Ready=$false
    while ([DateTime]::UtcNow -lt $Deadline) {
        if ($Backend.HasExited) {throw 'Owned installed backend exited before readiness.'}
        try {
            $Request=[Net.WebRequest]::Create("http://127.0.0.1:$BackendPort/api/health")
            $Request.Timeout=1000
            $Response=$Request.GetResponse()
            $Response.Close()
            $Ready=$true
            break
        } catch {Start-Sleep -Milliseconds 200}
    }
    if (-not $Ready) {throw 'Installed backend readiness timed out.'}
    $Editor=Start-Process -FilePath (Join-Path $InstallRoot 'agentvn-editor.exe') -WorkingDirectory $InstallRoot -WindowStyle Hidden -PassThru
    $State=[ordered]@{installRoot=$InstallRoot;editorPid=$Editor.Id;backendPid=$Backend.Id;
        databasePath=$env:DATABASE_PATH;webviewRoot=$env:WEBVIEW2_USER_DATA_FOLDER;
        cdpPort=$CdpPort;backendPort=$BackendPort;startedAt=[DateTime]::UtcNow.ToString('o')}
    [IO.File]::WriteAllText((Join-Path $RunRoot 'installed-processes.json'),($State|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
    $State|ConvertTo-Json
} catch {
    foreach ($Owned in @($Editor,$Backend)) {if ($Owned -and -not $Owned.HasExited) {& taskkill.exe /PID $Owned.Id /T /F|Out-Null}}
    throw
}
