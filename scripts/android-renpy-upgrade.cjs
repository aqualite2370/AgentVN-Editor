"use strict";
// QA only: one real retained APK pair, UI-created saves, install -r, no product writes.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm"), { execFileSync } = require("node:child_process");
const { fileEvidence: desc } = require("./android-acceptance-evidence.cjs");
const { rendererReview } = require("./android-candidate-renpy-device-audit.cjs");
const root = path.resolve("F:/AgentVN/QA/Android-Package-20261021-01");
const candidate = path.resolve("F:/AgentVN/QA/Editor-1.9.34-20261029-01");
const pkg = "com.agentvn.qa.renpygui20261025";
const original = path.join(__dirname, "android-native-upgrade-device.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const verify = f => { assert.equal(desc(f.path).sha256, f.sha256, f.path); return f; };
const expected = [
  ["29", "04", "0.1.3", 1003, "4063c2daf485c7f05661a1ce52a2c1702047fa511a6a1e905f70c089c09a0d8e"],
  ["30", "02", "0.1.4", 1004, "0fa02a46030050960d9f0ed6ab132092314e43a07a085562bea0fe1b339501db"],
];
function pair() {
  return expected.map(([attempt, audit, version, code, sha256]) => {
    const file = path.join(root, `renpy-artifact-${attempt}-audit-${audit}/report.json`), a = read(file);
    assert.equal(a.status, "RENPY_CANDIDATE_APK_BYTES_PASS_INPUT_ARCHIVE_NOT_RETAINED_DEVICE_NOT_RUN");
    assert.equal(a.checks.length, 5); assert(a.checks.every(c => c.status === "PASS"));
    assert.deepEqual(a.identity, { packageName: pkg, versionCode: code, versionName: version,
      signerSha256: "c0eb991c5754b5556f8d5dcd966437c86e495e0fe7379fb76b35545247751718" });
    assert.equal(a.apk.sha256, sha256); verify(a.apk); verify(a.build);
    const build = read(a.build.path);
    assert.equal(build.version, attempt === "30" ? "1.9.34" : "1.9.31");
    return { audit: desc(file), apk: a.apk, identity: a.identity, assets: a.embeddedAssets,
      publishingWorkflow: a.checks[0].evidence };
  });
}
function validateRequest(q, binding) {
  assert.equal(q.scope, "installed-native-upgrade"); assert.equal(q.package, pkg);
  assert.equal(q.sdk, "D:\\Android_dev\\Sdk"); assert.equal(q.serial, "emulator-5554");
  assert.equal(q.coldBoot.avd, "AgentVN_API35");
  assert.equal(q.coldBoot.avdHome, "D:\\Android_dev\\avd");
  assert.equal(q.outputDir, path.join(binding.output, "runtime"));
  assert.match(q.runId, /^device-renpy-upgrade-30-\d{2}$/);
  assert.equal(new Set([q.adbPort, q.cdpPort, q.coldBoot.adbPort, q.coldBoot.grpcPort]).size, 4);
  for (const p of [q.adbPort, q.cdpPort, q.coldBoot.adbPort, q.coldBoot.grpcPort])
    assert(Number.isInteger(p) && p > 1024 && p <= 65535);
  assert.deepEqual(q.oldApk, binding.pair[0].apk); assert.deepEqual(q.apk, binding.pair[1].apk);
  assert.deepEqual(q.upgradePair, binding.pair.map(p => p.identity));
  assert.equal(q.upgradePair[0].signerSha256, q.upgradePair[1].signerSha256);
  assert(q.upgradePair[1].versionCode > q.upgradePair[0].versionCode);
  q.upgradePair.forEach(p => assert.equal(p.packageName, pkg));
  verify(q.oldApk); verify(q.apk);
}
function latestSave(rows, kind) {
  const matches = rows.filter(s => s.value.save_kind === kind);
  assert(matches.length, "Missing old " + kind + " save");
  return matches.sort((a, b) => b.value.created_at.localeCompare(a.value.created_at))[0];
}
function validateOldSnapshots(rows, first) {
  assert.deepEqual([...new Set(rows.map(s => s.value.save_kind))].sort(), ["auto", "manual", "quick"]);
  for (const s of rows) {
    assert.equal(s.value.scene_id, first.scene);
    assert([0, 1].includes(s.value.command_index));
    assert(s.value.history.length > 0); assert(Number.isFinite(Date.parse(s.value.created_at)));
  }
  const quick = latestSave(rows, "quick").value, manual = latestSave(rows, "manual").value;
  const auto = latestSave(rows, "auto").value;
  assert.equal(manual.command_index, 0); assert.equal(quick.command_index, 0);
  assert.equal(auto.command_index, 0, "Newest exit snapshot must restore the loop's current position");
  assert.equal(auto.history.length, quick.history.length + 1);
  assert.notEqual(auto.history.at(-1).id, quick.history.at(-1).id);
}
async function scenario(c) {
  const { q, r, step, cmd, text, wait, tap, position, settings, screenshot, diskSaves, idle } = c;
  const state = expression => wait(() => c.client().evaluate(expression), expression);
  const back = async () => { cmd(["shell", "input", "keyevent", "KEYCODE_BACK"]); await idle(); };
  const equalFiles = (a, b) => assert.deepEqual(a.map(s => [s.remote, s.sha256]).sort(),
    b.map(s => [s.remote, s.sha256]).sort());
  const titleVersion = async version => {
    await state(`document.querySelector(".renpy-title-heading p")?.textContent.includes(${JSON.stringify(version)})`);
    return c.client().evaluate(`document.querySelector(".renpy-title-heading")?.innerText`);
  };
  let pref, first, baseline, retained;
  await step("Old real UI creates preferences, manual and quick saves", async () => {
    c.preserve(true); c.installed(true);
    assert.match(text(["install", c.staged[0]]), /Success/);
    cmd(["shell", "monkey", "-p", q.package, "1"]); await c.connect();
    const heading = await titleVersion("0.1.3"); await screenshot("old-title");
    await tap('[data-testid="open-settings"]', "old open settings");
    const control = 'input[aria-label="High contrast text"]';
    await state(`Boolean(document.querySelector(${JSON.stringify(control)}))`);
    assert.equal(await c.client().evaluate(`document.querySelector(${JSON.stringify(control)}).checked`), false);
    await tap(control, "old enable high contrast");
    await state(`document.querySelector(${JSON.stringify(control)}).checked===true`);
    await tap('[data-testid="settings-finish"]', "old finish settings");
    await titleVersion("0.1.3");
    pref = await settings(); assert.equal(Object.keys(pref).length, 1);
    assert.equal(Object.values(pref)[0].highContrastText, true);
    await tap('[data-testid="start-new-game"]', "old start actual story");
    first = await position(0); assert(first.text.startsWith("GUI_CONSUMPTION："));
    await tap('[data-testid="renpy-quick-save-load"]', "old open manual saves");
    await state(`Boolean(document.querySelector('[data-testid="save-slot-manual-1"]'))`);
    await tap(".save-mode-switch button:first-child", "old manual save mode");
    await tap('[data-testid="save-slot-manual-1"] .save-card-main', "old write manual slot");
    await state(`document.querySelector('[data-testid="save-slot-manual-1"]')?.classList.contains("has-save")`);
    await screenshot("old-manual-created");
    await back(); await position(0);
    await tap('[data-testid="renpy-quick-save"]', "old write quick save");
    await state(`!document.querySelector('[data-testid="renpy-quick-save"]')?.disabled
      && document.body.innerText.includes("快存已保存")`);
    const saves = diskSaves("old-ui-created");
    assert(saves.some(s => s.value.save_kind === "manual"));
    assert(saves.some(s => s.value.save_kind === "quick"));
    r.oldQuickCreation = "PASS_REAL_OLD_UI"; return { heading, first, pref, saves };
  });
  await step("Old confirmed Activity exit writes an actual automatic snapshot", async () => {
    await tap(".dialog-box", "old reach branch");
    await state(`document.querySelectorAll(".choice-panel button").length===2`);
    await tap(".choice-panel button:first-of-type", "old choose loop");
    await position(0);
    await tap('[data-testid="renpy-quick-settings"]', "old settings before exit");
    await tap('[data-testid="open-exit-confirmation"]', "old request exit");
    await state(`Boolean(document.querySelector('[data-testid="confirm-exit-game"]'))`);
    await screenshot("old-exit-confirmation");
    const { activityState } = require("./lib/android-activity-exit.cjs");
    const before = text(["shell", "dumpsys", "activity", "activities"]);
    assert(activityState(before, q.package).live.length > 0);
    const started = Date.now();
    await tap('[data-testid="confirm-exit-game"]', "old confirm native exit once");
    let after;
    await wait(() => { after = text(["shell", "dumpsys", "activity", "activities"]);
      return activityState(after, q.package).closed; }, "old real Activity finish", 15000);
    for (const [name, bytes] of [["old-activity-before.txt", before], ["old-activity-after.txt", after]])
      fs.writeFileSync(path.join(q.outputDir, name), bytes, { flag: "wx" });
    baseline = diskSaves("before-upgrade");
    validateOldSnapshots(baseline, first);
    r.oldAutoCreation = "PASS_REAL_OLD_CONFIRMED_EXIT";
    c.client().close(); c.dropClient();
    return { baseline, activityFinished: true, confirmationClicks: 1, elapsedMs: Date.now() - started,
      forcedBeforeExit: false, commandEnd: r.commands.length - 1 };
  });
  await step("One install -r preserves all three old save categories and preferences", async () => {
    const commandStart = r.commands.length;
    assert.match(text(["install", "-r", c.staged[1]]), /Success/);
    const installedVersion = text(["shell", "dumpsys", "package", q.package]);
    assert.match(installedVersion, /versionCode=1004\b/); assert.match(installedVersion, /versionName=0\.1\.4\b/);
    const after = diskSaves("after-upgrade"); equalFiles(baseline, after);
    cmd(["shell", "monkey", "-p", q.package, "1"]); await c.connect();
    const heading = await titleVersion("0.1.4"); assert.deepEqual(await settings(), pref);
    await screenshot("new-title");
    return { after, installedVersion, heading, commandStart, preferences: await settings() };
  });
  await step("New real UI loads manual, automatic and quick old snapshots", async () => {
    const loaded = [];
    await tap('[data-testid="open-save-load"]', "new open actual old saves");
    await tap(".save-mode-switch button:nth-child(2)", "new read mode");
    for (const [kind, tab] of [["manual", 1], ["auto", 2], ["quick", 3]]) {
      if (kind !== "manual") await tap(`.save-kind-tabs button:nth-child(${tab})`, "new select old " + kind);
      const old = latestSave(baseline, kind);
      await tap(`[data-testid="save-slot-${kind}-${old.value.slot}"] .save-card-main`, "new load actual old " + kind);
      const actual = await position(old.value.command_index);
      assert.equal(actual.scene, old.value.scene_id); assert.equal(actual.text, first.text);
      await screenshot("new-loaded-" + kind);
      loaded.push({ kind, old: desc(old.path), actual });
      if (kind !== "quick") {
        await tap('[data-testid="renpy-quick-save-load"]', "new reopen old categories");
        await tap(".save-mode-switch button:nth-child(2)", "new return read mode");
      }
    }
    assert.deepEqual(await settings(), pref);
    retained = diskSaves("post-consumption");
    for (const old of baseline.filter(s => s.value.save_kind !== "auto"))
      assert(retained.some(s => s.remote === old.remote && s.sha256 === old.sha256));
    c.preserve(false);
    return { loaded, preferences: await settings(), retained,
      limitation: "Fixture script is unchanged; new title version and installed identity prove update, not new authored dialogue" };
  });
  await step("Three retained-data process-loss restarts recover real preferences and save files", async () => {
    for (let n = 1; n <= 3; n++) {
      c.client().close(); c.dropClient();
      cmd(["shell", "am", "force-stop", q.package]);
      cmd(["shell", "monkey", "-p", q.package, "1"]); await c.connect();
      await titleVersion("0.1.4"); assert.deepEqual(await settings(), pref);
      const actual = diskSaves("retained-" + n); equalFiles(retained, actual);
      const shot = await screenshot("retained-title-" + n);
      r.restartTrials.push({ kind: "retained-data", n, screenshot: shot.path, status: "PASS",
        route: "EXPLICIT_PROCESS_LOSS_NOT_NATURAL_EXIT" }); c.save();
    }
    return { trials: 3, processLossSimulation: true, naturalExitClaimed: false };
  });
  await step("Three clean installs of the same new APK after upgrade proof", async () => {
    for (let n = 1; n <= 3; n++) {
      c.client().close(); c.dropClient();
      assert.match(text(["uninstall", q.package]), /Success/);
      assert.match(text(["install", c.staged[1]]), /Success/);
      cmd(["shell", "monkey", "-p", q.package, "1"]); await c.connect();
      await titleVersion("0.1.4");
      assert(Object.values(await settings()).every(s => s.highContrastText === false));
      assert.equal(diskSaves("clean-" + n).length, 0);
      const shot = await screenshot("clean-title-" + n);
      r.restartTrials.push({ kind: "clean-install", n, screenshot: shot.path, status: "PASS" }); c.save();
    }
    return { trials: 3, afterAllUpgradeAssertions: true };
  });
}
function runnerSource() {
  assert.equal(desc(original).sha256, "d62dcab26fae9c13a8bee4134fb51df5d0365bb6f96ec1433a9f39d7d3b1a953");
  let s = fs.readFileSync(original, "utf8");
  const replace = (a, b) => { assert.equal(s.split(a).length - 1, 1, a); s = s.replace(a, b); };
  replace('const pkg = "com.agentvn.qa.androidcurrent20261021";', `const pkg = ${JSON.stringify(pkg)};`);
  const start = s.indexOf("function validateRequest(request) {"), end = s.indexOf("function assertPreservedUpgradeData(");
  replace(s.slice(start, end), "function validateRequest(request) { module.validate(request); }\n");
  const a = s.indexOf("    let first, second, pref, baseline;"), b = s.indexOf('    const logs = text(["logcat"', a);
  replace(s.slice(a, b), `    await module.scenario({q,r,out,cmd,text,wait,tap,position,settings,screenshot,diskSaves,idle,
      step,save,staged,connect,client:()=>client,dropClient:()=>{client=null;},
      preserve:value=>{preservationWindow=value;},installed:value=>{installed=value;}});
`);
  replace('    r.status = r.logs.warnings.length ? "BLOCKED" : "PARTIAL_PASS";',
    '    r.rendererTerminationReview = module.rendererReview(r, logs);\n' +
    '    r.status = r.rendererTerminationReview.events.length ? "BLOCKED_RENDERER_TERMINATION_REVIEW" :\n' +
    '      r.logs.warnings.length ? "BLOCKED_CACHE_WARNING_REVIEW" : "PASS_LIMITED_REAL_APK_UPGRADE";');
  replace('    // Observe actual render turns, not a fixed delay that may inspect the old idle page.',
    '    if(selector===\'[data-testid="confirm-exit-game"]\')return;\n' +
    '    // Observe actual render turns, not a fixed delay that may inspect the old idle page.');
  replace('    oldQuickCreation: "BLOCKED_OLD_DEFAULT_LAYOUT_HAS_NO_CREATION_ENTRY",', '    oldQuickCreation: "NOT_RUN",');
  replace("if (require.main === module) main(process.argv[2]).catch(e => { console.error(e); process.exitCode = 1; });", "");
  s += "\nmodule.exports.run = main;\n";
  new vm.Script(Module.wrap(s)); return s;
}
function binding(file) {
  const b = read(file);
  assert.match(b.output, /^F:\\AgentVN\\QA\\Android-Package-20261021-01\\device-renpy-upgrade-30-\d{2}$/);
  for (const f of b.sources) verify(f);
  assert.deepEqual(b.pair, pair()); return b;
}
async function run(file, request, only = false) {
  const b = binding(file), q = read(request); validateRequest(q, b);
  assert.equal(q.binding.sha256, desc(file).sha256); assert.equal(q.binding.path, path.resolve(file));
  if (only) return;
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  Object.assign(worker, { validate: value => validateRequest(value, b), scenario, rendererReview });
  worker._compile(fs.readFileSync(b.runner.path, "utf8"), __filename);
  await worker.exports.run(request);
}
async function prepare(number) {
  assert.match(number, /^\d{2}$/);
  const sources = pair(), d = path.join(candidate, "android-renpy-upgrade-" + number);
  const output = path.join(root, "device-renpy-upgrade-30-" + number);
  assert(!fs.existsSync(d) && !fs.existsSync(output)); fs.mkdirSync(d);
  const startFile = path.join(d, "start.ps1"), runnerFile = path.join(d, "runner.cjs");
  const bindingFile = path.join(d, "binding.json");
  fs.writeFileSync(path.join(d, "executed-runner.cjs"), runnerSource(), { flag: "wx" });
  let start = fs.readFileSync(path.join(__dirname, "start-android-acceptance.ps1"), "utf8");
  const needle = "(Join-Path $PSScriptRoot 'android-native-upgrade-device.cjs')";
  assert.equal(start.split(needle).length - 1, 1);
  start = start.replace(needle, "'" + runnerFile + "'")
    .replaceAll("$PSCommandPath", "'" + startFile + "'")
    .replaceAll("$PSScriptRoot", "'" + __dirname + "'");
  require("./android-candidate-device.cjs").validateStartSyntax(start);
  fs.writeFileSync(startFile, start, { flag: "wx" });
  fs.writeFileSync(runnerFile, `require(${JSON.stringify(__filename)}).run(${JSON.stringify(bindingFile)},process.argv[2]).catch(e=>{console.error(e);process.exitCode=1});\n`, { flag: "wx" });
  const files = [__filename, original, startFile, runnerFile, path.join(d, "executed-runner.cjs"),
    ...["start-android-acceptance.ps1", "android-cold-boot.ps1", "android-acceptance-preflight.ps1",
      "android-runtime-log-analysis.cjs", "android-candidate-renpy-device-audit.cjs",
      "lib/android-adb-root-recovery.cjs", "lib/android-activity-exit.cjs",
      "android-acceptance-evidence.cjs", "visible-control-geometry.cjs"].map(n => path.join(__dirname, n)),
    ...sources.map(p => p.audit.path)];
  const archivedSources = files.map((file, index) => {
    const target = path.join(d, `source-${String(index).padStart(2, "0")}-${path.basename(file)}`);
    fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
    const source = desc(file), archived = desc(target); assert.equal(source.sha256, archived.sha256);
    return { source, archived };
  });
  const b = { pair: sources, output, startFile, runner: desc(path.join(d, "executed-runner.cjs")),
    sources: files.map(desc), archivedSources };
  fs.writeFileSync(bindingFile, JSON.stringify(b, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: "PREPARED_NOT_RUN", bindingFile }));
}
async function launch(file) {
  const b = binding(file); assert(!fs.existsSync(b.output)); fs.mkdirSync(b.output);
  const r = { status: "RUNNING", startedAt: new Date().toISOString(), binding: desc(file),
    productChanges: 0, buildInvocations: 0, modelRequests: 0 };
  const save = () => fs.writeFileSync(path.join(b.output, "report.json"), JSON.stringify(r, null, 2));
  save();
  try {
    const ports = await require("./lib/android-device-ports.cjs").allocateAndroidDevicePorts();
    const q = { scope: "installed-native-upgrade", package: pkg, sdk: "D:\\Android_dev\\Sdk",
      serial: "emulator-5554", runId: path.basename(b.output), outputDir: path.join(b.output, "runtime"),
      binding: r.binding, oldApk: b.pair[0].apk, apk: b.pair[1].apk, upgradePair: b.pair.map(p => p.identity),
      adbPort: ports[0], cdpPort: ports[1], coldBoot: { avd: "AgentVN_API35", avdHome: "D:\\Android_dev\\avd",
        adbPort: ports[2], grpcPort: ports[3], discoveryRoot: "C:\\Users\\1\\AppData\\Local\\Temp\\avd\\running",
        mediaVolumeTarget: 13 } };
    validateRequest(q, b);
    const request = path.join(b.output, "request.json");
    fs.writeFileSync(request, JSON.stringify(q, null, 2), { flag: "wx" });
    fs.copyFileSync(request, path.join(b.output, "request-submitted.json"), fs.constants.COPYFILE_EXCL);
    r.launchOutput = execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      b.startFile, "-RequestPath", request], { windowsHide: true, encoding: "utf8", timeout: 120000 }); save();
    const until = Date.now() + 20 * 60000; let l;
    while (Date.now() < until) {
      const p = path.join(q.outputDir, "acceptance-launch.json");
      if (fs.existsSync(p)) { try { l = read(p); } catch (e) { if (!(e instanceof SyntaxError)) throw e; } }
      if (l?.finishedAt) break;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    assert(l?.finishedAt, "Inspect this same owned helper; never relaunch on timeout");
    r.launch = l;
    const p = path.join(q.outputDir, "upgrade-runtime-report.json");
    if (fs.existsSync(p)) { r.runtime = desc(p); r.status = read(p).status; }
    else r.status = "BLOCKED";
    assert.equal(l.emulatorCleanupStatus, "PASS");
    binding(file);
    if (["FAILED", "BLOCKED"].includes(r.status)) process.exitCode = 1;
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
  r.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify(r, null, 2));
}
function selfTest() {
  const p = pair(); runnerSource();
  const b = { pair: p, output: path.join(root, "device-renpy-upgrade-30-00") };
  const q = { scope: "installed-native-upgrade", package: pkg, sdk: "D:\\Android_dev\\Sdk", serial: "emulator-5554",
    outputDir: path.join(b.output, "runtime"), runId: "device-renpy-upgrade-30-00",
    oldApk: p[0].apk, apk: p[1].apk, upgradePair: p.map(p => p.identity),
    adbPort: 51001, cdpPort: 51002, coldBoot: { avd: "AgentVN_API35", avdHome: "D:\\Android_dev\\avd",
      adbPort: 51003, grpcPort: 51004 } };
  validateRequest(q, b);
  const bad = [v => v.package += ".wrong", v => v.scope = "other", v => v.sdk = "other",
    v => v.outputDir = "D:\\AgentVN", v => v.coldBoot.avd = "other", v => v.cdpPort = v.adbPort,
    v => v.apk.sha256 = "0".repeat(64), v => v.oldApk.sha256 = "0".repeat(64),
    v => v.upgradePair[1].versionCode = 1003, v => v.upgradePair[1].signerSha256 = "0".repeat(64)];
  for (const change of bad) { const value = structuredClone(q); change(value); assert.throws(() => validateRequest(value, b)); }
  const { assertPreservedUpgradeData } = require(original);
  for (const args of [["uninstall", pkg], ["shell", "pm", "clear", pkg]])
    assert.throws(() => assertPreservedUpgradeData(args, true, false));
  assert.doesNotThrow(() => assertPreservedUpgradeData(["install", "-r", "current-staging.apk"], true, false));
  const previous = path.join(root, "device-renpy-upgrade-30-01/runtime");
  const observed = fs.readdirSync(previous).filter(n => /^before-upgrade-save-\d+\.json$/.test(n))
    .map(n => ({ value: read(path.join(previous, n)) }));
  validateOldSnapshots(observed, { scene: "ui_acceptance" });
  for (const change of [v => v.splice(v.findIndex(s => s.value.save_kind === "quick"), 1),
    v => latestSave(v, "auto").value.history.pop(),
    v => latestSave(v, "auto").value.command_index = 1]) {
    const badRows = structuredClone(observed); change(badRows);
    assert.throws(() => validateOldSnapshots(badRows, { scene: "ui_acceptance" }));
  }
  console.log(JSON.stringify({ status: "PASS", realPair: p.map(p => p.identity), invalidRequestsRejected: bad.length,
    destructiveCommandsRejected: 2, realOldSnapshotRegression: "PASS", invalidSnapshotsRejected: 3,
    productLaunches: 0, deviceOperations: 0, modelRequests: 0 }));
}
module.exports = { pair, validateRequest, validateOldSnapshots, latestSave, scenario, runnerSource, run, prepare, launch };
if (require.main === module) {
  const [action, value] = process.argv.slice(2);
  Promise.resolve().then(() => {
    if (action === "self-test") return selfTest();
    if (action === "prepare") return prepare(value);
    if (action === "launch") return launch(value);
    throw Error("Expected self-test, prepare NUMBER, or launch BINDING");
  }).catch(e => { console.error(e); process.exitCode = 1; });
}
