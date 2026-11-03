const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const setupScript = path.join(root, "scripts", "setup-android-build-env.ps1");
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-msvc-elevation-"));
const harnessPath = path.join(fixtureRoot, "msvc-elevation-policy.ps1");
const resultPath = path.join(fixtureRoot, "result.json");

const harness = String.raw`
param(
  [Parameter(Mandatory = $true)][string]$SetupScript,
  [Parameter(Mandatory = $true)][string]$ResultPath
)
$ErrorActionPreference = "Stop"

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
$functionAst = $ast.Find({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq "Install-AgentVNMsvcBuildTools"
}, $true)
if (-not $functionAst) {
  throw "Missing Install-AgentVNMsvcBuildTools in Android setup script."
}
. ([scriptblock]::Create($functionAst.Extent.Text))

$script:Calls = @()
$script:IsAdministratorFixture = $false
function Add-Stage {}
function Get-CommandPath { return "C:\fixture\winget.exe" }
function Test-AgentVNAdministrator { return $script:IsAdministratorFixture }
function Invoke-LoggedProcess {
  param([string]$FilePath, [string[]]$ArgumentList)
  $script:Calls += [pscustomobject][ordered]@{
    elevated = $false
    filePath = $FilePath
    arguments = @($ArgumentList)
  }
  return 0
}
function Invoke-LoggedElevatedProcess {
  param([string]$FilePath, [string[]]$ArgumentList)
  $script:Calls += [pscustomobject][ordered]@{
    elevated = $true
    filePath = $FilePath
    arguments = @($ArgumentList)
  }
  return 0
}

$nonAdminWarning = Install-AgentVNMsvcBuildTools
$script:IsAdministratorFixture = $true
$adminWarning = Install-AgentVNMsvcBuildTools

[ordered]@{
  nonAdminWarning = $nonAdminWarning
  adminWarning = $adminWarning
  calls = @($script:Calls)
} | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $ResultPath -Encoding UTF8
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
      "-ResultPath",
      resultPath,
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
    `MSVC elevation policy fixture failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  const report = JSON.parse(fs.readFileSync(resultPath, "utf8").replace(/^\uFEFF/, ""));
  assert.equal(report.nonAdminWarning, "");
  assert.equal(report.adminWarning, "");
  assert.equal(report.calls.length, 2);
  assert.equal(
    report.calls[0].elevated,
    true,
    "A normal editor process must launch the MSVC installer through an explicit RunAs helper",
  );
  assert.equal(
    report.calls[1].elevated,
    false,
    "An already elevated process must not request a second UAC prompt",
  );
  for (const call of report.calls) {
    assert.equal(call.filePath, "C:\\fixture\\winget.exe");
    assert.equal(
      call.arguments.at(-1),
      '"--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"',
    );
  }

  const source = fs.readFileSync(setupScript, "utf8");
  assert.match(source, /function\s+Invoke-LoggedElevatedProcess/);
  assert.match(source, /Verb\s*=\s*"RunAs"/);
  assert.match(source, /WINDOWS_MSVC_UAC_CANCELLED/);
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log("PASS Android MSVC repair explicitly elevates winget and reports UAC cancellation");
