"use strict";
// Read-only installed payload/fixture proof. This never claims an exported
// executable exists merely because resources or a source contract pass.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const root = "D:/AgentVN", run = path.join(root, "output/installed-windows-export-20261018-01");
const out = path.resolve(process.argv[2] || ""); assert(process.argv[2] && !fs.existsSync(out));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => sha256(fs.readFileSync(f));
const report = { status: "RUNNING", scope: "INSTALLED_STATIC_PAYLOAD_AND_CACHE_OBSERVATION_NOT_WINDOWS_EXPORT",
  windowsExportStatus: "BLOCKED", at: new Date().toISOString(), checks: [], resources: [], commands: [], inputs: [],
  productChanges: 0, realModelRequests: 0, error: null };
function load(relative) {
  const file = path.join(run, relative); report.inputs.push({ path: file, sha256: sha(file) }); return read(file);
}
function check(name, fn) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { row.detail = fn(); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
}
try {
  const launch = load("launch.json"), ready = load("backend-ready.json"), fixture = load("fixtures.json");
  const frozen = read(path.join(root, "output/full-regression-20261017-01/candidate-02/manifest.json"));
  check("Frozen actual NSIS Editor and automatically owned packaged backend", () => {
    assert.equal(launch.status, "PASS"); assert.equal(ready.status, "PASS");
    assert.equal(launch.executableSha256, "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    assert.equal(sha(path.join(launch.installRoot, "agentvn-editor.exe")), launch.executableSha256);
    assert.equal(sha(path.join(launch.installRoot, "creator-backend.exe")), ready.backendSha256);
    assert(!launch.manualBackendSpawn && !launch.dataDirectoryOverride && !launch.webviewDirectoryOverride);
    assert(ready.processes.some(p => p.Name === "creator-backend.exe" && p.ParentProcessId === launch.editorPid));
    return { installRoot: launch.installRoot, editorSha256: launch.executableSha256, backendSha256: ready.backendSha256 };
  });
  check("Installed version file, all published build scripts and actual runtime/shared sources match frozen input", () => {
    assert.equal(frozen.status, "PASS"); assert.equal(frozen.source.length, 560);
    const sourceMap = new Map(frozen.source.map(s => [path.relative(root, s.path).replaceAll("\\", "/"), s]));
    for (const s of frozen.source) assert.equal(sha(s.path), s.sha256, s.path);
    const manifest = read(path.join(root, "scripts/standalone-build-scripts.json"));
    assert(manifest.scripts.length >= 19 && manifest.scripts.includes("build-runtime-standalone-windows.cjs"));
    const required = new Set(manifest.scripts.map(n => `scripts/${n}`));
    for (const key of sourceMap.keys()) if (/^(GameCli_framework\/src\/|shared\/)/.test(key)) required.add(key);
    for (const key of ["GameCli_framework/package.json", "GameCli_framework/package-lock.json",
      "GameCli_framework/src-tauri/src/lib.rs", "GameCli_framework/src-tauri/src/save_location.rs",
      "GameCli_framework/src-tauri/src/portable_save_migration.rs"]) required.add(key);
    for (const relative of required) {
      const source = sourceMap.get(relative);
      // Runtime packaging manifest itself pins helpers that were part of the
      // candidate prerequisite; compare real bytes if not individually listed.
      const baseline = source?.sha256 || sha(path.join(root, relative));
      const installed = path.join(launch.installRoot, relative);
      assert.equal(sha(installed), baseline, `Installed payload differs: ${relative}`);
      report.resources.push({ relative, installed, sha256: baseline, individuallyFrozen: !!source });
    }
    const file = path.join(launch.installRoot, "build-versions.json"), bytes = fs.readFileSync(file);
    assert(!bytes.subarray(0, 2).equals(Buffer.from([255, 254])), "UTF16 metadata is invalid");
    assert.equal(JSON.parse(bytes.toString("utf8")).editorVersion, "1.9.9");
    report.resources.push({ relative: "build-versions.json", installed: file, sha256: sha(file) });
    return { actualInstalledResources: report.resources.length, frozenSourceHashes: 560, editorVersion: "1.9.9" };
  });
  check("Actual environment button result is explicitly cache reuse, never a new full probe", () => {
    const observed = load("environment-01/report.json");
    assert.equal(observed.status, "PASS");
    assert.equal(observed.environmentState, "passed");
    assert(observed.console.includes("skipped the repeated full check"));
    assert(observed.console.includes("已复用此前通过的环境检测"));
    const file = "C:/Users/1/AppData/Local/com.agentvn.editor/windows-env/windows-env-check.json";
    const native = read(file); assert.equal(native.cacheHit, true); assert.equal(native.cacheEditorVersion, "1.9.9");
    const retained = path.join(run, "observed-windows-env-cache.json");
    fs.copyFileSync(file, retained, fs.constants.COPYFILE_EXCL);
    report.inputs.push({ path: retained, sha256: sha(retained) });
    return { actualUIRecheckClicked: true, cacheHit: true, fullProbeExecutedThisRun: false,
      correction: "environment-01 case name and fresh-windows-environment.png filename describe intent, not actual fresh detection",
      versionChangedRecheckStatus: "NOT_RUN", retained };
  });
  check("Installed sharp dependency actually loads, without a source workspace or package install", () => {
    const args = ["-e", "require(process.argv[1]); console.log('installed-sharp-ready')",
      path.join(launch.installRoot, "GameCli_framework/node_modules/sharp")];
    const p = spawnSync(process.execPath, args, { cwd: launch.installRoot, windowsHide: true, encoding: "utf8", timeout: 30000 });
    report.commands.push({ executable: process.execPath, args, exitCode: p.status, stdout: p.stdout, stderr: p.stderr });
    assert.ifError(p.error); assert.equal(p.status, 0, p.stderr); assert(p.stdout.includes("installed-sharp-ready"));
    return { actualInstalledDependencyLoaded: true, windowsBuildClaim: false };
  });
  check("Native chooser blockage does not become successful export or a proven product defect", () => {
    const native = load("choose-native-01/native-computer-use-review.json");
    assert.equal(native.status, "BLOCKED_TOOL_NATIVE_INPUT_NO_OBSERVED_RESPONSE");
    assert(!native.pickerMocked && !native.productFailureClaim && !native.storeMutationUsedForOutputDirectory);
    assert.equal(native.observedFieldValue, fixture.output);
    assert.equal(fs.readdirSync(fixture.output).length, 0);
    return { windowsExport: "BLOCKED", portableRun: "NOT_RUN_DEPENDS_ON_EXPORT", setupInstall: "NOT_RUN_DEPENDS_ON_EXPORT",
      exeSideSaveAndACL: "NOT_RUN_DEPENDS_ON_EXPORT", actualNewExecutableCount: 0 };
  });
  report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(out, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, windowsExportStatus: report.windowsExportStatus,
    checks: report.checks.length, resources: report.resources.length, error: report.error, out }));
}
