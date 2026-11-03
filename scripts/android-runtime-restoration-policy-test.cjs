"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process"), { createHash } = require("node:crypto");
const root = path.resolve(__dirname, ".."), out = process.env.AGENTVN_RESTORATION_POLICY_OUTPUT;
assert(out && path.resolve(out).toLowerCase().startsWith("f:\\agentvn\\qa\\") && !fs.existsSync(out));
fs.mkdirSync(out, { recursive: true });
const r = { status: "RUNNING", scope: "ACTUAL_BUILD_HELPER_INSTALLATION_NOT_GRADLE_COMPILE_OR_DEVICE",
  startedAt: new Date().toISOString() };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
try {
  save();
  const runtime = path.join(out, "runtime"), android = path.join(runtime, "src-tauri/gen/android");
  fs.mkdirSync(android, { recursive: true });
  const settings = path.join(android, "settings.gradle");
  const original = "include ':app'\napply from: 'tauri.settings.gradle'\n";
  fs.writeFileSync(settings, original);
  const script = path.join(out, "test.ps1");
  const quote = text => "'" + text.replaceAll("'", "''") + "'";
  fs.writeFileSync(script, `
$ErrorActionPreference = "Stop"
$taskTokens = $null
$taskErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
  ${quote(path.join(root, "scripts/build-runtime-standalone-android.ps1"))}, [ref]$taskTokens, [ref]$taskErrors)
if ($taskErrors.Count) { throw "Actual build script parse failure" }
foreach ($name in @("Write-Utf8Atomic", "Add-Utf8Log", "Set-AndroidRuntimeActivityRestoration")) {
  $function = $ast.Find({ param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
  }, $true)
  if (-not $function) { throw "Missing actual function $name" }
  . ([scriptblock]::Create($function.Extent.Text))
}
$RuntimeRoot = ${quote(runtime)}
$BuildLog = ${quote(path.join(out, "policy.log"))}
Set-AndroidRuntimeActivityRestoration -HelperPath ${quote(path.join(root, "scripts/android-runtime-activity.gradle"))}
Set-AndroidRuntimeActivityRestoration -HelperPath ${quote(path.join(root, "scripts/android-runtime-activity.gradle"))}
try {
  Set-AndroidRuntimeActivityRestoration -HelperPath ${quote(path.join(out, "missing.gradle"))}
  throw "Missing helper was not rejected"
} catch {
  if (-not $_.Exception.Message.StartsWith("ANDROID_ACTIVITY_RESTORATION_MISSING:")) { throw }
}
`);
  const v = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
    { cwd: root, windowsHide: true, encoding: "utf8", timeout: 60000 });
  fs.writeFileSync(path.join(out, "command.log"), (v.stdout || "") + "\n" + (v.stderr || ""));
  r.command = { exe: "powershell.exe", script, exitCode: v.status, error: v.error?.message }; save();
  assert.equal(v.status, 0);
  const text = fs.readFileSync(settings, "utf8");
  assert(text.startsWith(original));
  assert.equal((text.match(/apply from: 'agentvn-runtime-activity.gradle'/g) || []).length, 1);
  const copied = path.join(android, "agentvn-runtime-activity.gradle");
  assert.deepEqual(fs.readFileSync(copied), fs.readFileSync(path.join(root, "scripts/android-runtime-activity.gradle")));
  r.helperSha256 = createHash("sha256").update(fs.readFileSync(copied)).digest("hex");
  r.cases = 3; r.status = "PASS";
} catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
finally { r.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify(r)); }
