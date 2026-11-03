"use strict";
// Orchestrate one owned administrator/device run from an audited terminal APK.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { fileEvidence } = require("./android-acceptance-evidence.cjs");
const { allocateAndroidDevicePorts } = require("./lib/android-device-ports.cjs");
const { validateRequest } = require("./android-native-upgrade-device.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const qa = "F:\\AgentVN\\QA\\Android-Package-20261021-01";
async function main() {
  const [attempt, auditAttempt, deviceAttempt, strategy] = process.argv.slice(2);
  for (const value of [attempt, auditAttempt, deviceAttempt]) assert.match(value, /^\d{2}$/);
  assert(strategy === undefined || strategy === "--background-auto");
  const out = path.join(qa, `device-upgrade-${attempt}-${deviceAttempt}`); fs.mkdirSync(out);
  const r = { status: "PREPARING", startedAt: new Date().toISOString(),
    scope: "RECENT_REAL_OLD_TO_CURRENT_APK_AVAILABLE_REAL_SAVES_AND_PREFERENCES_NOT_ALL_ANDROID_FEATURES",
    buildInvocations: 0, productChanges: 0, modelRequests: 0 };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
  try {
    const auditFile = path.join(qa, `native-upgrade-audit-${attempt}-${auditAttempt}`, "report.json");
    const audit = read(auditFile);
    assert(["APK_UPGRADE_PAIR_PASS_DEVICE_NOT_RUN",
      "APK_ARTIFACT_PAIR_PASS_EDITOR_CLOSE_FAILED_DEVICE_NOT_RUN"].includes(audit.status));
    r.sourcePublishingWorkflow = audit.publishingWorkflow || { publishingWorkflowStatus: "PASS" };
    const oldBuild = read(path.join(qa, "editor-10/report.json"));
    const old = oldBuild.artifacts.find(a => a.kind === "android_apk_signed"); assert(old);
    const [adbPort, cdpPort, bootPort, grpcPort] = await allocateAndroidDevicePorts();
    const request = { runId: `android-upgrade-${attempt}-${deviceAttempt}`,
      outputDir: path.join(out, "runtime"), scope: "installed-native-upgrade", package: "com.agentvn.qa.androidcurrent20261021",
      autoSaveSampleStrategy: strategy === "--background-auto" ? "background-resume" : "existing-only",
      sdk: "D:\\Android_dev\\Sdk", serial: "emulator-5554", adbPort, cdpPort,
      upgradePair: { old: audit.upgradePair.old, current: audit.upgradePair.current },
      oldApk: fileEvidence(old.path), apk: fileEvidence(audit.upgradePair.currentApk.path),
      packageAudit: fileEvidence(auditFile),
      coldBoot: { avd: "AgentVN_API35", avdHome: "D:\\Android_dev\\avd", adbPort: bootPort, grpcPort,
        discoveryRoot: "C:\\Users\\1\\AppData\\Local\\Temp\\avd\\running", mediaVolumeTarget: 13 } };
    validateRequest(request);
    // Negative validation uses actual retained sources, never a fake PASS package.
    const invalid = [
      q => { q.package = "com.other"; }, q => { q.upgradePair.current.versionCode = 1000; },
      q => { q.upgradePair.current.signerSha256 = "0".repeat(64); },
      q => { q.apk.sha256 = "0".repeat(64); }, q => { q.oldApk.sha256 = "0".repeat(64); },
      q => { q.outputDir = "D:\\AgentVN"; }, q => { q.scope = "installed-package-smoke"; },
      q => { q.packageAudit.sha256 = "0".repeat(64); }
    ];
    for (const mutate of invalid) { const copy = structuredClone(request); mutate(copy); assert.throws(() => validateRequest(copy)); }
    r.requestValidator = { status: "PASS", rejected: invalid.length };
    const tools = [__filename, path.join(__dirname, "android-native-upgrade-device.cjs"),
      path.join(__dirname, "start-android-acceptance.ps1"), path.join(__dirname, "android-cold-boot.ps1"),
      path.join(__dirname, "android-acceptance-preflight.ps1"),
      path.join(__dirname, "lib/android-adb-root-recovery.cjs")];
    r.tools = tools.map(file => {
      const copy = path.join(out, path.basename(file)); fs.copyFileSync(file, copy, fs.constants.COPYFILE_EXCL);
      const original = fileEvidence(file); assert.equal(fileEvidence(copy).sha256, original.sha256);
      return original;
    });
    const requestFile = path.join(out, "request.json");
    fs.writeFileSync(requestFile, JSON.stringify(request, null, 2), { flag: "wx" });
    const submitted = path.join(out, "request-submitted.json");
    fs.copyFileSync(requestFile, submitted, fs.constants.COPYFILE_EXCL);
    r.request = fileEvidence(submitted); r.runtimeRequestPath = requestFile;
    r.status = "STARTING_ONE_ADMINISTRATOR_RUNTIME"; save();
    console.log("Starting one administrator runtime: " + out);
    r.launchOutput = execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(__dirname, "start-android-acceptance.ps1"), "-RequestPath", requestFile],
    { windowsHide: true, encoding: "utf8", timeout: 120000 });
    r.status = "AWAITING_SAME_OWNED_RUNTIME"; save();
    const until = Date.now() + 40 * 60000, launchFile = path.join(request.outputDir, "acceptance-launch.json");
    while (Date.now() < until) {
      if (fs.existsSync(launchFile)) {
        let launch;
        try { launch = read(launchFile); } catch (e) { if (!(e instanceof SyntaxError)) throw e; }
        if (launch?.finishedAt) { r.launch = { ...fileEvidence(launchFile), value: launch }; break; }
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    assert(r.launch, "Observation timeout: preserve same owned helper and inspect; do not relaunch");
    r.runtimeRequestAfterBoot = fileEvidence(requestFile);
    const runtimeFile = path.join(request.outputDir, "upgrade-runtime-report.json");
    if (fs.existsSync(runtimeFile)) r.runtime = { ...fileEvidence(runtimeFile), value: read(runtimeFile) };
    for (const tool of r.tools) assert.equal(fileEvidence(tool.path).sha256, tool.sha256);
    assert.equal(r.launch.value.emulatorCleanupStatus, "PASS", r.launch.value.cleanupError);
    assert.equal(r.runtime?.value.uninstallStatus, "PASS"); assert.equal(r.runtime.value.apkCleanupStatus, "PASS");
    assert.equal(r.runtime.value.cleanupError, null); assert.equal(r.runtime.value.adbCleanupStatus, "PASS");
    assert.equal(r.runtime.value.cases.length, 6); assert(r.runtime.value.cases.every(c => c.status === "PASS"), r.runtime.value.error);
    assert.equal(r.runtime.value.restartTrials.length, 6);
    r.status = r.runtime.value.status;
    assert(["PARTIAL_PASS", "BLOCKED"].includes(r.status));
    r.limitations = ["Old default layout cannot create quick saves; that category remains BLOCKED",
      "Old APK normal exit remained pending; automatic save sample may be BLOCKED, not substituted",
      "Recent retained signed sample only; not the pre-save-mechanism old binary",
      "Real API35 emulator landscape; no physical device or full display matrix claim",
      "Renderer warnings require current-version review; no blanket old allowlist"];
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
  r.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: r.status, out, error: r.error }));
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
