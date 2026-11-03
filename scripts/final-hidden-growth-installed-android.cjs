"use strict";
// Dedicated final user-project path. Does not relax any small-fixture guards.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const net = require("node:net"), { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const A = require("./lib/installed-acceptance.cjs");
const { startInstalledEditor } = require("./lib/owned-installed-editor.cjs");
const { validateExportTarget } = require("./lib/android-export-target.cjs");
const { verifyProvenance } = require("./android-acceptance-evidence.cjs");
assert.equal(process.argv.length, 7, "node final-android <fresh-output> <installation-audit> <input-provenance> <Windows-terminal> <audio-confirmation>");
const [out, auditFile, provenanceFile, windowsFile, audioFile] = process.argv.slice(2).map(p => path.resolve(p));
const root = path.resolve(__dirname, "..");
assert(A.inside(path.join(root, "output"), out) && !fs.existsSync(out));
assert.notEqual(process.env.E5_LIFECYCLE_SOURCE, "1");
const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
const evidence = f => ({ path: f, sha256: A.sha256(fs.readFileSync(f)) });
const provenance = read(provenanceFile), audit = read(auditFile), windows = read(windowsFile);
assert.equal(audit.status, "PASS"); assert.equal(windows.status, "INSTALLED_FINAL_WINDOWS_TERMINAL_AUDIT_PASS");
assert.equal(read(audioFile).status, "USER_CONFIRMED_PASS");
fs.mkdirSync(out);
const session = path.join(out, "installed-session"); fs.mkdirSync(session);
fs.copyFileSync(auditFile, path.join(session, "installer-resource-report.json"), fs.constants.COPYFILE_EXCL);
const input = path.join(session, path.basename(provenance.output));
fs.copyFileSync(provenance.output, input, fs.constants.COPYFILE_EXCL);
const proofFile = path.join(session, "final-project-authorization.json");
const proof = { status: "FINAL_HIDDEN_GROWTH_AUTHORIZED", title: "隐忍的成长", projectFile: input,
  sessionRoot: session, inputProvenance: evidence(provenanceFile), windowsTerminal: evidence(windowsFile),
  authorizedSource: "User approved F1 after fixture/installed prerequisites; canonical source is read-only",
  recordedAt: new Date().toISOString() };
fs.writeFileSync(proofFile, JSON.stringify(proof, null, 2), { flag: "wx" });
const target = validateExportTarget({ title: proof.title, proofFile, projectFile: input, sessionRoot: session });
const fixtureFile = path.join(session, "final-title.json");
fs.writeFileSync(fixtureFile, JSON.stringify({ title: proof.title, purpose: "Final project title, NOT an isolated fixture" }), { flag: "wx" });
process.env.AGENTVN_TEST_PROJECT = input; process.env.AGENTVN_WORKSPACE_OUTPUT = out;
const file = path.join(out, "report.json");
const report = { status: "PREPARING", startedAt: new Date().toISOString(),
  scope: "Final canonical user project, actual installed Release UI Android export and administrator ADB touch; not legacy-device certification",
  proof: evidence(proofFile), installation: evidence(auditFile), input: evidence(input),
  windowsGate: evidence(windowsFile), audio: { ...evidence(audioFile), source: "historical user confirmation", newListening: false },
  environment: { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out }, commands: [], ownershipChecks: [] };
const save = () => fs.writeFileSync(file, JSON.stringify(report, null, 2));
const delay = ms => new Promise(r => setTimeout(r, ms));
const psEnv = { ...process.env,
  PSModulePath: "C:\\Users\\1\\Documents\\WindowsPowerShell\\Modules;C:\\Program Files\\WindowsPowerShell\\Modules;C:\\WINDOWS\\system32\\WindowsPowerShell\\v1.0\\Modules" };
