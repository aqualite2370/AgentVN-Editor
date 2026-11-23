param(
  [switch]$Install,
  [switch]$Json,
  [string]$ReportPath = "",
  [string]$SymlinkProbeRoot = "",
  [string]$ToolRoot = "",
  [string]$SdkRoot = "",
  [string]$JdkRoot = "",
  [string]$ApiLevel = "36",
  [string]$BuildToolsVersion = "36.0.0",
  [string]$NdkVersion = "27.2.12479018",
  [string]$PassCachePath = "",
  [string]$OfflinePackRoot = "",
  [switch]$NoPersistEnv,
  [switch]$DesktopOnly,
  [switch]$ProbeOnly,
  [switch]$UseCachedPass,
  [switch]$OfflineOnly,
  [switch]$ReplaceOfflinePack,
  [switch]$ResetManagedEnvironment
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$DefaultToolRoot = Join-Path $env:LOCALAPPDATA "AgentVN\AndroidToolchain"
if (-not $ToolRoot) { $ToolRoot = $DefaultToolRoot }
if (-not $SdkRoot) { $SdkRoot = Join-Path $ToolRoot "Sdk" }
if (-not $JdkRoot) { $JdkRoot = Join-Path $ToolRoot "jdk-17" }
if (-not $ReportPath) { $ReportPath = Join-Path $ToolRoot "android-env-report.json" }
if (-not $PassCachePath) { $PassCachePath = Join-Path $ToolRoot "android-env-pass-cache.json" }
$LogPath = [System.IO.Path]::ChangeExtension($ReportPath, ".log")
$EnvironmentPassCacheSchemaVersion = 1
$GradleVersion = "8.14.3"
$AgentVNGradleHome = Join-Path $env:LOCALAPPDATA "AgentVN\GradleHome"
$GradleDistributionPath = Join-Path $ToolRoot "gradle\gradle-$GradleVersion-bin.zip"
$ReclaimedBytes = [int64]0
$InstallSource = if ($OfflinePackRoot) { "avnenv" } elseif ($Install) { "online" } else { "existing" }

$Checks = New-Object System.Collections.Generic.List[object]
$Warnings = New-Object System.Collections.Generic.List[string]
$Actions = New-Object System.Collections.Generic.List[string]
$SymlinkCapability = $null
$OfflinePackState = [ordered]@{
  schemaVersion = 1
  available = $false
  complete = $false
  deployed = $false
  cacheHit = $false
  packVersion = ""
  root = ""
  manifestPath = ""
  manifestSha256 = ""
  gradleDistributionPath = $GradleDistributionPath
  gradleUserHome = $AgentVNGradleHome
  error = ""
}
$SymlinkElevation = [ordered]@{
  attempted = $false
  status = "NOT_NEEDED"
  reportPath = ""
  exitCode = $null
  error = ""
}

function Write-Utf8JsonAtomic {
  param([string]$Path, [object]$Value)
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  $temporary = "$Path.tmp-$([guid]::NewGuid().ToString('N'))"
  $json = $Value | ConvertTo-Json -Depth 10
  [System.IO.File]::WriteAllText($temporary, "$json`n", (New-Object System.Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporary -Destination $Path -Force
  return $json
}

function Initialize-Utf8Log {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [AllowEmptyString()][string]$Value = ""
  )
  $parent = Split-Path -Parent $Path
  if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  [System.IO.File]::WriteAllText(
    $Path,
    "$Value`n",
    (New-Object System.Text.UTF8Encoding($false))
  )
}

function Add-Utf8Log {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [AllowEmptyString()][string]$Value = ""
  )
  $parent = Split-Path -Parent $Path
  if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  [System.IO.File]::AppendAllText(
    $Path,
    "$Value`n",
    (New-Object System.Text.UTF8Encoding($false))
  )
}

function Read-Utf8JsonStrict {
  param([string]$Path)
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) {
    throw "Cached environment report is UTF-16LE; expected UTF-8: $Path"
  }
  $text = [System.Text.Encoding]::UTF8.GetString($bytes)
  if ($text.Contains([char]0xFFFD)) {
    throw "Cached environment report contains invalid UTF-8: $Path"
  }
  return ($text.TrimStart([char]0xFEFF) | ConvertFrom-Json)
}

function Get-SymbolicLinkPrivilegeState {
  if (-not ("AgentVNSymlinkPrivilegeProbe" -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class AgentVNSymlinkPrivilegeProbe {
  private const UInt32 TOKEN_QUERY = 0x0008;
  private const Int32 TokenPrivileges = 3;
  private const UInt32 SE_PRIVILEGE_ENABLED = 0x00000002;
  private const Int32 ERROR_INSUFFICIENT_BUFFER = 122;

  [StructLayout(LayoutKind.Sequential)]
  private struct LUID {
    public UInt32 LowPart;
    public Int32 HighPart;
  }

  [DllImport("kernel32.dll")]
  private static extern IntPtr GetCurrentProcess();

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool CloseHandle(IntPtr handle);

  [DllImport("advapi32.dll", SetLastError = true)]
  private static extern bool OpenProcessToken(IntPtr processHandle, UInt32 desiredAccess, out IntPtr tokenHandle);

  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool LookupPrivilegeValue(string systemName, string name, out LUID luid);

  [DllImport("advapi32.dll", SetLastError = true)]
  private static extern bool GetTokenInformation(
    IntPtr tokenHandle,
    Int32 tokenInformationClass,
    IntPtr tokenInformation,
    Int32 tokenInformationLength,
    out Int32 returnLength
  );

  public static int GetState() {
    IntPtr token;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, out token)) {
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    try {
      LUID target;
      if (!LookupPrivilegeValue(null, "SeCreateSymbolicLinkPrivilege", out target)) {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }
      Int32 required = 0;
      GetTokenInformation(token, TokenPrivileges, IntPtr.Zero, 0, out required);
      if (required <= 0 && Marshal.GetLastWin32Error() != ERROR_INSUFFICIENT_BUFFER) {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }
      IntPtr buffer = Marshal.AllocHGlobal(required);
      try {
        if (!GetTokenInformation(token, TokenPrivileges, buffer, required, out required)) {
          throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        Int32 count = Marshal.ReadInt32(buffer);
        for (Int32 index = 0; index < count; index++) {
          IntPtr entry = IntPtr.Add(buffer, 4 + (index * 12));
          UInt32 low = unchecked((UInt32)Marshal.ReadInt32(entry, 0));
          Int32 high = Marshal.ReadInt32(entry, 4);
          UInt32 attributes = unchecked((UInt32)Marshal.ReadInt32(entry, 8));
          if (low == target.LowPart && high == target.HighPart) {
            return (attributes & SE_PRIVILEGE_ENABLED) != 0 ? 2 : 1;
          }
        }
        return 0;
      } finally {
        Marshal.FreeHGlobal(buffer);
      }
    } finally {
      CloseHandle(token);
    }
  }
}
'@
  }
  try {
    $state = [AgentVNSymlinkPrivilegeProbe]::GetState()
    return [ordered]@{
      present = ($state -ge 1)
      enabled = ($state -eq 2)
      queryError = ""
    }
  } catch {
    return [ordered]@{
      present = $false
      enabled = $false
      queryError = $_.Exception.Message
    }
  }
}

function Test-SymlinkCapability {
  param([string]$ProbeRoot)
  New-Item -ItemType Directory -Force -Path $ProbeRoot | Out-Null
  $probeDirectory = Join-Path $ProbeRoot (".agentvn-symlink-probe-" + [guid]::NewGuid().ToString("N"))
  $source = Join-Path $probeDirectory "source.txt"
  $link = Join-Path $probeDirectory "link.txt"
  $success = $false
  $errorText = ""
  $win32Code = 0
  try {
    New-Item -ItemType Directory -Force -Path $probeDirectory | Out-Null
    [System.IO.File]::WriteAllText($source, "agentvn-symlink-probe", (New-Object System.Text.UTF8Encoding($false)))
    New-Item -ItemType SymbolicLink -Path $link -Target $source -ErrorAction Stop | Out-Null
    $success = (Get-Content -LiteralPath $link -Raw) -eq "agentvn-symlink-probe"
  } catch {
    $errorText = $_.Exception.Message
    if ($_.Exception.HResult) { $win32Code = $_.Exception.HResult -band 0xFFFF }
  } finally {
    Remove-Item -LiteralPath $probeDirectory -Recurse -Force -ErrorAction SilentlyContinue
  }
  $isElevated = $false
  try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    $isElevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  } catch {}
  $developerMode = $null
  try {
    $developerMode = [int](Get-ItemPropertyValue -LiteralPath "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" -Name "AllowDevelopmentWithoutDevLicense" -ErrorAction Stop)
  } catch {}
  $privilege = Get-SymbolicLinkPrivilegeState
  return [ordered]@{
    schemaVersion = 2
    probeRoot = $ProbeRoot
    success = $success
    win32ErrorCode = $win32Code
    error = $errorText
    windowsBuild = [Environment]::OSVersion.Version.ToString()
    checkedAt = (Get-Date).ToUniversalTime().ToString("o")
    isElevated = $isElevated
    developerModeEnabled = ($developerMode -eq 1)
    developerModeRegistryValue = $developerMode
    symbolicLinkPrivilegePresent = $privilege.present
    symbolicLinkPrivilegeEnabled = $privilege.enabled
    symbolicLinkPrivilegeQueryError = $privilege.queryError
  }
}

