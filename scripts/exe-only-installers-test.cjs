"use strict";
// Run real PowerShell packaging functions with isolated files and build callees.
// No Cargo, installer installation, user project, or model request.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { spawnSync } = require("node:child_process");
const sourceOverride = process.argv.find(arg => arg.startsWith("--source-root="));
const root = sourceOverride ? path.resolve(sourceOverride.slice("--source-root=".length)) : path.resolve(__dirname, "..");
const out = path.resolve(process.argv[2] || "");
assert(process.argv[2] && !fs.existsSync(out), "Provide a fresh evidence directory");
fs.mkdirSync(out, { recursive: true });
const paths = ["scripts/package-installers.ps1",
  "scripts/build-editor-windows.ps1", "editor/src-tauri/tauri.conf.json",
  "GameCli_framework/src-tauri/tauri.conf.json"];
// This worktree's supported packaging entry is scripts/package-installers.ps1.
// Inspect a convenience BAT launcher when present without inventing one in QA.
const batLauncherPresent = fs.existsSync(path.join(root, "package-installers.bat"));
if (batLauncherPresent) paths.unshift("package-installers.bat");
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
if (process.argv.includes("--checkpoint")) {
  const checkpoint = "F:/AgentVN/Checkpoints/Exe-Only-Installers-20261021-01";
  assert(!fs.existsSync(checkpoint));
  for (const name of paths) {
    const dest = path.join(checkpoint, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, name), dest, fs.constants.COPYFILE_EXCL);
  }
  fs.copyFileSync(path.join(root, "scripts/exe-only-installers-test.cjs"),
    path.join(checkpoint, "regression.cjs"), fs.constants.COPYFILE_EXCL);
}
const source = fs.readFileSync(path.join(root, "scripts/package-installers.ps1"), "utf8");
const editorBuildSource = fs.readFileSync(
  path.join(root, "scripts/build-editor-windows.ps1"),
  "utf8",
);
assert.match(
  editorBuildSource,
  /^\s*npm ci --no-audit --no-fund/m,
  "Editor release build must use the lockfile when dependencies are absent.",
);
assert.doesNotMatch(
  editorBuildSource,
  /^\s*npm install\b/m,
  "Editor release build must not drift compatible dependency ranges.",
);
assert.match(
  source,
  /Invoke-Npm -Arguments @\("ci", "--no-audit", "--no-fund"\)/,
  "Player packaging must use the lockfile when dependencies are absent.",
);
assert.doesNotMatch(
  source,
  /Invoke-Npm -Arguments @\("install"\)/,
  "Player packaging must not drift compatible dependency ranges.",
);
function extract(name) {
  const start = source.indexOf(`function ${name} {`), end = source.indexOf("\nfunction ", start + 1);
  assert(start >= 0 && end > start, name); return source.slice(start, end);
}
const q = value => "'" + value.replaceAll("'", "''") + "'";
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "REAL_POWERSHELL_PACKAGING_WITH_CONTROLLED_BUILD_COMMANDS_NOT_FULL_COMPILATION",
  packagingEntry: "scripts/package-installers.ps1", batLauncherPresent,
  sources: paths.map(p => ({ path: path.join(root, p), sha256: sha(path.join(root, p)) })), cases: [] };
