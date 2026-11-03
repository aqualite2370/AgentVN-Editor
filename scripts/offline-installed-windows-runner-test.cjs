"use strict";

// Exercise the REAL installed direct runner's pre-build input rejection.
// No Editor/Player/MSI/Android launch, no compilation and no credentials.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const repo = path.resolve(__dirname, "..");
const [installedArg, workArg, reportArg] = process.argv.slice(2);
assert(installedArg && workArg && reportArg, "Usage: node scripts/offline-installed-windows-runner-test.cjs <installed-root> <fresh-F-work-root> <fresh-report-root>");
const installed = fs.realpathSync(installedArg), work = path.resolve(workArg), out = path.resolve(reportArg);
assert.equal(path.parse(work).root.toUpperCase(), "F:\\", "Use F for new QA data");
assert(!fs.existsSync(work) && !fs.existsSync(out), "Never overwrite evidence");
assert(!work.toLowerCase().startsWith(installed.toLowerCase() + path.sep));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const manifest = read(path.join(repo, "output/full-regression-20261017-01/candidate-02/manifest.json"));
const preload = path.join(__dirname, "lib/offline-runner-safety-preload.cjs");
const runner = path.join(installed, "scripts/build-runtime-standalone-windows.cjs");
const report = {
  status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "ACTUAL_INSTALLED_WINDOWS_DIRECT_RUNNER_PREBUILD_REJECTION_WITH_SIDE_EFFECT_GUARD",
  fullWindowsExportStatus: "BLOCKED", nativeHostTested: false, desktopControlUsed: false,
  productChanges: 0, realModelRequests: 0, androidBuilds: 0,
  installedRoot: installed, workRoot: work, commands: [], checks: [], cases: [], errors: [],
  limitations: [
    "No native host invocation, output picker, workspace-version guard, diagnostics ZIP creation or successful build.",
    "Subprocess/network and out-of-case file writes are guarded. A case only passes if none was attempted.",
    "Invalid release-metadata rejection precedes runner diagnostics; this is not claimed as a user-visible host failure.",
    "A manifest archive path is not evidence that the archive exists; native Rust normally creates it."
  ]
};
fs.mkdirSync(work); fs.mkdirSync(out, { recursive: true });
const observedFiles = new Map();
function pin(file, expected) {
  const actual = sha(file);
  if (expected) assert.equal(actual, expected, file);
  observedFiles.set(file, actual);
}
function check(name, fn) {
  try { report.checks.push({ name, status: "PASS", detail: fn() }); }
  catch (error) { report.checks.push({ name, status: "FAILED", error: String(error.stack || error) }); throw error; }
}
function runCase(name, makeArgs, expect, selfTest = false) {
  const dir = path.join(work, name); fs.mkdirSync(dir);
  const audit = path.join(dir, "guard.jsonl");
  const env = { ...process.env, NODE_OPTIONS: "", AGENTVN_OFFLINE_CASE_ROOT: dir, AGENTVN_OFFLINE_GUARD_AUDIT: audit,
    TEMP: dir, TMP: dir };
  const args = ["--require", preload, ...makeArgs(dir)];
  const p = spawnSync(process.execPath, args, { cwd: installed, env, windowsHide: true, encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024 });
  const stdout = path.join(dir, "stdout.log"), stderr = path.join(dir, "stderr.log");
  fs.writeFileSync(stdout, p.stdout || "", { flag: "wx" }); fs.writeFileSync(stderr, p.stderr || "", { flag: "wx" });
  const row = { name, status: "RUNNING", exitCode: p.status, signal: p.signal,
    stdout: { path: stdout, sha256: sha(stdout) }, stderr: { path: stderr, sha256: sha(stderr) }, error: null };
  report.cases.push(row);
  report.commands.push({ executable: process.execPath, args, cwd: installed, windowsHide: true, exitCode: p.status });
  try {
    assert.ifError(p.error); assert.equal(p.signal, null);
    const events = fs.readFileSync(audit, "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(events[0].event, "READY");
    row.blockedSideEffects = events.filter(e => e.event === "BLOCKED");
    if (!selfTest) assert.deepEqual(row.blockedSideEffects, [], "Runner reached forbidden side effect");
    row.detail = expect({ dir, p, events });
    row.guardAudit = { path: audit, sha256: sha(audit) };
    row.status = "PASS";
  } catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); report.errors.push(row.error); }
}
try {
  check("Frozen candidate and actual restored installed payload identities", () => {
    assert.equal(manifest.status, "PASS"); assert.equal(manifest.source.length, 560);
    for (const entry of manifest.source) pin(entry.path, entry.sha256);
    pin(path.join(repo, "AgentVN Dev.exe"), "ceb15d74880bbdee426c0a597734324878dec406583318992193c1cde432be96");
    pin(path.join(installed, "agentvn-editor.exe"), "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    pin(path.join(installed, "creator-backend.exe"), "db44bd510997a73aee80ba5419d0c9c55e6f73f9a01ad65003915ea089eb5155");
    for (const name of read(path.join(repo, "scripts/standalone-build-scripts.json")).scripts) {
      pin(path.join(installed, "scripts", name), sha(path.join(repo, "scripts", name)));
    }
    const version = path.join(installed, "build-versions.json"); pin(version);
    assert.equal(read(version).editorVersion, "1.9.9");
    pin(preload); pin(__filename);
    return { sourceHashes: 560, installedVersion: "1.9.9", runner, runnerSha256: sha(runner) };
  });
  runCase("guard-selftest", () => ["-e", `
    const a=require('node:assert/strict'),fs=require('node:fs');
    a.throws(()=>require('node:child_process').spawn(process.execPath,['-e','process.exit(0)']),/SIDE_EFFECT_BLOCKED/);
    a.throws(()=>require('node:net').connect(9,'127.0.0.1'),/SIDE_EFFECT_BLOCKED/);
    a.throws(()=>fs.writeFileSync(process.argv[1],'never'),/SIDE_EFFECT_BLOCKED/);
  `, path.join(work, "must-not-write.txt")], ({ p, events }) => {
    assert.equal(p.status, 0, p.stderr);
    assert.equal(events.filter(e => e.event === "BLOCKED").length, 3);
    assert(!fs.existsSync(path.join(work, "must-not-write.txt")));
    return { checks: ["subprocess blocked before start", "network blocked before connection", "out-of-case write blocked"] };
  }, true);
  assert.equal(report.cases[0].status, "PASS", "Do not run installed code if guard selftest fails");
  const identity = { schemaVersion: 1, title: "离线 导出验证 中文", gameId: "offline-qa-no-desktop",
    versionName: "1.0.0", versionCode: 1, androidApplicationId: "com.agentvn.offlineqa" };
  const badInputs = [
    ["missing-cartridge-argument", "CartridgePath is required.", () => []],
    ["missing-chinese-space-path", "CartridgePath does not exist:", dir => ["--CartridgePath", path.join(dir, "中文 空格 不存在.vncart")]],
    ["cartridge-is-directory", "CartridgePath does not exist:", dir => ["--CartridgePath", dir]],
    ["missing-icon", "IconPath does not exist:", dir => ["--CartridgePath", seed(dir), "--IconPath", path.join(dir, "缺失 图标.png")]],
    ["icon-is-directory", "IconPath does not exist:", dir => ["--CartridgePath", seed(dir), "--IconPath", dir]],
    ["base64-identity", "CartridgePath is required.", () => [], true]
  ];
  function seed(dir) {
    const file = path.join(dir, "not-a-real-cartridge.vncart");
    fs.writeFileSync(file, "Never reaches verification or build.", { flag: "wx" }); return file;
  }
  for (const [name, message, inputArgs, base64] of badInputs) {
    runCase(name, dir => {
      const raw = JSON.stringify(identity);
      return [runner, "--OutputDir", path.join(dir, "output"), "--DiagnosticsDir", path.join(dir, "diagnostics"),
        "--ReleaseIdentity", base64 ? "base64:" + Buffer.from(raw).toString("base64") : raw, "--Json", ...inputArgs(dir)];
    }, ({ dir, p }) => {
      assert.equal(p.status, 1); assert.equal(p.stderr, "");
      const file = path.join(dir, "diagnostics/package-build-manifest.json"), result = read(file);
      assert.deepEqual(JSON.parse(p.stdout), result);
      assert.equal(result.ok, false); assert.equal(result.status, "FAIL");
      assert.equal(result.runtimeStatus, "NOT_RUN"); assert.equal(result.overallStatus, "FAIL");
      assert.equal(result.platform, "windows"); assert.deepEqual(result.artifacts, []);
      assert(result.message.includes(message)); assert.deepEqual(result.releaseIdentity, identity);
      assert.equal(result.outputDir, path.join(dir, "output")); assert.equal(result.diagnosticsDir, path.join(dir, "diagnostics"));
      assert.equal(result.manifestPath, file); assert(Number.isFinite(Date.parse(result.generatedAt)));
      const log = fs.readFileSync(result.buildLogPath, "utf8");
      assert(log.includes("direct runner") && log.includes("Diagnostics:"));
      assert.deepEqual(fs.readdirSync(result.outputDir), []);
      assert(!fs.existsSync(result.diagnosticsArchivePath), "Do not claim native-host ZIP creation from direct runner");
      assert(!fs.existsSync(path.join(dir, "diagnostics/standalone-package-command.log")));
      return { manifestPath: file, manifestSha256: sha(file), buildLogPath: result.buildLogPath,
        buildLogSha256: sha(result.buildLogPath), diagnosticsRetained: true,
        failureCode: result.failureCode ?? null, diagnosticsArchiveCreated: false };
    });
  }
  for (const [name, raw] of [["invalid-json-identity", "{broken"], ["invalid-version-identity", JSON.stringify({ ...identity, versionName: "" })]]) {
    runCase(name, dir => [runner, "--OutputDir", path.join(dir, "output"), "--DiagnosticsDir", path.join(dir, "diagnostics"),
      "--ReleaseIdentity", raw, "--Json"], ({ dir, p }) => {
      assert.equal(p.status, 1); assert.equal(p.stdout, "");
      assert(p.stderr.includes("RELEASE_METADATA_INVALID"));
      assert(!fs.existsSync(path.join(dir, "output"))); assert(!fs.existsSync(path.join(dir, "diagnostics")));
      return { rejection: "RELEASE_METADATA_INVALID", structuredManifestCreated: false,
        nativeHostExposure: "NOT_TESTED", evidenceIsNotFullUserFacingDiagnosticContract: true };
    });
  }
  check("Non-empty exact case set and no attempted build/subprocess/network in installed-runner cases", () => {
    assert.equal(report.cases.length, 9); assert(report.cases.every(c => c.status === "PASS"), "See case failures");
    return { safetySelftests: 1, installedRunnerInvocations: 8, prebuildManifests: 6, metadataRejections: 2 };
  });
  report.status = "PASS";
} catch (error) { report.status = "FAILED"; report.errors.push(String(error.stack || error)); }
finally {
  try {
    for (const [file, expected] of observedFiles) assert.equal(sha(file), expected, file);
    report.checks.push({ name: "All pinned product/source/Dev/test-tool bytes unchanged after execution", status: "PASS", files: observedFiles.size });
  } catch (error) { report.status = "FAILED"; report.errors.push(String(error.stack || error)); }
  report.pinnedFiles = [...observedFiles].map(([file, sha256]) => ({ path: file, sha256 }));
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, installedInvocations: report.cases.filter(c => c.name !== "guard-selftest").length,
    cases: report.cases.length, errors: report.errors, report: path.join(out, "report.json") }, null, 2));
  if (report.status !== "PASS") process.exitCode = 1;
}
