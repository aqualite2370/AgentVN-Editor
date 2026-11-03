"use strict";
// Independent read-only review of actual device evidence. No emulator or model.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { fileEvidence: desc } = require("./android-acceptance-evidence.cjs");
const { scopedRuntimeLog } = require("./android-runtime-log-analysis.cjs");
const { rendererReview } = require("./android-candidate-renpy-device-audit.cjs");
const { validateImmediateActivityReopen } = require("./android-exit-device.cjs");
const { activityState } = require("./lib/android-activity-exit.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve("F:/AgentVN/QA/Android-Package-20261021-01");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
function verify(f) { assert.equal(desc(f.path).sha256, f.sha256, f.path); return f; }
function warningKind(line) {
  if (/tile memory limits exceeded/.test(line)) return "RENDERER_TILE_MEMORY";
  if (/HTTP Cache\/Code Cache\/|Could not reconstruct index from disk/.test(line)) return "WEBVIEW_CODE_CACHE";
  return "UNKNOWN_RUNTIME_WARNING";
}
function validateBindingOwnership(mode, owner, runtime, request) {
  assert(request.candidateBinding?.path && request.candidateBinding?.sha256);
  assert.deepEqual(runtime.candidateBinding, request.candidateBinding);
  if (mode === "navigation") assert.deepEqual(owner.candidateBinding, request.candidateBinding);
  else {
    assert(owner.request?.path && owner.request?.sha256);
    verify(owner.request);
    assert.deepEqual(read(owner.request.path).candidateBinding, request.candidateBinding);
  }
}
function navigation(v) {
  assert(["PASS_LIMITED_AGENTVN_NAVIGATION", "BLOCKED_RENDERER_REVIEW"].includes(v.status));
  assert(v.finishedAt); assert.equal(v.cases.length, 5); assert(v.cases.every(c => c.status === "PASS"));
  assert.equal(v.cases[0].evidence.topModalOnly, true);
  assert.deepEqual(v.cases[1].evidence.restores, ["touch", "system BACK"]);
  assert.equal(v.cases[2].evidence.samples.length, 2);
  assert(v.cases[2].evidence.samples.every(s => s.controls.length === 8 && s.controls.every(c => c.visible && c.hit)));
  assert.equal(v.cases[3].evidence.menuThenChildThenMenuThenPlayer, true);
  assert.equal(v.rotationRestoreStatus, "PASS_EXACT_POLICY_RESTORED"); assert.equal(v.sensorRestoreStatus, "PASS");
  assert.equal(v.activityExits.length, 2);
  const [a, b] = v.activityExits; validateImmediateActivityReopen(a);
  assert.equal(b.basis, "ACTIVITY_FINISH"); assert.equal(b.after.closed, true); assert.equal(b.after.live.length, 0);
  assert(b.before.live.length > 0 && b.after.resumed.length > 0); assert.equal(b.forcedBeforeExit, false);
  assert.equal(b.confirmationClicks, 1); assert.deepEqual(b.fatalBeforeReclaim, []);
  assert(b.elapsedMs >= 0 && b.elapsedMs < 15000);
  assert(a.closedCommandIndex < a.reopened.commandIndex && a.reopened.commandIndex < b.closedCommandIndex);
  const beforeClose = v.commands.slice(0, b.closedCommandIndex + 1);
  assert(!beforeClose.some(c => c.args.slice(0, 3).join(" ") === "shell am force-stop" ||
    c.args[0] === "uninstall" || c.args.slice(0, 3).join(" ") === "shell pm clear"));
  const e = v.cases[4].evidence;
  assert.equal(e.restoredRuntimeOperable, true); assert.equal(e.confirmationClicks, 2);
  assert.deepEqual(e.continued, v.cases[1].evidence.position);
  assert.equal(Number(e.advanced.command), 1); assert(e.advanced.text.startsWith("QA_ANDROID_UPGRADE_NEW_1："));
  return { cases: 5, normalActivityFinishes: 2, immediateSameProcessReopen: true, controlsUnchanged: 8 };
}
function upgrade(v, recent = false) {
  assert(["PARTIAL_PASS", "BLOCKED"].includes(v.status)); assert(v.finishedAt);
  assert.equal(v.cases.length, 6); assert(v.cases.every(c => c.status === "PASS"));
  assert.equal(v.oldQuickCreation, "BLOCKED_OLD_DEFAULT_LAYOUT_HAS_NO_CREATION_ENTRY");
  assert.equal(v.oldExitObservation.status, recent ? "PASS" : "FAILED");
  if (recent) {
    assert.equal(v.oldExitObservation.basis, "ACTIVITY_FINISH");
    assert.equal(v.oldExitObservation.forcedBeforeExit, false);
    assert.equal(v.oldExitObservation.confirmationClicks, 1);
    assert.equal(v.oldAutoCreation, "PASS_REAL_OLD_CONFIRMED_EXIT");
    assert.equal(v.cases[3].evidence.newScriptDifferenceClaimed, false);
  }
  assert.equal(v.restartTrials.length, 6);
  for (const kind of ["retained-data", "clean-install"])
    assert.deepEqual(v.restartTrials.filter(t => t.kind === kind && t.status === "PASS").map(t => t.n), [1, 2, 3]);
  const before = v.cases[1].evidence.baseline, after = v.cases[2].evidence.after;
  assert(before.some(s => s.value.save_kind === "manual")); assert(!before.some(s => s.value.save_kind === "quick"));
  const identity = a => a.map(s => [s.remote, s.sha256]).sort();
  assert.deepEqual(identity(before), identity(after));
  const changes = v.commands.filter(c => c.args[0] === "install" && c.args[1] === "-r");
  assert.equal(changes.length, 1); assert.equal(changes[0].status, 0); assert.match(changes[0].stdout, /Success/);
  const start = Date.parse(v.cases[0].startedAt), end = Date.parse(v.cases[3].finishedAt);
  for (const c of v.commands.filter(c => Date.parse(c.at) >= start && Date.parse(c.at) <= end)) {
    assert.notEqual(c.args[0], "uninstall"); assert.notEqual(c.args.slice(0, 3).join(" "), "shell pm clear");
  }
  assert.equal(v.cases[3].evidence.snapshotAndNewScript, true);
  assert.deepEqual(v.cases[0].evidence.pref, v.cases[3].evidence.preferences);
  assert.equal(Object.values(v.cases[3].evidence.preferences)[0].highContrastText, true);
  return { cases: 6, retainedSaveFiles: before.length, kinds: v.cases[3].evidence.oldKinds,
    restarts: 6, quickUpgrade: "BLOCKED_OLD_UI_HAS_NO_CREATION_ENTRY" };
}
async function main() {
  const [mode, configFile, packageAudit, number, auditNumber] = process.argv.slice(2);
  assert(["navigation", "upgrade", "recent", "self-test"].includes(mode));
  if (mode === "self-test") {
    assert.throws(() => navigation({ status: "PASS_LIMITED_AGENTVN_NAVIGATION", finishedAt: "test", cases: [] }));
    assert.throws(() => upgrade({ status: "PARTIAL_PASS", finishedAt: "test", cases: [] }));
    assert.equal(warningKind("WARNING: tile memory limits exceeded, some content may not draw"), "RENDERER_TILE_MEMORY");
    assert.equal(warningKind("Could not get file info for /cache/WebView/Default/HTTP Cache/Code Cache/js/a"), "WEBVIEW_CODE_CACHE");
    assert.equal(warningKind("A new, unreviewed warning"), "UNKNOWN_RUNTIME_WARNING");
    const actual = path.join(root, "device-upgrade-32-01");
    {
      assert(fs.existsSync(path.join(actual, "report.json")), "Actual terminal upgrade evidence is required");
      const owner = read(path.join(actual, "report.json"));
      const runtime = read(path.join(actual, "runtime/upgrade-runtime-report.json"));
      const request = read(path.join(actual, "request-submitted.json"));
      validateBindingOwnership("upgrade", owner, runtime, request);
      assert.throws(() => validateBindingOwnership("upgrade", owner, { ...runtime, candidateBinding: {} }, request));
      assert.throws(() => validateBindingOwnership("navigation", owner, runtime, request));
      assert.throws(() => upgrade(runtime, true), "Old 0.1.0 exit failure cannot substitute for recent normal exit");
    }
    console.log(JSON.stringify({ status: "PASS", emptyMatricesRejected: 2,
      actualUpgradeRequestBinding: "PASS", wrongRuntimeAndNavigationOwnershipRejected: 2, deviceOperations: 0 })); return;
  }
  for (const n of [number, auditNumber]) assert.match(n, /^\d{2}$/);
  const { c, a } = require("./android-default-artifact.cjs").validateCandidate(configFile, packageAudit);
  const source = path.join(root, `device-${mode === "navigation" ? "navigation" : "upgrade"}-${c.attempt}-${number}`);
  const out = source + "-review-" + auditNumber; assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const r = { status: "RUNNING", startedAt: new Date().toISOString(),
    scope: "ACTUAL_CURRENT_DEFAULT_ANDROID_EVIDENCE_NOT_BLANKET_LIFECYCLE_PASS",
    modelRequests: 0, productChanges: 0, checks: [], sources: [desc(__filename), desc(configFile), desc(packageAudit)] };
  const load = file => { r.sources.push(desc(file)); return read(file); };
  const check = async (name, fn) => {
    const row = { name, status: "RUNNING" }; r.checks.push(row);
    try { row.evidence = await fn(); row.status = "PASS"; } catch (e) { row.status = "FAILED"; throw e; }
  };
  try {
    const owner = load(path.join(source, "report.json"));
    const v = load(path.join(source, "runtime", mode === "navigation" ? "navigation-report.json" : "upgrade-runtime-report.json"));
    const launch = load(path.join(source, "runtime/acceptance-launch.json")), boot = load(path.join(source, "runtime/cold-boot.json"));
    const q = load(path.join(source, "request-submitted.json"));
    await check("Exact current APK, candidate source binding, real administrator and cold boot", () => {
      assert(owner.finishedAt && launch.finishedAt && v.finishedAt); assert.equal(owner.status, v.status);
      assert.equal(owner.productChanges, 0); assert.equal(owner.buildInvocations, 0); assert.equal(owner.modelRequests, 0);
      assert.equal(q.apk.sha256, a.upgradePair.currentApk.sha256); verify(q.apk); verify(q.packageAudit);
      assert.equal(path.resolve(q.packageAudit.path), path.resolve(packageAudit));
      const bindingFile = q.candidateBinding; verify(bindingFile);
      validateBindingOwnership(mode, owner, v, q);
      const b = load(bindingFile.path); b.sources.forEach(verify);
      assert.equal(b.config.sha256, desc(configFile).sha256);
      assert.equal(launch.parentBoundary, "non-admin-to-RunAs"); assert.equal(launch.isElevated, true);
      assert.equal(v.isElevated, true); assert(v.symlinkProbe.success && v.symlinkProbe.isElevated);
      assert.equal(boot.coldBoot, true); assert.equal(v.coldBoot.status, "PASS");
      assert.equal(v.coldBoot.observedBootId, boot.bootId);
      if (mode !== "navigation") {
        assert.deepEqual(v.sourceApks.old, q.oldApk); assert.deepEqual(v.sourceApks.current, q.apk);
        if (mode === "recent") {
          const file = path.join(root, "native-upgrade-audit-25-01/report.json");
          assert.equal(desc(file).sha256, "241be35503e99937751364ea757baca793dd11fad5cef1fefd3b36a02f5cce56");
          const old = load(file); assert.deepEqual(q.upgradePair.old, old.upgradePair.current);
          assert.equal(q.oldApk.sha256, old.upgradePair.currentApk.sha256);
        } else {
          assert.equal(q.oldApk.sha256, "504ea034c14f393465b44160898516a7875d3031c65d108779ecb51897b5de5b");
          assert.deepEqual(q.upgradePair.old, a.upgradePair.old);
        }
      }
      return { bindingSources: b.sources.length, apk: q.apk, normalEditorClose: "FAILED_RETAINED" };
    });
    await check("Nonempty real interaction, actual functionality and negative evidence guards", () => {
      const validate = mode === "navigation" ? navigation : value => upgrade(value, mode === "recent"), result = validate(v);
      assert(v.touches.length > 0);
      assert(v.commands.some(c => c.status === 0 && c.args.slice(0, 2).join(" ") === "shell input"));
      const mutations = [
        x => { x.cases = []; }, x => { x.cases[0].status = "FAILED"; },
        mode === "navigation" ? x => { x.activityExits[1].forcedBeforeExit = true; } : x => { x.restartTrials = []; },
        mode === "navigation" ? x => { x.cases[4].evidence.confirmationClicks = 1; }
          : x => { x.cases[2].evidence.after[0].sha256 = "wrong"; },
      ];
      for (const change of mutations) { const bad = structuredClone(v); change(bad); assert.throws(() => validate(bad)); }
      return { ...result, badEvidenceRejected: mutations.length, nativeInputs: v.touches.length };
    });
    await check("Native PNG, actual UIAutomator, Activity and saved snapshot byte integrity", () => {
      assert(v.screenshots.length > 0);
      for (const s of v.screenshots) {
        verify(s); assert.deepEqual(s.before, s.after);
        const bytes = fs.readFileSync(s.path); assert.equal(bytes.subarray(1, 4).toString(), "PNG");
        assert.equal(bytes.readUInt32BE(16), s.physical.width); assert.equal(bytes.readUInt32BE(20), s.physical.height);
        assert(s.physical.width > s.physical.height && s.before.dpr > 0);
        if (s.uiautomator) { verify(s.uiautomator); assert(fs.readFileSync(s.uiautomator.path, "utf8").includes(q.package)); }
      }
      if (mode === "navigation") {
        for (const e of v.activityExits)
          [e.beforeEvidence, e.afterEvidence, e.reopened?.evidence, e.reopened?.targetSnapshot, e.reopened?.nativeLog].filter(Boolean).forEach(verify);
        const e = v.cases[4].evidence, newest = [];
        for (const [saves, expected] of [[e.saved, e.continued], [e.savedAfterSecond, e.advanced]]) {
          saves.forEach(s => { verify(s); assert.deepEqual(read(s.path), s.value); });
          const actual = saves.filter(s => s.value.save_kind === "auto" && s.value.scene_id === expected.scene &&
            s.value.command_index === Number(expected.command)).sort((a, b) => b.value.created_at.localeCompare(a.value.created_at));
          assert(actual.length); newest.push(actual[0].value);
        }
        assert.equal(newest[1].history.length, newest[0].history.length + 1);
        assert.notEqual(newest[1].history.at(-1).id, newest[0].history.at(-1).id);
      } else {
        for (const s of [...v.cases[1].evidence.baseline, ...v.cases[2].evidence.after]) { verify(s); assert.deepEqual(read(s.path), s.value); }
        for (const s of Object.values(v.sourceApks)) verify(s);
        if (mode === "recent") {
          v.oldExitObservation.evidence.forEach(verify);
          const [before, after] = v.oldExitObservation.evidence.map(s => activityState(fs.readFileSync(s.path, "utf8"), q.package));
          assert(before.live.length > 0); assert.equal(after.closed, true); assert.equal(after.live.length, 0);
        }
      }
      for (const d of v.diagnostics || []) verify(d);
      return { screenshots: v.screenshots.length, diagnostics: v.diagnostics?.length || 0, physicalDisplay: v.physical };
    });
    await check("Independent raw log parsing keeps renderer termination and cache uncertainty", () => {
      const file = path.join(source, "runtime/logcat.txt"); r.sources.push(desc(file));
      const text = fs.readFileSync(file, "utf8"), logs = scopedRuntimeLog(text, q.package, v.pids);
      assert.deepEqual(logs.fatal, v.logs.fatal); assert.deepEqual(logs.fatal, []);
      assert.deepEqual(logs.warnings, v.logs.warnings);
      r.rendererTerminationReview = rendererReview(v, text); r.warnings = logs.warnings;
      r.warningKinds = [...new Set(logs.warnings.map(warningKind))];
      return { rendererEvents: r.rendererTerminationReview.events, unknownWarnings: logs.warnings.length, fatal: 0 };
    });
    await check("Finally uninstall, staging, emulator, source bytes and all owned ports", () => {
      for (const key of ["uninstallStatus", "apkCleanupStatus", "adbCleanupStatus"]) assert.equal(v[key], "PASS");
      assert.equal(v.cleanupError, null); assert.equal(launch.emulatorCleanupStatus, "PASS"); assert.equal(boot.emulatorCleanupStatus, "PASS");
      const names = mode === "navigation" ? ["staging.apk"] : ["old-staging.apk", "current-staging.apk"];
      names.forEach(n => assert(!fs.existsSync(path.join(source, "runtime", n))));
      assert.deepEqual(listeners([q.adbPort, q.cdpPort, q.coldBoot.adbPort, q.coldBoot.grpcPort, 5554, 5555]), []);
      const live = rows(); assert(!boot.processes.some(p => live.some(n => n.ProcessId === p.ProcessId &&
        Date.parse(n.Created) === Date.parse(p.CreationDate))));
      verify(q.apk); if (q.oldApk) verify(q.oldApk);
      return { stagingDeleted: names.length, ownedPortsReleased: 6 };
    });
    r.featureStatus = mode === "navigation" ? "PASS_LIMITED_AGENTVN_NAVIGATION" : "PARTIAL_PASS_OLD_QUICK_UNAVAILABLE";
    r.status = r.rendererTerminationReview.events.length ? "BLOCKED_RENDERER_TERMINATION_REVIEW"
      : r.warningKinds.includes("RENDERER_TILE_MEMORY") ? "BLOCKED_RENDERER_MEMORY_WARNING_REVIEW"
      : r.warningKinds.includes("UNKNOWN_RUNTIME_WARNING") ? "BLOCKED_RUNTIME_WARNING_REVIEW"
      : r.warnings.length ? "BLOCKED_CACHE_WARNING_REVIEW" : "EVIDENCE_PASS_FEATURE_" + r.featureStatus;
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
  r.finishedAt = new Date().toISOString(); r.sources.forEach(verify);
  fs.copyFileSync(__filename, path.join(out, "executed-review.cjs"), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: r.status, featureStatus: r.featureStatus, out,
    checks: r.checks.map(({ name, status }) => ({ name, status })), error: r.error }));
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
