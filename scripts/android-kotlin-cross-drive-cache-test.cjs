const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const buildScript = path.join(root, "scripts", "build-runtime-standalone-android.ps1");
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-kotlin-cross-drive-"));
const harnessPath = path.join(fixtureRoot, "policy-test.ps1");
const gradlePropertiesPath = path.join(fixtureRoot, "gen", "android", "gradle.properties");

const harness = String.raw`
param(
  [Parameter(Mandatory = $true)][string]$BuildScript,
  [Parameter(Mandatory = $true)][string]$GradlePropertiesPath
)
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
  $BuildScript,
  [ref]$tokens,
  [ref]$parseErrors
)
if ($parseErrors.Count -gt 0) { throw $parseErrors[0].Message }
$functionAst = $ast.Find({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq "Set-AndroidKotlinCompilerPolicy"
}, $true)
if (-not $functionAst) { throw "Missing Set-AndroidKotlinCompilerPolicy." }
. ([scriptblock]::Create($functionAst.Extent.Text))
Set-AndroidKotlinCompilerPolicy -GradlePropertiesPath $GradlePropertiesPath
Set-AndroidKotlinCompilerPolicy -GradlePropertiesPath $GradlePropertiesPath
`;

try {
  fs.mkdirSync(path.dirname(gradlePropertiesPath), { recursive: true });
  fs.writeFileSync(
    gradlePropertiesPath,
    [
      "org.gradle.jvmargs=-Xmx2048m",
      "kotlin.incremental=true",
      "kotlin.compiler.execution.strategy=daemon",
      "custom.property=keep",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(harnessPath, harness, "utf8");
  const result = childProcess.spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      harnessPath,
      "-BuildScript",
      buildScript,
      "-GradlePropertiesPath",
      gradlePropertiesPath,
    ],
    { cwd: root, encoding: "utf8", windowsHide: true },
  );
  assert.equal(
    result.status,
    0,
    `Kotlin cross-drive policy harness failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  const text = fs.readFileSync(gradlePropertiesPath, "utf8");
  assert.match(text, /^kotlin\.incremental=false$/m);
  assert.match(text, /^kotlin\.incremental\.useClasspathSnapshot=false$/m);
  assert.match(text, /^kotlin\.compiler\.execution\.strategy=in-process$/m);
  assert.match(text, /^custom\.property=keep$/m);
  assert.equal((text.match(/^kotlin\.incremental=/gm) || []).length, 1);
  assert.equal((text.match(/^kotlin\.compiler\.execution\.strategy=/gm) || []).length, 1);
  console.log("PASS Android Kotlin incremental cache policy is cross-drive safe and idempotent");
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
