"use strict";
// Independent read-only audit of this repair block; no build, ADB or metadata repair.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { execFileSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip"), sharp = require("../GameCli_framework/node_modules/sharp");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { verifyProvenance } = require("./android-acceptance-evidence.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Android-RunId-Release-20261021-01";
const android = "F:/AgentVN/QA/Android-Package-20261021-01";
const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
const deviceAttempt = process.argv[3] || "01"; assert.match(deviceAttempt, /^\d{2}$/);
const file = path.join(qa, `terminal-audit-${attempt}.json`); assert(!fs.existsSync(file));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const hash = b => crypto.createHash("sha256").update(b).digest("hex");
const desc = f => ({ path: f, sha256: sha(f), bytes: fs.statSync(f).size });
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "RUNID_REPAIR_INSTALLED_ANDROID_LIMITED_SMOKE_NOT_COMPLETE_REGRESSION",
  checks: [], evidence: [], modelRequests: 0, builds: 0, limitations: [
    "Controlled native output path; native picker remains BLOCKED",
    "Desktop capture is installed WebView viewport simulation, 1080p DPR1 only",
    "Asset-free three-line AgentVN fixture, not full story/NVL/bubble/old-APK upgrade",
    "Audio user-confirmed historically; no new capture or listening",
    "Silent independent-directory NSIS, not clean machine or full upgrade matrix",
  ] };
