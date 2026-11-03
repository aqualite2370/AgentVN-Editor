const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const setupScript = path.join(root, "scripts", "setup-android-build-env.ps1");
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-msvc-source-retry-"));
const harnessPath = path.join(fixtureRoot, "retry-winget.ps1");
const fakeWingetPath = path.join(fixtureRoot, "winget-fixture.exe");
const callsPath = path.join(fixtureRoot, "calls.log");

const harness = String.raw`
param(
  [Parameter(Mandatory = $true)][string]$SetupScript,
  [Parameter(Mandatory = $true)][string]$FakeWingetPath,
  [Parameter(Mandatory = $true)][string]$CallsPath
)
$ErrorActionPreference = "Stop"

$fixtureSource = @'
using System;
using System.IO;
using System.Linq;
using System.Text;

public static class AgentVNWingetRetryFixture {
  public static int Main(string[] args) {
    var path = Environment.GetEnvironmentVariable("AGENTVN_WINGET_CALLS");
    File.AppendAllText(path, String.Join("\t", args) + Environment.NewLine, new UTF8Encoding(false));
    if (args.Length > 0 && args[0] == "install") {
      var installCount = File.ReadAllLines(path).Count(line => line.StartsWith("install\t"));
      return installCount == 1 ? 1 : 0;
    }
    return 0;
  }
}
'@
Add-Type -TypeDefinition $fixtureSource -OutputAssembly $FakeWingetPath -OutputType ConsoleApplication

$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
  $SetupScript,
  [ref]$tokens,
  [ref]$parseErrors
)
if ($parseErrors.Count -gt 0) { throw $parseErrors[0].Message }
foreach ($functionName in @(
  "Invoke-LoggedProcess",
  "Reset-AgentVNWingetSources",
  "Install-AgentVNMsvcBuildTools"
)) {
  $functionAst = $ast.Find({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -eq $functionName
  }, $true)
  if (-not $functionAst) { throw "Missing $functionName" }
  . ([scriptblock]::Create($functionAst.Extent.Text))
}

$script:LogPath = Join-Path (Split-Path -Parent $CallsPath) "setup.log"
function Add-Utf8Log {}
function Add-Stage {}
function Get-CommandPath { return $FakeWingetPath }
function Test-AgentVNAdministrator { return $true }

$env:AGENTVN_WINGET_CALLS = $CallsPath
$warning = Install-AgentVNMsvcBuildTools
if (-not [string]::IsNullOrWhiteSpace($warning)) { throw $warning }
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
      "-FakeWingetPath",
      fakeWingetPath,
      "-CallsPath",
      callsPath,
    ],
    { cwd: root, encoding: "utf8", windowsHide: true },
  );
  assert.equal(
    result.status,
    0,
    `winget source retry fixture failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  const calls = fs.readFileSync(callsPath, "utf8").trim().split(/\r?\n/);
  assert.equal(calls[0].split("\t")[0], "install");
  assert.equal(calls[1], "source\treset\t--force");
  assert.equal(calls[2], "source\tupdate");
  assert.equal(calls[3].split("\t")[0], "install");
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log("PASS Android MSVC repair refreshes winget sources and retries failed installation");
