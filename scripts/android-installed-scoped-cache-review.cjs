"use strict";
// Opt-in, offline engineering review of a previously investigated warning.
// Does not change the scanner, original BLOCKED results, APK or metadata.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const A = require("./lib/installed-acceptance.cjs");
const { audit } = require("./android-installed-cleanup-evidence-audit.cjs");
const { verifyProvenance } = require("./android-acceptance-evidence.cjs");
const { validateWindowsPrerequisite } = require("./lib/installed-windows-prerequisite.cjs");
const { assessRestartTrials, scopedRuntimeLog } = require("./android-runtime-log-analysis.cjs");
const root = path.resolve(__dirname, "..");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = file => A.sha256(fs.readFileSync(file));
const evidence = file => ({ path: file, sha256: sha(file) });
const fakeIndex = "[ERROR:simple_version_upgrade.cc(152)] Failed to write a new fake index.";
const cacheIndex = "[ERROR:simple_index_file.cc(614)] Could not reconstruct index from disk";
function parse(line) {
  const m = line.match(/^(\d\d-\d\d) (\d\d:\d\d:\d\d\.\d{3})\s+(\d+)\s+(\d+)\s+([EI]) (chromium|RustStdoutStderr): (.*)$/);
  assert(m, `Unrecognized warning, not exempted: ${line}`);
  return { pid: m[3], tid: m[4], native: m[5] === "E" && m[6] === "chromium",
    time: Date.parse(`2000-${m[1]}T${m[2]}Z`), body: m[7], line };
}
function reviewCacheWarnings(runtime, prior) {
  assert.equal(prior.status, "PASS_WITH_SCOPED_NON_BLOCKING_WEBVIEW_CACHE_WARNING");
  assert.equal(prior.scope.api, 35); assert.equal(prior.scope.avd, "AgentVN_API35");
  assert.equal(prior.scope.webview, "124.0.6367.219");
  assert.equal(runtime.packageName, prior.scope.packageName);
  assert.match(runtime.webviewVersion, /\(com\.google\.android\.webview, 124\.0\.6367\.219\)/);
  assert(prior.capture14DefaultAssessment.unknownWarnings.some(line => parse(line).native && parse(line).body === fakeIndex),
    "This exact message needs prior same-capture investigation, not merely a similar cache warning");
  assert.equal(runtime.status, "BLOCKED");
  assert.equal(runtime.fullStory.status, "PASS"); assert.equal(runtime.fullStory.cases.length, 7);
  assert(runtime.fullStory.cases.every(c => c.status === "PASS"));
  assert(Object.keys(runtime.requiredCoverage).length >= 20);
  for (const [name, state] of Object.entries(runtime.requiredCoverage))
    assert.equal(state, name === "rendererWarnings" ? "BLOCKED" : "PASS", name);
  assert.equal(runtime.logcat.fatal.length, 0); assert.equal(runtime.logcat.errors.length, 0);
  const trials = runtime.restartTrials, assessment = assessRestartTrials(trials);
  assert.deepEqual(assessment, runtime.rendererWarningAssessment, "Recorded and freshly recomputed evidence differ");
  assert.equal(assessment.status, "BLOCKED"); assert.equal(assessment.stableLayers, true);
  assert.equal(assessment.monotonicGrowth, false); assert.equal(assessment.tileWarningCount, 0);
  assert.deepEqual(trials.map(t => t.kind), ["clean-install", "clean-install", "clean-install",
    "retained-data", "retained-data", "retained-data"]);
  assert.equal(new Set(trials.map(t => t.screenshotSha256)).size, 1);
  assert(trials.every(t => /^[a-f0-9]{64}$/.test(t.screenshotSha256)));
  const prefix = `/data/user/0/${runtime.packageName}/cache/WebView/Default/HTTP Cache/Code Cache/`;
  const isPath = body => ["js", "wasm"].some(kind => body ===
    `[ERROR:simple_file_enumerator.cc(21)] opendir ${prefix}${kind}: No such file or directory (2)`);
  const correlations = [];
  for (const trial of trials) {
    const entries = trial.warnings.map(parse), native = entries.filter(e => e.native);
    assert.equal(trial.fatal.length, 0);
    for (const event of entries) {
      assert.equal(event.pid, String(trial.pid), "Warning must belong to the observed application");
      assert(isPath(event.body) || event.body === cacheIndex || event.body === fakeIndex,
        `New warning requires investigation: ${event.body}`);
      if (!event.native)
        assert(native.some(e => e.pid === event.pid && e.body === event.body && Math.abs(e.time - event.time) <= 2),
          "Forwarded warning requires its actual native event");
      else if (event.body === cacheIndex)
        assert(native.some(e => isPath(e.body) && e.pid === event.pid && e.tid === event.tid && e.time === event.time),
          "Index failure needs exact same-event cache-path evidence");
      else if (event.body === fakeIndex) {
        const nearby = native.find(e => isPath(e.body) && e.pid === event.pid
          && e.time >= event.time && e.time - event.time <= 10);
        assert(nearby, "Fake index needs same-startup, same-PID nearby code-cache evidence");
        correlations.push({ trial: `${trial.kind}-${trial.iteration}`, native: event.line,
          cachePath: nearby.line, deltaMs: nearby.time - event.time,
          attribution: "Engineering inference from prior same-capture diagnosis; not a new native stack" });
      }
    }
  }
  assert(correlations.length > 0, "Review only applies to the explicit fake-index blocker");
  assert.equal(assessment.unknownWarnings.length, correlations.length * 2);
  assert(assessment.unknownWarnings.every(line => parse(line).body === fakeIndex));
  return { status: "SCOPED_NON_BLOCKING_CACHE_WARNING_REVIEW", correlations,
    originalScannerStatus: "BLOCKED", assessment,
    limits: "This APK/API35/recorded provider only. No new native stack or provider binary capture; prior attribution is an engineering inference. Cache performance benefit may be lost. No scanner exemption, upstream fix, old-device support or overall release claim." };
}
async function main() {
  assert.equal(process.argv.length, 5, "node script <completed-run> <prior-disposition> <fresh-review-json>");
  const [run, priorFile, file] = process.argv.slice(2).map(p => path.resolve(p));
  assert(A.inside(path.join(root, "output"), run) && A.inside(run, file));
  assert(!fs.existsSync(file), "Preserve all original reports and earlier reviews");
  const source = path.join(run, "report.json"), session = path.join(run, "installed-session");
  const device = path.join(session, "android-runtime"), runtimeFile = path.join(device, "runtime-smoke-report.json");
  const result = { status: "FAILED", checkedAt: new Date().toISOString(), source: evidence(source),
    runtime: evidence(runtimeFile), prior: evidence(priorFile), originalReportsModified: false, checks: [] };
  async function check(name, action) {
    const row = { name, status: "FAILED" }; result.checks.push(row);
    row.evidence = await action(); row.status = "PASS";
  }
  try {
    const main = read(source), runtime = read(runtimeFile), prior = read(priorFile);
    const launch = read(path.join(device, "acceptance-launch.json")), boot = read(path.join(device, "cold-boot.json"));
    const request = read(path.join(session, "android-request.json"));
    await check("same actual installation, source bytes, APK and unchanged post-host metadata", () => {
      assert.equal(main.status, "BLOCKED"); assert.equal(main.buildLaunch.status, "BUILD_PASS_DEVICE_PENDING");
      assert.equal(main.buildLaunch.originIsElevated, false); assert.equal(main.buildLaunch.isElevated, true);
      assert.equal(main.buildLaunch.exitCode, 0);
      assert.equal(sha(main.apk.path), main.apk.sha256); assert.equal(sha(main.apk.metadata.path), main.apk.metadata.sha256);
      assert.equal(runtime.sourceApk.path, main.apk.path); assert.equal(runtime.sourceApk.sha256, main.apk.sha256);
      assert.equal(request.apk, main.apk.path); assert.equal(request.package, runtime.packageName);
      assert.equal(sha(main.input.path), main.input.sha256);
      assert.equal(sha(main.sourceFixture.path), main.sourceFixture.sha256);
      const meta = read(main.apk.metadata.path), provenance = verifyProvenance(main.apk.path, meta);
      assert.equal(provenance.status, "PASS"); assert.equal(provenance.versionStatus, "RECORDED");
      assert.equal(meta.packageName, runtime.packageName); assert.equal(meta.engineVersion, meta.runtimeVersion);
      const cleanup = audit(meta); assert.equal(cleanup.status, "PASS");
      assert.equal(sha(main.windowsGate.path), main.windowsGate.sha256);
      const windows = validateWindowsPrerequisite(main.windowsGate.path,
        { auditFile: path.join(session, "installer-resource-report.json"), fixture: read(main.sourceFixture.path) });
      assert.equal(windows.currentInstallationVerified, true);
      const deployments = read(path.join(session, "installer-resource-report.json")).deployments
        .filter(d => d.kind === "NSIS actual isolated installation");
      assert.equal(deployments.length, 1); assert.equal(deployments[0].installedRoot, main.installRoot);
      assert.equal(sha(path.join(main.installRoot, "agentvn-editor.exe")), deployments[0].executable.sha256);
      assert(main.resources.length >= 158);
      for (const item of main.resources)
        for (const base of [root, main.installRoot]) assert.equal(sha(path.join(base, item.relative)), item.sha256);
      for (const [kind, relative] of [["engine", "GameCli_framework/src-tauri/Cargo.toml"],
        ["protocol", "shared/cartridge/constants.ts"]])
        assert.equal(meta.versionEvidence.sources[kind].sha256, sha(path.join(main.installRoot, relative)));
      return { apk: main.apk, versions: main.versionProvenance, windows, cleanup, installedFiles: main.resources.length };
    });
    await check("fresh raw-log replay, actual screenshot bytes and narrowly scoped prior attribution", () => {
      for (const item of [...prior.evidence, ...prior.sources]) assert.equal(sha(item.path), item.sha256);
      const raw = runtime.restartTrials.map(t => {
        const file = path.join(device, `${t.kind}-${t.iteration}-app-renderer-logcat.txt`);
        const replay = scopedRuntimeLog(fs.readFileSync(file, "utf8"), runtime.packageName, t.appAndRendererPids);
        assert.deepEqual(replay.warnings, t.warnings); assert.deepEqual(replay.fatal, t.fatal);
        assert.equal(sha(t.screenshotPath), t.screenshotSha256);
        return { log: evidence(file), screenshot: evidence(t.screenshotPath) };
      });
      return { ...reviewCacheWarnings(runtime, prior), raw };
    });
    await check("actual-touch functional flow, admin boundary, honest audio and complete finally cleanup", () => {
      assert.equal(runtime.interaction, "administrator-adb-real-touch"); assert.equal(runtime.isElevated, true);
      assert.equal(runtime.permission.isElevated, true); assert.equal(runtime.permission.success, true);
      assert.equal(launch.parentBoundary, "non-admin-to-RunAs"); assert.equal(launch.status, "CHECK_RUNTIME_REPORT");
      assert.equal(runtime.coldBoot.status, "PASS"); assert.equal(boot.audioEnabled, true);
      assert.equal(boot.avd, "AgentVN_API35"); assert.equal(boot.serial, "emulator-5554");
      assert(!boot.arguments.includes("-no-audio"));
      assert.equal(runtime.uninstallStatus, "PASS"); assert.equal(runtime.apkCleanupStatus, "PASS");
      assert.equal(runtime.cleanupError, null); assert.equal(launch.emulatorCleanupStatus, "PASS");
      assert.equal(boot.emulatorCleanupStatus, "PASS"); assert.equal(fs.existsSync(runtime.stagingApk.path), false);
      assert.equal(sha(runtime.sourceApk.path), runtime.sourceApk.sha256);
      assert.equal(main.audio.newListening, false); assert.equal(sha(main.audio.path), main.audio.sha256);
      assert.equal(read(main.audio.path).status, "USER_CONFIRMED_PASS");
      assert(runtime.touches.length > 0 && runtime.layoutChecks.length > 0 && runtime.screenshots.length > 0);
      const pids = [...new Set([main.owner.editorPid, main.owner.backendPid, main.buildLaunch.elevatedProcessId,
        launch.processId, runtime.ownership.runnerPid, ...boot.processes.map(p => p.ProcessId)].filter(Boolean))];
      const ports = [main.owner.backendPort, main.owner.cdpPort, request.adbPort, request.cdpPort,
        request.coldBoot.adbPort, request.coldBoot.grpcPort];
      const command = `$ErrorActionPreference='Stop'; $reviewPids=@(${pids.join(",")}); $reviewPorts=@(${ports.join(",")}); `
        + `@{processes=@(Get-CimInstance Win32_Process | Where-Object {$_.ProcessId -in $reviewPids} `
        + `| Select-Object ProcessId,Name); listeners=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue `
        + `| Where-Object {$_.LocalPort -in $reviewPorts} | Select-Object LocalPort,OwningProcess)} `
        + `| ConvertTo-Json -Depth 5 -Compress`;
      const host = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", command],
        { windowsHide: true, encoding: "utf8", timeout: 30000 }));
      assert.equal(host.processes.length, 0); assert.equal(host.listeners.length, 0);
      return { touches: runtime.touches.length, geometry: runtime.layoutChecks.length,
        screenshots: runtime.screenshots.map(file => evidence(file)), audio: main.audio,
        uninstallStatus: runtime.uninstallStatus, apkCleanupStatus: runtime.apkCleanupStatus,
        cleanupError: runtime.cleanupError, pids, ports, host };
    });
    result.status = "INSTALLED_FUNCTIONS_AND_CLEANUP_PASS_WITH_SCOPED_CACHE_WARNING";
    result.originalAutomationStatus = "BLOCKED";
    result.notAnUnqualifiedRuntimePass = true;
  } catch (error) { result.error = String(error.stack || error); process.exitCode = 1; }
  finally {
    assert.equal(sha(source), result.source.sha256); assert.equal(sha(runtimeFile), result.runtime.sha256);
    fs.writeFileSync(file, JSON.stringify(result, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: result.status, file, checks: result.checks.map(c => ({ name: c.name, status: c.status })),
      error: result.error }));
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { reviewCacheWarnings };
