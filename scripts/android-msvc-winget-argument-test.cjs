const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const setupScript = path.join(root, "scripts", "setup-android-build-env.ps1");
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-msvc-winget-"));
const harnessPath = path.join(fixtureRoot, "capture-winget-args.ps1");
const fakeWingetPath = path.join(fixtureRoot, "winget-fixture.exe");
const argvPath = path.join(fixtureRoot, "argv.json");

const harness = String.raw`
param(
  [Parameter(Mandatory = $true)][string]$SetupScript,
  [Parameter(Mandatory = $true)][string]$FakeWingetPath,
  [Parameter(Mandatory = $true)][string]$ArgvPath
)
$ErrorActionPreference = "Stop"

$fixtureSource = @'
using System;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

public static class AgentVNWingetFixture {
  public static int Main(string[] args) {
    var output = Environment.GetEnvironmentVariable("AGENTVN_WINGET_ARGV");
    File.WriteAllText(
      output,
      new JavaScriptSerializer().Serialize(args),
      new UTF8Encoding(false)
    );
    return 0;
  }
}
'@
$addTypeArgs = @{
  TypeDefinition = $fixtureSource
  Language = "CSharp"
  ReferencedAssemblies = "System.Web.Extensions"
  OutputAssembly = $FakeWingetPath
  OutputType = "ConsoleApplication"
}
Add-Type @addTypeArgs

$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
  $SetupScript,
  [ref]$tokens,
  [ref]$parseErrors
)
if ($parseErrors.Count -gt 0) {
  throw "Android setup script has PowerShell parse errors: $($parseErrors[0].Message)"
}
foreach ($functionName in @("Invoke-LoggedProcess", "Install-AgentVNMsvcBuildTools")) {
  $functionAst = $ast.Find({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -eq $functionName
  }, $true)
  if (-not $functionAst) {
    throw "Missing $functionName in Android setup script."
  }
  . ([scriptblock]::Create($functionAst.Extent.Text))
}

$script:LogPath = Join-Path (Split-Path -Parent $ArgvPath) "setup.log"
function Add-Utf8Log {}
function Add-Stage {}
function Get-CommandPath { return $FakeWingetPath }
function Test-AgentVNAdministrator { return $true }

$env:AGENTVN_WINGET_ARGV = $ArgvPath
$warning = Install-AgentVNMsvcBuildTools
if (-not [string]::IsNullOrWhiteSpace($warning)) {
  throw $warning
}
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
      "-ArgvPath",
      argvPath,
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
    `MSVC winget argument fixture failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  const argv = JSON.parse(fs.readFileSync(argvPath, "utf8"));
  assert.deepEqual(argv.slice(0, 8), [
    "install",
    "--id",
    "Microsoft.VisualStudio.2022.BuildTools",
    "--exact",
    "--silent",
    "--accept-package-agreements",
    "--accept-source-agreements",
    "--override",
  ]);
  assert.equal(
    argv.length,
    9,
    `winget --override must receive one installer argument, received ${JSON.stringify(argv)}`,
  );
  assert.equal(
    argv[8],
    "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended",
  );
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log("PASS Android MSVC repair keeps Visual Studio installer options inside winget --override");
