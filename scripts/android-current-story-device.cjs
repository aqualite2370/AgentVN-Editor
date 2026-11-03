"use strict";
// QA-only continuation of an already completed installed APK build. Never
// rebuilds, modifies product files, or substitutes DOM input for ADB touches.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { fileEvidence: desc } = require("./android-acceptance-evidence.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { narrativeFixture } = require("./android-current-story-package.cjs");
const { validateConfig } = require("./installed-editor-android-candidate.cjs");
const qa = path.resolve("F:/AgentVN/QA/Android-Package-20261021-01");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
function verify(f) { assert.equal(sha(f.path), f.sha256, f.path); }
function sources(files) {
  const found = new Set();
  function visit(file) {
    file = path.resolve(file); if (found.has(file)) return; found.add(file);
    if (!/\.cjs$/.test(file)) return;
    for (const match of fs.readFileSync(file, "utf8").matchAll(/require\(["'](\.[^"']+)["']\)/g)) {
      const dep = path.resolve(path.dirname(file), match[1]);
      if (fs.existsSync(dep) && fs.statSync(dep).isFile()) visit(dep);
    }
  }
  files.forEach(visit); return [...found].map(desc);
}
function loadCandidate(configFile, auditFile) {
  const c = read(configFile); validateConfig(c); narrativeFixture(c.storyFixture.path);
  const a = read(auditFile);
  assert(["NARRATIVE_APK_ARTIFACT_PASS_DEVICE_NOT_RUN",
    "NARRATIVE_APK_ARTIFACT_PASS_AFTER_QA_CACHE_RECOVERY_DEVICE_NOT_RUN"].includes(a.status));
  assert.equal(a.checks.length, 6); assert(a.checks.every(v => v.status === "PASS"));
  assert.equal(a.config.path, path.resolve(configFile)); verify(a.config);
  assert.deepEqual(a.candidate, c); verify(a.apk);
  for (const f of a.sources) verify(f);
  assert.equal(a.identity.packageName, "com.agentvn.qa.narrative20261102");
  assert.equal(a.identity.versionCode, c.versionCode);
  return { c, a };
}
function validateShape(q, b, receipt, a) {
  assert.deepEqual(q.candidateBinding, receipt);
  assert.equal(q.scope, "installed-full-story"); assert.equal(q.package, a.identity.packageName);
  assert.equal(q.apk, a.apk.path); assert.deepEqual(q.packageAudit, b.audit);
  assert.equal(q.storyFixture, b.fixture.path); assert.equal(q.audioConfirmation, b.audio.path);
  assert.equal(q.outputDir, path.join(b.output, "runtime"));
  assert.equal(q.runId, path.basename(b.output));
  assert.equal(q.sdk, path.win32.normalize("D:/Android_dev/Sdk"));
  assert.equal(q.serial, "emulator-5554"); assert.equal(q.coldBoot.avd, "AgentVN_API35");
  assert.equal(q.coldBoot.avdHome, path.win32.normalize("D:/Android_dev/avd"));
  assert.equal(q.coldBoot.discoveryRoot, path.win32.normalize("C:/Users/1/AppData/Local/Temp/avd/running"));
  assert.equal(q.coldBoot.mediaVolumeTarget, 13);
  const ports = [q.adbPort, q.cdpPort, q.coldBoot.adbPort, q.coldBoot.grpcPort];
  assert.equal(new Set(ports).size, 4);
  assert(ports.every(p => Number.isInteger(p) && p > 1024 && p <= 65535));
  for (const key of ["rendererOnly", "traceCapabilitiesOnly", "cacheProbe", "cachePerf"])
    assert.equal(q[key], undefined);
}
function bound(file, digest) {
  assert.equal(sha(file), digest); const b = read(file);
  for (const f of b.sources) verify(f); verify(b.audio);
  const { c, a } = loadCandidate(b.config.path, b.audit.path);
  assert.equal(read(b.audio.path).status, "USER_CONFIRMED_PASS");
  return { b, c, a, receipt: { path: path.resolve(file), sha256: digest } };
}
async function validate(file, digest, request) {
  const { b, a, receipt } = bound(file, digest); validateShape(read(request), b, receipt, a);
}
function prepare(configFile, auditNumber, number, audioFile) {
  for (const n of [auditNumber, number]) assert.match(n, /^\d{2}$/);
  configFile = path.resolve(configFile); const c = read(configFile);
  const auditFile = path.join(qa, `story-artifact-${c.attempt}-audit-${auditNumber}/report.json`);
  loadCandidate(configFile, auditFile);
  assert.equal(read(audioFile).status, "USER_CONFIRMED_PASS");
  const prep = path.join(path.dirname(configFile), `android-story-device-${c.attempt}-${number}`);
  const output = path.join(qa, `device-story-${c.attempt}-${number}`);
  assert(!fs.existsSync(prep) && !fs.existsSync(output)); fs.mkdirSync(prep);
  const audio = path.join(prep, "retained-audio-user-confirmation.json");
  fs.copyFileSync(audioFile, audio, fs.constants.COPYFILE_EXCL); assert.equal(sha(audio), sha(audioFile));
  const runner = path.join(prep, "validate.cjs"), start = path.join(prep, "start.ps1");
  const tools = require("./android-candidate-device.cjs");
  const startText = tools.startSource(start, runner); tools.validateStartSyntax(startText);
  fs.writeFileSync(start, startText, { flag: "wx" });
  const b = { config: desc(configFile), audit: desc(auditFile), fixture: c.storyFixture, audio: desc(audio),
    audioSource: desc(audioFile), output, start, sources: sources([__filename, configFile, auditFile, start, audio,
      ...["android-apk-runtime-qa.cjs", "start-android-acceptance.ps1", "android-cold-boot.ps1",
        "android-acceptance-preflight.ps1"].map(f => path.join(__dirname, f))]) };
  const binding = path.join(prep, "binding.json");
  fs.writeFileSync(binding, JSON.stringify(b, null, 2), { flag: "wx" });
  const digest = sha(binding);
  fs.writeFileSync(runner, `require(${JSON.stringify(__filename)}).validate(${JSON.stringify(binding)},${JSON.stringify(digest)},process.argv[3]).catch(e=>{console.error(e);process.exitCode=1});\n`, { flag: "wx" });
  const launch = path.join(prep, "launch.cjs");
  fs.writeFileSync(launch, `require(${JSON.stringify(__filename)}).launch(${JSON.stringify(binding)},${JSON.stringify(digest)}).catch(e=>{console.error(e);process.exitCode=1});\n`, { flag: "wx" });
  return { status: "PREPARED_NOT_LAUNCHED", binding: desc(binding), launch };
}
async function launch(file, digest) {
  const { b, a, receipt } = bound(file, digest); assert(!fs.existsSync(b.output)); fs.mkdirSync(b.output);
  const r = { status: "RUNNING", startedAt: new Date().toISOString(), candidateBinding: receipt,
    builds: 0, productChanges: 0, modelRequests: 0, nativePicker: "NOT_RUN_CONTROLLED_INPUT_RESTORED",
    audio: { source: b.audioSource, retainedCopy: b.audio, newListening: false } };
  const save = () => fs.writeFileSync(path.join(b.output, "report.json"), JSON.stringify(r, null, 2)); save();
  try {
    const ports = await require("./lib/android-device-ports.cjs").allocateAndroidDevicePorts();
    const q = { candidateBinding: receipt, packageAudit: b.audit, scope: "installed-full-story",
      apk: a.apk.path, package: a.identity.packageName, storyFixture: b.fixture.path, audioConfirmation: b.audio.path,
      runId: path.basename(b.output), outputDir: path.join(b.output, "runtime"),
      sdk: path.win32.normalize("D:/Android_dev/Sdk"), serial: "emulator-5554", adbPort: ports[0], cdpPort: ports[1],
      coldBoot: { avd: "AgentVN_API35", avdHome: path.win32.normalize("D:/Android_dev/avd"),
        adbPort: ports[2], grpcPort: ports[3],
        discoveryRoot: path.win32.normalize("C:/Users/1/AppData/Local/Temp/avd/running"), mediaVolumeTarget: 13 } };
    validateShape(q, b, receipt, a);
    const request = path.join(b.output, "request.json");
    fs.writeFileSync(request, JSON.stringify(q, null, 2), { flag: "wx" });
    fs.copyFileSync(request, path.join(b.output, "request-submitted.json"), fs.constants.COPYFILE_EXCL);
    r.command = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", b.start, "-RequestPath", request]; save();
    r.launchOutput = execFileSync(r.command[0], r.command.slice(1), { encoding: "utf8", windowsHide: true, timeout: 120000 }); save();
    const launchFile = path.join(q.outputDir, "acceptance-launch.json");
    const deadline = Date.now() + 35 * 60000; let owner;
    while (Date.now() < deadline) {
      if (fs.existsSync(launchFile)) {
        try { owner = read(launchFile); } catch (e) { if (!(e instanceof SyntaxError)) throw e; }
        if (owner?.finishedAt) break;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    assert(owner?.finishedAt, "Observation ended; inspect the same owner, never relaunch"); r.owner = desc(launchFile);
    const runtimeFile = path.join(q.outputDir, "runtime-smoke-report.json");
    const runtime = read(runtimeFile); r.runtime = desc(runtimeFile);
    r.status = runtime.status; r.fullStory = runtime.fullStory?.cases?.map(({ name, status, error }) => ({ name, status, error }));
    r.cleanup = { package: runtime.uninstallStatus, staging: runtime.apkCleanupStatus,
      emulator: owner.emulatorCleanupStatus, error: runtime.cleanupError || owner.cleanupError || null };
    assert.equal(r.cleanup.package, "PASS"); assert.equal(r.cleanup.staging, "PASS");
    assert.equal(r.cleanup.emulator, "PASS"); assert.equal(r.cleanup.error, null);
    bound(file, digest);
    if (runtime.status !== "RUNTIME_PASS") process.exitCode = 1;
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
  r.limitations = ["Raw runner result requires independent renderer/log/cleanup review",
    "API35 emulator only, no physical Android<10 claim", "Native output picker was controlled and restored, not tested",
    "Retained historical user audio confirmation, no new listening"];
  r.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: r.status, output: b.output, error: r.error }));
}
function selfTest() {
  const b = { output: path.resolve("F:/test-only-no-write"), audit: { path: "audit", sha256: "a" },
    fixture: { path: "fixture" }, audio: { path: "audio" } };
  const receipt = { path: "binding", sha256: "b" }, a = { identity: { packageName: "p" }, apk: { path: "apk" } };
  const q = { candidateBinding: receipt, packageAudit: b.audit, scope: "installed-full-story", package: "p", apk: "apk",
    storyFixture: "fixture", audioConfirmation: "audio", outputDir: path.join(b.output, "runtime"), runId: path.basename(b.output),
    sdk: path.win32.normalize("D:/Android_dev/Sdk"), serial: "emulator-5554", adbPort: 50001, cdpPort: 50002,
    coldBoot: { avd: "AgentVN_API35", avdHome: path.win32.normalize("D:/Android_dev/avd"), adbPort: 50003, grpcPort: 50004,
      discoveryRoot: path.win32.normalize("C:/Users/1/AppData/Local/Temp/avd/running"), mediaVolumeTarget: 13 } };
  validateShape(q, b, receipt, a);
  const bad = [x => x.candidateBinding.sha256 = "old", x => x.apk = "old", x => x.scope = "installed-resources",
    x => x.storyFixture = "other", x => x.cdpPort = x.adbPort, x => x.audioConfirmation = "other",
    x => x.rendererOnly = true, x => x.outputDir = "D:/AgentVN", x => x.packageAudit.sha256 = "old"];
  for (const change of bad) { const x = structuredClone(q); change(x); assert.throws(() => validateShape(x, b, receipt, a)); }
  return { status: "PASS", rejectedRequests: bad.length, builds: 0, deviceOperations: 0 };
}
module.exports = { prepare, launch, validate, selfTest };
if (require.main === module) {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "self-test") console.log(JSON.stringify(selfTest()));
  else { assert.equal(mode, "prepare"); console.log(JSON.stringify(prepare(...args))); }
}
