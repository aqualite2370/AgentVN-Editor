const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const buildScript = path.join(root, "scripts", "build-runtime-standalone-android.ps1");
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-android-long-resource-"));
const packagedDir = path.join(fixtureRoot, "prepared", "embedded-cartridge");
const assetRelativePath = path.join(
  "assets",
  "background",
  "98430f7e-c311-4444-93c4-502b35afaaf2-98430f7e-c311-4444-93c4-502b35afaaf2.webp",
);

let deepWorkspaceRoot = path.join(
  fixtureRoot,
  "standalone-package",
  "1786942044417",
  "build-workspace",
);
const generatedSuffix = path.join(
  "GameCli_framework",
  "src-tauri",
  "gen",
  "android",
  "app",
  "src",
  "main",
  "assets",
  "embedded-cartridge",
);
while (path.join(deepWorkspaceRoot, generatedSuffix, assetRelativePath).length <= 275) {
  deepWorkspaceRoot = path.join(deepWorkspaceRoot, "deep-workspace-segment");
}

const generatedDir = path.join(deepWorkspaceRoot, generatedSuffix);
const generatedBuildDir = path.join(
  deepWorkspaceRoot,
  "GameCli_framework",
  "src-tauri",
  "gen",
  "android",
  "app",
  "build",
);
const longSourcePath = path.join(packagedDir, assetRelativePath);
const longTargetPath = path.join(generatedDir, assetRelativePath);
const buildLogPath = path.join(fixtureRoot, "build.log");
const harnessPath = path.join(fixtureRoot, "invoke-long-resource-sync.ps1");
const assetBytes = Buffer.from("agentvn-long-path-android-resource\n", "utf8");

const harness = String.raw`
param(
  [Parameter(Mandatory = $true)][string]$BuildScript,
  [Parameter(Mandatory = $true)][string]$PackagedDir,
  [Parameter(Mandatory = $true)][string]$GeneratedDir,
  [Parameter(Mandatory = $true)][string]$GeneratedBuildDir,
  [Parameter(Mandatory = $true)][string]$BuildLogPath
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
foreach ($functionName in @(
  "Add-Utf8Log",
  "ConvertTo-AgentVNExtendedPath",
  "Get-AgentVNDirectoryFileCount",
  "Copy-AgentVNDirectoryContents",
  "Remove-AgentVNDirectoryTree",
  "Reset-AndroidPackagedResourceOutputs",
  "Sync-AndroidPackagedResources"
)) {
  $functionAst = $ast.Find({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -eq $functionName
  }, $true)
  if (-not $functionAst) {
    throw "Missing function in Android build script: $functionName"
  }
  . ([scriptblock]::Create($functionAst.Extent.Text))
}

$PackagedEmbeddedDir = $PackagedDir
$AndroidGeneratedEmbeddedDir = $GeneratedDir
$AndroidGeneratedBuildDir = $GeneratedBuildDir
$BuildLog = $BuildLogPath

Sync-AndroidPackagedResources
Reset-AndroidPackagedResourceOutputs
Sync-AndroidPackagedResources
Write-Output "PASS Android packaged-resource sync supports long generated paths"
`;

try {
  for (const required of [
    "manifest.json",
    "script.json",
    "checksum.json",
    "startup-index.json",
  ]) {
    fs.mkdirSync(packagedDir, { recursive: true });
    fs.writeFileSync(path.join(packagedDir, required), `{"fixture":"${required}"}\n`, "utf8");
  }
  fs.mkdirSync(path.dirname(longSourcePath), { recursive: true });
  fs.writeFileSync(longSourcePath, assetBytes);
  fs.writeFileSync(harnessPath, harness, "utf8");

  assert.ok(
    longTargetPath.length > 260,
    `fixture must exceed traditional Windows MAX_PATH, got ${longTargetPath.length}`,
  );

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
      "-PackagedDir",
      packagedDir,
      "-GeneratedDir",
      generatedDir,
      "-GeneratedBuildDir",
      generatedBuildDir,
      "-BuildLogPath",
      buildLogPath,
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
    [
      `Android long-path resource fixture failed (target length ${longTargetPath.length}).`,
      `stdout:\n${result.stdout}`,
      `stderr:\n${result.stderr}`,
    ].join("\n"),
  );
  assert.match(result.stdout, /PASS Android packaged-resource sync supports long generated paths/);
  assert.equal(fs.existsSync(longTargetPath), true, "long-path Android asset was not copied");
  assert.equal(
    crypto.createHash("sha256").update(fs.readFileSync(longTargetPath)).digest("hex"),
    crypto.createHash("sha256").update(assetBytes).digest("hex"),
    "long-path Android asset changed during synchronization",
  );
  assert.equal(
    fs.readdirSync(generatedDir, { recursive: true }).filter((entry) => {
      return fs.statSync(path.join(generatedDir, entry)).isFile();
    }).length,
    5,
    "generated Android asset tree has an unexpected file count",
  );
  console.log(
    `PASS Android packaged-resource sync supports a ${longTargetPath.length}-character target path`,
  );
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
