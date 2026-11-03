param(
    [int]$Port = 9341,
    [string]$OutputExe = "output\test-player-cdp\agentvn-player.exe"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$ProjectDir = Join-Path $Root "GameCli_framework"
$ConfigPath = Join-Path $ProjectDir "src-tauri\tauri.conf.json"
$TempConfig = Join-Path $ProjectDir "src-tauri\tauri.cdp-test.$Port.conf.json"
$OutputPath = Join-Path $Root $OutputExe

$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$config.app.windows[0] | Add-Member -NotePropertyName additionalBrowserArgs -NotePropertyValue "--remote-debugging-port=$Port --remote-allow-origins=*" -Force
$config | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $TempConfig -Encoding UTF8
try {
    Push-Location $ProjectDir
    npm run tauri build -- --no-bundle --config $TempConfig
    if ($LASTEXITCODE -ne 0) { throw "GameCLI CDP test build failed." }
} finally {
    Pop-Location
    Remove-Item -LiteralPath $TempConfig -Force -ErrorAction SilentlyContinue
}

$ReleaseExe = Join-Path $ProjectDir "src-tauri\target\release\agentvn-player.exe"
if (-not (Test-Path -LiteralPath $ReleaseExe)) { throw "Missing release player after CDP test build." }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputPath) | Out-Null
Copy-Item -LiteralPath $ReleaseExe -Destination $OutputPath -Force
Write-Output "GameCLI CDP test player: $OutputPath (port $Port)"
