param(
    [int]$Port = 9477,
    [string]$OutputExe = "output\test-editor-cdp\agentvn-editor.exe"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$ProjectDir = Join-Path $Root "editor"
$ConfigPath = Join-Path $ProjectDir "src-tauri\tauri.conf.json"
$TempConfig = Join-Path $ProjectDir "src-tauri\tauri.cdp-test.$Port.conf.json"
$OutputPath = Join-Path $Root $OutputExe

$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$config.app.windows[0] | Add-Member -NotePropertyName additionalBrowserArgs -NotePropertyValue "--remote-debugging-port=$Port --remote-allow-origins=*" -Force
# The Tauri CLI exposes the selected config through TAURI_CONFIG. If the
# regular beforeBuildCommand is kept here, prepare:runtime-resources starts a
# nested GameCLI Tauri build which then inherits the Editor config and tries to
# resolve Editor-only resources from the GameCLI directory. The CDP harness
# only needs to rebuild the desktop host after the normal Dev build has already
# produced the frontend and runtime resources, so avoid that nested build.
$config.build.beforeBuildCommand = ""
$config | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $TempConfig -Encoding UTF8
try {
    Push-Location $ProjectDir
    npm run tauri build -- --no-bundle --config $TempConfig
    if ($LASTEXITCODE -ne 0) { throw "Editor CDP test build failed." }
} finally {
    Pop-Location
    Remove-Item -LiteralPath $TempConfig -Force -ErrorAction SilentlyContinue
}

$ReleaseExe = Join-Path $ProjectDir "src-tauri\target\release\agentvn-editor.exe"
if (-not (Test-Path -LiteralPath $ReleaseExe)) { throw "Missing release editor after CDP test build." }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputPath) | Out-Null
Copy-Item -LiteralPath $ReleaseExe -Destination $OutputPath -Force
Write-Output "AgentVN CDP test editor: $OutputPath (port $Port)"
