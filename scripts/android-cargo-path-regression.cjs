"use strict";
// Real MSVC output-path regression. Compiles a diagnostic binary; never runs it.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), os = require("node:os");
const assert = require("node:assert/strict"), cp = require("node:child_process");
const root = path.resolve(__dirname, "..");
assert.equal(process.platform, "win32", "This regression exercises the actual Windows MSVC linker");
const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), "agentvn-cargo-path-" + crypto.randomUUID()));
assert(!fs.existsSync(out), "Preserve every regression attempt");
fs.mkdirSync(out, { recursive: true });
const env = { ...process.env, PSModulePath: [
  path.join(os.homedir(), "Documents/WindowsPowerShell/Modules"),
  path.join(process.env.ProgramFiles, "WindowsPowerShell/Modules"),
  path.join(process.env.SystemRoot, "system32/WindowsPowerShell/v1.0/Modules"),
].join(";") };
const report = { status: "RUNNING", at: new Date().toISOString(), tests: [], productLaunches: 0 };
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const source = path.join(root, "scripts/build-runtime-standalone-android.ps1");
report.source = { path: source, sha256: sha(source) };
try {
  const tool = cp.spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/resolve-msvc-environment.ps1"), "-Json"], { env, encoding: "utf8", windowsHide: true });
  assert.equal(tool.status, 0, tool.stderr);
  const resolved = JSON.parse(tool.stdout.replace(/^\uFEFF/, "").trim()); assert.equal(resolved.status, "PASS");
  for (const [key, value] of Object.entries(resolved.environment)) {
    for (const prior of Object.keys(env)) if (prior.toLowerCase() === key.toLowerCase()) delete env[prior];
    env[key] = value;
  }
  const deep = path.join(out, "a".repeat(80), "b".repeat(80), "c".repeat(40));
  fs.mkdirSync(deep, { recursive: true });
  const filename = "build_script_build-355a94f07d792efc.exe", longExe = path.join(deep, filename);
  assert(longExe.length > 260);
  const compile = output => cp.spawnSync("rustc.exe", [path.join(root, "scripts/android-symlink-operation-probe.rs"),
    "--crate-name", "android_path_probe", "-C", "debuginfo=0", "-o", output],
  { cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 90000 });
  const long = compile(longExe);
  fs.writeFileSync(path.join(out, "long-linker.log"), (long.stdout || "") + (long.stderr || ""), { flag: "wx" });
  assert.ifError(long.error); assert.notEqual(long.status, 0); assert.match(long.stderr, /LNK1104/);
  report.tests.push({ name: "real-msvc-long-output-reproduces-LNK1104", status: "PASS",
    outputLength: longExe.length, exitCode: long.status });
  const harness = path.join(out, "target-harness.ps1");
  fs.writeFileSync(harness, String.raw`
param([string]$Source,[string]$Out,[string]$LinkerName)
$ErrorActionPreference='Stop'
$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile($Source,[ref]$null,[ref]$errors)
if($errors){throw ($errors|Out-String)}
foreach($name in @('New-AndroidCargoTarget','Remove-AndroidCargoTarget')){
  $fn=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true)
  if(!$fn){throw "Missing production function: $name"}
  . ([scriptblock]::Create($fn.Extent.Text))
}
$tauri=Join-Path $Out ('x'*120)
New-Item -ItemType Directory -Path $tauri|Out-Null
$previous=Join-Path $tauri 'target'
New-Item -ItemType Directory -Path $previous|Out-Null
$sentinel=Join-Path $previous 'keep.txt'
[IO.File]::WriteAllText($sentinel,'preserve-existing-target')
$target=New-AndroidCargoTarget -TauriDir $tauri -NodeExecutable (Get-Command node.exe).Source -TemporaryRoot (Split-Path -Parent $Out)
if(!$target.owned -or $target.path.Length -gt 120){throw 'A short owned target is required'}
$retained=Join-Path $Out 'target-result.json'
[IO.File]::WriteAllText($retained,($target|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
`, { flag: "wx" });
  const result = cp.spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    harness, "-Source", source, "-Out", out, "-LinkerName", filename],
  { env, encoding: "utf8", windowsHide: true, timeout: 60000 });
  fs.writeFileSync(path.join(out, "target-harness.log"), result.stdout + result.stderr, { flag: "wx" });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
  const selected = JSON.parse(fs.readFileSync(path.join(out, "target-result.json"), "utf8"));
  const shortExe = path.join(selected.path, filename), short = compile(shortExe);
  fs.writeFileSync(path.join(out, "short-linker.log"), short.stdout + short.stderr, { flag: "wx" });
  assert.ifError(short.error); assert.equal(short.status, 0, short.stderr); assert(fs.statSync(shortExe).size > 0);
  report.tests.push({ name: "same-real-rust-msvc-link-succeeds-in-selected-target", status: "PASS",
    outputLength: shortExe.length, executableSha256: sha(shortExe), binaryExecuted: false });
  const cleanup = path.join(out, "cleanup-harness.ps1");
  fs.writeFileSync(cleanup, String.raw`
param([string]$Source,[string]$Out)
$ErrorActionPreference='Stop'
$ast=[System.Management.Automation.Language.Parser]::ParseFile($Source,[ref]$null,[ref]$null)
$fn=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Remove-AndroidCargoTarget'},$true)
. ([scriptblock]::Create($fn.Extent.Text))
$target=Get-Content -LiteralPath (Join-Path $Out 'target-result.json') -Raw|ConvertFrom-Json
$original=$target.path
$target.token='wrong-token'
$rejected=$false
try{Remove-AndroidCargoTarget $target}catch{$rejected=$true}
if(!$rejected -or !(Test-Path -LiteralPath $original)){throw 'Changed ownership must not delete anything'}
$target=Get-Content -LiteralPath (Join-Path $Out 'target-result.json') -Raw|ConvertFrom-Json
Remove-AndroidCargoTarget $target
if(Test-Path -LiteralPath $original){throw 'Owned target cleanup incomplete'}
$keep=Join-Path (Join-Path (Join-Path $Out ('x'*120)) 'target') 'keep.txt'
if([IO.File]::ReadAllText($keep) -cne 'preserve-existing-target'){throw 'Existing target changed'}
$normal=Join-Path $Out 'normal-target'
[IO.File]::WriteAllText($normal,'preserve-non-owned')
Remove-AndroidCargoTarget ([pscustomobject]@{owned=$false;path=$normal})
if([IO.File]::ReadAllText($normal) -cne 'preserve-non-owned'){throw 'Non-owned target changed'}
'PASS owned cleanup, token mismatch refusal and existing target preservation'
`, { flag: "wx" });
  const cleaned = cp.spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    cleanup, "-Source", source, "-Out", out], { env, encoding: "utf8", windowsHide: true, timeout: 60000 });
  fs.writeFileSync(path.join(out, "cleanup.log"), cleaned.stdout + cleaned.stderr, { flag: "wx" });
  assert.ifError(cleaned.error); assert.equal(cleaned.status, 0, cleaned.stderr);
  report.tests.push({ name: "cleanup-validates-ownership-preserves-existing-target", status: "PASS" });
  report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
report.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify(report));
