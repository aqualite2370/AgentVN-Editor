param(
    [Parameter(Mandatory=$true)][string]$TargetFile,
    [Parameter(Mandatory=$true)][string]$ReportFile
)
# QA-only: query owners and open existing bytes without truncation or writes.
$ErrorActionPreference = "Stop"
$MapTarget = (Resolve-Path -LiteralPath $TargetFile).Path
$MapWorkspace = (Resolve-Path -LiteralPath "D:\AgentVN").Path.TrimEnd('\') + '\'
if (-not $MapTarget.StartsWith($MapWorkspace, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Diagnostic target must be an explicit file inside the workspace"
}
if (Test-Path -LiteralPath $ReportFile) { throw "Never overwrite diagnostics" }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SourceMapOwners {
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
    public uint AppType, AppStatus, SessionId;
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
$MapRecord = [ordered]@{
    at = (Get-Date).ToString("o")
    file = $MapTarget
    beforeSha256 = (Get-FileHash -LiteralPath $MapTarget -Algorithm SHA256).Hash.ToLowerInvariant()
    bytes = (Get-Item -LiteralPath $MapTarget).Length
    scope = "Read-only Restart Manager query and nontruncating exclusive open; no shutdown, writes, rename, delete or ACL change"
}
[uint32]$MapSession = 0
$MapRecord.startCode = [SourceMapOwners]::RmStartSession([ref]$MapSession, 0, [guid]::NewGuid().ToString("N"))
if ($MapRecord.startCode -eq 0) {
    try {
        $MapRecord.registerCode = [SourceMapOwners]::RmRegisterResources($MapSession, 1,
            [string[]]@($MapTarget), 0, [IntPtr]::Zero, 0, [IntPtr]::Zero)
        [uint32]$MapRequired = 0
        [uint32]$MapCount = 0
        [uint32]$MapReasons = 0
        $MapCode = [SourceMapOwners]::RmGetList($MapSession, [ref]$MapRequired, [ref]$MapCount, $null, [ref]$MapReasons)
        if ($MapCode -eq 234) {
            $MapCount = $MapRequired
            $MapEntries = New-Object 'SourceMapOwners+ProcessInfo[]' $MapCount
            $MapCode = [SourceMapOwners]::RmGetList($MapSession, [ref]$MapRequired, [ref]$MapCount, $MapEntries, [ref]$MapReasons)
            $MapRecord.owners = @($MapEntries | Select-Object @{n="pid";e={$_.Process.ProcessId}}, AppName, ServiceName, AppStatus)
        } else { $MapRecord.owners = @() }
        $MapRecord.listCode = $MapCode
    } finally { $MapRecord.endCode = [SourceMapOwners]::RmEndSession($MapSession) }
}
$MapStream = $null
try {
    $MapStream = [System.IO.File]::Open($MapTarget, [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    $MapRecord.exclusiveNontruncatingOpen = "PASS"
} catch {
    $MapRecord.exclusiveNontruncatingOpen = "FAILED"
    $MapRecord.openError = $_.Exception.Message
} finally { if ($MapStream) { $MapStream.Dispose() } }
$MapRecord.afterSha256 = (Get-FileHash -LiteralPath $MapTarget -Algorithm SHA256).Hash.ToLowerInvariant()
if ($MapRecord.beforeSha256 -ne $MapRecord.afterSha256) { throw "Diagnostic changed bytes" }
$MapBytes = [System.Text.Encoding]::UTF8.GetBytes(($MapRecord | ConvertTo-Json -Depth 5))
$MapReportStream = [System.IO.File]::Open($ReportFile, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write)
try { $MapReportStream.Write($MapBytes, 0, $MapBytes.Length) } finally { $MapReportStream.Dispose() }
$MapRecord | ConvertTo-Json -Depth 5
