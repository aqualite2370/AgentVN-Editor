"use strict";
// Consume a SUCCESSFUL current installation build, never invokes a builder,
// repairs acceptance metadata or reuses a historical APK as current evidence.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { fileEvidence, verifyProvenance } = require("./android-acceptance-evidence.cjs");
const { validatePackageSmokeApk } = require("./lib/android-package-smoke.cjs");
const { ps } = require("./lib/current-native-editor-session.cjs");
const { allocateAndroidDevicePorts } = require("./lib/android-device-ports.cjs");
const attempt = process.argv[2] || "09", deviceAttempt = process.argv[3] || "01";
assert.match(attempt, /^\d{2}$/); assert.match(deviceAttempt, /^\d{2}$/);
const version = attempt === "10" ? "1.9.19" : "1.9.18";
const qa = "F:/AgentVN/QA/Android-Package-20261021-01";
const source = path.join(qa, "editor-" + attempt), out = path.join(qa, `device-${attempt}-${deviceAttempt}`);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
assert(!fs.existsSync(out), "Never overwrite device evidence");
fs.mkdirSync(out);
const report = { status: "RUNNING", scope: "CURRENT_INSTALLED_EDITOR_ANDROID_THREE_LINE_SMOKE_NOT_FULL_STORY",
  startedAt: new Date().toISOString(), buildInvocations: 0, modelRequests: 0, productChanges: 0,
  normalNativePicker: "BLOCKED", androidUpgrade: "BLOCKED_MISSING_CREDIBLE_OLD_SIGNED_APK",
  audio: { source: "retained-user-confirmation", newCapture: false, newListening: false,
    fixtureHasAudioAssets: false }, cleanup: "NOT_RUN" };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function observe(file, condition, label, minutes) {
  const deadline = Date.now() + minutes * 60000;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) {
      try {
        const value = read(file);
        if (condition(value)) return value;
      } catch (e) {
        // A live owner may be replacing its in-progress JSON. Never treat a
        // partial observation as terminal or submit another operation.
        if (!(e instanceof SyntaxError)) throw e;
      }
    }
    await pause(2000);
  }
  throw Error(`${label}: timeout; preserve the owned administrator helper if still running`);
}
let runtimeStarted = false, runtimeFinished = false;
(async () => {
  report.origin = JSON.parse(ps("$i=[Security.Principal.WindowsIdentity]::GetCurrent();" +
    "ConvertTo-Json -Compress @{isElevated=([Security.Principal.WindowsPrincipal]::new($i)).IsInRole(" +
    "[Security.Principal.WindowsBuiltInRole]::Administrator);processId=$PID;sid=$i.User.Value}"));
  assert.equal(report.origin.isElevated, false, "Actual non-admin origin required");
  const buildFile = path.join(source, "report.json");
  if (process.argv.includes("--wait-build")) {
    report.status = "AWAITING_SAME_CURRENT_BUILD_TERMINAL"; save();
    console.log("WAIT same editor-" + attempt + " build; no new build invocation");
    await observe(buildFile, r => Boolean(r.finishedAt) && r.status !== "RUNNING", "Current build terminal", 40);
  }
  const build = read(buildFile);
  report.build = fileEvidence(buildFile);
  assert.equal(build.status, "PASS", "Device requires a terminal, valid current build, not repaired metadata");
  assert.equal(build.androidBuildStatus, "STATIC_ONLY"); assert.equal(build.builds, 1);
  assert.equal(build.nativeResult.status, "TERMINAL"); assert.equal(build.nativeResult.result.ok, true);
  assert.equal(build.version, version); assert.equal(build.modelRequests, 0);
  assert.equal(read(path.join(source, "cache-restoration.json")).status, "PASS");
  const admin = await observe(path.join(qa, `administrator-${attempt}`, "result.json"),
    r => Boolean(r.finishedAt), "Build administrator finally", 2);
  assert.equal(admin.policyRestoration, "PASS"); assert.equal(admin.physicalProtectionRestoration, "PASS");
  const task = await observe(path.join(qa, `administrator-${attempt}`, "task-engine.json"),
    r => Boolean(r.finishedAt), "Build task deletion", 2);
  assert.equal(task.cleanup, "PASS");
  const candidates = build.artifacts.filter(a => a.kind === "android_apk_signed" && a.path.endsWith(".apk"));
  assert.equal(candidates.length, 1, "Use exactly this successful build's universal APK");
  const apk = candidates[0].path; assert.equal(fileEvidence(apk).sha256, candidates[0].sha256);
  const metadataFile = apk + ".acceptance.json", metadata = read(metadataFile);
  assert.equal(metadata.runId, build.buildRequest.runId, "Native request and APK evidence must identify the same build");
  report.provenance = verifyProvenance(apk, metadata);
  assert.equal(report.provenance.status, "PASS"); assert.equal(report.provenance.versionStatus, "RECORDED");
  assert.equal(metadata.packageName, "com.agentvn.qa.androidcurrent20261021");
  assert.equal(metadata.editorVersion, version); assert.equal(metadata.gameVersion, "0.1.0");
  const installation = read(build.installation.path);
  assert.equal(fileEvidence(installation.executable.path).sha256, installation.executable.sha256);
  for (const [kind, relative] of [["engine", "GameCli_framework/src-tauri/Cargo.toml"],
    ["protocol", "shared/cartridge/constants.ts"]]) {
    assert.equal(metadata.versionEvidence.sources[kind].sha256,
      fileEvidence(path.join(installation.installRoot, relative)).sha256);
  }
  const input = path.join(source, "Android 隔离小工程.vnproj"), project = read(input);
  const scene = project.nodes.find(n => n.data?.scene)?.data.scene; assert(scene);
  const fixture = { input, sha256: fileEvidence(input).sha256, projectId: project.project_id,
    title: project.title, sceneId: scene.scene_id, texts: scene.commands.map(c => c.text) };
  assert.equal(fixture.projectId, `qa_android_pkg_20261021_${attempt}`);
  const fixtureFile = path.join(out, "fixture.json");
  fs.writeFileSync(fixtureFile, JSON.stringify(fixture, null, 2), { flag: "wx" });
  report.input = await validatePackageSmokeApk(apk, fixtureFile);
  report.apk = fileEvidence(apk); report.metadata = fileEvidence(metadataFile);
  report.installedEditor = fileEvidence(installation.executable.path);
  report.tools = [__filename, "scripts/android-apk-runtime-qa.cjs", "scripts/lib/android-package-smoke.cjs",
    "scripts/start-android-acceptance.ps1", "scripts/android-cold-boot.ps1",
    "scripts/android-acceptance-preflight.ps1", "scripts/lib/android-device-ports.cjs",
    "scripts/lib/windows-portable-qa-utils.cjs"].map(f => fileEvidence(path.resolve(f)));
  const runtime = path.join(out, "runtime");
  const [adbPort, cdpPort, bootAdbPort, grpcPort] = await allocateAndroidDevicePorts();
  const request = { runId: `android-current-${attempt}-${deviceAttempt}`, apk, package: metadata.packageName,
    outputDir: runtime, scope: "installed-package-smoke", storyFixture: fixtureFile,
    sdk: "D:\\Android_dev\\Sdk", serial: "emulator-5554", adbPort, cdpPort,
    coldBoot: { avd: "AgentVN_API35", avdHome: "D:\\Android_dev\\avd", adbPort: bootAdbPort, grpcPort,
      discoveryRoot: "C:\\Users\\1\\AppData\\Local\\Temp\\avd\\running", mediaVolumeTarget: 13 } };
  const requestFile = path.join(out, "request.json");
  fs.writeFileSync(requestFile, JSON.stringify(request, null, 2), { flag: "wx" });
  report.request = fileEvidence(requestFile); report.status = "REAL_ANDROID_RUNTIME_RUNNING"; save();
  console.log("START current installed-package Android smoke, no build invocation: " + out);
  report.launchOutput = ps(`& 'D:\\AgentVN\\scripts\\start-android-acceptance.ps1' -RequestPath '${requestFile.replaceAll("'", "''")}'`);
  runtimeStarted = true; save();
  const launchFile = path.join(runtime, "acceptance-launch.json");
  const launch = await observe(launchFile, r => Boolean(r.finishedAt), "Android owned runtime", 40);
  runtimeFinished = true; report.launch = { ...fileEvidence(launchFile), value: launch };
  const runtimeFile = path.join(runtime, "runtime-smoke-report.json");
  if (fs.existsSync(runtimeFile)) report.runtime = { ...fileEvidence(runtimeFile), value: read(runtimeFile) };
  assert.equal(launch.status, "PASS", report.runtime?.value.message || launch.error);
  assert.equal(launch.emulatorCleanupStatus, "PASS", launch.cleanupError);
  const r = report.runtime?.value; assert(r, "Nonempty runtime report required");
  assert.equal(r.status, "INSTALLED_PACKAGE_SMOKE_PASS", r.message);
  assert.equal(r.packageSmoke.cases.length, 4); assert(r.packageSmoke.cases.every(c => c.status === "PASS"));
  assert.equal(r.restartTrials.length, 6); assert.equal(r.uninstallStatus, "PASS");
  assert.equal(r.apkCleanupStatus, "PASS"); assert.equal(r.cleanupError, null);
  assert(!fs.existsSync(path.join(runtime, "staging.apk")));
  assert.equal(fileEvidence(apk).sha256, report.apk.sha256, "Source APK must remain unchanged");
  assert.equal(fileEvidence(buildFile).sha256, report.build.sha256, "Original build evidence is immutable");
  report.cleanup = "PASS"; report.status = "INSTALLED_PACKAGE_SMOKE_PASS";
})().catch(e => {
  report.status = report.runtime?.value.status === "BLOCKED" || report.launch?.value.status === "BLOCKED"
    ? "BLOCKED" : "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (runtimeStarted && !runtimeFinished) report.cleanup = "PRESERVE_OWNED_RUNTIME_UNTIL_TERMINAL";
  else if (runtimeFinished) report.cleanup = report.launch?.value.emulatorCleanupStatus === "PASS"
    && report.runtime?.value.uninstallStatus === "PASS" && report.runtime?.value.apkCleanupStatus === "PASS"
    ? "PASS" : "CHECK_RUNTIME_EVIDENCE";
}).finally(() => { report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, cleanup: report.cleanup, out, error: report.error })); });
