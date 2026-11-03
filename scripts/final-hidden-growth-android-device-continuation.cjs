"use strict";
// Reuse an unchanged installed-UI-built APK after a device-harness correction.
// Never upgrades or rewrites the original failed build/runtime receipts.
const fs = require("node:fs"), path = require("node:path"), net = require("node:net");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const A = require("./lib/installed-acceptance.cjs");
const { verifyProvenance } = require("./android-acceptance-evidence.cjs");
const { validateHiddenGrowthApk } = require("./lib/android-hidden-growth-flow.cjs");
assert.equal(process.argv.length, 4, "node continuation <prior-final-android-run> <fresh-run>");
const [prior, out] = process.argv.slice(2).map(p => path.resolve(p)), root = path.resolve(__dirname, "..");
assert(A.inside(path.join(root, "output"), out) && !fs.existsSync(out) && out !== prior);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const ev = f => ({ path: f, sha256: A.sha256(fs.readFileSync(f)) });
const priorFile = path.join(prior, "report.json"), beforeBytes = fs.readFileSync(priorFile), previous = read(priorFile);
assert.equal(previous.buildLaunch.status, "BUILD_PASS_DEVICE_PENDING");
assert.equal(previous.buildLaunch.originIsElevated, false); assert.equal(previous.buildLaunch.isElevated, true);
assert.equal(previous.buildLaunch.exitCode, 0);
assert.equal(previous.apk.sourceApkPreserved, true); assert.equal(ev(previous.apk.path).sha256, previous.apk.sha256);
assert.equal(ev(previous.apk.metadata.path).sha256, previous.apk.metadata.sha256);
const oldRuntimeFile = path.join(prior, "installed-session/android-runtime/runtime-smoke-report.json");
const oldRuntimeBytes = fs.readFileSync(oldRuntimeFile), oldRuntime = read(oldRuntimeFile);
assert.equal(oldRuntime.uninstallStatus, "PASS"); assert.equal(oldRuntime.apkCleanupStatus, "PASS");
assert.equal(oldRuntime.cleanupError, null);
assert.equal(read(path.join(prior, "installed-session/android-runtime/acceptance-launch.json")).emulatorCleanupStatus, "PASS");
assert.equal(verifyProvenance(previous.apk.path, read(previous.apk.metadata.path)).status, "PASS");
fs.mkdirSync(out);
const session = path.join(out, "installed-session"); fs.mkdirSync(session);
fs.copyFileSync(path.join(prior, "source-cartridge-original-bytes.json"),
  path.join(out, "source-cartridge-original-bytes.json"), fs.constants.COPYFILE_EXCL);
const file = path.join(out, "report.json");
const report = { ...previous, status: "PREPARING", startedAt: new Date().toISOString(),
  sourceInstalledBuild: { ...ev(priorFile), originalStatus: previous.status, originalError: previous.error,
    originalDevice: ev(oldRuntimeFile), unchangedApkReused: true },
  commands: [], ownershipChecks: [] };