function evidence(f) { const r = read(f); report.evidence.push({ ...desc(f), status: r.status }); return r; }
async function check(name, action) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { row.result = await action(); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); }
}
(async () => {
  const baseline = evidence(path.join(qa, "checkpoint-01/report.json"));
  const install = evidence(path.join(qa, "installation.json"));
  const build = evidence(path.join(android, "editor-10/report.json"));
  const device = evidence(path.join(android, `device-10-${deviceAttempt}/report.json`));
  let apk, metadata;
  await check("Original failed package/report preserved; product and candidate provenance", async () => {
    for (const f of [...baseline.frozen, ...baseline.history]) assert.equal(sha(f.path), f.sha256, f.path);
    const sourceCheckpoint = read("F:/AgentVN/QA/Android-RunId-Repair-20261021-01/checkpoint.json");
    const allowed = new Set(["editor/src-tauri/src/main.rs", "editor/package.json", "editor/package-lock.json",
      "editor/src-tauri/Cargo.toml", "editor/src-tauri/Cargo.lock", "editor/src-tauri/tauri.conf.json"]);
    let unchangedProductFiles = 0;
    for (const f of sourceCheckpoint.snapshots) {
      if (!/^(editor|GameCli_framework|backend|shared)\//.test(f.relative) || allowed.has(f.relative) || f.deleted) continue;
      assert.equal(sha(path.join(root, f.relative)), f.sha256, f.relative); unchangedProductFiles++;
    }
    assert(unchangedProductFiles > 400, "Must audit the saved WIP, not just selected UI files");
    assert.equal(read(path.join(android, "editor-09/report.json")).status, "FAILED");
    for (const phase of ["check", "dev", "release", "payload", "install"]) {
      const r = evidence(path.join(qa, `${phase}-01/report.json`));
      assert.equal(r.status, "PASS"); assert(r.commands.length > 0);
      assert(r.commands.every(c => c.status === "PASS" && c.exitCode === 0));
      for (const f of r.sources) {
        if (sha(f.path) === f.sha256) continue;
        // The completed build froze its original QA launcher. A later QA-only
        // import repair must retain that exact source and use a new device run.
        assert.equal(path.resolve(f.path), path.join(root, "scripts/android-current-package-device.cjs"));
        const checkpointFile = "F:/AgentVN/Checkpoints/Android-Device-QA-20261021-01/checkpoint.json";
        const checkpoint = read(checkpointFile);
        const saved = checkpoint.files.find(s => path.resolve(s.path) === path.resolve(f.path));
        assert(saved); assert.equal(saved.sha256, f.sha256); assert.equal(sha(saved.copy), f.sha256);
        const executed = device.tools?.find(s => path.resolve(s.path) === path.resolve(f.path));
        assert(executed); assert.equal(sha(f.path), executed.sha256);
        for (const frozen of checkpoint.frozen) assert.equal(sha(frozen.path), frozen.sha256, frozen.path);
        assert.equal(read(path.join(android, "device-10-01/report.json")).status, "FAILED");
        assert(!fs.existsSync(path.join(android, "device-10-01/runtime")));
        report.qaContinuation = { checkpoint: desc(checkpointFile), originalSource: desc(saved.copy),
          executedSource: desc(f.path), deviceAttempt, originalDeviceActions: 0 };
      }
    }
    const dev = read(path.join(qa, "dev-01/report.json"));
    assert.equal(sha(dev.dev.path), dev.dev.sha256);
    assert.equal(sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")), dev.dev.sha256);
    assert.equal(install.status, "PASS"); assert.equal(install.metadataRestoration, "PASS");
    assert.equal(sha(install.executable.path), install.executable.sha256);
    for (const f of install.resources) assert.equal(sha(f.path), f.sha256, f.path);
    return { dev: dev.dev, installed: install.executable, unchangedProductFiles };
  });
  await check("One real installed Android build, original ID through final native cleanup and APK signature", async () => {
    assert.equal(build.status, "PASS"); assert.equal(build.builds, 1); assert.equal(build.version, "1.9.19");
    assert.equal(build.androidBuildStatus, "STATIC_ONLY");
    assert.equal(build.nativeResult.status, "TERMINAL"); assert.equal(build.nativeResult.result.ok, true);
    const artifacts = build.artifacts.filter(a => a.kind === "android_apk_signed");
    assert.equal(artifacts.length, 1); apk = artifacts[0].path;
    assert.equal(sha(apk), artifacts[0].sha256);
    const metadataFile = apk + ".acceptance.json"; metadata = read(metadataFile);
    assert.equal(metadata.runId, build.buildRequest.runId);
    assert.equal(metadata.nativeCleanup.status, "PASS"); assert.equal(metadata.nativeCleanup.cleanupError, null);
    assert.equal(metadata.sourceCartridge.cleaned, true); assert.equal(metadata.prepackageLayout.cleaned, true);
    assert.equal(metadata.sourceCartridge.sha256, sha(build.cartridge.path));
    assert.equal(metadata.editorVersion, "1.9.19");
    assert.equal(verifyProvenance(apk, metadata).status, "PASS");
    const zip = await JSZip.loadAsync(fs.readFileSync(apk), { checkCRC32: true });
    const entry = zip.file("assets/embedded-cartridge/ui/layout.json"); assert(entry);
    const layout = await entry.async("nodebuffer");
    assert.equal(hash(layout), metadata.embeddedLayout.sha256);
    const cart = await JSZip.loadAsync(fs.readFileSync(build.cartridge.path));
    assert.deepEqual(JSON.parse(layout.toString("utf8")), JSON.parse(await cart.file("ui/layout.json").async("string")));
    const signature = execFileSync(
      "C:/Users/1/AppData/Local/AgentVN/AndroidToolchain/jdk-17/bin/java.exe",
      ["-jar", "C:/Users/1/AppData/Local/AgentVN/AndroidToolchain/Sdk/build-tools/35.0.0/lib/apksigner.jar",
        "verify", "--verbose", "--print-certs", apk],
      { encoding: "utf8", windowsHide: true, timeout: 30000 });
    assert.match(signature, /Verifies/); assert.match(signature, /v2 scheme.*true/);
    const log = path.join(qa, `signature-audit-${attempt}.log`);
    fs.writeFileSync(log, signature, { flag: "wx" });
    return { apk: desc(apk), metadata: desc(metadataFile), layout: metadata.embeddedLayout, signature: desc(log) };
  });
  await check("Actual elevation, symlink and exact cache/policy/task finally", async () => {
    const admin = evidence(path.join(android, "administrator-10/result.json"));
    const origin = evidence(path.join(android, "administrator-10/origin.json"));
    assert.equal(origin.originIsElevated, false); assert.equal(admin.isElevated, true);
    assert.equal(admin.probe.success, true); assert.equal(admin.probe.isElevated, true);
    assert.equal(admin.originProcessId, origin.originProcessId);
    assert.equal(admin.policyRestoration, "PASS"); assert.equal(admin.physicalProtectionRestoration, "PASS");
    assert.equal(evidence(path.join(android, "administrator-10/task-engine.json")).cleanup, "PASS");
    assert.equal(evidence(path.join(android, "editor-10/cache-restoration.json")).status, "PASS");
    assert(build.cleanups.length > 0 && build.cleanups.every(c => c.status === "PASS"));
    assert.equal(sha(build.installation.path), build.installation.sha256);
    const now = rows(), known = [...build.knownProcesses, ...build.buildKnownProcesses];
    assert(!known.some(p => now.some(n => p.ProcessId === n.ProcessId && p.Created === n.Created)));
    assert.equal(listeners(build.cleanups.flatMap(c => c.ports)).length, 0);
    for (const f of build.packagedHostHistoricalProtection) assert.equal(sha(f.path), f.sha256, f.path);
    return { cacheRows: 4, ownedProcesses: known.length };
  });
  await check("Installed screenshots have actual matching viewport/DPR and decoded PNG geometry", async () => {
    assert(build.screenshots.length >= 2);
    for (const s of build.screenshots) {
      assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
      const png = await sharp(s.path).metadata();
      assert.equal(png.width, s.png.width); assert.equal(png.height, s.png.height);
      assert.equal(png.width, s.before.width * s.before.dpr);
      assert.equal(png.height, s.before.height * s.before.dpr);
    }
    return { captures: build.screenshots.length, viewport: build.screenshots[0].before };
  });
  await check("Real-touch limited Android flow, six restarts, evidence and finally cleanup", async () => {
    assert.equal(device.status, "INSTALLED_PACKAGE_SMOKE_PASS"); assert.equal(device.cleanup, "PASS");
    assert.equal(device.buildInvocations, 0); assert.equal(device.modelRequests, 0);
    assert.equal(sha(device.build.path), device.build.sha256);
    const runtime = evidence(device.runtime.path), launch = evidence(device.launch.path);
    const serializationRoot = "F:/AgentVN/Checkpoints/Android-Device-QA-20261021-01/serialization";
    const oldDevice = path.join(android, "device-10-02/report.json");
    const oldRuntime = path.join(android, "device-10-02/runtime/runtime-smoke-report.json");
    assert.equal(sha(oldDevice), sha(path.join(serializationRoot, "device-report-02.json")));
    assert.equal(sha(oldRuntime), sha(path.join(serializationRoot, "runtime-report-02.json")));
    assert.equal(read(oldDevice).status, "FAILED"); assert.equal(read(oldDevice).cleanup, "PASS");
    assert.equal(read(oldRuntime).message, '{"code":-32000,"message":"Object reference chain is too long"}');
    assert(!fs.existsSync(path.join(android, "device-10-02/runtime/staging.apk")));
    assert.equal(runtime.status, "INSTALLED_PACKAGE_SMOKE_PASS");
    assert.equal(runtime.interaction, "administrator-adb-real-touch");
    assert.equal(runtime.packageSmoke.cases.length, 4);
    assert(runtime.packageSmoke.cases.every(c => c.status === "PASS"));
    assert.equal(runtime.restartTrials.length, 6);
    for (const kind of ["clean-install", "retained-data"]) {
      const trials = runtime.restartTrials.filter(t => t.kind === kind);
      assert.equal(trials.length, 3);
      assert.deepEqual(trials.map(t => t.iteration), [1, 2, 3]);
    }
    assert.equal(Object.keys(runtime.requiredCoverage).length, 12);
    assert(Object.values(runtime.requiredCoverage).every(s => s === "PASS"));
    assert.equal(launch.isElevated, true);
    for (const tool of device.tools) assert.equal(sha(tool.path), tool.sha256, tool.path);
    for (const trial of runtime.restartTrials) {
      assert.equal(sha(trial.screenshotPath), trial.screenshotSha256);
      assert.equal(trial.fatal.length, 0);
    }
    assert(runtime.touches.length > 0 && runtime.screens.length > 0);
    const taps = runtime.touches.filter(t => !t.kind);
    assert(taps.length > 0 && taps.every(t => t.touchPoint?.hit === true));
    const saveRoot = runtime.screens.find(s => s.label === "package-manual-save")?.state.root;
    assert(saveRoot);
    for (const action of runtime.touches.filter(t => t.kind)) {
      if (action.kind === "swipe") {
        assert(action.before?.hit && action.after?.hit);
        assert(Number.isFinite(action.x) && Number.isFinite(action.y1) && Number.isFinite(action.y2));
      } else if (action.kind === "scroll-reachability") {
        const rect = action.cssRect;
        assert(rect.width > 0 && rect.height > 0);
        assert(rect.x >= 0 && rect.y >= 0 && rect.right <= saveRoot.width && rect.bottom <= saveRoot.height);
      } else assert.fail(`Unreviewed interaction kind: ${action.kind}`);
    }
    assert.equal(runtime.uninstallStatus, "PASS"); assert.equal(runtime.apkCleanupStatus, "PASS");
    assert.equal(runtime.cleanupError, null); assert.equal(launch.emulatorCleanupStatus, "PASS");
    const runtimeRoot = path.dirname(device.runtime.path);
    assert(!fs.existsSync(path.join(runtimeRoot, "staging.apk")));
    for (const name of ["logcat.txt", "runtime-smoke-report.json", "cold-boot.json"])
      assert(fs.statSync(path.join(runtimeRoot, name)).size > 0, name);
    assert(fs.readdirSync(runtimeRoot).some(n => n.endsWith(".xml")), "UIAutomator evidence required");
    const boot = read(path.join(runtimeRoot, "cold-boot.json")), now = rows();
    const timestamp = value => {
      const encoded = String(value).match(/^\/Date\((\d+)(?:[+-]\d+)?\)\/$/);
      return encoded ? Number(encoded[1]) : Date.parse(value);
    };
    assert(Array.isArray(boot.processes) && boot.processes.length > 0);
    assert(!boot.processes.some(owned => now.some(p => p.ProcessId === owned.ProcessId
      && Math.abs(timestamp(owned.CreationDate) - timestamp(p.Created)) < 2)),
      "No owned emulator may remain; unrelated or reused PIDs are preserved");
    assert.equal(sha(apk), metadata.apk.sha256, "Preserve source APK");
    return { cases: 4, restarts: 6, touches: runtime.touches.length, actualTaps: taps.length,
      screenshots: runtime.screenshots.length, audio: device.audio };
  });
  report.status = report.checks.every(c => c.status === "PASS") ? "PASS" : "FAILED";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); })
  .finally(() => {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, file, checks: report.checks.map(c => ({
      name: c.name, status: c.status, error: c.error })), error: report.error }, null, 2));
    if (report.status !== "PASS") process.exitCode = 1;
  });
