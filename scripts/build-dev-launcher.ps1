param([switch]$SkipGameCliPlayer)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$EditorSrcTauri = Join-Path $Root "editor\src-tauri"
$OutputBinary = Join-Path $Root "AgentVN Dev.exe"
$CargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
$PlayerResource = Join-Path $EditorSrcTauri "binaries\agentvn-player.exe"

if ((Test-Path $CargoBin) -and ($env:Path -notlike "*$CargoBin*")) {
    $env:Path = "$CargoBin;$env:Path"
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw "缺少 Rust 构建工具（cargo）：原因：当前系统没有找到 cargo 命令。影响：无法重新编译 AgentVN Dev.exe。解决方案：请先安装 Rustup：winget install Rustlang.Rustup"
}

$vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vsWhere) {
    $vsPath = & $vsWhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ($vsPath) {
        $vsDevCmd = Join-Path $vsPath "Common7\Tools\VsDevCmd.bat"
        if (Test-Path $vsDevCmd) {
            Write-Host "[AgentVN] Loading Visual Studio C++ build environment..." -ForegroundColor Cyan
            $envBlock = & cmd.exe /c "call `"$vsDevCmd`" -arch=x64 >nul 2>&1 && set"
            foreach ($line in $envBlock -split "`r`n") {
                if ($line -match "^(.*?)=(.*)$") {
                    [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
                }
            }
        }
    }
}

$env:PATH = "$CargoBin;$env:PATH"

if ($SkipGameCliPlayer) {
    if (-not (Test-Path -LiteralPath $PlayerResource -PathType Leaf)) {
        throw "Editor-only build requires an existing preview player: $PlayerResource"
    }
    Write-Host "[AgentVN] Editor-only build: reusing existing native preview player." -ForegroundColor Cyan
} else {
    Write-Host "[AgentVN] Rebuilding GameCLI player resource for preview protocol compatibility..." -ForegroundColor Cyan
    & (Join-Path $PSScriptRoot "build-game-shell-windows.ps1")
    if ($LASTEXITCODE -ne 0) { throw "GameCLI preview player build failed." }
    $BuiltPlayer = Join-Path $Root "GameCli_framework\src-tauri\target\release\agentvn-player.exe"
    if (-not (Test-Path -LiteralPath $BuiltPlayer)) {
        throw "GameCLI player executable was not found after build: $BuiltPlayer"
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $PlayerResource) | Out-Null
    Copy-Item -LiteralPath $BuiltPlayer -Destination $PlayerResource -Force
}

Write-Host "[AgentVN] Refreshing bundled standalone build resources..." -ForegroundColor Cyan
& powershell.exe `
    -NoProfile `
    -ExecutionPolicy Bypass `
    -File (Join-Path $PSScriptRoot "prepare-editor-runtime-resources.ps1") `
    -SkipGameCliPlayer
if ($LASTEXITCODE -ne 0) {
    throw "独立包资源准备失败：无法使用过期的 bundled workspace 继续编译 AgentVN Dev.exe。"
}

Write-Host "[AgentVN] Building dev container from $EditorSrcTauri..." -ForegroundColor Cyan

Push-Location $EditorSrcTauri
try {
    cargo build
    if ($LASTEXITCODE -ne 0) {
        throw "桌面壳编译失败（cargo build）：原因：Rust/Tauri 构建返回失败。影响：无法重新生成 AgentVN Dev.exe。解决方案：请查看上方 cargo 输出并修复编译错误。"
    }
}
finally {
    Pop-Location
}

$debugBinary = Join-Path $EditorSrcTauri "target\debug\agentvn-editor.exe"
if (-not (Test-Path $debugBinary)) {
    throw "构建产物不存在（debug executable）：原因：cargo build 没有生成预期的调试版可执行文件。影响：无法替换根目录 AgentVN Dev.exe。解决方案：请查看上方 cargo 输出并修复编译错误。路径：$debugBinary"
}

& (Join-Path $PSScriptRoot "assert-windows-gui-subsystem.ps1") -Path $debugBinary

try {
    Copy-Item $debugBinary $OutputBinary -Force
    Write-Host "[AgentVN] Dev container built: $OutputBinary" -ForegroundColor Green
}
catch {
    $PendingBinary = Join-Path $Root "AgentVN Dev.pending.exe"
    Copy-Item $debugBinary $PendingBinary -Force
    Write-Host "[AgentVN] 根目录 AgentVN Dev.exe 正在运行，Windows 暂时无法覆盖。" -ForegroundColor Yellow
    $RunningProcessIds = @(
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object { $_.ExecutablePath -and [System.IO.Path]::GetFullPath($_.ExecutablePath) -eq [System.IO.Path]::GetFullPath($OutputBinary) } |
            Select-Object -ExpandProperty ProcessId
    )
    if ($RunningProcessIds.Count -gt 0) {
        $ExistingReplacement = @(
            Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
                Where-Object {
                    $_.CommandLine -like "*$PendingBinary*" -and
                    $_.CommandLine -like "*$OutputBinary*"
                }
        )
        if ($ExistingReplacement.Count -eq 0) {
            $IdList = ($RunningProcessIds -join ",")
            $ReplaceScript = @"
Wait-Process -Id $IdList -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 400
Copy-Item -LiteralPath '$($PendingBinary.Replace("'", "''"))' -Destination '$($OutputBinary.Replace("'", "''"))' -Force
Remove-Item -LiteralPath '$($PendingBinary.Replace("'", "''"))' -Force -ErrorAction SilentlyContinue
"@
            Start-Process powershell.exe `
                -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", $ReplaceScript `
                -WindowStyle Hidden
        }
        Write-Host "[AgentVN] 已安排关闭当前编辑器后自动替换：$OutputBinary" -ForegroundColor Green
    } else {
        Write-Host "[AgentVN] 已输出待替换文件：$PendingBinary" -ForegroundColor Yellow
    }
}