function Add-AndroidSymlinkEnvironmentCheck {
  param(
    [Parameter(Mandatory = $true)]$Capability,
    [Parameter(Mandatory = $true)][string]$ProbeRoot
  )
  if ($Capability.success) {
    Add-Check "windows_symlink_capability" "Windows symbolic-link capability" "PASS" $ProbeRoot "The current process can create a file symbolic link on the Android build cache volume." ""
    return
  }

  $canDeferToBuild = (-not $Capability.isElevated) -and
    ($Capability.win32ErrorCode -in @(5, 1314))
  if ($canDeferToBuild) {
    # The environment check runs as a normal desktop process. A missing
    # SeCreateSymbolicLinkPrivilege is a build-time permission requirement,
    # not evidence that the SDK/JDK/NDK package is incomplete. The actual
    # Android build performs the authoritative elevated probe immediately
    # before invoking Tauri and keeps the UAC interaction next to the action
    # that needs it.
    $script:SymlinkElevation.status = "DEFERRED_TO_BUILD"
    $script:SymlinkElevation.reason = "The normal desktop process cannot create symbolic links; the Android build will request one-time administrator elevation."
    $script:Warnings.Add("ANDROID_BUILD_ELEVATION_REQUIRED: Symbolic-link permission will be checked with one-time administrator elevation when the Android build starts.") | Out-Null
    Add-Check "windows_symlink_capability" "Windows symbolic-link capability" "PASS" $ProbeRoot "Symbolic-link permission is deferred to the real Android build. SDK, JDK, NDK and Rust checks are reported separately." "Approve the one-time administrator prompt when the Android build begins."
    return
  }

  Add-Check "windows_symlink_capability" "Windows symbolic-link capability" "BLOCKED" $ProbeRoot ("The current process cannot create the symbolic link required by Tauri Android builds. Win32 error: " + $Capability.win32ErrorCode) "The process is already elevated or the filesystem rejected symbolic links; inspect account/group policy or filesystem restrictions."
}

# A normal desktop process may be unable to create the links required by
# Tauri/Android even though every SDK component is already installed. During
# repair, probe this capability once in a narrowly-scoped elevated helper so
# the user does not have to restart the entire environment installation.
if ($ProbeOnly) {
  $resolvedProbeRoot = if ([string]::IsNullOrWhiteSpace($SymlinkProbeRoot)) {
    Join-Path (Split-Path -Parent $ReportPath) "symlink-probe-workspace"
  } else {
    [System.IO.Path]::GetFullPath($SymlinkProbeRoot)
  }
  $probe = Test-SymlinkCapability -ProbeRoot $resolvedProbeRoot
  $probe | Add-Member -NotePropertyName probeOnly -NotePropertyValue $true
  Write-Utf8JsonAtomic -Path $ReportPath -Value $probe | Out-Null
  if ($Json) { Write-Output ($probe | ConvertTo-Json -Depth 10) }
  if ($probe.success) { exit 0 }
  exit 2
}

# A successful environment check is durable until the user explicitly asks
# for a recheck/repair or a future AgentVN version bumps the cache schema.
# Automatic checks and package builds reuse it without rerunning sdkmanager,
# rustup, Java or the symbolic-link environment probe.
if ($UseCachedPass -and -not $Install -and (Test-Path -LiteralPath $PassCachePath)) {
  try {
    $cached = Read-Utf8JsonStrict -Path $PassCachePath
    if (
      $cached.status -eq "PASS" -and
      $cached.ok -eq $true -and
      [int]$cached.cacheSchemaVersion -eq $EnvironmentPassCacheSchemaVersion -and
      [string]$cached.cachePlatform -eq "android"
    ) {
      $cached.cacheHit = $true
      $cached.message = "Android build environment is ready (reused previous successful check)."
      $cached.installAttempted = $false
      $cached.reportPath = $ReportPath
      $cached.logPath = $LogPath
      $cached.passCachePath = $PassCachePath
      Write-Utf8JsonAtomic -Path $ReportPath -Value $cached | Out-Null
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogPath) | Out-Null
      [System.IO.File]::WriteAllText(
        $LogPath,
        "[cache] Reused successful Android environment check: $PassCachePath`n",
        (New-Object System.Text.UTF8Encoding($false))
      )
      if ($Json) { Write-Output ($cached | ConvertTo-Json -Depth 10) }
      exit 0
    }
  } catch {
    # Invalid/outdated caches are ignored and replaced by a full check below.
  }
}

# AgentVN China network mirrors and progress metadata. These settings are process-local
# and do not modify user proxy configuration.
$MirrorNotes = @(
  "npm: https://registry.npmmirror.com",
  "rustup: https://rsproxy.cn",
  "cargo sparse: https://rsproxy.cn/index/",
  "Gradle distribution: https://mirrors.aliyun.com/gradle/distributions/",
  "Android/JDK: official source first, retry-friendly logs for China networks"
)
function Add-Stage([string]$Message) {
  $Actions.Add("Progress: $Message") | Out-Null
  Add-Utf8Log -Path $LogPath -Value ("[stage] " + $Message)
}

function Get-DirectoryBytes([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return [int64]0 }
  $sum = (Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction SilentlyContinue |
    Measure-Object -Property Length -Sum).Sum
  return [int64]$(if ($null -eq $sum) { 0 } else { $sum })
}

