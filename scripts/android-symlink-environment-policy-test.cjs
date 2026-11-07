const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const setupScript = path.join(root, "scripts", "setup-android-build-env.ps1");
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-symlink-policy-"));
const harnessPath = path.join(fixtureRoot, "policy-harness.ps1");

const harness = String.raw`
param([Parameter(Mandatory = $true)][string]$SetupScript)
$ErrorActionPreference = "Stop"
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
  $SetupScript,
  [ref]$tokens,
  [ref]$parseErrors
)
if ($parseErrors.Count -gt 0) {
  throw "Android environment script has PowerShell parse errors: $($parseErrors[0].Message)"
}
$functionAst = $ast.Find({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq "Add-AndroidSymlinkEnvironmentCheck"
}, $true)
if (-not $functionAst) {
  throw "Missing Add-AndroidSymlinkEnvironmentCheck in Android environment script."
}
. ([scriptblock]::Create($functionAst.Extent.Text))

function Invoke-PolicyCase([bool]$Elevated, [int]$Win32Code) {
  $script:Checks = New-Object System.Collections.ArrayList
  $script:Warnings = New-Object System.Collections.ArrayList
  $script:SymlinkElevation = [ordered]@{
    attempted = $false
    status = "NOT_REQUIRED"
    reason = ""
  }
  function Add-Check(
    [string]$Id,
    [string]$Label,
    [string]$Status,
    [string]$Path,
    [string]$Detail,
    [string]$Fix
  ) {
    $script:Checks.Add([ordered]@{
      id = $Id
      label = $Label
      status = $Status
      path = $Path
      detail = $Detail
      fix = $Fix
    }) | Out-Null
  }
  $capability = [pscustomobject]@{
    success = $false
    isElevated = $Elevated
    win32ErrorCode = $Win32Code
  }
  $parameters = @{
    Capability = $capability
    ProbeRoot = "C:\AgentVN\build-workspace"
  }
  try {
    Add-AndroidSymlinkEnvironmentCheck @parameters
  } catch {
    throw ("Policy case failed: " + $_.Exception.Message + " | " + $_.InvocationInfo.PositionMessage + " | " + $_.ScriptStackTrace)
  }
  return [ordered]@{
    check = @($script:Checks)[0]
    warnings = @($script:Warnings)
    elevation = $script:SymlinkElevation
  }
}

[ordered]@{
  normalUserPrivilegeRequired = Invoke-PolicyCase -Elevated $false -Win32Code 1314
  elevatedPrivilegeDenied = Invoke-PolicyCase -Elevated $true -Win32Code 1314
  unsupportedFilesystem = Invoke-PolicyCase -Elevated $false -Win32Code 50
} | ConvertTo-Json -Depth 10 -Compress
`;

try {
  fs.writeFileSync(harnessPath, harness, "utf8");
  const result = childProcess.spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      harnessPath,
      "-SetupScript",
      setupScript,
    ],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    },
  );
  assert.equal(
    result.status,
    0,
    `Android symlink environment policy harness failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  const report = JSON.parse(result.stdout.trim());
  assert.equal(report.normalUserPrivilegeRequired.check.status, "PASS");
  assert.equal(report.normalUserPrivilegeRequired.elevation.attempted, false);
  assert.equal(report.normalUserPrivilegeRequired.elevation.status, "DEFERRED_TO_BUILD");
  assert.match(
    report.normalUserPrivilegeRequired.warnings.join("\n"),
    /ANDROID_BUILD_ELEVATION_REQUIRED/,
  );
  assert.doesNotMatch(
    report.normalUserPrivilegeRequired.warnings.join("\n") + report.normalUserPrivilegeRequired.check.detail,
    /Android tooling is (installed|ready)/,
    "A permission-only check cannot claim the SDK/JDK/NDK toolchain is ready",
  );
  assert.equal(report.elevatedPrivilegeDenied.check.status, "BLOCKED");
  assert.equal(report.unsupportedFilesystem.check.status, "BLOCKED");
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log(
  "PASS Android environment defers normal-user symlink elevation to the real build",
);
