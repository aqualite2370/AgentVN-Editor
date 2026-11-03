param(
    [Parameter(Mandatory=$true)][string]$RunRoot,
    [Parameter(Mandatory=$true)][string]$ResourceReport
)
$ErrorActionPreference = 'Stop'
$RunRoot = [IO.Path]::GetFullPath($RunRoot)
if (Test-Path -LiteralPath $RunRoot) { throw "Acceptance directory already exists: $RunRoot" }
New-Item -ItemType Directory -Path $RunRoot | Out-Null
$Resources = Get-Content -LiteralPath $ResourceReport -Raw -Encoding UTF8 | ConvertFrom-Json
if ($Resources.status -ne 'PASS') { throw 'Installer resources must pass before installation.' }
$InstallerEntries = @($Resources.installers | Where-Object { $_.path -like '*_x64-setup.exe' })
if ($InstallerEntries.Count -eq 0 -and $Resources.installerFormat -eq 'nsis') {
    # Current EXE-only release names are versioned by package-installers.bat
    # (for example AgentVN_Editor_v1.9.28_20261026_022558.exe). The payload
    # audit has already established that the report contains exactly one
    # verified NSIS installer, so accept that explicit path rather than
    # imposing the retired Tauri bundle filename convention.
    $InstallerEntries = @($Resources.installers)
}
if ($InstallerEntries.Count -ne 1) { throw 'Expected exactly one verified NSIS installer.' }
$Installer = $InstallerEntries[0]
if ((Get-FileHash -LiteralPath $Installer.path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Installer.sha256) {
    throw 'Installer bytes changed after resource verification.'
}
# The shipped hook kills these process names; refuse to affect unrelated sessions.
$Running = Get-Process -Name 'agentvn-editor','creator-backend','AgentVN Editor' -ErrorAction SilentlyContinue
if ($Running) { throw 'An existing Editor/backend is running; isolated installation cannot own the hook targets.' }
$InstallRoot = Join-Path $RunRoot 'installed-nsis'
$Keys = @(
    'HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentVN Editor',
    'HKEY_CURRENT_USER\Software\agentvn\AgentVN Editor'
)
$Saved = @()
$Report = [ordered]@{ status='RUNNING'; startedAt=[DateTime]::UtcNow.ToString('o');
    installer=$Installer; installRoot=$InstallRoot; registryRestored=$false }
try {
    for ($Index=0; $Index -lt $Keys.Count; $Index++) {
        $Key = $Keys[$Index]
        $Exists = Test-Path -LiteralPath ('Registry::'+$Key)
        $Backup = Join-Path $RunRoot "registry-before-$Index.reg"
        if ($Exists) {
            & reg.exe export $Key $Backup /y | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "Cannot preserve registry key: $Key" }
        }
        $Saved += [pscustomobject]@{ key=$Key; existed=$Exists; backup=$Backup }
    }
    # /UPDATE bypasses the old uninstall flow; /NS suppresses shortcuts. /D must be last.
    $Process = Start-Process -FilePath $Installer.path -ArgumentList @('/S','/NS','/UPDATE',"/D=$InstallRoot") -WindowStyle Hidden -PassThru
    $Report.installerPid = $Process.Id
    $Process.WaitForExit()
    $Report.exitCode = $Process.ExitCode
    if ($Process.ExitCode -ne 0) { throw "NSIS exited $($Process.ExitCode)" }
    foreach ($Name in @('agentvn-editor.exe','creator-backend.exe','agentvn-player.exe','build-versions.json','uninstall.exe')) {
        if (-not (Test-Path -LiteralPath (Join-Path $InstallRoot $Name) -PathType Leaf)) { throw "Installed file missing: $Name" }
    }
    $Payload = @($Resources.deployments | Where-Object { $_.kind -eq 'NSIS actual payload' })[0]
    if (-not $Payload) { throw 'Verified NSIS payload is missing.' }
    $InstalledHash = (Get-FileHash -LiteralPath (Join-Path $InstallRoot 'agentvn-editor.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($InstalledHash -ne $Payload.executable.sha256) { throw 'Actual installed executable differs from NSIS payload.' }
    $Report.executable = [ordered]@{path=(Join-Path $InstallRoot 'agentvn-editor.exe');sha256=$InstalledHash}
    $Report.status = 'PASS'
} catch {
    $Report.status = 'FAILED'
    $Report.error = $_.Exception.Message
    throw
} finally {
    foreach ($Entry in $Saved) {
        # Exact scoped keys only; original data is already recoverable in .reg files.
        if (Test-Path -LiteralPath ('Registry::'+$Entry.key)) {
            Remove-Item -LiteralPath ('Registry::'+$Entry.key) -Recurse -Force
        }
        if ($Entry.existed) {
            & reg.exe import $Entry.backup | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "Restore failed; preserved backup: $($Entry.backup)" }
        }
    }
    $Report.registryRestored = $true
    $Report.finishedAt = [DateTime]::UtcNow.ToString('o')
    [IO.File]::WriteAllText((Join-Path $RunRoot 'actual-installation.json'), ($Report|ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
    if ($Report.status -eq 'PASS') {
        $Deployment = [pscustomobject]@{kind='NSIS actual isolated installation';installedRoot=$InstallRoot;
            executable=$Report.executable;installationReport=(Join-Path $RunRoot 'actual-installation.json')}
        $Resources.deployments = @($Resources.deployments)+@($Deployment)
        [IO.File]::WriteAllText((Join-Path $RunRoot 'installer-resource-report.json'), ($Resources|ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
    }
}
$Report|ConvertTo-Json -Depth 8
