"use strict";
// Only drives installed product interfaces. Never substitutes source UI or a
// mocked engine, and never imports the final user project as a test fixture.
const fs = require("node:fs"), path = require("node:path");
const assert = require("node:assert/strict"), net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const A = require("./lib/installed-acceptance.cjs");
const { startInstalledEditor } = require("./lib/owned-installed-editor.cjs");
const { verifyProvenance } = require("./android-acceptance-evidence.cjs");
const { validateWindowsPrerequisite } = require("./lib/installed-windows-prerequisite.cjs");
const { validateInstalledDefaultTitle } = require("./lib/installed-agentvn-title-prerequisite.cjs");
const root = path.resolve(__dirname, "..");
const titleOnly = process.argv[7] === "--agentvn-title";
assert(process.argv.length === 7 || process.argv.length === 8 && titleOnly,
  "node script <fresh-root> <installer-resource-report> <fixture-report> <windows-flow-report> <audio-confirmation> [--agentvn-title]");
assert.notEqual(process.env.E5_LIFECYCLE_SOURCE, "1", "Actual installed UI only");
const [out, auditFile, fixtureFile, windowsFile, audioFile] = process.argv.slice(2, 7).map(p => path.resolve(p));
assert(A.inside(path.join(root, "output"), out));
assert(!fs.existsSync(out), "Preserve all previous evidence; use a fresh run");
const fixture = JSON.parse(fs.readFileSync(fixtureFile, "utf8"));
assert.equal(fixture.status, "FIXTURE_VALIDATED");
assert(fixture.projectId.startsWith("installed_resource_flow_"));
assert.equal(A.sha256(fs.readFileSync(fixture.input)), fixture.sha256);
const windows = JSON.parse(fs.readFileSync(windowsFile, "utf8"));
const windowsValidation = titleOnly
  ? validateInstalledDefaultTitle(windowsFile, { auditFile, fixture })
  : validateWindowsPrerequisite(windowsFile, { auditFile, fixture });
assert.equal(JSON.parse(fs.readFileSync(audioFile, "utf8")).status, "USER_CONFIRMED_PASS");
fs.mkdirSync(out);
const session = path.join(out, "installed-session");
fs.mkdirSync(session);
fs.copyFileSync(auditFile, path.join(session, "installer-resource-report.json"));
const input = path.join(session, path.basename(fixture.input));
fs.copyFileSync(fixture.input, input, fs.constants.COPYFILE_EXCL);
process.env.AGENTVN_TEST_PROJECT = input;
process.env.AGENTVN_WORKSPACE_OUTPUT = out;
process.env.INSTALLED_ACCEPTANCE_PROJECT_TITLE = fixture.title;
const reportFile = path.join(out, "report.json");
const evidence = file => ({ path: file, sha256: A.sha256(fs.readFileSync(file)) });
const report = { status: "PREPARING", startedAt: new Date().toISOString(),
  scope: titleOnly ? "Installed AgentVN default-title Android flow, not full-story/legacy-device acceptance" : "Installed full-story Android flow",
  sourceFixture: evidence(fixtureFile), input: evidence(input),
  windowsGate: { ...evidence(windowsFile), status: windows.status, validation: windowsValidation,
    reusedUnchangedBuild: !windowsValidation.currentInstallationVerified },
  audio: { ...evidence(audioFile), source: "historical user confirmation", newListening: false },
  environment: { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out },
  commands: [], ownershipChecks: [] };
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const psEnv = { ...process.env,
  PSModulePath: "C:\\Users\\1\\Documents\\WindowsPowerShell\\Modules;C:\\Program Files\\WindowsPowerShell\\Modules;C:\\WINDOWS\\system32\\WindowsPowerShell\\v1.0\\Modules" };
