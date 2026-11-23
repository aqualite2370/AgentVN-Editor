param(
    [switch]$SkipGameCliPlayer
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$EditorDir = Join-Path $Root "editor"
$TauriDir = Join-Path $EditorDir "src-tauri"
$PlayerResource = Join-Path $TauriDir "binaries\agentvn-player.exe"
$BundleWorkspace = Join-Path $TauriDir "bundle-workspace"
$BundledScriptManifest = Join-Path $Root "scripts\standalone-build-scripts.json"
$WindowsOfflineToolsSource = Join-Path $Root "windows-offline-tools"

function Assert-PreparedRuntimeResources {
    $Config = Get-Content -LiteralPath (Join-Path $TauriDir "tauri.conf.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    $VersionPath = Join-Path $BundleWorkspace "build-versions.json"
    $Versions = Get-Content -LiteralPath $VersionPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace($Config.version) -or $Versions.editorVersion -cne $Config.version) {
        throw "EDITOR_BUILD_VERSION_MISMATCH: $VersionPath expected=$($Config.version) actual=$($Versions.editorVersion)"
    }
    foreach ($RelativePath in @(
        "GameCli_framework\package.json",
        "GameCli_framework\src-tauri\src\lib.rs",
        "GameCli_framework\node_modules\lucide-react\dist\cjs\lucide-react.js",
        "GameCli_framework\node_modules\lucide-react\dist\lucide-react.d.ts",
        "GameCli_framework\node_modules\sharp\dist\index.cjs",
        "shared\cartridge\types.ts",
        "windows-offline-tools\NSIS\makensis.exe",
        "windows-offline-tools\NSIS\Bin\makensis.exe",
        "windows-offline-tools\NSIS\Include\MUI2.nsh",
        "windows-offline-tools\NSIS\Plugins\x86-unicode\additional\nsis_tauri_utils.dll"
    )) {
        $RequiredPath = Join-Path $BundleWorkspace $RelativePath
        if (-not (Test-Path -LiteralPath $RequiredPath -PathType Leaf)) {
            throw "Prepared runtime resource is missing: $RequiredPath"
        }
    }
    foreach ($Name in Get-BundledBuildScriptNames) {
        $Source = Join-Path $Root "scripts\$Name"
        $Bundled = Join-Path $BundleWorkspace "scripts\$Name"
        $Hasher = [Security.Cryptography.SHA256]::Create()
        try {
            $SourceHash = [Convert]::ToBase64String($Hasher.ComputeHash([IO.File]::ReadAllBytes($Source)))
            $BundledHash = [Convert]::ToBase64String($Hasher.ComputeHash([IO.File]::ReadAllBytes($Bundled)))
            if ($SourceHash -cne $BundledHash) { throw "Prepared build helper is stale: $Bundled" }
        } finally {
            $Hasher.Dispose()
        }
    }
    Assert-PlayerExecutableLogContract -ExecutablePath $PlayerResource
}

function Get-BundledBuildScriptNames {
    if (-not (Test-Path -LiteralPath $BundledScriptManifest -PathType Leaf)) {
        throw "Missing bundled build script manifest: $BundledScriptManifest"
    }
    $bytes = [System.IO.File]::ReadAllBytes($BundledScriptManifest)
    try {
        $text = (New-Object System.Text.UTF8Encoding($false, $true)).
            GetString($bytes).
            TrimStart([char]0xFEFF)
        $manifest = $text | ConvertFrom-Json
    }
    catch {
        throw "Bundled build script manifest must be strict UTF-8 JSON: $BundledScriptManifest / $($_.Exception.Message)"
    }
    $names = @($manifest.scripts)
    if ([int]$manifest.schemaVersion -ne 1 -or $names.Count -eq 0) {
        throw "Bundled build script manifest is invalid: $BundledScriptManifest"
    }
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($name in $names) {
        $value = [string]$name
        if (
            [string]::IsNullOrWhiteSpace($value) -or
            [System.IO.Path]::GetFileName($value) -ne $value -or
            -not $seen.Add($value)
        ) {
            throw "Bundled build script manifest contains an unsafe or duplicate entry: $value"
        }
    }
    return $names
}

function Assert-PathInside {
    param(
        [string]$Path,
        [string]$Parent
    )

    $FullPath = [System.IO.Path]::GetFullPath($Path)
    $FullParent = [System.IO.Path]::GetFullPath($Parent).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    if (-not $FullPath.StartsWith(
        $FullParent + [System.IO.Path]::DirectorySeparatorChar,
        [System.StringComparison]::OrdinalIgnoreCase
    )) {
        throw "Refusing to modify path outside expected directory. Path=$FullPath Parent=$FullParent"
    }
}

function Copy-DirectoryFiltered {
    param(
        [string]$Source,
        [string]$Destination,
        [string[]]$ExcludedDirectoryNames = @()
    )

    if (-not (Test-Path -LiteralPath $Source)) {
        throw "Missing source directory: $Source"
    }

    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    foreach ($Item in Get-ChildItem -LiteralPath $Source -Force) {
        $Target = Join-Path $Destination $Item.Name
        if ($Item.PSIsContainer) {
            if ($ExcludedDirectoryNames -contains $Item.Name) {
                continue
            }
            Copy-DirectoryFiltered `
                -Source $Item.FullName `
                -Destination $Target `
                -ExcludedDirectoryNames $ExcludedDirectoryNames
        } else {
            # Never ship development-session traces in the user installer.
            # In particular, .codex-vite-*.log files can contain workspace
            # paths, commands, and browser diagnostics from a local session.
            if (
                $Item.Name -match '(?i)^\.codex.*\.log$' -or
                $Item.Name -match '(?i)codexlog' -or
                $Item.Name -match '(?i)^packageinstaller(s)?\.bat$'
            ) {
                continue
            }
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Target) | Out-Null
            Copy-Item -LiteralPath $Item.FullName -Destination $Target -Force
        }
    }
}

function Assert-PlayerLogContractText {
    param(
        [string]$Content,
        [string]$SourceLabel
    )

    if (-not $Content.Contains("player-desktop.log") -or -not $Content.Contains("player-frontend.log")) {
        throw "Bundled player does not contain the current error log names: $SourceLabel"
    }
    if ($Content.Contains("player.log")) {
        throw "Bundled player still contains the retired player.log path: $SourceLabel"
    }
}

function Assert-PlayerExecutableLogContract {
    param([string]$ExecutablePath)

    if (-not (Test-Path -LiteralPath $ExecutablePath)) {
        throw "Cannot inspect missing player executable: $ExecutablePath"
    }
    $BinaryText = [System.Text.Encoding]::UTF8.GetString(
        [System.IO.File]::ReadAllBytes($ExecutablePath)
    )
    Assert-PlayerLogContractText -Content $BinaryText -SourceLabel $ExecutablePath
}

function Prepare-GameCliPlayer {
    if ($SkipGameCliPlayer) {
        Assert-PlayerExecutableLogContract -ExecutablePath $PlayerResource
        Write-Host "[AgentVN] Reusing existing GameCLI preview player: $PlayerResource" -ForegroundColor DarkGray
        return
    }

    & (Join-Path $PSScriptRoot "build-game-shell-windows.ps1")
    if ($LASTEXITCODE -ne 0) {
        throw "GameCLI preview player build failed."
    }
    Assert-PlayerExecutableLogContract -ExecutablePath $PlayerResource
}

function Prepare-BundledWindowsTools {
    $Source = Join-Path $WindowsOfflineToolsSource "NSIS"
    $Destination = Join-Path $BundleWorkspace "windows-offline-tools\NSIS"
    foreach ($RequiredFile in @(
        "makensis.exe",
        "Bin\makensis.exe",
        "Include\MUI2.nsh",
        "Plugins\x86-unicode\additional\nsis_tauri_utils.dll"
    )) {
        $RequiredPath = Join-Path $Source $RequiredFile
        if (-not (Test-Path -LiteralPath $RequiredPath -PathType Leaf)) {
            throw "Bundled Windows NSIS toolset is incomplete: $RequiredPath"
        }
    }
    Copy-DirectoryFiltered -Source $Source -Destination $Destination
}

function Prepare-BundledBuildWorkspace {
    Assert-PathInside -Path $BundleWorkspace -Parent $TauriDir
    if (Test-Path -LiteralPath $BundleWorkspace) {
        Remove-Item -LiteralPath $BundleWorkspace -Recurse -Force
    }

    $ScriptsTarget = Join-Path $BundleWorkspace "scripts"
    New-Item -ItemType Directory -Force -Path $ScriptsTarget | Out-Null
    $EditorVersion = (Get-Content -LiteralPath (Join-Path $Root "editor\src-tauri\tauri.conf.json") -Raw -Encoding UTF8 | ConvertFrom-Json).version
    if ([string]::IsNullOrWhiteSpace($EditorVersion)) {
        throw "Editor version must not be empty."
    }
    [IO.File]::WriteAllText((Join-Path $BundleWorkspace "build-versions.json"), (@{ editorVersion = $EditorVersion } | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
    foreach ($ScriptName in Get-BundledBuildScriptNames) {
        $ScriptPath = Join-Path $Root "scripts\$ScriptName"
        if (-not (Test-Path -LiteralPath $ScriptPath)) {
            throw "Missing required bundled build script: $ScriptPath"
        }
        Copy-Item -LiteralPath $ScriptPath -Destination (Join-Path $ScriptsTarget $ScriptName) -Force
    }

    $RuntimeSource = Join-Path $Root "GameCli_framework"
    $RuntimeTarget = Join-Path $BundleWorkspace "GameCli_framework"
    Copy-DirectoryFiltered `
        -Source $RuntimeSource `
        -Destination $RuntimeTarget `
        -ExcludedDirectoryNames @(
            "node_modules",
            "dist",
            "target",
            "gen",
            ".git",
            ".gradle",
            "build",
            "embedded-cartridge"
        )

    # Runtime dependencies contain their own required dist/build directories
    # (for example lucide-react/dist and sharp/dist). Copy node_modules in a
    # separate pass so workspace-output filters cannot strip package contents.
    Copy-DirectoryFiltered `
        -Source (Join-Path $RuntimeSource "node_modules") `
        -Destination (Join-Path $RuntimeTarget "node_modules") `
        -ExcludedDirectoryNames @(".vite", ".vite-temp")

    foreach ($RequiredDependencyFile in @(
        "node_modules\lucide-react\dist\cjs\lucide-react.js",
        "node_modules\lucide-react\dist\lucide-react.d.ts",
        "node_modules\sharp\dist\index.cjs"
    )) {
        $RequiredPath = Join-Path $RuntimeTarget $RequiredDependencyFile
        if (-not (Test-Path -LiteralPath $RequiredPath -PathType Leaf)) {
            throw "Bundled standalone build dependency is incomplete: $RequiredPath"
        }
    }

    $BundledRuntimePublic = Join-Path $BundleWorkspace "GameCli_framework\public"
    Remove-Item -LiteralPath (Join-Path $BundledRuntimePublic "runtime-mode.json") -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $BundledRuntimePublic "fixed-only.json") -Force -ErrorAction SilentlyContinue

    Copy-DirectoryFiltered `
        -Source (Join-Path $Root "shared") `
        -Destination (Join-Path $BundleWorkspace "shared") `
        -ExcludedDirectoryNames @("node_modules", "dist", "target", ".git")

    Prepare-BundledWindowsTools

    $BundledPlayerHost = Join-Path $BundleWorkspace "GameCli_framework\src-tauri\src\lib.rs"
    if (-not (Test-Path -LiteralPath $BundledPlayerHost)) {
        throw "Bundled player host source is missing: $BundledPlayerHost"
    }
    $BundledPlayerHostContent = Get-Content -LiteralPath $BundledPlayerHost -Raw -Encoding UTF8
    Assert-PlayerLogContractText -Content $BundledPlayerHostContent -SourceLabel $BundledPlayerHost
    Write-Host "[AgentVN] Refreshed editor standalone build workspace: $BundleWorkspace" -ForegroundColor Green
}

if ($env:AGENTVN_EDITOR_RUNTIME_RESOURCES_PREPARED -eq "1") {
    Assert-PreparedRuntimeResources
    Write-Host "[AgentVN] Validated previously prepared editor runtime resources." -ForegroundColor DarkGray
} else {
    Prepare-GameCliPlayer
    Prepare-BundledBuildWorkspace
    Assert-PreparedRuntimeResources
}
