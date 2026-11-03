"use strict";
// Independent evidence audit. Never boots a device, rebuilds, or changes a product verdict.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto");
const JSZip = require("../editor/node_modules/jszip");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { scopedRuntimeLog } = require("./android-runtime-log-analysis.cjs");
const [deviceDirectory, output] = process.argv.slice(2);
const out = path.resolve(output || ""), device = path.resolve(deviceDirectory || "");
assert.equal(path.dirname(device), "F:\\AgentVN\\QA\\Android-Package-20261021-01");
assert.match(path.basename(device), /^device-aspect-37-\d{2}$/);
assert.equal(path.dirname(out), "F:\\AgentVN\\QA\\Player-Aspect-20261102-01");
assert(!fs.existsSync(out));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const verify = f => { assert.equal(sha(f.path || f.file), f.sha256, f.path || f.file); };
const report = { status: "RUNNING", startedAt: new Date().toISOString(), checks: [], modelRequests: 0,
  productChanges: 0, builds: 0, deviceLaunches: 0 };
const save = () => fs.writeFileSync(out, JSON.stringify(report, null, 2));
let runtime, build, request, admin;
async function check(name, fn) {
  const c = { name, status: "RUNNING" }; report.checks.push(c); save();
  try { c.detail = await fn(); c.status = "PASS"; }
  catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
  finally { save(); }
}
(async () => {
  await check("real-installed-editor-single-build-admin-and-restored-environment", () => {
    request = read(path.join(device, "request.json")); verify(request.build); build = read(request.build.path);
    assert.equal(build.status, "PASS"); assert.equal(build.cleanup, "PASS"); assert.equal(build.builds, 1);
    assert.equal(build.steps.length, 4); assert(build.steps.every(s => s.status === "PASS"));
    verify(build.apk); verify(build.installation); verify(build.author); verify(build.testIdentity);
    for (const f of build.observedFiles) verify(f);
    assert(build.observedFiles.some(f => f.name === "settings") && build.observedFiles.some(f => f.name === "settings-store"));
    verify(build.cacheRestoration); verify(build.policyRestoration);
    assert.equal(read(build.cacheRestoration.path).status, "PASS");
    assert.equal(read(build.policyRestoration.path).status, "PASS");
    const dir = build.administrator.directory, origin = read(path.join(dir, "origin.json"));
    const receipt = read(path.join(dir, "result.json")), task = read(path.join(dir, "task-engine.json"));
    assert.equal(origin.originIsElevated, false); assert.equal(receipt.isElevated, true);
    assert.equal(receipt.status, "BUILD_PASS_DEVICE_PENDING");
    assert(receipt.probe.success && receipt.probe.isElevated && !fs.existsSync(receipt.probe.probeRoot));
    assert.equal(task.cleanup, "PASS"); assert.equal(task.status, "PASS");
    assert.equal(build.controlledOutput.cleanup.restored, true);
    assert.equal(build.controlledOutput.cleanup.calls, 1);
    report.build = desc(request.build.path); report.apk = build.apk;
    return { build: build.status, cache: "PASS", policy: "PASS", nativeOutputPicker: "NOT_RUN",
      sourceApk: build.apk, buildAdmin: receipt.processId, noSecondBuild: true };
  });
  await check("apk-embedded-source-and-authored-default-unchanged-by-player", async () => {
    const zip = await JSZip.loadAsync(fs.readFileSync(build.apk.path), { checkCRC32: true });
    for (const key of ["manifest", "layout"]) {
      const e = build.embedded[key], bytes = await zip.file(e.name).async("nodebuffer");
      assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), e.sha256);
      assert.deepEqual(JSON.parse(bytes), e.value);
    }
    assert.equal(build.embedded.manifest.value.game_id, "qa_player_aspect_android_1936");
    assert.equal(build.embedded.manifest.value.runtime_version, "0.27.0");
    assert.equal(build.embedded.layout.value.layout_type, "renpy");
    assert.equal(build.embedded.layout.value.gameViewport.aspectRatio, "4:3");
    return { game: "qa_player_aspect_android_1936", minimumRuntime: "0.27.0", authorDefault: "4:3" };
  });
  await check("current-android-touch-cases-restarts-rotation-and-images", () => {
    runtime = read(path.join(device, "runtime-report.json"));
    const prior = read(runtime.continuation.previousReport.path);
    verify(runtime.continuation.previousReport);
    assert.equal(prior.status, "FAILED"); assert.equal(prior.cleanup, "PASS");
    assert.equal(prior.error.includes("137 !== 0"), true);
    assert.equal(runtime.status, "BLOCKED"); assert.equal(runtime.functionalStatus, "PASS");
    assert.deepEqual(runtime.cases.map(c => c.name), [
      "current-apk-signature-package-capability-and-real-install",
      "real-process-restart-retains-player-override-and-reset-default",
    ]);
    assert(runtime.cases.every(c => c.status === "PASS"));
    assert.equal(prior.cases.length, 5); assert(prior.cases.slice(0, 4).every(c => c.status === "PASS"));
    verify(runtime.source); verify(runtime.test);
    assert.equal(runtime.apk.sha256, build.apk.sha256);
    const touches = [...prior.touches, ...runtime.touches], screenshots = [...prior.screenshots, ...runtime.screenshots];
    const pids = [...prior.pids, ...runtime.pids];
    assert(touches.length >= 38 && screenshots.length >= 16 && pids.length === 6);
    assert.equal(new Set(pids).size, 6);
    assert.equal(runtime.device.api, "35");
    assert.equal(runtime.device.installedSha256, build.apk.sha256);
    assert.match(runtime.device.signer, /^[a-f0-9]{64}$/);
    let xmls = 0;
    for (const s of screenshots) {
      verify(s); assert.deepEqual(s.before, s.after);
      const bytes = fs.readFileSync(s.path);
      assert.equal(bytes.readUInt32BE(16), s.physical.width); assert.equal(bytes.readUInt32BE(20), s.physical.height);
      assert(s.physical.width >= 1920 && s.physical.height >= 1080 && s.physical.width > s.physical.height);
      assert(Math.abs(s.before.width * s.before.dpr - s.physical.width) <= 3);
      assert(Math.abs(s.before.height * s.before.dpr - s.physical.height) <= 3);
      if (s.uiautomator) { verify(s.uiautomator); assert(fs.readFileSync(s.uiautomator.path, "utf8").includes(request.package)); xmls++; }
    }
    assert(xmls >= 3);
    const choices = prior.cases[1].detail, story = prior.cases[2].detail;
    assert.deepEqual(choices.map(c => c.value), ["16:9", "16:10", "4:3", "default"]);
    assert.deepEqual(story.cases.map(c => c.value), choices.map(c => c.value));
    assert(story.cases.every(c => c.quickbar.buttons.length === 9));
    assert.deepEqual(prior.cases[3].detail.map(c => c.actual.angle), [270, 90]);
    assert.deepEqual(runtime.cases[1].detail.map(c => c.value), ["16:10", "default"]);
    report.priorDeviceReport = desc(runtime.continuation.previousReport.path);
    report.continuationDeviceReport = desc(path.join(device, "runtime-report.json"));
    report.runtime = desc(path.join(device, "runtime-report.json"));
    return { functionalStatus: "PASS", touches: runtime.touches.length, pngs: runtime.screenshots.length,
      combinedTouches: touches.length, combinedPngs: screenshots.length, xmls, launches: pids.length,
      firstAttemptAncillaryFailurePreserved: prior.error, limitations: runtime.limitations };
  });
  await check("current-log-verdict-does-not-reuse-historical-allowlists", () => {
    const logFile = path.join(device, "logcat.txt"), logs = fs.readFileSync(logFile, "utf8");
    const prior = read(runtime.continuation.previousReport.path);
    const priorLog = fs.readFileSync(path.join(path.dirname(runtime.continuation.previousReport.path), "logcat.txt"), "utf8");
    const scoped = scopedRuntimeLog(logs, request.package, runtime.pids);
    assert.deepEqual(scoped, runtime.logs); assert.equal(scoped.fatal.length, 0);
    assert.equal(runtime.logAssessment.historicalAllowlistUsed, false);
    const priorScoped = scopedRuntimeLog(priorLog, request.package, prior.pids);
    assert.deepEqual(priorScoped, prior.logs);
    assert.equal(priorScoped.fatal.length, 0);
    const warnings = scoped.warnings.length + priorScoped.warnings.length;
    const rendererEvents = runtime.rendererEvents.length + prior.rendererEvents.length;
    const blocking = warnings || rendererEvents;
    assert.equal(runtime.status, blocking ? "BLOCKED" : "PASS");
    report.productVerdict = runtime.status;
    return { verdict: runtime.status, warnings, rendererEvents, historicalAllowlistUsed: false,
      logs: [desc(path.join(device, "logcat.txt")), desc(path.join(path.dirname(runtime.continuation.previousReport.path), "logcat.txt"))] };
  });
  await check("test-package-staging-task-emulator-process-and-port-cleanup", () => {
    admin = read(path.join(device, "administrator.json")); const task = read(path.join(device, "task-engine.json"));
    const boot = read(path.join(device, "cold-boot.json")), origin = read(path.join(device, "origin.json"));
    assert.equal(origin.originIsElevated, false); assert.equal(admin.isElevated, true);
    assert.equal(admin.status, runtime.status); assert.equal(admin.cleanup, "PASS");
    assert.equal(task.cleanup, "PASS"); assert.equal(task.status, runtime.status);
    const prior = read(runtime.continuation.previousReport.path);
    assert.equal(prior.cleanup, "PASS"); assert.equal(prior.uninstall, "PASS");
    assert.equal(prior.stagingCleanup, "PASS"); assert.equal(prior.adbCleanup, "PASS");
    assert.equal(prior.forwardCleanup, "PASS");
    assert.equal(boot.emulatorCleanupStatus, "PASS"); assert.equal(runtime.cleanup, "PASS");
    assert.equal(runtime.rotationRestoration, "NOT_CHANGED_PRIOR_ROUNDTRIP_PASS_REFERENCED");
    assert.equal(prior.rotationRestoration, "PASS");
    assert.equal(runtime.uninstall, "PASS");
    assert.equal(runtime.stagingCleanup, "PASS"); assert.equal(runtime.adbCleanup, "PASS");
    assert.equal(runtime.forwardCleanup, "PASS"); assert(!fs.existsSync(path.join(device, "current-staging.apk")));
    verify(build.apk);
    const live = rows(), known = [...(build.knownProcesses || []), ...build.knownBuildProcesses];
    const identities = new Set(known.map(p => `${p.ProcessId}:${p.Created}`));
    assert(!live.some(p => identities.has(`${p.ProcessId}:${p.Created}`)));
    assert(!live.some(p => [origin.helperPid, admin.processId, admin.nodePid, ...boot.processes.map(p => p.ProcessId)].includes(p.ProcessId)));
    const ports = [...build.launches.flatMap(l => l.ports), request.adbPort, request.cdpPort,
      request.coldBoot.adbPort, request.coldBoot.grpcPort, 5554, 5555];
    const priorRequest = read(runtime.continuation.previousReport.path.replace(/runtime-report\.json$/, "request.json"));
    ports.push(priorRequest.adbPort, priorRequest.cdpPort, priorRequest.coldBoot.adbPort, priorRequest.coldBoot.grpcPort);
    assert.deepEqual(listeners(ports), []);
    return { cleanup: "PASS", firstRoundCleanup: "PASS", continuationCleanup: "PASS",
      processIdentities: identities.size, ports: new Set(ports).size,
      sourcePreserved: build.apk.path, userFilesDeleted: 0 };
  });
  assert.equal(report.checks.length, 5);
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => { report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify(report)); });