function Remove-AgentVNManagedUserPathEntries {
  if ($NoPersistEnv) { return }
  $managedRoot = [System.IO.Path]::GetFullPath($DefaultToolRoot).TrimEnd("\")
  $current = [Environment]::GetEnvironmentVariable("Path", "User")
  $next = @($current -split ";" | Where-Object {
    if ([string]::IsNullOrWhiteSpace($_)) { return $false }
    try {
      $candidate = [System.IO.Path]::GetFullPath($_).TrimEnd("\")
      return -not (
        $candidate.Equals($managedRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
        $candidate.StartsWith($managedRoot + "\", [System.StringComparison]::OrdinalIgnoreCase)
      )
    } catch {
      return $true
    }
  })
  [Environment]::SetEnvironmentVariable("Path", ($next -join ";"), "User")
}

function Clear-AgentVNManagedAndroidEnvironment {
  $resolvedToolRoot = [System.IO.Path]::GetFullPath($ToolRoot).TrimEnd("\")
  $expectedToolRoot = [System.IO.Path]::GetFullPath($DefaultToolRoot).TrimEnd("\")
  $expectedGradleHome = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "AgentVN\GradleHome")).TrimEnd("\")
  if (-not $resolvedToolRoot.Equals($expectedToolRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "ANDROID_ENV_CLEANUP_FAILED: refusing to clear a non-AgentVN Android tool root: $resolvedToolRoot"
  }
  if (-not ([System.IO.Path]::GetFullPath($AgentVNGradleHome).TrimEnd("\")).Equals($expectedGradleHome, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "ANDROID_ENV_CLEANUP_FAILED: refusing to clear a non-AgentVN Gradle home: $AgentVNGradleHome"
  }
  Add-Stage "[phase:cleaning] Remove previous AgentVN-managed Android environment"
  $script:ReclaimedBytes = (Get-DirectoryBytes $ToolRoot) + (Get-DirectoryBytes $AgentVNGradleHome)
  Remove-AgentVNManagedUserPathEntries
  foreach ($target in @($ToolRoot, $AgentVNGradleHome, $PassCachePath)) {
    if (Test-Path -LiteralPath $target) {
      try {
        Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop
      } catch {
        throw "ANDROID_ENV_CLEANUP_FAILED: cannot remove $target / $($_.Exception.Message)"
      }
    }
  }
  New-Item -ItemType Directory -Force -Path $ToolRoot, $AgentVNGradleHome | Out-Null
  Add-Stage "[phase:installing] Previous environment removed; install only the new dependency set"
}
function Enable-ChinaBuildMirrors {
  Add-Stage "Configure temporary download mirrors without changing proxy settings"
  if (-not $env:npm_config_registry) { $env:npm_config_registry = "https://registry.npmmirror.com" }
  if (-not $env:RUSTUP_DIST_SERVER) { $env:RUSTUP_DIST_SERVER = "https://rsproxy.cn" }
  if (-not $env:RUSTUP_UPDATE_ROOT) { $env:RUSTUP_UPDATE_ROOT = "https://rsproxy.cn/rustup" }
  if (-not $env:CARGO_REGISTRIES_CRATES_IO_PROTOCOL) { $env:CARGO_REGISTRIES_CRATES_IO_PROTOCOL = "sparse" }
}

function Add-Check {
  param([string]$Id, [string]$Label, [string]$Status, [string]$Path = "", [string]$Message = "", [string]$Fix = "")
  $Checks.Add([ordered]@{
    id = $Id
    label = $Label
    status = $Status
    path = $Path
    message = $Message
    fix = $Fix
  }) | Out-Null
}

function Test-CommandExists([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-CommandPath([string]$Name) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return ""
}

function Test-AgentVNAdministrator {
  try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole(
      [Security.Principal.WindowsBuiltInRole]::Administrator
    )
  } catch {
    return $false
  }
}

function Invoke-LoggedProcess {
  param([string]$FilePath, [string[]]$ArgumentList, [string]$WorkingDirectory = "")
  Add-Utf8Log -Path $LogPath -Value "`n== $FilePath $($ArgumentList -join ' ') =="
  $stdoutPath = Join-Path ([System.IO.Path]::GetTempPath()) ("agentvn-android-env-stdout-" + [guid]::NewGuid().ToString("N") + ".log")
  $stderrPath = Join-Path ([System.IO.Path]::GetTempPath()) ("agentvn-android-env-stderr-" + [guid]::NewGuid().ToString("N") + ".log")
  $startInfo = @{
    FilePath = $FilePath
    ArgumentList = $ArgumentList
    RedirectStandardOutput = $stdoutPath
    RedirectStandardError = $stderrPath
    WindowStyle = "Hidden"
    Wait = $true
    PassThru = $true
  }
  if ($WorkingDirectory) { $startInfo.WorkingDirectory = $WorkingDirectory }
  $process = Start-Process @startInfo
  $stdout = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -LiteralPath $stdoutPath -Raw } else { "" }
  $stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw } else { "" }
  Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
  if ($stdout) { Add-Utf8Log -Path $LogPath -Value "`n-- stdout --`n$stdout" }
  if ($stderr) { Add-Utf8Log -Path $LogPath -Value "`n-- stderr --`n$stderr" }
  return $process.ExitCode
}

function Reset-AgentVNWingetSources {
  param([Parameter(Mandatory = $true)][string]$WingetPath)
  Add-Utf8Log -Path $LogPath -Value "[winget] Refreshing package sources before retrying Visual Studio installation."
  $resetExit = Invoke-LoggedProcess -FilePath $WingetPath -ArgumentList @("source", "reset", "--force")
  if ($resetExit -ne 0) {
    Add-Utf8Log -Path $LogPath -Value "[winget] source reset failed with exit code $resetExit; continuing with source update."
  }
  $updateExit = Invoke-LoggedProcess -FilePath $WingetPath -ArgumentList @("source", "update")
  if ($updateExit -ne 0) {
    Add-Utf8Log -Path $LogPath -Value "[winget] source update failed with exit code $updateExit; retrying install anyway."
  }
}

function Install-AgentVNMsvcBuildToolsBootstrapper {
  $bootstrapperRoot = Join-Path ([System.IO.Path]::GetTempPath()) "AgentVN\visual-studio-build-tools"
  $bootstrapperPath = Join-Path $bootstrapperRoot "vs_BuildTools.exe"
  New-Item -ItemType Directory -Force -Path $bootstrapperRoot | Out-Null

  $urls = New-Object System.Collections.Generic.List[string]
  $overrideUrl = [Environment]::GetEnvironmentVariable("AGENTVN_VS_BUILDTOOLS_URL")
  if (-not [string]::IsNullOrWhiteSpace($overrideUrl)) {
    $urls.Add($overrideUrl) | Out-Null
  }
  # The aka.ms endpoint resolves to Microsoft's current CDN and is more
  # reliable on China networks than an App Installer/winget source lookup.
  $urls.Add("https://aka.ms/vs/17/release/vs_BuildTools.exe") | Out-Null

  Add-Stage "[phase:downloading] Download Visual Studio Build Tools installer from a retry-friendly official source"
  $downloaded = $false
  foreach ($url in $urls) {
    try {
      Add-Utf8Log -Path $LogPath -Value "[download] Visual Studio Build Tools bootstrapper: $url"
      Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $bootstrapperPath -TimeoutSec 240
      if ((Get-Item -LiteralPath $bootstrapperPath).Length -lt 1MB) {
        throw "Downloaded bootstrapper is unexpectedly small."
      }
      $downloaded = $true
      break
    } catch {
      Add-Utf8Log -Path $LogPath -Value "[download] Failed: $($_.Exception.Message)"
      Remove-Item -LiteralPath $bootstrapperPath -Force -ErrorAction SilentlyContinue
    }
  }
  if (-not $downloaded) {
    return "Visual Studio Build Tools bootstrapper could not be downloaded from the configured official sources."
  }

  try {
    $signature = Get-AuthenticodeSignature -FilePath $bootstrapperPath
    if ($signature.Status -ne "Valid" -or
      [string]$signature.SignerCertificate.Subject -notmatch "Microsoft") {
      return "Visual Studio Build Tools bootstrapper signature validation failed."
    }
  } catch {
    return "Visual Studio Build Tools bootstrapper signature validation failed: $($_.Exception.Message)"
  }

  Add-Stage "[phase:installing] Request administrator permission for Visual Studio C++ Build Tools bootstrapper"
  $arguments = @(
    "--quiet",
    "--wait",
    "--norestart",
    "--add",
    "Microsoft.VisualStudio.Workload.VCTools",
    "--includeRecommended"
  )
  $exit = if (Test-AgentVNAdministrator) {
    Invoke-LoggedProcess -FilePath $bootstrapperPath -ArgumentList $arguments
  } else {
    Invoke-LoggedElevatedProcess -FilePath $bootstrapperPath -ArgumentList $arguments
  }
  if ($exit -eq 0) { return "" }
  if ($exit -eq 1223) {
    return "WINDOWS_MSVC_UAC_CANCELLED: Administrator permission was not granted for the Visual Studio Build Tools bootstrapper."
  }
  return "Visual Studio Build Tools bootstrapper failed with exit code $exit."
}

function Invoke-LoggedElevatedProcess {
  param([string]$FilePath, [string[]]$ArgumentList, [string]$WorkingDirectory = "")
  Add-Utf8Log -Path $LogPath -Value (
    "`n== administrator: $FilePath $($ArgumentList -join ' ') =="
  )
  $startInfo = @{
    FilePath = $FilePath
    ArgumentList = $ArgumentList
    Verb = "RunAs"
    WindowStyle = "Hidden"
    Wait = $true
    PassThru = $true
  }
  if ($WorkingDirectory) { $startInfo.WorkingDirectory = $WorkingDirectory }
  try {
    $process = Start-Process @startInfo
    Add-Utf8Log -Path $LogPath -Value (
      "[administrator] Process exited with code $($process.ExitCode)."
    )
    return $process.ExitCode
  } catch {
    $win32Code = if ($_.Exception.HResult) {
      $_.Exception.HResult -band 0xFFFF
    } else {
      1
    }
    Add-Utf8Log -Path $LogPath -Value (
      "[administrator] Failed to start elevated process. Win32 error: $win32Code. " +
      $_.Exception.Message
    )
    return $win32Code
  }
}

function Resolve-AgentVNMsvcEnvironment {
  $resolver = Join-Path $PSScriptRoot "resolve-msvc-environment.ps1"
  if (-not (Test-Path -LiteralPath $resolver -PathType Leaf)) {
    return [pscustomobject]@{
      status = "BLOCKED"
      message = "The bundled MSVC environment resolver is missing: $resolver"
      linkPath = ""
      environment = [pscustomobject]@{}
    }
  }
  try {
    $json = (& $resolver -Json | Out-String).Trim()
    if ([string]::IsNullOrWhiteSpace($json)) {
      throw "The MSVC environment resolver returned no JSON."
    }
    return ($json | ConvertFrom-Json)
  } catch {
    return [pscustomobject]@{
      status = "BLOCKED"
      message = $_.Exception.Message
      linkPath = ""
      environment = [pscustomobject]@{}
    }
  }
}

function Install-AgentVNMsvcBuildTools {
  $winget = Get-CommandPath "winget.exe"
  if (-not $winget) { $winget = Get-CommandPath "winget" }
  if (-not $winget) {
    return "winget/App Installer is unavailable; automatic repair cannot install Visual Studio C++ Build Tools."
  }
  Add-Stage "Install Visual Studio C++ Build Tools and Windows SDK"
  $arguments = @(
    "install",
    "--id",
    "Microsoft.VisualStudio.2022.BuildTools",
    "--exact",
    "--silent",
    "--accept-package-agreements",
    "--accept-source-agreements",
    "--override",
    '"--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"'
  )
  $exit = if (Test-AgentVNAdministrator) {
    Invoke-LoggedProcess -FilePath $winget -ArgumentList $arguments
  } else {
    Add-Stage "[phase:installing] Request administrator permission for Visual Studio C++ Build Tools"
    Invoke-LoggedElevatedProcess -FilePath $winget -ArgumentList $arguments
  }
  if ($exit -ne 0) {
    Add-Stage "[phase:retrying] Refresh winget sources and retry Visual Studio C++ Build Tools"
    Reset-AgentVNWingetSources -WingetPath $winget
    $exit = if (Test-AgentVNAdministrator) {
      Invoke-LoggedProcess -FilePath $winget -ArgumentList $arguments
    } else {
      Add-Stage "[phase:installing] Request administrator permission for Visual Studio C++ Build Tools (retry)"
      Invoke-LoggedElevatedProcess -FilePath $winget -ArgumentList $arguments
    }
  }
  if ($exit -eq 0) { return "" }
  $bootstrapperWarning = Install-AgentVNMsvcBuildToolsBootstrapper
  if ([string]::IsNullOrWhiteSpace($bootstrapperWarning)) { return "" }
  if ($exit -eq 1223) {
    return "WINDOWS_MSVC_UAC_CANCELLED: Administrator permission was not granted. Approve the UAC prompt to install Visual Studio C++ Build Tools."
  }
  if (($exit -band 0xFFFF) -eq 112) {
    return "WINDOWS_MSVC_INSTALL_DISK_FULL: Visual Studio C++ Build Tools could not be installed because the Windows system drive does not have enough free space."
  }
  return "$bootstrapperWarning Visual Studio C++ Build Tools automatic install failed with exit code $exit."
}

function Copy-DirectoryContents {
  param([string]$Source, [string]$Destination)
  if (-not (Test-Path -LiteralPath $Source)) { return $false }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  foreach ($item in Get-ChildItem -LiteralPath $Source -Force) {
    Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $Destination $item.Name) -Recurse -Force
  }
  return $true
}

function Resolve-AndroidOfflinePackRoot {
  $candidates = New-Object System.Collections.Generic.List[string]
  if (-not [string]::IsNullOrWhiteSpace($OfflinePackRoot)) { $candidates.Add($OfflinePackRoot) | Out-Null }
  if (-not [string]::IsNullOrWhiteSpace($env:AGENTVN_ANDROID_OFFLINE_PACK)) { $candidates.Add($env:AGENTVN_ANDROID_OFFLINE_PACK) | Out-Null }
  $candidates.Add((Join-Path $PSScriptRoot "android-offline-pack")) | Out-Null
  $candidates.Add((Join-Path (Split-Path -Parent $PSScriptRoot) "android-offline-pack")) | Out-Null
  foreach ($candidate in $candidates | Select-Object -Unique) {
    try {
      $full = [System.IO.Path]::GetFullPath($candidate)
      if (
        (Test-Path -LiteralPath (Join-Path $full "format.json")) -or
        (Test-Path -LiteralPath (Join-Path $full "manifest.json"))
      ) { return $full }
    } catch {}
  }
  return ""
}

function Get-AndroidOfflinePackManifestPath([string]$RootPath) {
  foreach ($name in @("format.json", "manifest.json")) {
    $candidate = Join-Path $RootPath $name
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  return ""
}

function Enable-DeployedOfflineToolchain {
  $nodeHome = Join-Path $ToolRoot "node-portable"
  $cargoHome = Join-Path $ToolRoot "cargo"
  $rustupHome = Join-Path $ToolRoot "rustup"
  if (Test-Path -LiteralPath (Join-Path $nodeHome "node.exe")) {
    Add-PathForCurrentProcess $nodeHome
    if ($Install) { Add-UserPath $nodeHome }
  }
  if (Test-Path -LiteralPath (Join-Path $cargoHome "bin\cargo.exe")) {
    Set-ToolEnv "CARGO_HOME" $cargoHome
    Add-PathForCurrentProcess (Join-Path $cargoHome "bin")
    if ($Install) { Add-UserPath (Join-Path $cargoHome "bin") }
  }
  if (Test-Path -LiteralPath $rustupHome) { Set-ToolEnv "RUSTUP_HOME" $rustupHome }
  # The offline archive carries the toolchain files but rustup's settings.toml
  # intentionally has no machine-specific default. Pin the bundled Windows
  # host toolchain explicitly so fresh processes (including the Dev launcher)
  # can resolve cargo/rustc without requiring a networked `rustup default`.
  $bundledRustToolchain = Join-Path $rustupHome "toolchains\stable-x86_64-pc-windows-msvc"
  if (Test-Path -LiteralPath (Join-Path $bundledRustToolchain "bin\cargo.exe")) {
    Set-ToolEnv "RUSTUP_TOOLCHAIN" "stable-x86_64-pc-windows-msvc"
  }
  if (Test-Path -LiteralPath $AgentVNGradleHome) { Set-ToolEnv "GRADLE_USER_HOME" $AgentVNGradleHome }
  if (Test-Path -LiteralPath $GradleDistributionPath) {
    Set-ToolEnv "AGENTVN_GRADLE_DISTRIBUTION" $GradleDistributionPath
    $OfflinePackState.gradleDistributionPath = $GradleDistributionPath
  }
  $OfflinePackState.gradleUserHome = $AgentVNGradleHome
}

function Test-OfflinePackInstalled {
  $markerPath = Join-Path $ToolRoot "offline-pack-deployment.json"
  if (-not (Test-Path -LiteralPath $markerPath)) { return $false }
  try {
    $marker = Read-Utf8JsonStrict -Path $markerPath
    if (
      [int]$marker.schemaVersion -ne 2 -or
      [string]::IsNullOrWhiteSpace([string]$marker.installSource) -or
      [string]::IsNullOrWhiteSpace([string]$marker.packVersion) -or
      -not (Test-Path -LiteralPath (Join-Path $JdkRoot "bin\java.exe")) -or
      -not (Test-Path -LiteralPath (Join-Path $SdkRoot "build-tools\$BuildToolsVersion\aapt.exe")) -or
      -not (Test-Path -LiteralPath $GradleDistributionPath)
    ) { return $false }
    $OfflinePackState.available = $true
    $OfflinePackState.complete = $true
    $OfflinePackState.deployed = $true
    $OfflinePackState.cacheHit = $true
    $OfflinePackState.packVersion = [string]$marker.packVersion
    $OfflinePackState.manifestSha256 = [string]$marker.manifestSha256
    Enable-DeployedOfflineToolchain
    return $true
  } catch {
    $OfflinePackState.error = $_.Exception.Message
    return $false
  }
}

function Install-AndroidOfflinePack {
  $resolvedRoot = Resolve-AndroidOfflinePackRoot
  if (-not $resolvedRoot) {
    $OfflinePackState.error = "Bundled Android offline pack was not found."
    return $false
  }
  $manifestPath = Get-AndroidOfflinePackManifestPath $resolvedRoot
  $OfflinePackState.available = $true
  $OfflinePackState.root = $resolvedRoot
  $OfflinePackState.manifestPath = $manifestPath
  try {
    $manifest = Read-Utf8JsonStrict -Path $manifestPath
    $OfflinePackState.packVersion = [string]$manifest.packVersion
    $OfflinePackState.complete = $manifest.complete -eq $true
    if (
      [int]$manifest.schemaVersion -ne 1 -or
      [string]$manifest.kind -ne "agentvn-android-environment" -or
      [string]$manifest.platform -ne "windows-x86_64" -or
      $manifest.complete -ne $true
    ) {
      throw "Bundled Android offline pack is incomplete: $((@($manifest.missing) -join '; '))"
    }
    $manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $OfflinePackState.manifestSha256 = $manifestHash
    foreach ($entry in @($manifest.files)) {
      $relative = ([string]$entry.path).Replace("/", "\")
      $source = [System.IO.Path]::GetFullPath((Join-Path $resolvedRoot $relative))
      $rootPrefix = $resolvedRoot.TrimEnd("\") + "\"
      if (-not $source.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Offline pack path escaped its root: $relative"
      }
      if (-not (Test-Path -LiteralPath $source)) { throw "Offline pack file is missing: $relative" }
      $item = Get-Item -LiteralPath $source
      if ([int64]$entry.bytes -ne $item.Length) { throw "Offline pack file size mismatch: $relative" }
      $hash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($hash -ne ([string]$entry.sha256).ToLowerInvariant()) { throw "Offline pack hash mismatch: $relative" }
    }
    foreach ($relative in @($manifest.requiredPaths)) {
      $required = Join-Path $resolvedRoot (([string]$relative).Replace("/", "\"))
      if (-not (Test-Path -LiteralPath $required)) { throw "Offline pack required file is missing: $relative" }
    }
    Add-Stage "Deploy bundled Android offline toolchain $($manifest.packVersion)"
    $payload = Join-Path $resolvedRoot "payload"
    if (-not (Copy-DirectoryContents -Source (Join-Path $payload "toolchain") -Destination $ToolRoot)) {
      throw "Offline pack toolchain payload is missing."
    }
    if (-not (Copy-DirectoryContents -Source (Join-Path $payload "gradle-home") -Destination $AgentVNGradleHome)) {
      throw "Offline pack Gradle cache payload is missing."
    }
    $marker = [ordered]@{
      schemaVersion = 2
      installSource = "avnenv"
      packageId = [string]$manifest.packageId
      packVersion = [string]$manifest.packVersion
      manifestSha256 = $manifestHash
      installedAt = (Get-Date).ToUniversalTime().ToString("o")
      sourceRoot = $resolvedRoot
      totalBytes = [int64]$manifest.totalBytes
      fileCount = [int64]$manifest.fileCount
    }
    Write-Utf8JsonAtomic -Path (Join-Path $ToolRoot "offline-pack-deployment.json") -Value $marker | Out-Null
    $OfflinePackState.deployed = $true
    $OfflinePackState.cacheHit = $false
    Enable-DeployedOfflineToolchain
    return $true
  } catch {
    $OfflinePackState.error = $_.Exception.Message
    return $false
  }
}

function Add-PathForCurrentProcess([string]$PathValue) {
  if ($PathValue -and (Test-Path -LiteralPath $PathValue) -and ($env:Path -notlike "*$PathValue*")) {
    $env:Path = "$PathValue;$env:Path"
  }
}

function Add-UserPath([string]$PathValue) {
  if ($NoPersistEnv -or -not $PathValue -or -not (Test-Path -LiteralPath $PathValue)) { return }
  $current = [Environment]::GetEnvironmentVariable("Path", "User")
  $items = @($current -split ";" | Where-Object { $_ })
  if ($items -notcontains $PathValue) {
    $next = (@($PathValue) + $items) -join ";"
    [Environment]::SetEnvironmentVariable("Path", $next, "User")
  }
}

function Set-ToolEnv([string]$Name, [string]$Value) {
  if (-not $Value) { return }
  Set-Item -Path "Env:\$Name" -Value $Value
  # Detection only needs process-local paths. Writing User variables also
  # broadcasts WM_SETTINGCHANGE and can stall on unresponsive desktop windows.
  # Persist toolchain configuration only for an explicit install/repair.
  if ($Install -and -not $NoPersistEnv) {
    [Environment]::SetEnvironmentVariable($Name, $Value, "User")
  }
}

function Test-JavaHome([string]$JavaHomePath) {
  return $JavaHomePath -and (Test-Path -LiteralPath (Join-Path $JavaHomePath "bin\java.exe"))
}

function Find-JavaHome {
  $candidates = @()
  $candidates += $JdkRoot
  if ($env:JAVA_HOME) { $candidates += $env:JAVA_HOME }
  $candidates += "C:\Program Files\Android\Android Studio\jbr"
  $javaCommand = Get-Command java -ErrorAction SilentlyContinue
  if ($javaCommand) {
    $binDir = Split-Path -Parent $javaCommand.Source
    $candidates += (Split-Path -Parent $binDir)
  }
  foreach ($candidate in $candidates | Where-Object { $_ } | Select-Object -Unique) {
    if (Test-JavaHome $candidate) { return (Resolve-Path -LiteralPath $candidate).Path }
  }
  return ""
}

function Install-PortableJdk {
  New-Item -ItemType Directory -Force -Path $ToolRoot | Out-Null
  Enable-ChinaBuildMirrors
  foreach ($note in $MirrorNotes) { $Warnings.Add("Mirror note: $note") | Out-Null }
  $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("agentvn-jdk-" + [guid]::NewGuid().ToString("N"))
  $zipPath = Join-Path $tempRoot "jdk17.zip"
  $expanded = Join-Path $tempRoot "expanded"
  New-Item -ItemType Directory -Force -Path $expanded | Out-Null
  $url = "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk"
  $Actions.Add("Downloading Eclipse Temurin JDK 17 from Adoptium.") | Out-Null
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zipPath
  Expand-Archive -LiteralPath $zipPath -DestinationPath $expanded -Force
  $java = Get-ChildItem -LiteralPath $expanded -Recurse -Filter "java.exe" | Where-Object { $_.FullName -match "\\bin\\java\.exe$" } | Select-Object -First 1
  if (-not $java) { throw "Downloaded JDK archive did not contain bin\java.exe." }
  $portableHome = Split-Path -Parent (Split-Path -Parent $java.FullName)
  if (Test-Path -LiteralPath $JdkRoot) { Remove-Item -LiteralPath $JdkRoot -Recurse -Force }
  Copy-Item -LiteralPath $portableHome -Destination $JdkRoot -Recurse -Force
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

function Get-LatestCommandLineToolsUrl {
  $repoUrl = "https://dl.google.com/android/repository/repository2-1.xml"
  [xml]$repo = (Invoke-WebRequest -UseBasicParsing -Uri $repoUrl).Content
  $nodes = $repo.SelectNodes("//*[local-name()='remotePackage']")
  $packages = @()
  foreach ($node in $nodes) {
    $path = $node.GetAttribute("path")
    if ($path -notlike "cmdline-tools;*") { continue }
    $archive = $node.SelectSingleNode(".//*[local-name()='archive'][*[local-name()='host-os' and text()='windows']]")
    if (-not $archive) { continue }
    $urlNode = $archive.SelectSingleNode(".//*[local-name()='complete']/*[local-name()='url']")
    if (-not $urlNode) { continue }
    $revisionNode = $node.SelectSingleNode("./*[local-name()='revision']")
    $majorNode = $revisionNode.SelectSingleNode("./*[local-name()='major']")
    $minorNode = $revisionNode.SelectSingleNode("./*[local-name()='minor']")
    $microNode = $revisionNode.SelectSingleNode("./*[local-name()='micro']")
    $major = if ($majorNode) { [int]$majorNode.InnerText } else { 0 }
    $minor = if ($minorNode) { [int]$minorNode.InnerText } else { 0 }
    $micro = if ($microNode) { [int]$microNode.InnerText } else { 0 }
    $packages += [pscustomobject]@{
      SortKey = ($major * 100000000) + ($minor * 10000) + $micro
      Url = "https://dl.google.com/android/repository/$($urlNode.InnerText)"
    }
  }
  $latest = $packages | Sort-Object SortKey | Select-Object -Last 1
  if (-not $latest) { throw "Could not resolve latest Android command-line tools URL from Google's repository index." }
  return $latest.Url
}

function Install-AndroidCommandLineTools {
  $sdkManager = Join-Path $SdkRoot "cmdline-tools\latest\bin\sdkmanager.bat"
  if (Test-Path -LiteralPath $sdkManager) { return }
  New-Item -ItemType Directory -Force -Path $SdkRoot | Out-Null
  $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("agentvn-android-tools-" + [guid]::NewGuid().ToString("N"))
  $zipPath = Join-Path $tempRoot "cmdline-tools.zip"
  $expanded = Join-Path $tempRoot "expanded"
  New-Item -ItemType Directory -Force -Path $expanded | Out-Null
  $url = Get-LatestCommandLineToolsUrl
  $Actions.Add("Downloading Android SDK command-line tools from Google.") | Out-Null
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zipPath
  Expand-Archive -LiteralPath $zipPath -DestinationPath $expanded -Force
  $source = Join-Path $expanded "cmdline-tools"
  if (-not (Test-Path -LiteralPath $source)) { throw "Downloaded Android command-line tools archive did not contain cmdline-tools." }
  $latest = Join-Path $SdkRoot "cmdline-tools\latest"
  if (Test-Path -LiteralPath $latest) { Remove-Item -LiteralPath $latest -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $latest | Out-Null
  Copy-Item -Path (Join-Path $source "*") -Destination $latest -Recurse -Force
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

function Get-SdkManagerPath {
  $candidate = Join-Path $SdkRoot "cmdline-tools\latest\bin\sdkmanager.bat"
  if (Test-Path -LiteralPath $candidate) { return (Resolve-Path -LiteralPath $candidate).Path }
  $fromPath = Get-Command sdkmanager.bat -ErrorAction SilentlyContinue
  if ($fromPath) { return $fromPath.Source }
  return ""
}

function Get-NdkHome {
  $ndkRoot = Join-Path $SdkRoot "ndk"
  if (Test-Path -LiteralPath $ndkRoot) {
    $latest = Get-ChildItem -LiteralPath $ndkRoot -Directory | Sort-Object Name | Select-Object -Last 1
    if ($latest) { return $latest.FullName }
  }
  if ($env:NDK_HOME -and (Test-Path -LiteralPath $env:NDK_HOME)) { return (Resolve-Path -LiteralPath $env:NDK_HOME).Path }
  return ""
}

function Install-NodeIfMissing {
  if (
    -not $ResetManagedEnvironment -and
    (Test-CommandExists "node") -and
    ((Test-CommandExists "npm") -or (Test-CommandExists "npm.cmd"))
  ) { return }
  New-Item -ItemType Directory -Force -Path $ToolRoot | Out-Null
  $nodeVersion = "v22.11.0"
  $nodeDir = Join-Path $ToolRoot "node-portable"
  $nodeExe = Join-Path $nodeDir "node.exe"
  if (-not (Test-Path -LiteralPath $nodeExe)) {
    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("agentvn-node-" + [guid]::NewGuid().ToString("N"))
    $zipPath = Join-Path $tempRoot "node.zip"
    $expanded = Join-Path $tempRoot "expanded"
    New-Item -ItemType Directory -Force -Path $expanded | Out-Null
    $urls = @(
      "https://npmmirror.com/mirrors/node/$nodeVersion/node-$nodeVersion-win-x64.zip",
      "https://nodejs.org/dist/$nodeVersion/node-$nodeVersion-win-x64.zip"
    )
    $downloaded = $false
    foreach ($url in $urls) {
      try {
        Add-Stage "Download Node.js LTS: $url"
        Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zipPath
        $downloaded = $true
        break
      } catch {
        $Warnings.Add("Node.js download failed, trying fallback: $url / $($_.Exception.Message)") | Out-Null
      }
    }
    if (-not $downloaded) { throw "Node.js portable download failed from all configured mirrors." }
    Expand-Archive -LiteralPath $zipPath -DestinationPath $expanded -Force
    $source = Get-ChildItem -LiteralPath $expanded -Directory | Where-Object { $_.Name -like "node-*-win-x64" } | Select-Object -First 1
    if (-not $source) { throw "Downloaded Node.js archive did not contain node win-x64 folder." }
    if (Test-Path -LiteralPath $nodeDir) { Remove-Item -LiteralPath $nodeDir -Recurse -Force }
    Copy-Item -LiteralPath $source.FullName -Destination $nodeDir -Recurse -Force
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  Add-PathForCurrentProcess $nodeDir
  Add-UserPath $nodeDir
}

function Install-RustupIfMissing {
  if (
    -not $ResetManagedEnvironment -and
    (Test-CommandExists "rustup") -and
    (Test-CommandExists "cargo")
  ) { return }
  New-Item -ItemType Directory -Force -Path $ToolRoot | Out-Null
  $cargoHome = Join-Path $ToolRoot "cargo"
  $rustupHome = Join-Path $ToolRoot "rustup"
  $cargoBin = Join-Path $cargoHome "bin"
  Add-PathForCurrentProcess $cargoBin
  if (Test-Path -LiteralPath (Join-Path $cargoBin "rustup.exe")) { Add-UserPath $cargoBin; return }
  New-Item -ItemType Directory -Force -Path $cargoHome, $rustupHome | Out-Null
  $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("agentvn-rustup-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
  $rustupInit = Join-Path $tempRoot "rustup-init.exe"
  $urls = @(
    "https://rsproxy.cn/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe",
    "https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe"
  )
  $downloaded = $false
  foreach ($url in $urls) {
    try {
      Add-Stage "Download rustup-init: $url"
      Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $rustupInit
      $downloaded = $true
      break
    } catch {
      $Warnings.Add("rustup-init download failed, trying fallback: $url / $($_.Exception.Message)") | Out-Null
    }
  }
  if (-not $downloaded) { throw "rustup-init download failed from all configured mirrors." }
  $env:CARGO_HOME = $cargoHome
  $env:RUSTUP_HOME = $rustupHome
  $exit = Invoke-LoggedProcess -FilePath $rustupInit -ArgumentList @("-y", "--profile", "minimal", "--default-toolchain", "stable-msvc")
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  if ($exit -ne 0) { throw "rustup-init failed. Exit code: $exit" }
  Add-PathForCurrentProcess $cargoBin
  Add-UserPath $cargoBin
}

function Install-RustTargets {
  $targets = @("aarch64-linux-android", "armv7-linux-androideabi", "i686-linux-android", "x86_64-linux-android")
  $Actions.Add("Installing Rust Android targets.") | Out-Null
  $exit = Invoke-LoggedProcess -FilePath (Get-CommandPath "rustup") -ArgumentList (@("target", "add") + $targets)
  if ($exit -ne 0) { throw "rustup target add failed. Exit code: $exit" }
}

function Install-GradleDistribution {
  if (Test-Path -LiteralPath $GradleDistributionPath) { return }
  $expectedSha256 = "bd71102213493060956ec229d946beee57158dbd89d0e62b91bca0fa2c5f3531"
  $urls = @(
    "https://mirrors.aliyun.com/gradle/distributions/v$GradleVersion/gradle-$GradleVersion-bin.zip",
    "https://services.gradle.org/distributions/gradle-$GradleVersion-bin.zip"
  )
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $GradleDistributionPath) | Out-Null
  $temporary = "$GradleDistributionPath.tmp-$([guid]::NewGuid().ToString('N'))"
  $downloaded = $false
  foreach ($url in $urls) {
    try {
      Add-Stage "Download Gradle $GradleVersion distribution: $url"
      Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $temporary -TimeoutSec 180
      $actualSha256 = (Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($actualSha256 -ne $expectedSha256) {
        throw "Gradle archive SHA-256 mismatch. Expected $expectedSha256, got $actualSha256."
      }
      Move-Item -LiteralPath $temporary -Destination $GradleDistributionPath -Force
      $downloaded = $true
      break
    } catch {
      Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
      $Warnings.Add("Gradle download failed, trying fallback: $url / $($_.Exception.Message)") | Out-Null
    }
  }
  if (-not $downloaded) {
    throw "GRADLE_DISTRIBUTION_DOWNLOAD_FAILED: Gradle $GradleVersion could not be downloaded from the configured China mirror or official fallback."
  }
  Set-ToolEnv "AGENTVN_GRADLE_DISTRIBUTION" $GradleDistributionPath
}

function Install-AndroidSdkPackages {
  $sdkManager = Get-SdkManagerPath
  if (-not $sdkManager) { throw "sdkmanager was not found after installing Android command-line tools." }
  Set-ToolEnv "ANDROID_HOME" $SdkRoot
  Set-ToolEnv "ANDROID_SDK_ROOT" $SdkRoot
  Add-PathForCurrentProcess (Join-Path $SdkRoot "cmdline-tools\latest\bin")
  Add-PathForCurrentProcess (Join-Path $SdkRoot "platform-tools")
  $packages = @(
    "cmdline-tools;latest",
    "platform-tools",
    "platforms;android-$ApiLevel",
    "build-tools;$BuildToolsVersion",
    "ndk;$NdkVersion"
  )
  $licenseInput = Join-Path ([System.IO.Path]::GetTempPath()) ("agentvn-android-licenses-" + [guid]::NewGuid().ToString("N") + ".txt")
  1..100 | ForEach-Object { "y" } | Set-Content -Path $licenseInput -Encoding ASCII
  $cmd = "/c type `"$licenseInput`" | `"$sdkManager`" --sdk_root=`"$SdkRoot`" --licenses"
  $licenseExit = Invoke-LoggedProcess -FilePath "cmd.exe" -ArgumentList @($cmd)
  if ($licenseExit -ne 0) { $Warnings.Add("Initial sdkmanager --licenses exited with code $licenseExit. Package install will still be attempted.") | Out-Null }

  $Actions.Add("Installing Android SDK packages: $($packages -join ', ').") | Out-Null
  $exit = Invoke-LoggedProcess -FilePath $sdkManager -ArgumentList (@("--sdk_root=$SdkRoot", "--install") + $packages)
  if ($exit -ne 0) { throw "sdkmanager failed to install Android SDK packages. Exit code: $exit" }
  $licenseExit = Invoke-LoggedProcess -FilePath "cmd.exe" -ArgumentList @($cmd)
  if ($licenseExit -ne 0) { $Warnings.Add("sdkmanager --licenses exited with code $licenseExit. If APK build still fails, run sdkmanager --licenses manually.") | Out-Null }
  $retryExit = Invoke-LoggedProcess -FilePath $sdkManager -ArgumentList (@("--sdk_root=$SdkRoot", "--install") + $packages)
  Remove-Item -LiteralPath $licenseInput -Force -ErrorAction SilentlyContinue
  if ($retryExit -ne 0) { throw "sdkmanager retry failed to install Android SDK packages. Exit code: $retryExit" }
}

function Test-InstalledSdkPackage([string]$RelativePath) {
  return Test-Path -LiteralPath (Join-Path $SdkRoot $RelativePath)
}

try {
  if ($Install) {
    Remove-AgentVNManagedUserPathEntries
  }
  if ($Install -and $ResetManagedEnvironment) {
    Clear-AgentVNManagedAndroidEnvironment
  }
  New-Item -ItemType Directory -Force -Path $ToolRoot | Out-Null
  if (Test-Path -LiteralPath $LogPath) { Remove-Item -LiteralPath $LogPath -Force }

  $offlineReady = if ($ReplaceOfflinePack) { $false } else { Test-OfflinePackInstalled }
  if ($Install) {
    if (-not $offlineReady) { $offlineReady = Install-AndroidOfflinePack }
    if (-not $offlineReady -and $OfflineOnly) {
      throw "ANDROID_OFFLINE_PACK_INCOMPLETE: $($OfflinePackState.error)"
    }
    if (-not $offlineReady) {
      $Warnings.Add("Bundled Android offline pack was unavailable; falling back to the legacy online repair path. $($OfflinePackState.error)") | Out-Null
      Add-Stage "Check and repair Node.js / npm"
      Install-NodeIfMissing
      Add-Stage "Check and repair Rust / Cargo / rustup"
      Install-RustupIfMissing
      Add-Stage "Verify Android toolchain status"
      $javaHome = if ($ResetManagedEnvironment) { "" } else { Find-JavaHome }
      if ($ResetManagedEnvironment -or -not $javaHome) { Install-PortableJdk }
      $javaHome = Find-JavaHome
      if (-not $javaHome) { throw "JDK installation did not produce a usable JAVA_HOME." }
      Set-ToolEnv "JAVA_HOME" $javaHome
      Add-PathForCurrentProcess (Join-Path $javaHome "bin")
      Add-UserPath (Join-Path $javaHome "bin")

      Add-Stage "Download or check Android SDK Command-line Tools"
      Install-AndroidCommandLineTools
      Add-Stage "Install Android SDK / Build-Tools / NDK"
      Install-AndroidSdkPackages
      Add-Stage "Install local Gradle distribution"
      Install-GradleDistribution
      $ndkHome = Get-NdkHome
      if ($ndkHome) { Set-ToolEnv "NDK_HOME" $ndkHome }
      Add-UserPath (Join-Path $SdkRoot "cmdline-tools\latest\bin")
      Add-UserPath (Join-Path $SdkRoot "platform-tools")
      Add-Stage "Install Rust Android targets"
      Install-RustTargets
    } else {
      Add-Stage "Bundled Android offline environment is ready; network downloads were skipped"
    }
  }

  $javaHome = Find-JavaHome
  if ($javaHome) {
    Set-ToolEnv "JAVA_HOME" $javaHome
    Add-PathForCurrentProcess (Join-Path $javaHome "bin")
    if ($Install) { Add-UserPath (Join-Path $javaHome "bin") }
    Add-Check "java" "JDK / JAVA_HOME" "PASS" $javaHome "JDK is available." ""
  } else {
    Add-Check "java" "JDK / JAVA_HOME" "BLOCKED" "" "JDK was not found." "Click the Android environment repair button, or install Android Studio/JDK 17 and set JAVA_HOME."
  }

  $sdkManager = Get-SdkManagerPath
  if ($sdkManager) {
    Set-ToolEnv "ANDROID_HOME" $SdkRoot
    Set-ToolEnv "ANDROID_SDK_ROOT" $SdkRoot
    Add-PathForCurrentProcess (Join-Path $SdkRoot "cmdline-tools\latest\bin")
    if ($Install) {
      Add-UserPath (Join-Path $SdkRoot "cmdline-tools\latest\bin")
      Add-UserPath (Join-Path $SdkRoot "platform-tools")
    }
    Add-Check "sdkmanager" "Android SDK Command-line Tools" "PASS" $sdkManager "sdkmanager is available." ""
  } else {
    Add-Check "sdkmanager" "Android SDK Command-line Tools" "BLOCKED" "" "Android command-line tools were not found." "Click the Android environment repair button, or install Android SDK Command-line Tools and set ANDROID_HOME."
  }

  if (Test-InstalledSdkPackage "platform-tools") {
    Add-PathForCurrentProcess (Join-Path $SdkRoot "platform-tools")
    Add-Check "platform_tools" "Android SDK Platform-Tools" "PASS" (Join-Path $SdkRoot "platform-tools") "platform-tools is installed." ""
  } else {
    Add-Check "platform_tools" "Android SDK Platform-Tools" "BLOCKED" "" "platform-tools is missing." "Run sdkmanager --install platform-tools."
  }

  if (Test-InstalledSdkPackage "platforms\android-$ApiLevel") {
    Add-Check "android_platform" "Android SDK Platform android-$ApiLevel" "PASS" (Join-Path $SdkRoot "platforms\android-$ApiLevel") "Android platform is installed." ""
  } else {
    Add-Check "android_platform" "Android SDK Platform android-$ApiLevel" "BLOCKED" "" "Android platform android-$ApiLevel is missing." "Install the Android platform package for this API level with sdkmanager."
  }

  if (Test-InstalledSdkPackage "build-tools\$BuildToolsVersion") {
    Add-Check "build_tools" "Android SDK Build-Tools $BuildToolsVersion" "PASS" (Join-Path $SdkRoot "build-tools\$BuildToolsVersion") "Android build-tools is installed." ""
  } else {
    Add-Check "build_tools" "Android SDK Build-Tools $BuildToolsVersion" "BLOCKED" "" "Android build-tools $BuildToolsVersion is missing." "Install the matching Android build-tools package with sdkmanager."
  }

  $ndkHome = Get-NdkHome
  if ($ndkHome) {
    Set-ToolEnv "NDK_HOME" $ndkHome
    Add-Check "ndk" "Android NDK Side by side" "PASS" $ndkHome "NDK is installed." ""
  } else {
    Add-Check "ndk" "Android NDK Side by side" "BLOCKED" "" "Android NDK was not found." "Install the matching Android NDK package with sdkmanager and set NDK_HOME."
  }

  foreach ($tool in @("node", "npm", "cargo", "rustup")) {
    $name = if ($tool -eq "npm") { if (Test-CommandExists "npm.cmd") { "npm.cmd" } else { "npm" } } else { $tool }
    $path = Get-CommandPath $name
    if ($path) {
      Add-Check $tool $tool "PASS" $path "$tool is available." ""
    } else {
      $fix = if ($tool -eq "node" -or $tool -eq "npm") { "Install Node.js LTS." } else { "Install Rust with rustup and choose the MSVC toolchain." }
      Add-Check $tool $tool "BLOCKED" "" "$tool was not found." $fix
    }
  }

  $msvcEnvironment = Resolve-AgentVNMsvcEnvironment
  if ($msvcEnvironment.status -ne "PASS" -and $Install) {
    $msvcInstallWarning = Install-AgentVNMsvcBuildTools
    if ($msvcInstallWarning) { $Warnings.Add($msvcInstallWarning) | Out-Null }
    $msvcEnvironment = Resolve-AgentVNMsvcEnvironment
  }
  if ($msvcEnvironment.status -eq "PASS") {
    Add-Check "windows_msvc_linker" "Windows MSVC linker / Windows SDK" "PASS" ([string]$msvcEnvironment.linkPath) "The Windows host linker environment required by Rust build scripts is available." ""
  } else {
    Add-Check "windows_msvc_linker" "Windows MSVC linker / Windows SDK" "BLOCKED" "" ([string]$msvcEnvironment.message) "Install Visual Studio 2022 Build Tools with the C++ workload and a Windows SDK, then rerun Android environment repair."
  }

  $installedTargets = ""
  if (Test-CommandExists "rustup") {
    $installedTargets = (& rustup target list --installed) -join "`n"
  }
  foreach ($target in @("aarch64-linux-android", "armv7-linux-androideabi", "i686-linux-android", "x86_64-linux-android")) {
    if ($installedTargets -match [regex]::Escape($target)) {
      Add-Check "rust_target_$target" "Rust target $target" "PASS" $target "Rust Android target is installed." ""
    } else {
      Add-Check "rust_target_$target" "Rust target $target" "BLOCKED" "" "Rust target $target is missing." "Run rustup target add $target."
    }
  }
} catch {
  $Warnings.Add($_.Exception.Message) | Out-Null
  Add-Check "android_env_tool" "Android environment tool" "BLOCKED" "" $_.Exception.Message "Check the repair log and rerun the tool."
}

$resolvedSymlinkProbeRoot = if ([string]::IsNullOrWhiteSpace($SymlinkProbeRoot)) {
  Join-Path (Split-Path -Parent $ReportPath) "symlink-probe-workspace"
} else {
  [System.IO.Path]::GetFullPath($SymlinkProbeRoot)
}
try {
  $SymlinkCapability = Test-SymlinkCapability -ProbeRoot $resolvedSymlinkProbeRoot
  Add-AndroidSymlinkEnvironmentCheck `
    -Capability $SymlinkCapability `
    -ProbeRoot $resolvedSymlinkProbeRoot
} catch {
  $SymlinkCapability = [ordered]@{
    schemaVersion = 2
    probeRoot = $resolvedSymlinkProbeRoot
    sourcePath = ""
    linkPath = ""
    success = $false
    win32ErrorCode = 0
    error = $_.Exception.Message
    windowsBuild = [Environment]::OSVersion.Version.ToString()
    checkedAt = (Get-Date).ToUniversalTime().ToString("o")
    isElevated = Get-ProcessElevationState
    developerModeEnabled = $false
    developerModeRegistryValue = $null
    symbolicLinkPrivilegePresent = $false
    symbolicLinkPrivilegeEnabled = $false
    symbolicLinkPrivilegeQueryError = $_.Exception.Message
  }
  Add-Check "windows_symlink_capability" "Windows symbolic-link capability" "BLOCKED" $resolvedSymlinkProbeRoot $_.Exception.Message "The symbolic-link probe failed before it could classify the permission requirement; inspect the environment log."
}

$blocked = @($Checks | Where-Object { $_.status -ne "PASS" })
$status = if ($blocked.Count -eq 0) { "PASS" } else { "BLOCKED" }
if ($status -ne "PASS" -and $Install -and $ResetManagedEnvironment) {
  $managedToolchainBlocked = @($blocked | Where-Object {
    [string]$_.id -notin @("windows_msvc_linker", "windows_symlink_capability")
  })
  if ($managedToolchainBlocked.Count -gt 0) {
    foreach ($target in @($ToolRoot, $AgentVNGradleHome, $PassCachePath)) {
      Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
    }
    $Warnings.Add("ANDROID_ENV_INSTALL_INCOMPLETE: the partial AgentVN-managed Android environment was removed after installation failed.") | Out-Null
  } else {
    $Warnings.Add("ANDROID_HOST_PREREQUISITE_MISSING: the imported Android SDK/JDK/NDK/Rust toolchain was retained; only Windows host prerequisites remain incomplete.") | Out-Null
  }
}
$message = if ($status -eq "PASS") {
  "Android build environment is ready."
} elseif ($Install) {
  "Android build environment is still incomplete after repair. Check the missing items and log."
} else {
  "Android build environment is incomplete. Run this tool with -Install or use the editor repair button."
}

$result = [ordered]@{
  cacheSchemaVersion = $EnvironmentPassCacheSchemaVersion
  cachePlatform = "android"
  cacheHit = $false
  ok = ($status -eq "PASS")
  status = $status
  message = $message
  installAttempted = ($Install.IsPresent)
  installSource = $InstallSource
  reclaimedBytes = [int64]$ReclaimedBytes
  toolRoot = $ToolRoot
  sdkRoot = $SdkRoot
  jdkHome = $javaHome
  ndkHome = $ndkHome
  apiLevel = $ApiLevel
  buildToolsVersion = $BuildToolsVersion
  ndkVersion = $NdkVersion
  gradleVersion = $GradleVersion
  gradleDistributionPath = if (Test-Path -LiteralPath $GradleDistributionPath) { $GradleDistributionPath } else { "" }
  gradleUserHome = if (Test-Path -LiteralPath $AgentVNGradleHome) { $AgentVNGradleHome } else { "" }
  offlinePack = $OfflinePackState
  checks = @($Checks.ToArray())
  missing = @($blocked | ForEach-Object { $_.label })
  warnings = @($Warnings.ToArray())
  actions = @($Actions.ToArray())
  symlinkCapability = $SymlinkCapability
  symlinkElevation = $SymlinkElevation
  reportPath = $ReportPath
  logPath = $LogPath
  passCachePath = $PassCachePath
  manualFix = @(
    "Install Android Studio or Android SDK Command-line Tools.",
    "Install SDK Platform, Platform-Tools, Build-Tools, Command-line Tools, and NDK (Side by side) with sdkmanager.",
    "Set JAVA_HOME, ANDROID_HOME, ANDROID_SDK_ROOT, and NDK_HOME.",
    "Install Visual Studio 2022 Build Tools with the C++ workload and a Windows SDK.",
    "Run: rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android",
    "Restart AgentVN after persistent environment variables are updated."
  )
}

$jsonText = Write-Utf8JsonAtomic -Path $ReportPath -Value $result
if ($status -eq "PASS") {
  if ($Install -and $ResetManagedEnvironment) {
    $onlineMarker = [ordered]@{
      schemaVersion = 2
      installSource = "online"
      packageId = "agentvn.android.windows-x86_64.api$ApiLevel"
      packVersion = "online-$ApiLevel-$BuildToolsVersion-$NdkVersion"
      manifestSha256 = ""
      installedAt = (Get-Date).ToUniversalTime().ToString("o")
      sourceRoot = ""
      totalBytes = (Get-DirectoryBytes $ToolRoot) + (Get-DirectoryBytes $AgentVNGradleHome)
      fileCount = (Get-ChildItem -LiteralPath $ToolRoot, $AgentVNGradleHome -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object).Count
    }
    Write-Utf8JsonAtomic -Path (Join-Path $ToolRoot "offline-pack-deployment.json") -Value $onlineMarker | Out-Null
  }
  Write-Utf8JsonAtomic -Path $PassCachePath -Value $result | Out-Null
}
if ($Json) { Write-Output $jsonText }
if ($status -eq "PASS") { exit 0 }
exit 2