delete report.error; delete report.finishedAt; delete report.runtime;
delete report.runtimeLaunch; delete report.runtimeLaunchOutput;
const save = () => fs.writeFileSync(file, JSON.stringify(report, null, 2));
const delay = ms => new Promise(r => setTimeout(r, ms));
const psEnv = { ...process.env, PSModulePath: "C:\\Users\\1\\Documents\\WindowsPowerShell\\Modules;C:\\Program Files\\WindowsPowerShell\\Modules;C:\\WINDOWS\\system32\\WindowsPowerShell\\v1.0\\Modules" };
function ps(args) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", ...args],
    { windowsHide: true, encoding: "utf8", timeout: 120000, env: psEnv });
  assert.equal(r.status, 0, `${r.error || ""}\n${r.stderr || ""}`); return r.stdout;
}
async function freePort() { return new Promise((resolve, reject) => {
  const s = net.createServer(); s.once("error", reject);
  s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
}); }
(async () => {
  save();
  const validation = await validateHiddenGrowthApk(previous.apk.path, previous.proof.path);
  report.reusedApkValidation = { assets: validation.assets.length, gameId: validation.gameId, proof: validation.proof }; save();
  const ports = new Set(); while (ports.size < 4) ports.add(await freePort());
  const [adbPort, cdpPort, bootAdbPort, grpcPort] = [...ports], runtime = path.join(session, "android-runtime");
  const requestFile = path.join(session, "android-request.json");
  fs.writeFileSync(requestFile, JSON.stringify({ runId: path.basename(out), apk: previous.apk.path,
    package: read(previous.apk.metadata.path).packageName, outputDir: runtime,
    scope: "installed-hidden-growth", storyFixture: previous.proof.path, audioConfirmation: previous.audio.path,
    sdk: "D:\\Android_dev\\Sdk", serial: "emulator-5554", adbPort, cdpPort,
    coldBoot: { avd: "AgentVN_API35", avdHome: "D:\\Android_dev\\avd", adbPort: bootAdbPort, grpcPort,
      discoveryRoot: "C:\\Users\\1\\AppData\\Local\\Temp\\avd\\running", mediaVolumeTarget: 13 } }, null, 2), { flag: "wx" });
  report.runtimeRequest = requestFile; report.status = "ANDROID_REAL_DEVICE_RUNNING"; save();
  report.runtimeLaunchOutput = ps(["-File", path.join(root, "scripts/start-android-acceptance.ps1"), "-RequestPath", requestFile]); save();
  const receipt = path.join(runtime, "acceptance-launch.json"), deadline = Date.now() + 45 * 60000;
  let nextCheck = 0, absent = 0;
  while (Date.now() < deadline) {
    if (fs.existsSync(receipt)) {
      const launch = read(receipt);
      if (launch.status !== "RUNNING") { report.runtimeLaunch = launch; break; }
      if (launch.processId && Date.now() >= nextCheck) {
        const rows = JSON.parse(ps(["-Command", `@(Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(launch.processId)}" | Select-Object ProcessId,Name) | ConvertTo-Json -Compress`]) || "[]");
        const alive = (Array.isArray(rows) ? rows : [rows]).some(p => p?.ProcessId === launch.processId && /powershell/i.test(p.Name));
        report.ownershipChecks.push({ at: new Date().toISOString(), pid: launch.processId, alive });
        absent = alive ? 0 : absent + 1; save();
        assert(absent < 3, "Original helper gone while pending; retain raw diagnostics");
        nextCheck = Date.now() + 15000;
      }
    }
    await delay(3000);
  }
  assert(report.runtimeLaunch, "Observation deadline, live helper is preserved; do not restart");
  const runtimeFile = path.join(runtime, "runtime-smoke-report.json");
  if (fs.existsSync(runtimeFile)) report.runtime = { ...ev(runtimeFile), ...read(runtimeFile) };
  assert.equal(report.runtimeLaunch.status, "PASS", report.runtime?.message || report.runtimeLaunch.error);
  assert.equal(report.runtime.status, "RUNTIME_PASS");
  assert.equal(report.runtime.uninstallStatus, "PASS"); assert.equal(report.runtime.apkCleanupStatus, "PASS");
  assert.equal(report.runtime.cleanupError, null); assert.equal(report.runtimeLaunch.emulatorCleanupStatus, "PASS");
  report.status = "INSTALLED_FINAL_HIDDEN_GROWTH_ANDROID_PASS";
})().catch(e => {
  report.status = [report.runtimeLaunch?.status, report.runtime?.status].includes("BLOCKED") ? "BLOCKED" : "FAILED";
  report.error = String(e.stack || e); process.exitCode = 1;
}).finally(() => {
  report.originalReceiptsPreserved = fs.readFileSync(priorFile).equals(beforeBytes) && fs.readFileSync(oldRuntimeFile).equals(oldRuntimeBytes);
  report.sourceApkPreserved = ev(previous.apk.path).sha256 === previous.apk.sha256;
  if (!report.originalReceiptsPreserved || !report.sourceApkPreserved) { report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, file, error: report.error }));
});
