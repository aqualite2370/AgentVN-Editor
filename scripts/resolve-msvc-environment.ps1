param(
  [string]$VsDevCmdPath = "",
  [switch]$Json
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

function Get-LinkerPath {
  $command = Get-Command link.exe -ErrorAction SilentlyContinue
  if ($command) { return [string]$command.Source }
  return ""
}

function Find-VsDevCmd {
  param([AllowEmptyString()][string]$ExplicitPath)
  foreach ($candidate in @(
    $ExplicitPath,
    [Environment]::GetEnvironmentVariable("AGENTVN_VSDEVCMD_PATH", "Process")
  )) {
    if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      return [System.IO.Path]::GetFullPath($candidate)
    }
  }

  $vswhereCandidates = New-Object System.Collections.Generic.List[string]
  foreach ($variable in @("ProgramFiles(x86)", "ProgramFiles")) {
    $root = [Environment]::GetEnvironmentVariable($variable, "Process")
    if (-not [string]::IsNullOrWhiteSpace($root)) {
      $vswhereCandidates.Add((Join-Path $root "Microsoft Visual Studio\Installer\vswhere.exe")) | Out-Null
    }
  }
  foreach ($vswhere in $vswhereCandidates | Select-Object -Unique) {
    if (-not (Test-Path -LiteralPath $vswhere -PathType Leaf)) { continue }
    $installationPath = (& $vswhere `
      -latest `
      -products "*" `
      -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
      -property installationPath 2>$null | Select-Object -First 1)
    if (-not [string]::IsNullOrWhiteSpace([string]$installationPath)) {
      $candidate = Join-Path ([string]$installationPath).Trim() "Common7\Tools\VsDevCmd.bat"
      if (Test-Path -LiteralPath $candidate -PathType Leaf) {
        return [System.IO.Path]::GetFullPath($candidate)
      }
    }
  }

  foreach ($root in @(
    [Environment]::GetEnvironmentVariable("ProgramFiles(x86)", "Process"),
    [Environment]::GetEnvironmentVariable("ProgramFiles", "Process")
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) {
    foreach ($edition in @("BuildTools", "Community", "Professional", "Enterprise")) {
      $candidate = Join-Path $root "Microsoft Visual Studio\2022\$edition\Common7\Tools\VsDevCmd.bat"
      if (Test-Path -LiteralPath $candidate -PathType Leaf) {
        return [System.IO.Path]::GetFullPath($candidate)
      }
    }
  }
  return ""
}

function Capture-VsEnvironment {
  param([Parameter(Mandatory = $true)][string]$DeveloperCommandPath)
  $commandLine = "call `"$DeveloperCommandPath`" -arch=x64 -host_arch=x64 >nul && set"
  $lines = & $env:ComSpec /d /s /c $commandLine
  if ($LASTEXITCODE -ne 0) {
    throw "VsDevCmd.bat failed with exit code $LASTEXITCODE."
  }
  $environment = [ordered]@{}
  foreach ($line in $lines) {
    if ($line -notmatch '^([^=][^=]*)=(.*)$') { continue }
    $environment[$Matches[1]] = $Matches[2]
  }
  return $environment
}

function Select-MsvcEnvironment {
  param([Parameter(Mandatory = $true)][System.Collections.IDictionary]$Environment)
  $selected = [ordered]@{}
  foreach ($name in @(
    "Path",
    "LIB",
    "INCLUDE",
    "LIBPATH",
    "VCToolsInstallDir",
    "VSINSTALLDIR",
    "VCINSTALLDIR",
    "WindowsSdkDir",
    "WindowsSDKVersion",
    "UniversalCRTSdkDir",
    "UCRTVersion",
    "ExtensionSdkDir",
    "FrameworkDir",
    "FrameworkVersion",
    "FrameworkVersion64"
  )) {
    if ($Environment.Contains($name) -and -not [string]::IsNullOrWhiteSpace([string]$Environment[$name])) {
      $selected[$name] = [string]$Environment[$name]
    }
  }
  return $selected
}

$result = try {
  $currentLinker = Get-LinkerPath
  if ($currentLinker -and -not [string]::IsNullOrWhiteSpace($env:LIB)) {
    $currentEnvironment = [ordered]@{}
    foreach ($entry in Get-ChildItem Env:) { $currentEnvironment[$entry.Name] = $entry.Value }
    [ordered]@{
      schemaVersion = 1
      status = "PASS"
      message = "MSVC linker environment is already active."
      linkPath = $currentLinker
      vsDevCmdPath = ""
      environment = Select-MsvcEnvironment -Environment $currentEnvironment
    }
  } else {
    $resolvedVsDevCmd = Find-VsDevCmd -ExplicitPath $VsDevCmdPath
    if ([string]::IsNullOrWhiteSpace($resolvedVsDevCmd)) {
      [ordered]@{
        schemaVersion = 1
        status = "BLOCKED"
        message = "Visual Studio C++ Build Tools with MSVC and a Windows SDK were not found."
        linkPath = ""
        vsDevCmdPath = ""
        environment = [ordered]@{}
      }
    } else {
      $captured = Capture-VsEnvironment -DeveloperCommandPath $resolvedVsDevCmd
      foreach ($entry in $captured.GetEnumerator()) {
        Set-Item -LiteralPath ("Env:\" + $entry.Key) -Value ([string]$entry.Value)
      }
      $resolvedLinker = Get-LinkerPath
      if ([string]::IsNullOrWhiteSpace($resolvedLinker) -or [string]::IsNullOrWhiteSpace($env:LIB)) {
        [ordered]@{
          schemaVersion = 1
          status = "BLOCKED"
          message = "VsDevCmd completed, but link.exe or the MSVC LIB environment is still unavailable."
          linkPath = $resolvedLinker
          vsDevCmdPath = $resolvedVsDevCmd
          environment = Select-MsvcEnvironment -Environment $captured
        }
      } else {
        [ordered]@{
          schemaVersion = 1
          status = "PASS"
          message = "Visual Studio C++ Build Tools environment is ready."
          linkPath = $resolvedLinker
          vsDevCmdPath = $resolvedVsDevCmd
          environment = Select-MsvcEnvironment -Environment $captured
        }
      }
    }
  }
} catch {
  [ordered]@{
    schemaVersion = 1
    status = "BLOCKED"
    message = $_.Exception.Message
    linkPath = ""
    vsDevCmdPath = $VsDevCmdPath
    environment = [ordered]@{}
  }
}

if ($Json) {
  $result | ConvertTo-Json -Depth 5 -Compress
} else {
  $result | ConvertTo-Json -Depth 5
}