let owner, browser, page, preserve = false;
function ps(args) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", ...args],
    { windowsHide: true, encoding: "utf8", timeout: 120000, env: psEnv });
  assert.equal(r.status, 0, `${r.error || ""}\n${r.stderr || ""}`); return r.stdout;
}
async function command(executable, args, name) {
  const row = { executable, args, name, startedAt: new Date().toISOString() };
  report.commands.push(row); save();
  const log = fs.createWriteStream(path.join(out, `${name}.log`), { flags: "wx" });
  try {
    const child = spawn(executable, args, { cwd: root, env: psEnv, windowsHide: true });
    row.pid = child.pid; save(); child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    row.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(row.exitCode, 0, `See ${name}.log`);
  } finally { row.finishedAt = new Date().toISOString(); log.end(); save(); }
}
async function observe(receipt, pending, minutes) {
  const deadline = Date.now() + minutes * 60000;
  let seenLive = false, nextCheck = 0, absent = 0;
  while (Date.now() < deadline) {
    if (fs.existsSync(receipt)) {
      const state = read(receipt);
      if (!pending.includes(state.status)) return state;
      const pid = state.elevatedProcessId || state.processId;
      if (pid && Date.now() > nextCheck) {
        const output = ps(["-Command", `@(Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(pid)}" | Select-Object ProcessId,Name) | ConvertTo-Json -Compress`]);
        const rows = JSON.parse(output || "[]"), list = Array.isArray(rows) ? rows : [rows];
        const alive = list.some(p => p?.ProcessId === pid && /powershell/i.test(p.Name));
        seenLive ||= alive; absent = alive ? 0 : absent + 1;
        report.ownershipChecks.push({ at: new Date().toISOString(), pid, alive }); save();
        assert(absent < 3, "Helper exited with an unfinished receipt; preserve original diagnostics");
        nextCheck = Date.now() + 15000;
      }
    }
    await delay(3000);
  }
  preserve = seenLive;
  throw Error("Observation deadline; live owned build preserved, not restarted");
}
async function freePort() {
  return new Promise((resolve, reject) => { const s = net.createServer(); s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}
(async () => {
  save();
  const checkpoint = path.join(out, "checkpoint"); fs.mkdirSync(checkpoint);
  for (const rel of ["plans/ACTIVE_TASKS.md", "plans/FINAL_HIDDEN_GROWTH_20261017.md",
    "scripts/installed-android-export-admin.ps1", "scripts/installed-editor-android-export-playwright.cjs",
    "scripts/android-apk-runtime-qa.cjs", "scripts/start-android-acceptance.ps1"]) {
    const dest = path.join(checkpoint, rel); fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, rel), dest, fs.constants.COPYFILE_EXCL);
  }
  await command(process.execPath, [path.join(root, "scripts/final-project-android-guard-test.cjs"),
    path.join(out, "guard-test"), proofFile], "final-project-guards");
  const installations = audit.deployments.filter(d => d.kind === "NSIS actual isolated installation");
  assert.equal(installations.length, 1);
  report.installRoot = installations[0].installedRoot;
  report.resources = [];
  function walk(rel) { for (const d of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const p = path.join(rel, d.name); if (d.isDirectory()) walk(p); else {
      const source = evidence(path.join(root, p)), installed = evidence(path.join(report.installRoot, p));
      assert.equal(installed.sha256, source.sha256, `Installed source mismatch: ${p}`);
      report.resources.push({ relative: p, sha256: installed.sha256 });
    }
  }}
  walk("GameCli_framework/src"); walk("shared");
  for (const rel of ["GameCli_framework/src-tauri/Cargo.toml", "scripts/build-runtime-standalone-android.ps1"]) {
    assert.equal(evidence(path.join(root, rel)).sha256, evidence(path.join(report.installRoot, rel)).sha256);
  }
  owner = await startInstalledEditor(session); report.owner = owner.state; save();
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${owner.state.cdpPort}`);
  const deadline = Date.now() + 60000;
  while (!page && Date.now() < deadline) {
    page = browser.contexts().flatMap(c => c.pages()).find(p => /tauri\.localhost|tauri:/.test(p.url()));
    if (!page) await delay(100);
  }
  assert(page); page.setDefaultTimeout(90000); await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByLabel("创建或打开项目").waitFor();
  const native = path.join(out, "native-import"); fs.mkdirSync(native);
  const selected = command("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/gui-directory-picker-uia.ps1"), "-OwnerPid", String(owner.state.editorPid),
    "-ReportPath", path.join(native, "picker.json"), "-Directory", input, "-TitlePattern", "^选择 AgentVN 工程文件$", "-File"], "native-project-picker");
  selected.catch(() => {});
  await page.getByLabel("创建或打开项目").getByRole("button", { name: "导入项目", exact: true }).click();
  await selected;
  await page.locator(".editor-toolbar").waitFor(); await A.settleEditor(page);
  const imported = await A.projectSnapshot(owner.state.backendPort);
  assert.equal(imported.projectId, target.projectId); assert.equal(imported.assetManifest.length, 143);
  for (const asset of target.provenance.assets) {
    const item = imported.assetManifest.find(x => x.asset_id === asset.assetId);
    assert(item); assert.equal(A.sha256(await A.assetBytes(owner.state.backendPort, item)), asset.sha256);
  }
  report.imported = { projectId: imported.projectId, assetsVerified: 143, picker: evidence(path.join(native, "picker.json")) };
  await page.screenshot({ path: path.join(out, "installed-imported.png") });
  await browser.close(); browser = undefined;
  const buildDir = path.join(session, "android-build"); fs.mkdirSync(buildDir);
  report.status = "INSTALLED_ANDROID_EXPORT"; save();
  report.buildLaunchOutput = ps(["-File", path.join(root, "scripts/installed-android-export-admin.ps1"),
    "-SessionRoot", session, "-EvidenceDir", buildDir, "-FixtureFile", fixtureFile, "-ProjectFile", input,
    "-FinalProjectProof", proofFile]); save();
  report.buildLaunch = await observe(path.join(buildDir, "admin-launch.json"), ["AWAITING_RUNAS", "RUNNING"], 95);
  save(); assert.equal(report.buildLaunch.status, "BUILD_PASS_DEVICE_PENDING", report.buildLaunch.error);
  const apks = fs.readdirSync(path.join(session, "android-export")).filter(n => n.endsWith(".apk")); assert.equal(apks.length, 1);
  const apk = path.join(session, "android-export", apks[0]), metadataFile = `${apk}.acceptance.json`, metadata = read(metadataFile);
  report.provenance = verifyProvenance(apk, metadata); assert.equal(report.provenance.status, "PASS");
  assert.equal(report.provenance.versionStatus, "RECORDED");
  report.apk = { ...evidence(apk), metadata: evidence(metadataFile), sourceApkPreserved: true };
  report.editorCleanup = await owner.stop(); owner = undefined; save();
  const ports = new Set(); while (ports.size < 4) ports.add(await freePort());
  const [adbPort, cdpPort, bootAdbPort, grpcPort] = [...ports];
  const runtime = path.join(session, "android-runtime");
  const requestFile = path.join(session, "android-request.json");
  fs.writeFileSync(requestFile, JSON.stringify({ runId: path.basename(out), apk, package: metadata.packageName,
    outputDir: runtime, scope: "installed-hidden-growth", storyFixture: proofFile, audioConfirmation: audioFile,
    sdk: "D:\\Android_dev\\Sdk", serial: "emulator-5554", adbPort, cdpPort,
    coldBoot: { avd: "AgentVN_API35", avdHome: "D:\\Android_dev\\avd", adbPort: bootAdbPort, grpcPort,
      discoveryRoot: "C:\\Users\\1\\AppData\\Local\\Temp\\avd\\running", mediaVolumeTarget: 13 } }, null, 2), { flag: "wx" });
  report.runtimeRequest = requestFile; report.status = "ANDROID_REAL_DEVICE_RUNNING"; save();
  report.runtimeLaunchOutput = ps(["-File", path.join(root, "scripts/start-android-acceptance.ps1"), "-RequestPath", requestFile]); save();
  report.runtimeLaunch = await observe(path.join(runtime, "acceptance-launch.json"), ["RUNNING"], 45);
  const runtimeFile = path.join(runtime, "runtime-smoke-report.json");
  if (fs.existsSync(runtimeFile)) report.runtime = { ...evidence(runtimeFile), ...read(runtimeFile) };
  assert.equal(report.runtimeLaunch.status, "PASS", report.runtime?.message || report.runtimeLaunch.error);
  assert.equal(report.runtime?.status, "RUNTIME_PASS");
  assert.equal(report.runtime.uninstallStatus, "PASS"); assert.equal(report.runtime.apkCleanupStatus, "PASS");
  assert.equal(report.runtime.cleanupError, null); assert.equal(report.runtimeLaunch.emulatorCleanupStatus, "PASS");
  report.status = "INSTALLED_FINAL_HIDDEN_GROWTH_ANDROID_PASS";
})().catch(e => {
  report.status = [report.buildLaunch?.status, report.runtimeLaunch?.status, report.runtime?.status].includes("BLOCKED") ? "BLOCKED" : "FAILED";
  report.error = String(e.stack || e); process.exitCode = 1;
}).finally(async () => {
  await browser?.close().catch(() => {});
  if (owner) report.editorCleanup = preserve ? { status: "PRESERVED_ACTIVE_BUILD" } : await owner.stop();
  report.sourcePreserved = evidence(provenance.source).sha256 === provenance.sourceSha256;
  report.inputPreserved = evidence(input).sha256 === provenance.outputSha256;
  if (!report.sourcePreserved || !report.inputPreserved) { report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, reportFile: file, error: report.error }));
});