function run(name, body) {
  const dir = path.join(out, name); fs.mkdirSync(dir);
  const resultFile = path.join(dir, "result.json");
  const script = ["$ErrorActionPreference='Stop'", `$base=${q(dir)}`, "$script:seen=@()",
    ...body, `$script:seen | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath ${q(resultFile)} -Encoding UTF8`].join("\n");
  fs.writeFileSync(path.join(dir, "run.ps1"), script, { flag: "wx" });
  const result = spawnSync("powershell.exe", ["-NoProfile", "-File", path.join(dir, "run.ps1")],
    { windowsHide: true, encoding: "utf8", timeout: 30000 });
  fs.writeFileSync(path.join(dir, "output.log"), `${result.stdout || ""}\n${result.stderr || ""}`);
  assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  return { dir, seen: fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, "utf8").replace(/^\uFEFF/, "")) : null };
}
function test(name, fn) {
  try { fn(); report.cases.push({ name, status: "PASS" }); }
  catch (e) { report.cases.push({ name, status: "FAILED", error: String(e.stack || e) }); }
}
const copy = extract("Copy-InstallerArtifacts");
for (const kind of ["exe-only", "msi-only", "mixed"]) test(`collect-${kind}`, () => {
  const { dir } = run(`collect-${kind}`, [
    "$script:ReleaseRootPath=Join-Path $base 'releases'", "$script:PackageVersion='1.9.13'", "$Timestamp='isolated'",
    "$bundle=Join-Path $base 'bundle'",
    "New-Item -ItemType Directory -Force -Path (Join-Path $bundle 'nsis'),(Join-Path $bundle 'msi') | Out-Null",
    ...(kind !== "msi-only" ? ["[IO.File]::WriteAllText((Join-Path $bundle 'nsis\\current-setup.exe'),'current-exe')"] : []),
    ...(kind !== "exe-only" ? ["[IO.File]::WriteAllText((Join-Path $bundle 'msi\\stale.msi'),'historical-msi')"] : []),
    copy, "$rejected=$false",
    "try { Copy-InstallerArtifacts -AppName 'AgentVN Editor' -BundleRoot $bundle -ReleaseSubDir 'editor' } catch { $rejected=$true }",
    "$script:seen=@{rejected=$rejected}",
  ]);
  const state = JSON.parse(fs.readFileSync(path.join(dir, "result.json"), "utf8").replace(/^\uFEFF/, ""));
  assert.equal(state.rejected, kind === "msi-only");
  const release = path.join(dir, "releases/editor");
  if (kind !== "msi-only") {
    assert.deepEqual(fs.readdirSync(release), ["AgentVN_Editor_v1.9.13_isolated.exe"]);
    assert.equal(fs.readFileSync(path.join(release, fs.readdirSync(release)[0]), "utf8"), "current-exe");
  } else assert(!fs.existsSync(release));
  if (kind !== "exe-only") assert.equal(fs.readFileSync(path.join(dir, "bundle/msi/stale.msi"), "utf8"), "historical-msi");
});
test("player-real-build-function-nsis-only", () => {
  const { seen } = run("player-build", [
    "$Root=$base", "$script:NpmCommand='unused'",
    "function Resolve-WorkspacePath {param([string]$RelativePath) Join-Path $Root $RelativePath}",
    "function Clear-BundleOutput {param([string]$RelativeTauriDir)}",
    "function Invoke-Npm {param([string[]]$Arguments,[string]$WorkingDirectory) $script:seen+=,@{arguments=$Arguments;directory=$WorkingDirectory}}",
    "function Sync-EditorPlayerResource {param([string]$BuiltPlayerExe)}",
    "function Copy-InstallerArtifacts {param($AppName,$BundleRoot,$ReleaseSubDir)}",
    "New-Item -ItemType Directory -Force -Path (Join-Path $base 'editor\\src-tauri\\icons'),(Join-Path $base 'GameCli_framework\\src-tauri\\icons'),(Join-Path $base 'GameCli_framework\\node_modules')|Out-Null",
    "[IO.File]::WriteAllText((Join-Path $base 'editor\\src-tauri\\icons\\icon.ico'),'fixture-icon')",
    "$PSScriptRoot=$base",
    "[IO.File]::WriteAllText((Join-Path $base 'assert-windows-gui-subsystem.ps1'),'param($Path)')",
    extract("Build-PlayerInstaller"), "Build-PlayerInstaller",
  ]);
  const rows = Array.isArray(seen) ? seen : [seen];
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].arguments, ["run", "tauri", "build", "--", "--bundles", "nsis"]);
});
test("editor-real-build-entry-nsis-only", () => {
  const base = path.join(out, "editor-build"), scripts = path.join(base, "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.copyFileSync(path.join(root, "scripts/build-editor-windows.ps1"), path.join(scripts, "build-editor-windows.ps1"));
  fs.writeFileSync(path.join(scripts, "prepare-editor-runtime-resources.ps1"), "param([switch]$SkipGameCliPlayer)\n");
  fs.writeFileSync(path.join(scripts, "assert-windows-gui-subsystem.ps1"), "param($Path)\n");
  for (const name of ["creator-backend.exe", "agentvn-player.exe"]) {
    const file = path.join(base, "editor/src-tauri/binaries", name);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, "fixture-resource");
  }
  fs.mkdirSync(path.join(base, "editor/node_modules"));
  const { seen } = run("editor-wrapper", [
    "function link.exe {}", // Existing linker means no external VS discovery.
    "function npm {$global:editorSeen=@($args);$global:editorInvocation=$MyInvocation.Line;$global:LASTEXITCODE=0}",
    "function npm.cmd {$global:editorSeen=@($args);$global:editorInvocation=$MyInvocation.Line;$global:LASTEXITCODE=0}",
    `& ${q(path.join(scripts, "build-editor-windows.ps1"))} -SkipBackendSidecar -SkipGameCliPlayer`,
    "$script:seen=@{arguments=$global:editorSeen;invocation=$global:editorInvocation}",
  ]);
  const rows = Array.isArray(seen) ? seen : [seen];
  assert.equal(rows.length, 1);
  // A controlled PowerShell function consumes its own '--' end-of-parameters
  // marker. Verify the source invocation too; the actual native npm.cmd keeps it.
  assert.deepEqual(rows[0].arguments, ["run", "tauri", "build", "--bundles", "nsis"]);
  assert.match(rows[0].invocation, /build -- --bundles nsis/);
});
for (const product of ["editor", "GameCli_framework"]) test(`${product}-default-targets`, () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, product, "src-tauri/tauri.conf.json"), "utf8"));
  assert.deepEqual(config.bundle.targets, ["nsis"]);
});
report.status = report.cases.every(c => c.status === "PASS") ? "PASS" : "FAILED";
report.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify(report, null, 2));
if (report.status !== "PASS") process.exitCode = 1;
