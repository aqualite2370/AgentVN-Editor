const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const buildScript = path.join(root, "scripts", "build-runtime-standalone-android.ps1");

function runFixture(mode) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), `agentvn-offline-gradle-${mode}-`));
  const propertiesPath = path.join(fixtureRoot, "gradle", "wrapper", "gradle-wrapper.properties");
  const distributionPath = path.join(fixtureRoot, "离线 环境", "gradle-8.14.3-bin.zip");
  const gradleHome = path.join(fixtureRoot, "Gradle Home");
  const logPath = path.join(fixtureRoot, "diagnostics", "build.log");
  const harnessPath = path.join(fixtureRoot, "invoke-offline-gradle.ps1");
  fs.mkdirSync(path.dirname(propertiesPath), { recursive: true });
  fs.mkdirSync(path.dirname(distributionPath), { recursive: true });
  fs.writeFileSync(distributionPath, "fixture");
  fs.writeFileSync(
    propertiesPath,
    mode === "missing-distribution-url"
      ? "networkTimeout=10000\n"
      : "distributionUrl=https\\://services.gradle.org/distributions/gradle-8.14.3-bin.zip\nnetworkTimeout=10000\n",
    "utf8",
  );
  const harness = String.raw`
param(
  [Parameter(Mandatory = $true)][string]$BuildScript,
  [Parameter(Mandatory = $true)][string]$PropertiesPath,
  [Parameter(Mandatory = $true)][string]$DistributionPath,
  [Parameter(Mandatory = $true)][string]$GradleHome,
  [Parameter(Mandatory = $true)][string]$LogPath,
  [Parameter(Mandatory = $true)][string]$Mode
)
$ErrorActionPreference = "Stop"
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
  $BuildScript,
  [ref]$tokens,
  [ref]$parseErrors
)
if ($parseErrors.Count -gt 0) { throw $parseErrors[0].Message }
foreach ($functionName in @("Add-Utf8Log", "Use-AgentVNOfflineGradle")) {
  $functionAst = $ast.Find({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -eq $functionName
  }, $true)
  if (-not $functionAst) { throw "Missing function: $functionName" }
  . ([scriptblock]::Create($functionAst.Extent.Text))
}
$AndroidGradleWrapperPropertiesPath = $PropertiesPath
$BuildLog = $LogPath
if ($Mode -eq "missing-distribution-url") {
  try {
    $null = Use-AgentVNOfflineGradle -DistributionPath $DistributionPath -GradleHome $GradleHome
  } catch {
    if ($_.Exception.Message -notmatch "ANDROID_OFFLINE_PACK_INCOMPLETE") { throw }
    Write-Output "PASS missing distributionUrl rejected"
    exit 0
  }
  throw "Missing distributionUrl must be rejected."
}
$configured = Use-AgentVNOfflineGradle -DistributionPath $DistributionPath -GradleHome $GradleHome
if (-not $configured) { throw "Offline Gradle was not configured." }
$bytes = [System.IO.File]::ReadAllBytes($PropertiesPath)
if (
  $bytes.Length -ge 3 -and
  $bytes[0] -eq 0xEF -and
  $bytes[1] -eq 0xBB -and
  $bytes[2] -eq 0xBF
) {
  throw "Gradle wrapper properties must be UTF-8 without BOM."
}
$text = (New-Object System.Text.UTF8Encoding($false, $true)).GetString($bytes)
if ($text -notmatch '(?m)^distributionUrl=file:///') {
  throw "Gradle wrapper distributionUrl was not replaced with the offline archive."
}
Write-Output "PASS offline Gradle mutation"
`;
  fs.writeFileSync(harnessPath, harness, "utf8");
  try {
    return childProcess.spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        harnessPath,
        "-BuildScript",
        buildScript,
        "-PropertiesPath",
        propertiesPath,
        "-DistributionPath",
        distributionPath,
        "-GradleHome",
        gradleHome,
        "-LogPath",
        logPath,
        "-Mode",
        mode,
      ],
      {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
      },
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

const valid = runFixture("valid");
assert.equal(
  valid.status,
  0,
  `valid offline Gradle fixture failed:\nstdout:\n${valid.stdout}\nstderr:\n${valid.stderr}`,
);
assert.match(valid.stdout, /PASS offline Gradle mutation/);

const missingDistributionUrl = runFixture("missing-distribution-url");
assert.equal(
  missingDistributionUrl.status,
  0,
  `missing distributionUrl contract failed:\nstdout:\n${missingDistributionUrl.stdout}\nstderr:\n${missingDistributionUrl.stderr}`,
);
assert.match(missingDistributionUrl.stdout, /PASS missing distributionUrl rejected/);

console.log("PASS offline Gradle configuration validates generated wrapper templates");
