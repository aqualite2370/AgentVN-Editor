"use strict";
// QA only: reuse the real install-r/finally workflow with the retained recent
// default-layout APK. The default UI is never changed to create a quick slot.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const base = require("./android-candidate-device.cjs");
const { fileEvidence: desc } = require("./android-acceptance-evidence.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const root = path.resolve("F:/AgentVN/QA/Android-Package-20261021-01");
const oldAuditFile = path.join(root, "native-upgrade-audit-25-01/report.json");
const oldAuditSha = "241be35503e99937751364ea757baca793dd11fad5cef1fefd3b36a02f5cce56";
const oldApkSha = "a532634cdaefb3d9ec09a8f4a5962f4870b4a2d6a5968971f3b241b494412c23";
function replace(s, a, b) { assert.equal(s.split(a).length - 1, 1, a); return s.replace(a, b); }
function oldPair() {
  assert.equal(desc(oldAuditFile).sha256, oldAuditSha);
  const a = read(oldAuditFile); assert.equal(a.status, "APK_UPGRADE_PAIR_PASS_DEVICE_NOT_RUN");
  assert(a.checks.length >= 5 && a.checks.every(c => c.status === "PASS"));
  assert.equal(a.candidateBinding.editor, "1.9.31");
  const p = a.upgradePair; assert.equal(p.currentApk.sha256, oldApkSha);
  assert.equal(desc(p.currentApk.path).sha256, oldApkSha);
  assert.deepEqual(p.current, { packageName: "com.agentvn.qa.androidcurrent20261021",
    versionName: "0.1.3", versionCode: 1003,
    signerSha256: "c0eb991c5754b5556f8d5dcd966437c86e495e0fe7379fb76b35545247751718" });
  return { identity: p.current, apk: p.currentApk };
}
function runnerSource(c) {
  oldPair(); let s = base.runnerSource(c);
  s = replace(s, 'assert.equal(request.upgradePair.old.versionName, "0.1.0")',
    'assert.equal(request.upgradePair.old.versionName, "0.1.3")');
  s = replace(s, "assert.equal(request.upgradePair.old.versionCode, 1000)",
    "assert.equal(request.upgradePair.old.versionCode, 1003)");
  s = replace(s, "assert.deepEqual(audit.upgradePair.old, request.upgradePair.old);",
    "assert.deepEqual(request.upgradePair.old, " + JSON.stringify(oldPair().identity) + ");");
  s = replace(s, "504ea034c14f393465b44160898516a7875d3031c65d108779ecb51897b5de5b", oldApkSha);
  s = replace(s, 'first.text.startsWith("QA_ANDROID_0：")', 'first.text.startsWith("QA_ANDROID_UPGRADE_NEW_0：")');
  s = replace(s, 'second.text.startsWith("QA_ANDROID_1：")', 'second.text.startsWith("QA_ANDROID_UPGRADE_NEW_1：")');
  const start = s.indexOf('    await step("Snapshot UI-created old saves;');
  const end = s.indexOf('    await step("Real install -r', start);
  assert(start > 0 && end > start);
  s = s.slice(0, start) + `    await step("Recent old confirmed Activity exit persists the actual automatic snapshot", async () => {
      cmd(["shell","input","keyevent","KEYCODE_BACK"]); await idle();
      await wait(()=>client.evaluate('Boolean(document.querySelector(\\'[data-testid="continue-game"]\\'))'),"old menu");
      await tap('[data-testid="open-settings"]',"old settings before confirmed exit");
      await tap('[data-testid="open-exit-confirmation"]',"old explicit exit request");
      await wait(()=>client.evaluate('Boolean(document.querySelector(\\'[data-testid="confirm-exit-game"]\\'))'),"old exit confirmation");
      await screenshot("old-exit-confirmation");
      const {activityState}=require("./lib/android-activity-exit.cjs");
      const before=text(["shell","dumpsys","activity","activities"]);
      assert(activityState(before,pkg).live.length>0);
      const started=Date.now(); await tap('[data-testid="confirm-exit-game"]',"old confirm native exit once");
      let after;
      await wait(()=>{after=text(["shell","dumpsys","activity","activities"]);return activityState(after,pkg).closed;},
        "old real Activity finish",15000);
      const evidence=[];
      for(const [name,value] of [["old-activity-before.txt",before],["old-activity-after.txt",after]]) {
        const file=path.join(out,name); fs.writeFileSync(file,value,{flag:"wx"});evidence.push(fileEvidence(file));
      }
      baseline=diskSaves("before-upgrade");
      assert(baseline.some(s=>s.value.save_kind==="manual"&&s.value.command_index===first.command));
      const auto=baseline.filter(s=>s.value.save_kind==="auto").sort((a,b)=>b.value.created_at.localeCompare(a.value.created_at));
      assert(auto.length);assert.equal(auto[0].value.command_index,second.command);
      assert.equal(auto[0].value.scene_id,second.scene);assert(!baseline.some(s=>s.value.save_kind==="quick"));
      r.oldAutoCreation="PASS_REAL_OLD_CONFIRMED_EXIT";
      r.oldExitObservation={status:"PASS",basis:"ACTIVITY_FINISH",physicalInput:"ADB_TOUCH",
        forcedBeforeExit:false,confirmationClicks:1,elapsedMs:Date.now()-started,evidence};
      client.close();client=null;
      return {baseline,...r.oldExitObservation,normalExitClaimed:true};
    });
` + s.slice(end);
  s = replace(s, "snapshotAndNewScript: true, preferences: pref",
    "snapshotAndNewScript: true, newScriptDifferenceClaimed: false, preferences: pref");
  s = replace(s, "    // Observe actual render turns, not a fixed delay that may inspect the old idle page.",
    '    if(selector===\'[data-testid="confirm-exit-game"]\')return;\n' +
    "    // Observe actual render turns, not a fixed delay that may inspect the old idle page.");
  new vm.Script(Module.wrap(s)); return s;
}
function launchSource(startFile, runnerFile) {
  const old = oldPair(); let s = base.launchSource(startFile, runnerFile);
  s = replace(s, '"editor-10/report.json"', '"editor-25/report.json"');
  s = replace(s, 'a.kind === "android_apk_signed"', 'a.kind === "android_apk"');
  s = replace(s, "old: audit.upgradePair.old, current: audit.upgradePair.current",
    "old: " + JSON.stringify(old.identity) + ", current: audit.upgradePair.current");
  s = replace(s, '"Old APK normal exit remained pending; automatic save sample may be BLOCKED, not substituted"',
    '"Old 0.1.3 normal Activity finish and automatic snapshot are independently recorded"');
  s = replace(s, '"Recent retained signed sample only; not the pre-save-mechanism old binary"',
    '"Recent retained 0.1.3 to current 0.1.4; unchanged story text does not prove a new script difference"');
  s = replace(s, "autoSaveSampleStrategy: strategy ===", 'autoSaveSampleStrategy: "confirmed-exit", unusedLegacyStrategy: strategy ===');
  new vm.Script(Module.wrap(s)); return s;
}
function worker() {
  const file = require.resolve("./android-candidate-device.cjs");
  let s = fs.readFileSync(file, "utf8");
  const a = s.indexOf("function runnerSource(c) {"), b = s.indexOf("function loadRunner(", a);
  assert(a > 0 && b > a);
  s = s.slice(0, a) + "function runnerSource(c) { return module.runnerSource(c); }\n" + s.slice(b);
  const x = s.indexOf("function launchSource("), y = s.indexOf("function startSource(", x);
  assert(x > 0 && y > x);
  s = s.slice(0, x) + "function launchSource(...args) { return module.launchSource(...args); }\n" + s.slice(y);
  s = replace(s, "sources: [...preserved(), desc(__filename),",
    "sources: [...preserved(), desc(module.adapterFile), desc(module.oldAuditFile), desc(__filename),");
  s = replace(s, "JSON.stringify(__filename)", "JSON.stringify(module.adapterFile)");
  s = replace(s, "if (require.main === module)", "if (module.qaRun)");
  const w = new Module(file, module); w.filename = file; w.paths = module.paths;
  Object.assign(w, { qaRun: false, adapterFile: __filename, oldAuditFile, runnerSource, launchSource });
  w._compile(s, file); return w.exports;
}
async function selfTest(configFile, auditFile) {
  const c = read(configFile), a = base.auditCandidate(c, configFile, auditFile), old = oldPair();
  const runner = (() => {
    const file = require.resolve("./android-candidate-device.cjs"), w = new Module(file, module);
    w.filename = file; w.paths = module.paths; w.qaRun = false; w._compile(runnerSource(c), file); return w.exports;
  })();
  const request = { scope: "installed-native-upgrade", package: old.identity.packageName,
    upgradePair: { old: old.identity, current: a.upgradePair.current }, oldApk: old.apk, apk: a.upgradePair.currentApk,
    outputDir: path.join(root, `device-upgrade-${c.attempt}-99/runtime`), serial: "emulator-5554",
    coldBoot: {}, packageAudit: desc(auditFile) };
  runner.validateRequest(request);
  const wrong = [q => q.oldApk.sha256 = "0".repeat(64), q => q.upgradePair.old.versionCode = 1000,
    q => q.upgradePair.old.versionName = "0.1.0", q => q.package += ".other",
    q => q.upgradePair.current.signerSha256 = "0".repeat(64), q => q.outputDir = "D:\\AgentVN"];
  for (const change of wrong) { const q = structuredClone(request); change(q); assert.throws(() => runner.validateRequest(q)); }
  const prep = path.join(path.dirname(configFile), "recent-syntax-only");
  base.validateStartSyntax(base.startSource(path.join(prep, "start.ps1"), path.join(prep, "runner.cjs")));
  launchSource(path.join(prep, "start.ps1"), path.join(prep, "runner.cjs")); worker();
  assert(!fs.existsSync(prep));
  return { status: "PASS", actualSignedRecentPair: true, rejected: wrong.length, builds: 0, deviceOperations: 0 };
}
module.exports = { runPrepared: (...args) => worker().runPrepared(...args),
  launchPrepared: (...args) => worker().launchPrepared(...args), selfTest };
if (require.main === module) {
  (async () => {
    const [mode, config, audit, number] = process.argv.slice(2);
    if (mode === "self-test") console.log(JSON.stringify(await selfTest(config, audit)));
    else { assert.equal(mode, "prepare"); oldPair(); console.log(JSON.stringify(worker().prepare(config, audit, number))); }
  })().catch(e => { console.error(e); process.exitCode = 1; });
}