let owner, browser, preserve = false;
function ps(args) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", ...args],
    { windowsHide: true, encoding: "utf8", timeout: 120000, env: psEnv });
  assert.equal(r.status, 0, `${r.error || ""}\n${r.stderr || ""}`);
  return r.stdout;
}
async function command(args) {
  report.commands.push({ args, startedAt: new Date().toISOString() }); save();
  const r = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env: process.env, windowsHide: true });
    child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
    child.once("error", reject); child.once("close", code => resolve(code));
  });
  Object.assign(report.commands.at(-1), { exitCode: r, finishedAt: new Date().toISOString() }); save();
  assert.equal(r, 0, `Installed command failed: ${args[0]}`);
}
async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer(); probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => { const n = probe.address().port; probe.close(() => resolve(n)); });
  });
}
async function observe(file, pending, minutes) {
  const deadline = Date.now() + minutes * 60000;
  let seenLive = false, lastCheck = 0, absent = 0;
  while (true) {
    if (fs.existsSync(file)) {
      const state = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!pending.includes(state.status)) return state;
      const pid = state.elevatedProcessId || state.processId;
      if (pid && Date.now() - lastCheck > 15000) {
        const rows = JSON.parse(ps(["-Command",
          `@(Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(pid)}" | Select-Object ProcessId,Name,CreationDate,CommandLine) | ConvertTo-Json -Compress`]) || "[]");
        const processes = Array.isArray(rows) ? rows : [rows];
        const alive = processes.some(p => p?.ProcessId === pid && /powershell/i.test(p.Name));
        report.ownershipChecks.push({ checkedAt: new Date().toISOString(), pid, alive });
        save(); lastCheck = Date.now();
        absent = alive ? 0 : absent + 1; seenLive ||= alive;
        assert(absent < 3, `Helper ${pid} gone while receipt still pending; retain original diagnostics`);
      }
    }
    if (Date.now() >= deadline) {
      preserve = seenLive;
      throw Error("Observation deadline reached; a live build is preserved, not restarted or called helper loss");
    }
    await delay(3000);
  }
}
function verifySources() {
  const audit = JSON.parse(fs.readFileSync(auditFile, "utf8"));
  assert.equal(audit.status, "PASS");
  const deployed = audit.deployments.filter(d => d.kind === "NSIS actual isolated installation");
  assert.equal(deployed.length, 1);
  const install = deployed[0].installedRoot;
  assert.equal(A.sha256(fs.readFileSync(path.join(install, "agentvn-editor.exe"))), deployed[0].executable.sha256);
  const files = [];
  function walk(relative) {
    for (const item of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const rel = path.join(relative, item.name);
      if (item.isDirectory()) walk(rel); else files.push(rel);
    }
  }
  walk("GameCli_framework/src"); walk("shared");
  files.push(...["lib.rs", "save_location.rs", "portable_save_migration.rs"].map(n => `GameCli_framework/src-tauri/src/${n}`));
  files.push("GameCli_framework/src-tauri/Cargo.toml",
    "scripts/build-runtime-standalone-android.ps1", "scripts/android-acceptance-evidence.cjs");
  report.resources = files.map(rel => {
    const source = evidence(path.join(root, rel)), installed = evidence(path.join(install, rel));
    assert.equal(source.sha256, installed.sha256, `Installed resource differs: ${rel}`);
    return { relative: rel, sha256: source.sha256 };
  });
  report.installRoot = install;
}
(async () => {
  save();
  const checkpoint = path.join(out, "checkpoint"); fs.mkdirSync(checkpoint);
  report.checkpoint = [];
  const checkpointFiles = ["scripts/installed-current-android-acceptance.cjs",
    "scripts/installed-android-export-admin.ps1", "plans/ACTIVE_TASKS.md",
    "plans/INSTALLED_COMPLETION_LEDGER_20261016.md", "plans/CURRENT_ANDROID_ACCEPTANCE_20261017.md"];
  if (titleOnly) checkpointFiles.push("scripts/android-apk-runtime-qa.cjs",
    "scripts/lib/android-default-title-flow.cjs", "scripts/lib/agentvn-default-title.cjs",
    "scripts/lib/installed-agentvn-title-prerequisite.cjs", "plans/RUNTIME_TITLE_CONTRAST_20261017.md");
  for (const relative of checkpointFiles) {
    const target = path.join(checkpoint, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, relative), target, fs.constants.COPYFILE_EXCL);
    report.checkpoint.push(evidence(target));
  }
  verifySources(); save();
  owner = await startInstalledEditor(session); report.owner = owner.state; save();
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${owner.state.cdpPort}`);
  let page;
  const ready = Date.now() + 60000;
  while (!page && Date.now() < ready) {
    page = browser.contexts().flatMap(c => c.pages()).find(p => /tauri\.localhost|tauri:/.test(p.url()));
    if (!page) await delay(150);
  }
  assert(page); page.setDefaultTimeout(60000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByLabel("创建或打开项目").waitFor();
  await page.screenshot({ path: path.join(out, "installed-home.png") });
  await browser.close(); browser = undefined;
  report.status = "NATIVE_IMPORT"; save();
  await command([path.join(__dirname, "installed-p1-native-input.cjs"), session, "open", input, path.join(session, "native-import")]);
  assert.equal((await A.projectSnapshot(owner.state.backendPort)).projectId, fixture.projectId);
  const buildEvidence = path.join(session, "android-build"); fs.mkdirSync(buildEvidence);
  report.status = "INSTALLED_ANDROID_EXPORT"; save();
  report.buildLaunchOutput = ps(["-File", path.join(__dirname, "installed-android-export-admin.ps1"),
    "-SessionRoot", session, "-EvidenceDir", buildEvidence, "-FixtureFile", fixtureFile, "-ProjectFile", input]);
  save();
  report.buildLaunch = await observe(path.join(buildEvidence, "admin-launch.json"), ["AWAITING_RUNAS", "RUNNING"], 95);
  save();
  assert.equal(report.buildLaunch.status, "BUILD_PASS_DEVICE_PENDING", report.buildLaunch.error);
  const apkFiles = fs.readdirSync(path.join(session, "android-export")).filter(n => n.endsWith(".apk"));
  assert.equal(apkFiles.length, 1);
  const apk = path.join(session, "android-export", apkFiles[0]);
  const metadataFile = `${apk}.acceptance.json`;
  const metadata = JSON.parse(fs.readFileSync(metadataFile, "utf8"));
  report.provenance = verifyProvenance(apk, metadata);
  assert.equal(report.provenance.status, "PASS");
  assert.equal(report.provenance.versionStatus, "RECORDED",
    "New installed exports must distinguish game, engine and protocol versions");
  assert.equal(metadata.engineVersion, metadata.runtimeVersion);
  const versionSources = metadata.versionEvidence.sources;
  for (const [kind, relative] of [["engine", "GameCli_framework/src-tauri/Cargo.toml"],
    ["protocol", "shared/cartridge/constants.ts"]]) {
    const installedSource = path.join(report.installRoot, relative);
    assert.equal(versionSources[kind].sha256, A.sha256(fs.readFileSync(installedSource)),
      `Recorded ${kind} source must match the actual installation, not development configuration`);
  }
  report.versionProvenance = { status: "PASS", gameVersion: metadata.gameVersion,
    engineVersion: metadata.engineVersion, runtimeProtocolVersion: metadata.runtimeProtocolVersion,
    minimumRuntimeVersion: metadata.minimumRuntimeVersion, sources: versionSources };
  assert(Date.parse(metadata.recordedAt) >= Date.parse(report.buildLaunch.requestedAt));
  report.apk = { ...evidence(apk), metadata: evidence(metadataFile), sourceApkPreserved: true }; save();
  report.editorCleanup = await owner.stop(); owner = undefined;
  const ports = new Set(); while (ports.size < 4) ports.add(await freePort());
  const [adbPort, cdpPort, bootAdbPort, grpcPort] = [...ports];
  const runtime = path.join(session, "android-runtime");
  const request = { runId: path.basename(out), apk, package: metadata.packageName, outputDir: runtime,
    scope: titleOnly ? "installed-agentvn-title" : "installed-full-story", storyFixture: fixtureFile, audioConfirmation: audioFile,
    sdk: "D:\\Android_dev\\Sdk", serial: "emulator-5554", adbPort, cdpPort,
    coldBoot: { avd: "AgentVN_API35", avdHome: "D:\\Android_dev\\avd", adbPort: bootAdbPort, grpcPort,
      discoveryRoot: "C:\\Users\\1\\AppData\\Local\\Temp\\avd\\running", mediaVolumeTarget: 13 } };
  const requestFile = path.join(session, "android-request.json");
  fs.writeFileSync(requestFile, JSON.stringify(request, null, 2), { flag: "wx" });
  report.runtimeRequest = requestFile; report.status = "ANDROID_REAL_DEVICE_RUNNING"; save();
  report.runtimeLaunchOutput = ps(["-File", path.join(__dirname, "start-android-acceptance.ps1"), "-RequestPath", requestFile]);
  save();
  report.runtimeLaunch = await observe(path.join(runtime, "acceptance-launch.json"), ["RUNNING"], 45);
  const runtimeReport = path.join(runtime, "runtime-smoke-report.json");
  if (fs.existsSync(runtimeReport)) report.runtime = { ...evidence(runtimeReport), ...JSON.parse(fs.readFileSync(runtimeReport)) };
  assert.equal(report.runtimeLaunch.status, "PASS", report.runtime?.message || report.runtimeLaunch.error);
  assert.equal(report.runtime?.status, "RUNTIME_PASS");
  assert.equal(report.runtime.uninstallStatus, "PASS");
  assert.equal(report.runtime.apkCleanupStatus, "PASS");
  assert.equal(report.runtime.cleanupError, null);
  assert.equal(report.runtimeLaunch.emulatorCleanupStatus, "PASS");
  report.status = titleOnly ? "INSTALLED_AGENTVN_DEFAULT_TITLE_ANDROID_PASS" : "INSTALLED_CURRENT_ANDROID_PASS";
})().catch(error => {
  report.status = report.buildLaunch?.status === "BLOCKED" || report.runtimeLaunch?.status === "BLOCKED"
    || report.runtime?.status === "BLOCKED" ? "BLOCKED" : "FAILED";
  report.error = String(error.stack || error); process.exitCode = 1;
}).finally(async () => {
  await browser?.close().catch(() => {});
  if (owner) report.editorCleanup = preserve ? { status: "PRESERVED_ACTIVE_BUILD", owner: owner.state } : await owner.stop();
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, reportFile, error: report.error }));
});
