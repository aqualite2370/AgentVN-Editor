param(
    [string]$OutputDir = "releases\player-shell"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$ProjectDir = Join-Path $Root "GameCli_framework"
$ResolvedOutput = Join-Path $Root $OutputDir
$ReleaseExe = Join-Path $ProjectDir "src-tauri\target\release\agentvn-player.exe"
$EditorPlayerResource = Join-Path $Root "editor\src-tauri\binaries\agentvn-player.exe"

function Assert-PathInside {
    param(
        [string]$Path,
        [string]$Parent
    )
    $FullPath = [System.IO.Path]::GetFullPath($Path)
    $FullParent = [System.IO.Path]::GetFullPath($Parent).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    if (-not $FullPath.StartsWith($FullParent + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify path outside expected directory. Path=$FullPath Parent=$FullParent"
    }
}

function Get-ExecutableProcessHint {
    param(
        [string]$Path
    )

    $FullPath = [System.IO.Path]::GetFullPath($Path)
    try {
        $Matches = Get-CimInstance Win32_Process -ErrorAction Stop |
            Where-Object {
                $_.ExecutablePath -and [System.String]::Equals($_.ExecutablePath, $FullPath, [System.StringComparison]::OrdinalIgnoreCase)
            } |
            Select-Object ProcessId, Name, ExecutablePath
    }
    catch {
        return @("Could not inspect running processes: $($_.Exception.Message)")
    }

    if (-not $Matches) {
        return @()
    }

    return $Matches | ForEach-Object {
        "Close process PID $($_.ProcessId) ($($_.Name)): $($_.ExecutablePath)"
    }
}

function Remove-PreviousReleaseExe {
    param(
        [string]$Path
    )

    Assert-PathInside -Path $Path -Parent (Join-Path $ProjectDir "src-tauri\target")
    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    $FullPath = [System.IO.Path]::GetFullPath($Path)
    $LastError = $null
    for ($Attempt = 1; $Attempt -le 5; $Attempt++) {
        try {
            Remove-Item -LiteralPath $Path -Force -ErrorAction Stop
            return
        }
        catch {
            $LastError = $_
            Start-Sleep -Milliseconds (250 * $Attempt)
        }
    }

    $ProcessHints = @(Get-ExecutableProcessHint -Path $FullPath)
    if ($ProcessHints.Count -eq 0) {
        $ProcessHints = @("No running process was found with that exact path. Close any AgentVN Player windows, wait a few seconds for antivirus or indexing to release the file, then retry.")
    }

    $Message = @(
        "Unable to remove previous GameCLI player executable before build."
        "Path: $FullPath"
        "Windows reported: $($LastError.Exception.Message)"
        $ProcessHints
    ) -join [Environment]::NewLine
    throw $Message
}

$LibraryConfigPath = Join-Path ([System.IO.Path]::GetTempPath()) ("AgentVN-library-" + [Guid]::NewGuid().ToString("N") + ".json")
Push-Location $ProjectDir
try {
    # A previous standalone export can leave its identity/resources in the
    # source config. Override the effective build only; never edit that file
    # or read/copy its embedded cartridge while building the preview library.
    $CargoText = Get-Content -LiteralPath (Join-Path $ProjectDir "src-tauri\Cargo.toml") -Raw -Encoding UTF8
    $PackageSection = [regex]::Match($CargoText, '(?ms)^\[package\]\s*(.*?)(?=^\[|\z)').Groups[1].Value
    $LibraryVersion = [regex]::Match($PackageSection, '(?m)^version\s*=\s*"([^"]+)"').Groups[1].Value
    if ([string]::IsNullOrWhiteSpace($LibraryVersion)) {
        throw "Cannot determine the GameCLI library package version."
    }
    $LibraryConfig = @{
        productName = "AgentVN Player"
        version = $LibraryVersion
        identifier = "com.agentvn.player"
        build = @{ beforeBuildCommand = "" }
        app = @{ windows = @(@{
            title = "AgentVN Player"
            width = 1280; height = 720; minWidth = 960; minHeight = 540
            fullscreen = $true; maximized = $false; resizable = $false
            maximizable = $false; minimizable = $false; decorations = $false
        }) }
        # Tauri uses JSON Merge Patch: [] replaces the inherited map, whereas
        # an empty object would leave every user resource mapping in place.
        bundle = @{ resources = @() }
    }
    [System.IO.File]::WriteAllText($LibraryConfigPath,
        ($LibraryConfig | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding($false)))
    # The Rust side is locked to the Tauri versions in package-lock.json.
    # `npm install` is unsafe here because the manifest uses compatible ranges
    # and can silently replace the JS Tauri packages with a newer minor
    # version than the Rust crates used by this build.
    npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
        throw "npm ci failed while preparing GameCLI player shell."
    }
    New-Item -ItemType Directory -Force -Path "public" | Out-Null
    $LibraryModePath = Join-Path $ProjectDir "public\runtime-mode.json"
    $LibraryModeText = "{ `"mode`": `"library`" }`n"
    # Avoid truncating an unchanged file that another reader has memory-mapped.
    # A genuinely different mode must still be written successfully.
    if (-not [System.IO.File]::Exists($LibraryModePath) -or
        [System.IO.File]::ReadAllText($LibraryModePath) -cne $LibraryModeText) {
        [System.IO.File]::WriteAllText(
            $LibraryModePath,
            $LibraryModeText,
            (New-Object System.Text.UTF8Encoding($false))
        )
    }
    Remove-Item -LiteralPath "public\fixed-only.json" -Force -ErrorAction SilentlyContinue
    $EmbeddedDir = Join-Path $ProjectDir "public\embedded-cartridge"
    Assert-PathInside -Path $EmbeddedDir -Parent (Join-Path $ProjectDir "public")
    if (Test-Path -LiteralPath $EmbeddedDir) {
        Remove-Item -LiteralPath $EmbeddedDir -Recurse -Force
    }
    Remove-PreviousReleaseExe -Path $ReleaseExe
    # Build after staging library mode: a previous standalone build may have
    # left a fixed-mode dist, while the shared Tauri build hook may be empty.
    npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "npm run build failed while preparing the GameCLI library frontend."
    }
    npm run tauri build -- --no-bundle --config $LibraryConfigPath
    if ($LASTEXITCODE -ne 0) {
        throw "npm run tauri build -- --no-bundle failed while building GameCLI player shell."
    }
}
finally {
    Pop-Location
    if (Test-Path -LiteralPath $LibraryConfigPath) {
        Remove-Item -LiteralPath $LibraryConfigPath -Force -ErrorAction Stop
    }
}

New-Item -ItemType Directory -Force -Path $ResolvedOutput | Out-Null
$Exe = $ReleaseExe
if (-not (Test-Path $Exe)) {
    throw "GameCLI 构建产物不存在（agentvn-player.exe）：原因：构建结束后没有找到预期的播放器可执行文件。影响：无法复制 GameCLI 容器。解决方案：请查看上方 npm/Tauri 构建输出并修复错误。路径：$Exe"
}

& (Join-Path $PSScriptRoot "assert-windows-gui-subsystem.ps1") -Path $Exe
Copy-Item -LiteralPath $Exe -Destination (Join-Path $ResolvedOutput "AgentVN Player.exe") -Force
Assert-PathInside -Path $EditorPlayerResource -Parent $Root
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $EditorPlayerResource) | Out-Null
Copy-Item -LiteralPath $Exe -Destination $EditorPlayerResource -Force
Write-Host "[AgentVN] Game shell copied to $ResolvedOutput\AgentVN Player.exe" -ForegroundColor Green
Write-Host "[AgentVN] Editor preview player updated: $EditorPlayerResource" -ForegroundColor Green
