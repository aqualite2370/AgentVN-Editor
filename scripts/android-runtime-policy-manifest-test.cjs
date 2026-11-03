const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const buildScript = path.join(root, "scripts", "build-runtime-standalone-android.ps1");
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-android-manifest-policy-"));
const manifestPath = path.join(fixtureRoot, "AndroidManifest.xml");
const activityPath = path.join(fixtureRoot, "MainActivity.kt");
const gradlePath = path.join(fixtureRoot, "build.gradle.kts");
const buildLogPath = path.join(fixtureRoot, "build.log");
const harnessPath = path.join(fixtureRoot, "invoke-policy.ps1");

const manifest = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:usesCleartextTraffic="\${usesCleartextTraffic}">
        <activity
            android:configChanges="orientation|keyboardHidden|screenSize"
            android:launchMode="singleTask"
            android:label="@string/main_activity_title"
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`;

const harness = String.raw`
param(
  [Parameter(Mandatory = $true)][string]$BuildScript,
  [Parameter(Mandatory = $true)][string]$ManifestPath,
  [Parameter(Mandatory = $true)][string]$ActivityPath,
  [Parameter(Mandatory = $true)][string]$GradlePath,
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
foreach ($functionName in @("Write-Utf8Atomic", "Add-Utf8Log", "Apply-AndroidRuntimePolicy")) {
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

$AndroidManifestPath = $ManifestPath
$AndroidMainActivityPath = $ActivityPath
$AndroidGradlePath = $GradlePath
$ReleaseApplicationId = "com.agentvn.game.unicode_test"
$BuildLog = $BuildLogPath

Apply-AndroidRuntimePolicy
Apply-AndroidRuntimePolicy

$manifestBytes = [System.IO.File]::ReadAllBytes($ManifestPath)
$manifestText = (New-Object System.Text.UTF8Encoding($false, $true)).
  GetString($manifestBytes).
  TrimStart([char]0xFEFF)
$document = New-Object System.Xml.XmlDocument
$document.LoadXml($manifestText)
if (
  $manifestBytes.Length -ge 3 -and
  $manifestBytes[0] -eq 0xEF -and
  $manifestBytes[1] -eq 0xBB -and
  $manifestBytes[2] -eq 0xBF
) {
  throw "Generated AndroidManifest.xml must be UTF-8 without BOM."
}
$androidNamespace = "http://schemas.android.com/apk/res/android"
$activity = @($document.SelectNodes("/manifest/application/activity")) |
  Where-Object { $_.GetAttribute("name", $androidNamespace) -eq ".MainActivity" } |
  Select-Object -First 1
if (-not $activity) { throw "MainActivity is missing from generated manifest." }
if ($activity.GetAttribute("screenOrientation", $androidNamespace) -ne "sensorLandscape") {
  throw "MainActivity screenOrientation was not applied."
}
if ($activity.GetAttribute("exported", $androidNamespace) -ne "true") {
  throw "Existing android:exported attribute was corrupted."
}
if (
  [regex]::Matches($manifestText, 'android:screenOrientation="sensorLandscape"').Count -ne 1
) {
  throw "Android runtime policy must be idempotent."
}
foreach ($utf8Path in @($ActivityPath, $GradlePath)) {
  $bytes = [System.IO.File]::ReadAllBytes($utf8Path)
  if (
    $bytes.Length -ge 3 -and
    $bytes[0] -eq 0xEF -and
    $bytes[1] -eq 0xBB -and
    $bytes[2] -eq 0xBF
  ) {
    throw "Generated text must be UTF-8 without BOM: $utf8Path"
  }
  $null = (New-Object System.Text.UTF8Encoding($false, $true)).GetString($bytes)
}
$activityText = [System.IO.File]::ReadAllText(
  $ActivityPath,
  (New-Object System.Text.UTF8Encoding($false, $true))
)
if ($activityText -notmatch 'runtimeWebView\?\.let\s*\{\s*webView\s*->') {
  throw "MainActivity.onResume must bind the nullable WebView to an explicit lambda parameter."
}
if ($activityText -notmatch 'webView\.post\s*\{[\s\S]*?requestApplyInsets\(webView\)[\s\S]*?webView\.evaluateJavascript') {
  throw "MainActivity.onResume must reuse the explicitly bound WebView inside Runnable.post."
}
if ($activityText -match 'runtimeWebView\?\.post\s*\{[\s\S]*?\bit\b') {
  throw "MainActivity.onResume references implicit it inside a zero-argument Runnable lambda."
}
if ($activityText -notmatch 'coordinateSpace:\s*[''"]physical[''"]') {
  throw "Native Insets events must explicitly declare physical pixels."
}
if ($activityText -notmatch 'addJavascriptInterface\([\s\S]*?"AgentVNViewport"') {
  throw "Runtime must expose a narrow viewport synchronization bridge before page initialization."
}
if ($activityText -notmatch '@JavascriptInterface\s+fun requestInsets\(\)') {
  throw "Viewport bridge must let a newly registered frontend listener request current Insets."
}
if ($activityText -notmatch 'getRootWindowInsets\(webView\)') {
  throw "Viewport synchronization must replay current Insets even when geometry did not change."
}

[System.IO.File]::WriteAllText(
  $GradlePath,
  @'
android {
    androidResources {
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
}
'@,
  (New-Object System.Text.UTF8Encoding($false))
)
Apply-AndroidRuntimePolicy
$existingBlockGradle = [System.IO.File]::ReadAllText(
  $GradlePath,
  (New-Object System.Text.UTF8Encoding($false, $true))
)
$literalPowerShellNewline = ([string][char]0x60) + "r" + ([string][char]0x60) + "n"
if ($existingBlockGradle.Contains($literalPowerShellNewline)) {
  throw "Existing androidResources block contains literal PowerShell newline escapes."
}
if ([regex]::Matches($existingBlockGradle, 'noCompress\.clear\(\)').Count -ne 1) {
  throw "Existing androidResources block must contain exactly one noCompress.clear()."
}
Write-Output "PASS Android runtime policy preserves valid strict UTF-8 manifest attributes"
`;

try {
  fs.writeFileSync(manifestPath, manifest, "utf8");
  fs.writeFileSync(activityPath, "package com.agentvn.player\nclass MainActivity\n", "utf8");
  fs.writeFileSync(
    gradlePath,
    `android {\n    kotlinOptions {\n        jvmTarget = "1.8"\n    }\n}\n`,
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
      "-ManifestPath",
      manifestPath,
      "-ActivityPath",
      activityPath,
      "-GradlePath",
      gradlePath,
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
    `Android runtime policy fixture failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.match(result.stdout, /PASS Android runtime policy/);
  console.log("PASS Android runtime policy preserves valid strict UTF-8 manifest attributes");
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
