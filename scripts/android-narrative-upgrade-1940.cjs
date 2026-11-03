"use strict";
// Real retained narrative APK -> current APK. No rebuilt old binaries or
// manufactured saves: all three categories must be created through old UI.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { fileEvidence: desc } = require("./android-acceptance-evidence.cjs");
const preference = require("./lib/windows-upgrade-preference-contract.cjs");
const file = require.resolve("./android-renpy-upgrade.cjs");
const root = path.resolve("F:/AgentVN/QA/Android-Package-20261021-01");
const candidate = "F:/AgentVN/QA/Android-Candidate-1940-20261103-04";
const configFile = path.join(candidate, "config.json");
const pkg = "com.agentvn.qa.narrative20261102";
const prefix = "device-story-upgrade-41-";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const verify = f => assert.equal(desc(f.path).sha256, f.sha256, f.path);
function validateCurrentCandidate(c) {
  // The running device adapter is hash-bound. Expose its existing validator
  // through an in-memory QA module; never edit that active execution source.
  const file = require.resolve("./android-candidate-1940-device.cjs");
  const source = fs.readFileSync(file, "utf8") + "\nmodule.exports.currentValidator=validateCurrentConfig;\n";
  new vm.Script(Module.wrap(source));
  const worker = new Module(file, module); worker.filename = file; worker.paths = module.paths;
  worker._compile(source, file); return worker.exports.currentValidator(c);
}
function one(source, before, after, count = 1) {
  assert.equal(source.split(before).length - 1, count, "Exact preserved QA seam: " + before);
  return source.split(before).join(after);
}
function pair() {
  const c = read(configFile);
  validateCurrentCandidate(c);
  const result = [["story-artifact-36-audit-05", "1.9.35", "0.1.6", 1006],
    ["story-artifact-41-audit-01", "1.9.40", "0.1.7", 1007]].map(([name, editor, version, code]) => {
    const auditFile = path.join(root, name, "report.json"), a = read(auditFile);
    assert(["NARRATIVE_APK_ARTIFACT_PASS_DEVICE_NOT_RUN",
      "NARRATIVE_APK_ARTIFACT_PASS_AFTER_QA_CACHE_RECOVERY_DEVICE_NOT_RUN"].includes(a.status));
    assert.equal(a.checks.length, 6); assert(a.checks.every(v => v.status === "PASS"));
    assert.equal(a.candidate.version, editor); assert.equal(a.identity.packageName, pkg);
    assert.equal(a.identity.versionName, version); assert.equal(a.identity.versionCode, code);
    verify(a.apk); verify(a.build); const b = read(a.build.path);
    assert.equal(b.version, editor);
    assert.equal(b.storyFixture.sha256, c.storyFixture.sha256);
    return { audit: desc(auditFile), apk: a.apk, identity: a.identity, assets: a.assets,
      publishingWorkflow: a.checks[0].evidence };
  });
  assert.equal(result[0].identity.signerSha256, result[1].identity.signerSha256);
  assert.equal(result[0].apk.sha256, "1165d4705c7f64fd7d4abec0adadc3fef6ad1ecf3febfe560e3118354221f349");
  return result;
}
function validateSnapshots(rows, first) {
  assert.equal(first.scene, "main"); assert.equal(first.command, 3);
  assert.deepEqual([...new Set(rows.map(s => s.value.save_kind))].sort(), ["auto", "manual", "quick"]);
  const latest = kind => rows.filter(r => r.value.save_kind === kind)
    .sort((a, b) => b.value.created_at.localeCompare(a.value.created_at))[0].value;
  for (const row of rows) {
    assert.equal(row.value.scene_id, first.scene); assert.equal(row.value.command_index, first.command);
    assert(row.value.history.length > 0); assert(Number.isFinite(Date.parse(row.value.created_at)));
  }
  for (const kind of ["manual", "auto"])
    assert.deepEqual(latest(kind).history, latest("quick").history,
      "Opening menus and confirming exit must not add dialogue history");
}
function validatePreferences(before, after) {
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
  for (const key of Object.keys(before)) {
    if (Object.hasOwn(before[key], "gameAspectRatio")) assert.deepEqual(after[key], before[key]);
    else preference.validate(before[key], after[key]);
  }
}
function validateChosenAspect(before, after) {
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
  assert.equal(Object.keys(before).length, 1);
  for (const key of Object.keys(before))
    assert.deepEqual(after[key], { ...before[key], gameAspectRatio: "4:3" },
      "Explicit player ratio choice must leave all other preferences unchanged");
}
function dependencyFiles() {
  return ["android-candidate-1940-device.cjs", "installed-editor-android-candidate.cjs",
    "android-current-story-nvl-device.cjs", "android-current-story-nine-device.cjs",
    "android-current-story-device.cjs", "android-apk-runtime-qa.cjs",
    "lib/windows-upgrade-preference-contract.cjs"].map(f => path.join(__dirname, f));
}
function adapter() {
  let source = fs.readFileSync(file, "utf8");
  const begin = source.indexOf("function pair() {"), end = source.indexOf("function validateRequest(", begin);
  assert(begin >= 0 && end > begin);
  source = source.slice(0, begin) + "function pair() { return module.currentPair(); }\n" + source.slice(end);
  const snapshots = source.indexOf("function validateOldSnapshots("), scenario = source.indexOf("async function scenario(", snapshots);
  assert(snapshots >= 0 && scenario > snapshots);
  source = source.slice(0, snapshots) +
    "function validateOldSnapshots(rows,first) { return module.validateSnapshots(rows,first); }\n" + source.slice(scenario);
  source = one(source, 'const pkg = "com.agentvn.qa.renpygui20261025";', `const pkg = ${JSON.stringify(pkg)};`);
  source = one(source, 'const candidate = path.resolve("F:/AgentVN/QA/Editor-1.9.34-20261029-01");',
    `const candidate = path.resolve(${JSON.stringify(candidate)});`);
  source = one(source, "device-renpy-upgrade-30-", prefix, 6);
  source = one(source, 'titleVersion("0.1.4")', 'titleVersion("0.1.7")', 3);
  source = one(source, 'titleVersion("0.1.3")', 'titleVersion("0.1.6")', 2);
  source = one(source, '    await tap(".dialog-box", "old reach branch");\n' +
    '    await state(`document.querySelectorAll(".choice-panel button").length===2`);\n' +
    '    await tap(".choice-panel button:first-of-type", "old choose loop");\n' +
    '    await position(0);\n', "");
  source = one(source, "position(0)", "position(3)", 2);
  source = one(source, 'assert(first.text.startsWith("GUI_CONSUMPTION："))',
    'assert.equal(first.text,"第一句：确认背景、立绘、普通对白与八项快捷栏。")');
  source = one(source, String.raw`/versionCode=1004\b/`, String.raw`/versionCode=1007\b/`);
  source = one(source, String.raw`/versionName=0\.1\.4\b/`, String.raw`/versionName=0\.1\.7\b/`);
  source = one(source, "assert.deepEqual(await settings(), pref)", "module.validatePreferences(pref, await settings())", 3);
  source = one(source,
    '  await step("Three retained-data process-loss restarts recover real preferences and save files", async () => {\n',
    '  await step("Three retained-data process-loss restarts recover real preferences and save files", async () => {\n' +
    '    r.playerAspectPersistence = {status:"RUNNING",before:await settings(),trials:[]}; c.save();\n' +
    '    await tap(\'[data-testid="renpy-quick-settings"]\',"upgrade aspect open settings");\n' +
    '    await tap(".settings-tabs button:first-child","upgrade aspect display");\n' +
    '    await tap(\'[data-testid="settings-aspect-4:3"]\',"upgrade choose player 4:3");\n' +
    '    await state(`document.querySelector(\'[data-testid="settings-aspect-4:3"]\')?.getAttribute("aria-pressed")==="true"`);\n' +
    '    await tap(\'[data-testid="settings-finish"]\',"upgrade aspect return"); await position(3);\n' +
    '    pref=await settings(); module.validateChosenAspect(r.playerAspectPersistence.before,pref);\n' +
    '    r.playerAspectPersistence.selected=pref; c.save();\n');
  source = one(source,
    '      const shot = await screenshot("retained-title-" + n);',
    '      await state(`document.querySelector(".ui-skin-scope")?.dataset.gameAspectRatio==="4:3"`);\n' +
    '      const frame=await c.client().evaluate(`(() => {\n' +
    '        const scope=document.querySelector(".ui-skin-scope"); const f=scope?.querySelector(".runtime-layout-frame")?.getBoundingClientRect();\n' +
    '        return {ratio:scope?.dataset.gameAspectRatio,width:f?.width,height:f?.height}; })()`);\n' +
    '      assert.equal(frame.ratio,"4:3"); assert(Math.abs(frame.width/frame.height-4/3)<.003);\n' +
    '      r.playerAspectPersistence.trials.push({n,frame,preferences:await settings()});\n' +
    '      const shot = await screenshot("retained-title-" + n);');
  source = one(source, '    return { trials: 3, processLossSimulation: true, naturalExitClaimed: false };',
    '    r.playerAspectPersistence.status="PASS"; c.save();\n' +
    '    return { trials: 3, processLossSimulation: true, naturalExitClaimed: false };');
  const installed = label => `
    const installedPath=text(["shell","pm","path",q.package]).match(/^package:(\\/data\\/app\\/[^\\r\\n]+\\.apk)$/m)?.[1];
    assert(installedPath && !installedPath.includes(".."));
    const installedSha=text(["shell","sha256sum",installedPath]).split(/\\s+/)[0];
    assert.equal(installedSha,q.${label === "old" ? "oldApk" : "apk"}.sha256);
    (r.installedPackageBytes ??= []).push({label:${JSON.stringify(label)},path:installedPath,sha256:installedSha});
`;
  for (const [command, label] of [['    assert.match(text(["install", c.staged[0]]), /Success/);', "old"],
    ['    assert.match(text(["install", "-r", c.staged[1]]), /Success/);', "current"]])
    source = one(source, command, command + installed(label));
  source = one(source, '`require(${JSON.stringify(__filename)}).run(', '`require(${JSON.stringify(module.currentAdapter)}).run(');
  source = one(source, "const files = [__filename, original, startFile, runnerFile,",
    "const files = [__filename, module.currentAdapter, module.currentConfig, ...module.dependencyFiles(), original, startFile, runnerFile,");
  const worker = new Module(file, module); worker.filename = file; worker.paths = module.paths;
  Object.assign(worker, { currentPair: pair, validateSnapshots, validatePreferences, validateChosenAspect,
    currentAdapter: __filename, currentConfig: configFile, dependencyFiles });
  new vm.Script(Module.wrap(source)); worker._compile(source, file); return worker.exports;
}
function auditAdapter(actualPair) {
  const auditFile = require.resolve("./android-renpy-upgrade-audit.cjs");
  let source = fs.readFileSync(auditFile, "utf8");
  source = one(source, 'const pkg = "com.agentvn.qa.renpygui20261025";', `const pkg = ${JSON.stringify(pkg)};`);
  source = one(source, "device-renpy-upgrade-30-", prefix);
  const begin = source.indexOf("      for (const [n, version, code, sha256] of [");
  const end = source.indexOf("        const p = b.pair[n];", begin);
  assert(begin >= 0 && end > begin);
  source = source.slice(0, begin) + "      for (const [n, version, code, sha256] of " +
    JSON.stringify(actualPair.map((p, n) => [n, p.identity.versionName, p.identity.versionCode, p.apk.sha256])) +
    ") {\n" + source.slice(end);
  source = one(source, "assert.equal(a.checks.length, 5)", "assert.equal(a.checks.length, 6)");
  source = one(source, 'n === 1 ? "1.9.34" : "1.9.31"', 'n === 1 ? "1.9.40" : "1.9.35"');
  source = one(source, "Artifact pair only; current Editor normal close remains FAILED",
    "Current actual installed Editor natural WM_CLOSE passed; old cache-recovery boundary retained");
  for (const kind of ["manual", "quick", "auto"])
    source = one(source, `latest("${kind}").command_index, 0`, `latest("${kind}").command_index, 3`);
  source = one(source,
    '      assert.equal(latest("auto").history.length, latest("quick").history.length + 1);\n' +
    '      assert.notEqual(latest("auto").history.at(-1).id, latest("quick").history.at(-1).id);',
    '      module.validateSnapshots(before, runtime.cases[0].evidence.first);');
  source = one(source, String.raw`/versionCode=1004\b/`, String.raw`/versionCode=1007\b/`);
  source = one(source, String.raw`/versionName=0\.1\.4\b/`, String.raw`/versionName=0\.1\.7\b/`);
  source = one(source, "assert.deepEqual(initial.pref, loaded.preferences)",
    "module.validatePreferences(initial.pref, loaded.preferences)");
  source = one(source, "assert.deepEqual(initial.pref, runtime.cases[2].evidence.preferences)",
    "module.validatePreferences(initial.pref, runtime.cases[2].evidence.preferences)");
  source = one(source, "      assert.deepEqual(runtime.sourceApks, { old: b.pair[0].apk, current: b.pair[1].apk });",
    "      assert.deepEqual(runtime.sourceApks, { old: b.pair[0].apk, current: b.pair[1].apk });\n" +
    '      assert.deepEqual(runtime.installedPackageBytes.map(v=>[v.label,v.sha256]),' +
    '[["old",b.pair[0].apk.sha256],["current",b.pair[1].apk.sha256]]);');
  source = one(source, "  fs.copyFileSync(__filename, path.join(out, \"executed-audit.cjs\"), fs.constants.COPYFILE_EXCL);",
    "  fs.copyFileSync(__filename, path.join(out, \"executed-audit.cjs\"), fs.constants.COPYFILE_EXCL);\n" +
    "  r.sources.push(desc(module.currentAdapter));\n" +
    '  fs.writeFileSync(path.join(out,"executed-adapted-audit.cjs"),module.currentSource,{flag:"wx"});');
  source = one(source, "if (require.main === module) {",
    "module.exports = { audit };\nif (require.main === module) {");
  source = one(source, '    r.featureStatus = "PASS_LIMITED_REAL_APK_UPGRADE";',
    '    check("Player-selected 4:3 survives all three retained-data process restarts",()=>{\n' +
    '      const a=runtime.playerAspectPersistence; assert.equal(a?.status,"PASS");\n' +
    '      module.validateChosenAspect(a.before,a.selected);\n' +
    '      assert.deepEqual(a.before,runtime.cases[3].evidence.preferences);\n' +
    '      assert.deepEqual(a.trials.map(t=>t.n),[1,2,3]);\n' +
    '      for(const t of a.trials){assert.deepEqual(t.preferences,a.selected);assert.equal(t.frame.ratio,"4:3");\n' +
    '        assert(Math.abs(t.frame.width/t.frame.height-4/3)<.003);}\n' +
    '      assert.equal(runtime.touches.filter(t=>t.label==="upgrade choose player 4:3").length,1);\n' +
    '      return a;\n' +
    '    });\n    r.featureStatus = "PASS_LIMITED_REAL_APK_UPGRADE";');
  new vm.Script(Module.wrap(source));
  const worker = new Module(auditFile, module); worker.filename = auditFile; worker.paths = module.paths;
  Object.assign(worker, { validateSnapshots, validatePreferences, validateChosenAspect,
    currentAdapter: __filename, currentSource: source });
  worker._compile(source, auditFile); return worker.exports;
}
async function audit(bindingFile, number) {
  const b = read(bindingFile), actual = pair(); assert.deepEqual(b.pair, actual);
  return auditAdapter(actual).audit(bindingFile, number);
}
function selfTest() {
  validateCurrentCandidate(read(configFile));
  const tool = adapter(); new vm.Script(Module.wrap(tool.runnerSource()));
  const scenario = tool.scenario.toString();
  assert(scenario.includes('position(3)')); assert(!scenario.includes("old reach branch"));
  assert(scenario.includes('["manual", 1], ["auto", 2], ["quick", 3]'));
  assert(scenario.includes('["install", "-r", c.staged[1]]'));
  assert(scenario.includes("equalFiles(baseline, after)"));
  const before = { game: { highContrastText: true, muteSfx: false } };
  validatePreferences(before, { game: { ...before.game, gameAspectRatio: "default" } });
  for (const after of [{}, { game: { ...before.game, gameAspectRatio: "16:9" } },
    { game: { ...before.game, gameAspectRatio: "default", muteSfx: true } }])
    assert.throws(() => validatePreferences(before, after));
  validateChosenAspect(before, { game: { ...before.game, gameAspectRatio: "4:3" } });
  for (const after of [{ game: { ...before.game, gameAspectRatio: "default" } },
    { game: { ...before.game, gameAspectRatio: "4:3", muteSfx: true } }])
    assert.throws(() => validateChosenAspect(before, after));
  const rows = ["manual", "auto", "quick"].map(save_kind => ({ value: {
    save_kind, scene_id: "main", command_index: 3, history: [{ id: "original" }],
    created_at: "2026-11-03T00:00:00Z",
  } }));
  const first = { scene: "main", command: 3 }; validateSnapshots(rows, first);
  for (const mutate of [v => v.pop(), v => v[0].value.command_index = 0,
    v => v[1].value.history.push({ id: "duplicate" })]) {
    const bad = structuredClone(rows); mutate(bad); assert.throws(() => validateSnapshots(bad, first));
  }
  auditAdapter([1006, 1007].map((code, n) => ({
    identity: { versionName: `0.1.${n + 6}`, versionCode: code }, apk: { sha256: String(n).repeat(64) },
  })));
  dependencyFiles().forEach(f => assert(fs.existsSync(f)));
  return { status: "PASS", rejectedPreferenceChanges: 3, rejectedExplicitAspectChanges: 2, rejectedSnapshotChanges: 3,
    actualInstalledPackageHashChecks: 2, preservedDataGuards: true, deviceOperations: 0, builds: 0 };
}
module.exports = { run: (...args) => adapter().run(...args), pair, selfTest, validateSnapshots, validatePreferences };
if (require.main === module) Promise.resolve().then(() => {
  const [mode, arg] = process.argv.slice(2);
  if (mode === "self-test") return selfTest();
  if (mode === "prepare") return adapter().prepare(arg);
  if (mode === "audit") return audit(arg, process.argv[4]);
  assert.equal(mode, "launch"); return adapter().launch(arg);
}).then(result => { if (result) console.log(JSON.stringify(result)); })
  .catch(error => { console.error(error); process.exitCode = 1; });
