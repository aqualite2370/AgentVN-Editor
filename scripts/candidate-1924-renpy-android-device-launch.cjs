"use strict";
// A single resource-backed run, gated on the terminal installed-builder audit.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { fileEvidence } = require("./android-acceptance-evidence.cjs");
const { allocateAndroidDevicePorts } = require("./lib/android-device-ports.cjs");
const { validateRenpyRequest } = require("./candidate-1924-renpy-android-device.cjs");
const root = "F:\\AgentVN\\QA\\Android-Package-20261021-01";
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const tools = [
  "candidate-1924-renpy-android-device-launch.cjs", "candidate-1924-renpy-android-device.cjs",
  "candidate-1924-renpy-android-device-start.ps1", "android-current-navigation.cjs",
  "start-android-acceptance.ps1", "android-cold-boot.ps1", "android-acceptance-preflight.ps1",
  "visible-control-geometry.cjs", "android-acceptance-evidence.cjs", "android-runtime-log-analysis.cjs",
  "android-native-upgrade-device.cjs", "android-exit-device.cjs",
  "lib/renpy-official-android-flow.cjs", "lib/current-android-navigation-exit.cjs",
  "lib/android-activity-exit.cjs", "lib/android-exit-observer.cjs", "lib/android-adb-root-recovery.cjs",
];
function validateCompletion(r) {
  assert(r.finishedAt); assert.equal(r.scope, "installed-renpy-resource-navigation");
  assert(["PASS_LIMITED_RENPY_OFFICIAL_GUI", "BLOCKED_RENDERER_REVIEW", "FAILED"].includes(r.status));
  assert.equal(r.isElevated, true);
  assert.equal(r.uninstallStatus, "PASS"); assert.equal(r.apkCleanupStatus, "PASS");
  assert.equal(r.adbCleanupStatus, "PASS"); assert.equal(r.cleanupError, null);
  if (r.status !== "FAILED") {
    assert.equal(r.cases.length, 5); assert(r.cases.every(row => row.status === "PASS"));
    assert.equal(r.activityExits.length, 2); assert.equal(r.quickSaveSnapshots.length, 7);
    assert(r.renderedResources.length >= 3);
  } else assert(r.error);
}
async function main() {
  if (process.argv[2] === "--self-test") {
    const result = execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(__dirname, "candidate-1924-renpy-android-device-start.ps1"), "-SelfTest"],
    { windowsHide: true, encoding: "utf8", timeout: 30000 });
    assert.match(result, /PASS: Renpy resource runner/);
    const good = { finishedAt: "terminal", scope: "installed-renpy-resource-navigation",
      status: "PASS_LIMITED_RENPY_OFFICIAL_GUI", isElevated: true, uninstallStatus: "PASS",
      apkCleanupStatus: "PASS", adbCleanupStatus: "PASS", cleanupError: null,
      cases: Array.from({ length: 5 }, () => ({ status: "PASS" })), activityExits: [{}, {}],
      quickSaveSnapshots: Array.from({ length: 7 }, () => []), renderedResources: [{}, {}, {}] };
    validateCompletion(good);
    const mutations = [r => { r.cases = []; }, r => { r.activityExits.pop(); },
      r => { r.quickSaveSnapshots.pop(); }, r => { r.isElevated = false; },
      r => { r.cleanupError = "failure"; }, r => { r.uninstallStatus = "FAILED"; },
      r => { r.status = "PASS"; }, r => { delete r.finishedAt; }];
    for (const mutate of mutations) { const r = structuredClone(good); mutate(r); assert.throws(() => validateCompletion(r)); }
    console.log(JSON.stringify({ status: "PASS", rejectedReceipts: mutations.length,
      nodeToPowerShell: "PASS", deviceOperations: 0 })); return;
  }
  assert.equal(process.argv.length, 3);
  const attempt = process.argv[2]; assert.match(attempt, /^\d{2}$/);
  const auditFile = path.join(root, "renpy-artifact-19-audit-01/report.json"), audit = read(auditFile);
  assert.equal(audit.status, "RENPY_RESOURCE_APK_PASS_SUPPLEMENTAL_NORMAL_PUBLISH_BLOCKED_DEVICE_NOT_RUN");
  const out = path.join(root, "device-renpy-19-" + attempt); fs.mkdirSync(out);
  const r = { status: "PREPARING", startedAt: new Date().toISOString(),
    scope: "INSTALLED_RENPY_RESOURCE_DEVICE_SUPPLEMENTAL_NOT_NORMAL_PUBLISH",
    productChanges: 0, modelRequests: 0, buildInvocations: 0, packageAudit: fileEvidence(auditFile) };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
  try {
    const previous = read(path.join(root, "device-upgrade-17-03/request-submitted.json"));
    const [adbPort, cdpPort, bootPort, grpcPort] = await allocateAndroidDevicePorts();
    const q = { runId: "android-renpy-resource-19-" + attempt, scope: "installed-renpy-resource-navigation",
      outputDir: path.join(out, "runtime"), package: audit.identity.packageName,
      sdk: previous.sdk, serial: previous.serial, adbPort, cdpPort,
      apk: audit.apk, packageAudit: fileEvidence(auditFile), resourceAssets: audit.embeddedAssets,
      coldBoot: { ...previous.coldBoot, adbPort: bootPort, grpcPort } };
    validateRenpyRequest(q);
    r.tools = tools.map(name => {
      const file = path.join(__dirname, name);
      fs.copyFileSync(file, path.join(out, path.basename(name)), fs.constants.COPYFILE_EXCL);
      return fileEvidence(file);
    });
    const requestFile = path.join(out, "request.json");
    fs.writeFileSync(requestFile, JSON.stringify(q, null, 2), { flag: "wx" });
    fs.copyFileSync(requestFile, path.join(out, "request-submitted.json"), fs.constants.COPYFILE_EXCL);
    r.status = "AWAITING_SAME_OWNED_RUNTIME"; save();
    r.launchOutput = execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(__dirname, "candidate-1924-renpy-android-device-start.ps1"), "-RequestPath", requestFile],
    { windowsHide: true, encoding: "utf8", timeout: 120000 });
    save();
    const until = Date.now() + 25 * 60000, launchFile = path.join(q.outputDir, "acceptance-launch.json");
    while (Date.now() < until) {
      if (fs.existsSync(launchFile)) {
        let launch; try { launch = read(launchFile); } catch (e) { if (!(e instanceof SyntaxError)) throw e; }
        if (launch?.finishedAt) { r.launch = { ...fileEvidence(launchFile), value: launch }; break; }
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    assert(r.launch, "Observation timeout: inspect the same owner; do not relaunch");
    assert.equal(r.launch.value.emulatorCleanupStatus, "PASS");
    const runtimeFile = path.join(q.outputDir, "navigation-report.json");
    r.runtime = { ...fileEvidence(runtimeFile), value: read(runtimeFile) };
    validateCompletion(r.runtime.value);
    for (const tool of r.tools) assert.equal(fileEvidence(tool.path).sha256, tool.sha256);
    assert.equal(fileEvidence(auditFile).sha256, r.packageAudit.sha256);
    r.status = r.runtime.value.status;
    if (r.status === "FAILED") process.exitCode = 1;
    r.limitations = [
      "Supplemental installed native builder; ordinary native picker and normal Editor close remain unverified",
      "Official GUI fixture only; not NVL, bubble, complete glyph coverage or full Android acceptance",
      "API35 emulator natural landscape; not physical-device or desktop display-matrix evidence",
      "Historical failures and unresolved cache warnings remain separate",
    ];
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
  r.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: r.status, out, error: r.error }));
}
module.exports = { validateCompletion };
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
