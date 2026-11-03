# One-shot QA diagnostic retained with the original failed build evidence.
$ErrorActionPreference = "Stop"
$NvlLockPath = "D:\AgentVN\editor\src-tauri\Cargo.lock"
$NvlDiagnosticPath = "F:\AgentVN\QA\NVL-Flow-Source-20261020-01\cargo-lock-diagnostic-01.json"
if (Test-Path -LiteralPath $NvlDiagnosticPath) { throw "Never overwrite diagnostics" }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NvlLockOwners {
  [StructLayout(LayoutKind.Sequential)]
  public struct UniqueProcess {
    public uint ProcessId;
    public System.Runtime.InteropServices.ComTypes.FILETIME StartTime;
  }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct ProcessInfo {
    public UniqueProcess Process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string AppName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string ServiceName;
    public uint AppType;
    public uint AppStatus;
    public uint SessionId;
    [MarshalAs(UnmanagedType.Bool)] public bool Restartable;
  }
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  public static extern int RmStartSession(out uint session, uint flags, string key);
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  public static extern int RmRegisterResources(uint session, uint count, string[] files,
    uint applications, IntPtr appList, uint services, IntPtr serviceList);
  [DllImport("rstrtmgr.dll")]
  public static extern int RmGetList(uint session, out uint required, ref uint count,
    [In, Out] ProcessInfo[] entries, ref uint reasons);
  [DllImport("rstrtmgr.dll")]
  public static extern int RmEndSession(uint session);
}
'@
$NvlRecord = [ordered]@{
  at = (Get-Date).ToString("o")
  file = $NvlLockPath
  beforeSha256 = (Get-FileHash -LiteralPath $NvlLockPath -Algorithm SHA256).Hash.ToLowerInvariant()
  scope = "Read-only resource-owner query and nontruncating exclusive open; no process shutdown"
}
[uint32]$NvlSession = 0
$NvlStartCode = [NvlLockOwners]::RmStartSession([ref]$NvlSession, 0, [guid]::NewGuid().ToString("N"))
$NvlRecord.startCode = $NvlStartCode
if ($NvlStartCode -eq 0) {
  try {
    $NvlRecord.registerCode = [NvlLockOwners]::RmRegisterResources($NvlSession, 1,
      [string[]]@($NvlLockPath), 0, [IntPtr]::Zero, 0, [IntPtr]::Zero)
    [uint32]$NvlRequired = 0
    [uint32]$NvlCount = 0
    [uint32]$NvlReasons = 0
    $NvlListCode = [NvlLockOwners]::RmGetList($NvlSession, [ref]$NvlRequired, [ref]$NvlCount, $null, [ref]$NvlReasons)
    if ($NvlListCode -eq 234) {
      $NvlCount = $NvlRequired
      $NvlEntries = New-Object 'NvlLockOwners+ProcessInfo[]' $NvlCount
      $NvlListCode = [NvlLockOwners]::RmGetList($NvlSession, [ref]$NvlRequired, [ref]$NvlCount, $NvlEntries, [ref]$NvlReasons)
      $NvlRecord.owners = @($NvlEntries | Select-Object @{n="pid";e={$_.Process.ProcessId}}, AppName, ServiceName, AppStatus)
    } else { $NvlRecord.owners = @() }
    $NvlRecord.listCode = $NvlListCode
    $NvlRecord.required = $NvlRequired
  } finally { $NvlRecord.endCode = [NvlLockOwners]::RmEndSession($NvlSession) }
}
$NvlStream = $null
try {
  # Open existing bytes only. Never truncate, rewrite, rename or remove the lock.
  $NvlStream = [System.IO.File]::Open($NvlLockPath, [System.IO.FileMode]::Open,
    [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
  $NvlRecord.exclusiveNontruncatingOpen = "PASS"
} catch {
  $NvlRecord.exclusiveNontruncatingOpen = "FAILED"
  $NvlRecord.openError = $_.Exception.Message
} finally { if ($NvlStream) { $NvlStream.Dispose() } }
$NvlRecord.afterSha256 = (Get-FileHash -LiteralPath $NvlLockPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($NvlRecord.beforeSha256 -ne $NvlRecord.afterSha256) { throw "Lock bytes changed during read-only diagnosis" }
$NvlRecord | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $NvlDiagnosticPath -Encoding UTF8
$NvlRecord | ConvertTo-Json -Depth 5
