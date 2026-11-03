const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const buildScript = path.join(root, "scripts", "build-runtime-standalone-android.ps1");

function runFixture(mode) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), `agentvn-release-identity-${mode}-`));
  const runtimeRoot = path.join(fixtureRoot, "构建 工作区", "GameCli_framework");
  const tauriConfigPath = path.join(runtimeRoot, "src-tauri", "tauri.conf.json");
  const gradlePath = path.join(runtimeRoot, "src-tauri", "gen", "android", "app", "build.gradle.kts");
  const propertiesPath = path.join(runtimeRoot, "src-tauri", "gen", "android", "app", "tauri.properties");
  const stringsPath = path.join(
    runtimeRoot,
    "src-tauri",
    "gen",
    "android",
    "app",
    "src",
    "main",
    "res",
    "values",
    "strings.xml",
  );
  const activityPath = path.join(
    runtimeRoot,
    "src-tauri",
    "gen",
    "android",
    "app",
    "src",
    "main",
    "java",
    "com",
    "agentvn",
    "player",
    "MainActivity.kt",
  );
  const proguardPath = path.join(
    runtimeRoot,
    "src-tauri",
    "gen",
    "android",
    "app",
    "proguard-tauri.pro",
  );
  const buildLogPath = path.join(fixtureRoot, "diagnostics", "build.log");
  const harnessPath = path.join(fixtureRoot, "invoke-release-identity.ps1");

  fs.mkdirSync(path.dirname(tauriConfigPath), { recursive: true });
  fs.mkdirSync(path.dirname(gradlePath), { recursive: true });
  fs.mkdirSync(path.dirname(stringsPath), { recursive: true });
  fs.mkdirSync(path.dirname(activityPath), { recursive: true });
  fs.mkdirSync(path.dirname(proguardPath), { recursive: true });
  const binaryProfilePath = path.join(
    runtimeRoot,
    "src-tauri",
    "gen",
    "android",
    "app",
    "build",
    "intermediates",
    "binary_art_profile",
    "universalRelease",
    "compileUniversalReleaseArtProfile",
    "baseline.prof",
  );
  fs.mkdirSync(path.dirname(binaryProfilePath), { recursive: true });
  fs.mkdirSync(path.dirname(buildLogPath), { recursive: true });
  fs.writeFileSync(
    tauriConfigPath,
    `${JSON.stringify({
      productName: "AgentVN Player",
      version: "1.8.0",
      identifier: "com.agentvn.player",
      build: { beforeBuildCommand: "npm run build" },
      bundle: { android: { versionCode: 1 } },
      app: { windows: [{ title: "AgentVN Player" }] },
    }, null, 2)}\n`,
    "utf8",
  );
  const applicationIdLine = mode === "missing-application-id"
    ? ""
    : '        applicationId = "com.agentvn.player"\n';
  fs.writeFileSync(
    gradlePath,
    `android {\n    namespace = "com.agentvn.player"\n    defaultConfig {\n${applicationIdLine}    }\n}\n`,
    "utf8",
  );
  fs.writeFileSync(
    activityPath,
    mode === "missing-kotlin-package"
      ? "class MainActivity\n"
      : "package com.agentvn.player\nclass MainActivity\n",
    "utf8",
  );
  fs.writeFileSync(
    proguardPath,
    `-keep class com.agentvn.player.TauriActivity {\n  public app.tauri.plugin.PluginManager getPluginManager();\n}\n`,
    "utf8",
  );
  fs.writeFileSync(binaryProfilePath, Buffer.from([
    0x70, 0x72, 0x6f, 0x01, 0xca, 0xfe, 0xba, 0xbe,
  ]));
  const harness = String.raw`
param(
  [Parameter(Mandatory = $true)][string]$BuildScript,
  [Parameter(Mandatory = $true)][string]$RuntimeRoot,
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
foreach ($functionName in @("Write-Utf8Atomic", "Read-Utf8Json", "Add-Utf8Log", "Apply-ReleaseIdentity")) {
  $functionAst = $ast.Find({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -eq $functionName
  }, $true)
  if (-not $functionAst) { throw "Missing function: $functionName" }
  . ([scriptblock]::Create($functionAst.Extent.Text))
}

$RuntimeTauriConfigPath = Join-Path $RuntimeRoot "src-tauri\tauri.conf.json"
$AndroidGradlePath = Join-Path $RuntimeRoot "src-tauri\gen\android\app\build.gradle.kts"
$AndroidPropertiesPath = Join-Path $RuntimeRoot "src-tauri\gen\android\app\tauri.properties"
$AndroidStringsPath = Join-Path $RuntimeRoot "src-tauri\gen\android\app\src\main\res\values\strings.xml"
$BuildLog = Join-Path (Split-Path -Parent $RuntimeRoot) "diagnostics\build.log"
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $BuildLog) | Out-Null
$ReleaseTitle = if ($Mode -eq "invalid-title") {
  "坏" + [char]0x01 + "标题"
} else {
  "隐忍的成长"
}
$ReleaseVersionName = "0.1.0"
$ReleaseVersionCode = 1000
$ReleaseApplicationId = "com.agentvn.game.unicode"

if ($Mode -eq "missing-application-id") {
  try {
    Apply-ReleaseIdentity
  } catch {
    if ($_.Exception.Message -notmatch "ANDROID_GRADLE_TEMPLATE_INVALID") {
      throw
    }
    Write-Output "PASS missing applicationId rejected before Gradle"
    exit 0
  }
  throw "Missing applicationId must be rejected before Gradle."
}
if ($Mode -eq "missing-kotlin-package") {
  try {
    Apply-ReleaseIdentity
  } catch {
    if ($_.Exception.Message -notmatch "ANDROID_KOTLIN_TEMPLATE_INVALID") {
      throw
    }
    Write-Output "PASS missing Kotlin package rejected before Gradle"
    exit 0
  }
  throw "Missing Kotlin package declaration must be rejected before Gradle."
}
if ($Mode -eq "invalid-title") {
  try {
    Apply-ReleaseIdentity
  } catch {
    if ($_.Exception.Message -notmatch "RELEASE_METADATA_INVALID") {
      throw
    }
    Write-Output "PASS invalid XML title rejected before Android files are written"
    exit 0
  }
  throw "Invalid XML title characters must be rejected before Android files are written."
}

Apply-ReleaseIdentity
$gradle = [System.IO.File]::ReadAllText(
  $AndroidGradlePath,
  (New-Object System.Text.UTF8Encoding($false, $true))
)
if ($gradle -notmatch 'namespace = "com\.agentvn\.game\.unicode"') {
  throw "Gradle namespace was not updated."
}
if ($gradle -notmatch 'applicationId = "com\.agentvn\.game\.unicode"') {
  throw "Gradle applicationId was not updated."
}
$proguard = [System.IO.File]::ReadAllText(
  (Join-Path $RuntimeRoot "src-tauri\gen\android\app\proguard-tauri.pro"),
  (New-Object System.Text.UTF8Encoding($false, $true))
)
if ($proguard -notmatch 'com\.agentvn\.game\.unicode\.TauriActivity') {
  throw "Tauri ProGuard keep rule was not updated with the release application id."
}
if ($proguard -match 'com\.agentvn\.player\.TauriActivity') {
  throw "Tauri ProGuard keep rule still references the generated template package."
}
[xml]$strings = [System.IO.File]::ReadAllText(
  $AndroidStringsPath,
  (New-Object System.Text.UTF8Encoding($false, $true))
)
if ($strings.resources.string[0].InnerText -ne "隐忍的成长") {
  throw "Unicode Android title was not preserved."
}
Write-Output "PASS release identity mutation"
`;
  fs.writeFileSync(
    harnessPath,
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(harness, "utf8")]),
  );

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
        "-RuntimeRoot",
        runtimeRoot,
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
  `valid release identity fixture failed:\nstdout:\n${valid.stdout}\nstderr:\n${valid.stderr}`,
);
assert.match(valid.stdout, /PASS release identity mutation/);

const missingApplicationId = runFixture("missing-application-id");
assert.equal(
  missingApplicationId.status,
  0,
  `missing applicationId contract failed:\nstdout:\n${missingApplicationId.stdout}\nstderr:\n${missingApplicationId.stderr}`,
);
assert.match(missingApplicationId.stdout, /PASS missing applicationId rejected before Gradle/);

const missingKotlinPackage = runFixture("missing-kotlin-package");
assert.equal(
  missingKotlinPackage.status,
  0,
  `missing Kotlin package contract failed:\nstdout:\n${missingKotlinPackage.stdout}\nstderr:\n${missingKotlinPackage.stderr}`,
);
assert.match(missingKotlinPackage.stdout, /PASS missing Kotlin package rejected before Gradle/);

const invalidTitle = runFixture("invalid-title");
assert.equal(
  invalidTitle.status,
  0,
  `invalid XML title contract failed:\nstdout:\n${invalidTitle.stdout}\nstderr:\n${invalidTitle.stderr}`,
);
assert.match(invalidTitle.stdout, /PASS invalid XML title rejected/);

console.log("PASS Android release identity mutations are validated before Gradle");
