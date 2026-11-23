[CmdletBinding()]
param(
    [ValidateSet("127.0.0.1")][string]$BackendHost = "127.0.0.1",
    [ValidateRange(1, 65535)][int]$BackendPort = 8278,
    [ValidateSet("127.0.0.1", "localhost", "0.0.0.0")][string]$EditorHost = "127.0.0.1",
    [ValidateRange(1, 65535)][int]$EditorPort = 6767,
    [ValidateSet("127.0.0.1", "localhost", "0.0.0.0")][string]$RuntimeHost = "127.0.0.1",
    [ValidateRange(1, 65535)][int]$RuntimePort = 5174,
    [switch]$WithRuntime,
    [switch]$NoInstall,
    [switch]$PrepareOnly,
    [switch]$Hidden
)

$ErrorActionPreference = "Stop"
$Backend = Join-Path $PSScriptRoot "backend"
$Editor = Join-Path $PSScriptRoot "editor"
$Runtime = Join-Path $PSScriptRoot "GameCli_framework"
$BackendScript = Join-Path $PSScriptRoot "scripts\start-backend.ps1"
$npm = (Get-Command npm.cmd -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$uv = Get-Command uv -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
$python = if (-not $uv) {
    (Get-Command python -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
}

function Quote-PowerShell([string]$Value) {
    return "'" + $Value.Replace("'", "''") + "'"
}

function Start-DevService([string]$Name, [string]$Directory, [string]$Command) {
    $code = '$ErrorActionPreference = "Stop"; ' + $Command
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code))
    $windowStyle = if ($Hidden) { "Hidden" } else { "Normal" }
    $process = Start-Process -FilePath powershell.exe -WorkingDirectory $Directory -WindowStyle $windowStyle `
        -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encoded) -PassThru
    Write-Host "[AgentVN] $Name launcher PID: $($process.Id)"
    return $process
}

function Wait-DevService([string]$Name, [System.Diagnostics.Process]$Process, [string]$Url) {
    $deadline = [Diagnostics.Stopwatch]::StartNew()
    do {
        if ($Process.HasExited) {
            throw "$Name exited before startup (exit $($Process.ExitCode)). See the service window; rerun without -Hidden for details."
        }
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) { return }
        } catch {
            # The service may still be compiling or starting.
        }
        Start-Sleep -Milliseconds 300
    } while ($deadline.Elapsed.TotalSeconds -lt 120)
    throw "$Name did not become ready at $Url. See the service window; rerun without -Hidden for details."
}

foreach ($required in @($BackendScript, (Join-Path $Backend "pyproject.toml"),
        (Join-Path $PSScriptRoot "package-lock.json"), (Join-Path $Editor "package-lock.json"),
        (Join-Path $Runtime "package-lock.json"))) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Missing Dev source: $required" }
}
if (-not $PrepareOnly) {
    $ports = @($BackendPort, $EditorPort)
    if ($WithRuntime) { $ports += $RuntimePort }
    if (@($ports | Sort-Object -Unique).Count -ne $ports.Count) { throw "Dev service ports must be distinct." }
    $listeners = [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
    foreach ($port in $ports) {
        if ($listeners.Port -contains $port) { throw "Dev port $port is already in use. Stop the existing service or specify a different port." }
    }
}

# GameCLI preview consumes shared source, whose JSZip dependency resolves from the root.
foreach ($dependency in @(
        @{ Project = $PSScriptRoot; Marker = "node_modules\jszip\package.json" },
        @{ Project = $Runtime; Marker = "node_modules\.bin\vite.cmd" },
        @{ Project = $Editor; Marker = "node_modules\.bin\vite.cmd" })) {
    $project = $dependency.Project
    if (-not (Test-Path -LiteralPath (Join-Path $project $dependency.Marker) -PathType Leaf)) {
        if ($NoInstall) { throw "Missing npm dependencies in $project. Rerun without -NoInstall." }
        & $npm --prefix $project ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "npm ci failed in $project (exit $LASTEXITCODE)." }
    }
}
Push-Location $Backend
try {
    if ($uv -and -not $NoInstall) {
        $syncArgs = @("sync", "--extra", "dev")
        if (Test-Path -LiteralPath "uv.lock" -PathType Leaf) { $syncArgs += "--locked" }
        & $uv.Source @syncArgs
        if ($LASTEXITCODE -ne 0) { throw "Backend dependency setup failed (exit $LASTEXITCODE)." }
    }
    if (-not $uv) {
        & $python -c "import fastapi, uvicorn, pydantic_settings, openai, PIL, sqlite_vec, dotenv" 2>$null
        if ($LASTEXITCODE -ne 0) {
            if ($NoInstall) { throw "Missing Python dependencies. Rerun without -NoInstall." }
            & $python -m pip install -e ".[dev]"
            if ($LASTEXITCODE -ne 0) { throw "Backend dependency setup failed (exit $LASTEXITCODE)." }
        }
    }
} finally { Pop-Location }
if ($PrepareOnly) {
    Write-Host "[AgentVN] Dev dependencies are ready. No services were started."
    exit 0
}

$backendUrl = "http://127.0.0.1:$BackendPort"
$editorAddress = if ($EditorHost -eq "localhost") { "localhost" } else { "127.0.0.1" }
$runtimeAddress = if ($RuntimeHost -eq "localhost") { "localhost" } else { "127.0.0.1" }
$editorUrl = "http://${editorAddress}:$EditorPort"
$runtimeUrl = "http://${runtimeAddress}:$RuntimePort"
$services = @()
try {
    $backendProcess = Start-DevService "Backend" $Backend ('& {0} -BindHost {1} -Port {2} -NoDependencySync; exit $LASTEXITCODE' -f `
        (Quote-PowerShell $BackendScript), (Quote-PowerShell $BackendHost), $BackendPort)
    $services += $backendProcess
    Wait-DevService "Backend" $backendProcess "$backendUrl/api/health"
    $editorProcess = Start-DevService "Editor" $Editor ('$env:VITE_BACKEND_URL = {0}; & {1} run dev -- --host {2} --port {3} --strictPort; exit $LASTEXITCODE' -f `
        (Quote-PowerShell $backendUrl), (Quote-PowerShell $npm), (Quote-PowerShell $EditorHost), $EditorPort)
    $services += $editorProcess
    if ($WithRuntime) {
        $runtimeProcess = Start-DevService "Runtime" $Runtime ('& {0} run dev -- --host {1} --port {2} --strictPort; exit $LASTEXITCODE' -f `
            (Quote-PowerShell $npm), (Quote-PowerShell $RuntimeHost), $RuntimePort)
        $services += $runtimeProcess
        Wait-DevService "Runtime" $runtimeProcess $runtimeUrl
    }
    Wait-DevService "Editor" $editorProcess $editorUrl
} catch {
    foreach ($service in $services) {
        if (-not $service.HasExited) { & taskkill.exe /PID $service.Id /T /F | Out-Host }
    }
    throw
}
Write-Host "[AgentVN] Backend: $backendUrl/api/health"
Write-Host "[AgentVN] Editor: $editorUrl"
if ($WithRuntime) { Write-Host "[AgentVN] Runtime: $runtimeUrl" }
