const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const buildScript = path.join(root, "scripts", "build-runtime-standalone-android.ps1");
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-android-kotlin-classification-"));
const logPath = path.join(fixtureRoot, "standalone-android-build.log");
const harnessPath = path.join(fixtureRoot, "classify.ps1");

const harness = String.raw`
param(
  [Parameter(Mandatory = $true)][string]$BuildScript,
  [Parameter(Mandatory = $true)][string]$LogPath
)
$ErrorActionPreference = "Stop"
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
  $BuildScript,
  [ref]$tokens,
  [ref]$parseErrors
)
if ($parseErrors.Count -gt 0) {
  throw "Android build script has PowerShell parse errors: $($parseErrors[0].Message)"
}
foreach ($functionName in @("Read-Utf8Text", "Classify-AndroidBuildFailure")) {
  $functionAst = $ast.Find({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -eq $functionName
  }, $true)
  if (-not $functionAst) {
    throw "Missing $functionName in Android build script."
  }
  . ([scriptblock]::Create($functionAst.Extent.Text))
}
$classification = Classify-AndroidBuildFailure -LogPath $LogPath
if ($classification -ne "ANDROID_KOTLIN_COMPILE_FAILED") {
  throw "Expected ANDROID_KOTLIN_COMPILE_FAILED, got '$classification'."
}
Write-Output $classification
`;

try {
  fs.writeFileSync(
    logPath,
    [
      "> Task :app:compileUniversalReleaseKotlin",
      "e: file:///C:/构建 工作区/MainActivity.kt:44:37 Unresolved reference: it",
      "Execution failed for task ':app:compileUniversalReleaseKotlin'.",
      "> Compilation error. See log for more details",
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
      "-LogPath",
      logPath,
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
    `Kotlin failure classification fixture failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.match(result.stdout, /ANDROID_KOTLIN_COMPILE_FAILED/);
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log("PASS Android Kotlin compile failures receive a stable failure code");
