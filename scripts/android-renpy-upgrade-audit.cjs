"use strict";
// Independent, read-only terminal review. Never launches Android or repairs evidence.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { fileEvidence: desc } = require("./android-acceptance-evidence.cjs");
const { scopedRuntimeLog } = require("./android-runtime-log-analysis.cjs");
const { rendererReview } = require("./android-candidate-renpy-device-audit.cjs");
const { activityState } = require("./lib/android-activity-exit.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const root = path.resolve("F:/AgentVN/QA/Android-Package-20261021-01");
const pkg = "com.agentvn.qa.renpygui20261025";
const view = saves => saves.map(s => [s.remote, s.sha256]).sort();
function requireNativeDisplay(shot, png, xml) {
  assert.deepEqual(shot.before, shot.after);
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), shot.physical.width);
  assert.equal(png.readUInt32BE(20), shot.physical.height);
  assert(shot.physical.width > shot.physical.height);
  assert(Number.isFinite(shot.before.dpr) && shot.before.dpr > 0);
  // ADB captures physical screen pixels. Android's integer innerWidth/Height
  // ceil fractional CSS extents; these are not browser screenshot dimensions.
  assert.equal(shot.before.width, Math.ceil(shot.physical.width / shot.before.dpr));
  assert.equal(shot.before.height, Math.ceil(shot.physical.height / shot.before.dpr));
  if (xml !== undefined) {
    const node = xml.match(/<node\b[^>]*class="android\.webkit\.WebView"[^>]*>/)?.[0];
    assert(node && node.includes(`package="${pkg}"`));
    assert(node.includes(`bounds="[0,0][${shot.physical.width},${shot.physical.height}]"`));
  }
}
function requireComplete(r) {
  assert(["BLOCKED_RENDERER_TERMINATION_REVIEW", "BLOCKED_CACHE_WARNING_REVIEW",
    "PASS_LIMITED_REAL_APK_UPGRADE"].includes(r.status));
  assert.equal(r.cases.length, 6); assert(r.cases.every(c => c.status === "PASS" && c.finishedAt));
  assert.equal(r.restartTrials.length, 6);
  for (const kind of ["retained-data", "clean-install"])
    assert.deepEqual(r.restartTrials.filter(t => t.kind === kind).map(t => t.n), [1, 2, 3]);
  assert(r.restartTrials.every(t => t.status === "PASS"));
  assert.equal(r.oldQuickCreation, "PASS_REAL_OLD_UI");
  assert.equal(r.oldAutoCreation, "PASS_REAL_OLD_CONFIRMED_EXIT");
  assert.equal(r.uninstallStatus, "PASS"); assert.equal(r.apkCleanupStatus, "PASS");
  assert.equal(r.adbCleanupStatus, "PASS"); assert.equal(r.cleanupError, null);
}
function requirePreservation(commands, provedAt) {
  const relevant = commands.filter(c => Date.parse(c.at) <= Date.parse(provedAt));
  assert.equal(relevant.filter(c => c.args[0] === "install" && c.args[1] === "-r").length, 1);
  assert(!relevant.some(c => c.args[0] === "uninstall" || c.args.slice(0, 3).join(" ") === "shell pm clear"));
}
async function audit(bindingFile, number) {
  assert.match(number, /^\d{2}$/);
  const b = read(bindingFile);
  assert.match(b.output, /^F:\\AgentVN\\QA\\Android-Package-20261021-01\\device-renpy-upgrade-30-\d{2}$/);
  const out = b.output + "-audit-" + number; assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const r = { status: "RUNNING", startedAt: new Date().toISOString(), checks: [], sources: [],
    productLaunches: 0, deviceOperations: 0, modelRequests: 0 };
  const verify = f => { assert.equal(desc(f.path).sha256, f.sha256, f.path); r.sources.push(desc(f.path)); return f; };
  const load = f => { r.sources.push(desc(f)); return read(f); };
  const check = (name, fn) => {
    const row = { name, status: "RUNNING" }; r.checks.push(row);
    try { row.evidence = fn(); row.status = "PASS"; }
    catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  };
  try {
    const owner = load(path.join(b.output, "report.json"));
    const runtime = load(path.join(b.output, "runtime/upgrade-runtime-report.json"));
    const launch = load(path.join(b.output, "runtime/acceptance-launch.json"));
    const boot = load(path.join(b.output, "runtime/cold-boot.json"));
    const q = load(path.join(b.output, "request-submitted.json"));
    requireComplete(runtime);
    check("Exact retained signed pair, candidate provenance, executed-source archive and real administrator boot", () => {
      assert.equal(owner.binding.sha256, desc(bindingFile).sha256);
      assert.equal(q.binding.sha256, owner.binding.sha256);
      assert.equal(owner.runtime.sha256, desc(path.join(b.output, "runtime/upgrade-runtime-report.json")).sha256);
      assert.equal(b.sources.length, b.archivedSources.length); assert(b.sources.length > 10);
      for (let n = 0; n < b.sources.length; n++) {
        const a = b.archivedSources[n]; assert.deepEqual(a.source, b.sources[n]);
        verify(a.archived); assert.equal(a.archived.sha256, a.source.sha256);
      }
      for (const [n, version, code, sha256] of [
        [0, "0.1.3", 1003, "4063c2daf485c7f05661a1ce52a2c1702047fa511a6a1e905f70c089c09a0d8e"],
        [1, "0.1.4", 1004, "0fa02a46030050960d9f0ed6ab132092314e43a07a085562bea0fe1b339501db"]]) {
        const p = b.pair[n]; verify(p.audit); verify(p.apk); assert.equal(p.apk.sha256, sha256);
        const a = load(p.audit.path); assert.deepEqual(a.identity, p.identity);
        assert.equal(a.checks.length, 5); assert(a.checks.every(c => c.status === "PASS"));
        assert.equal(p.identity.packageName, pkg); assert.equal(p.identity.versionName, version);
        assert.equal(p.identity.versionCode, code);
        assert.equal(a.candidate.version, n === 1 ? "1.9.34" : "1.9.31");
      }
      assert.equal(b.pair[0].identity.signerSha256, b.pair[1].identity.signerSha256);
      assert.deepEqual(runtime.sourceApks, { old: b.pair[0].apk, current: b.pair[1].apk });
      assert.equal(owner.buildInvocations, 0); assert.equal(owner.modelRequests, 0); assert.equal(owner.productChanges, 0);
      assert.equal(launch.isElevated, true); assert.equal(launch.parentBoundary, "non-admin-to-RunAs");
      assert.equal(runtime.isElevated, true); assert(runtime.symlinkProbe.success && runtime.symlinkProbe.isElevated);
      assert.equal(launch.exitCode, 0); assert(launch.finishedAt); assert.equal(boot.coldBoot, true);
      assert.equal(runtime.coldBoot.observedBootId, boot.bootId); assert.equal(runtime.coldBoot.status, "PASS");
      return { archiveFiles: b.archivedSources.length, old: b.pair[0].identity, current: b.pair[1].identity,
        boundary: "Artifact pair only; current Editor normal close remains FAILED" };
    });
    const before = runtime.cases[1].evidence.baseline, after = runtime.cases[2].evidence.after;
    const savedFile = f => { verify(f); assert.deepEqual(read(f.path), f.value); };
    check("Actual old UI writes, complete exit snapshot, unchanged old bytes and real install -r", () => {
      for (const f of [...before, ...after, ...runtime.cases[0].evidence.saves]) savedFile(f);
      assert.deepEqual([...new Set(before.map(s => s.value.save_kind))].sort(), ["auto", "manual", "quick"]);
      assert.deepEqual(view(before), view(after));
      const latest = kind => before.filter(s => s.value.save_kind === kind)
        .sort((a, b) => b.value.created_at.localeCompare(a.value.created_at))[0].value;
      assert.equal(latest("manual").command_index, 0); assert.equal(latest("quick").command_index, 0);
      assert.equal(latest("auto").command_index, 0);
      assert.equal(latest("auto").history.length, latest("quick").history.length + 1);
      assert.notEqual(latest("auto").history.at(-1).id, latest("quick").history.at(-1).id);
      const oldExit = runtime.cases[1].evidence;
      assert(oldExit.activityFinished); assert.equal(oldExit.confirmationClicks, 1);
      assert.equal(oldExit.forcedBeforeExit, false); assert(oldExit.elapsedMs < 15000);
      for (const [name, closed] of [["old-activity-before.txt", false], ["old-activity-after.txt", true]]) {
        const file = path.join(b.output, "runtime", name); r.sources.push(desc(file));
        assert.equal(activityState(fs.readFileSync(file, "utf8"), pkg).closed, closed);
      }
      requirePreservation(runtime.commands, runtime.cases[3].finishedAt);
      const oldExitCommands = runtime.commands.slice(0, oldExit.commandEnd + 1);
      assert(!oldExitCommands.some(c => c.args.slice(0, 3).join(" ") === "shell am force-stop"));
      const update = runtime.commands.filter(c => c.args[0] === "install" && c.args[1] === "-r");
      assert.equal(update.length, 1); assert.equal(update[0].status, 0); assert.match(update[0].stdout, /Success/);
      assert.match(runtime.cases[2].evidence.installedVersion, /versionCode=1004\b/);
      assert.match(runtime.cases[2].evidence.installedVersion, /versionName=0\.1\.4\b/);
      return { oldFiles: before.length, kinds: ["manual", "auto", "quick"],
        snapshotHistories: { quick: latest("quick").history.length, auto: latest("auto").history.length } };
    });
    check("All three old snapshots actually load, preferences persist and six starts are complete", () => {
      const initial = runtime.cases[0].evidence, loaded = runtime.cases[3].evidence;
      assert.equal(loaded.loaded.length, 3);
      assert.deepEqual(loaded.loaded.map(l => l.kind), ["manual", "auto", "quick"]);
      for (const entry of loaded.loaded) {
        verify(entry.old); const old = read(entry.old.path);
        assert.equal(entry.actual.scene, old.scene_id); assert.equal(entry.actual.command, old.command_index);
        assert.equal(entry.actual.text, initial.first.text);
      }
      assert.deepEqual(initial.pref, loaded.preferences);
      assert.deepEqual(initial.pref, runtime.cases[2].evidence.preferences);
      assert.equal(Object.keys(initial.pref).length, 1); assert.equal(Object.values(initial.pref)[0].highContrastText, true);
      const retained = loaded.retained; for (const f of retained) savedFile(f);
      for (const kind of ["retained-data", "clean-install"]) {
        assert.equal(runtime.restartTrials.filter(t => t.kind === kind).length, 3);
        for (const trial of runtime.restartTrials.filter(t => t.kind === kind)) {
          const prefix = `${kind === "retained-data" ? "retained" : "clean"}-${trial.n}-save-`;
          const files = fs.readdirSync(path.join(b.output, "runtime")).filter(n => n.startsWith(prefix));
          if (kind === "clean-install") assert.equal(files.length, 0);
          else {
            const actual = files.map(n => desc(path.join(b.output, "runtime", n))).map(f => f.sha256).sort();
            assert.deepEqual(actual, retained.map(s => s.sha256).sort());
            assert.equal(trial.route, "EXPLICIT_PROCESS_LOSS_NOT_NATURAL_EXIT");
          }
        }
      }
      return { loadedKinds: loaded.loaded.map(l => l.kind), retainedStarts: 3, cleanInstalls: 3,
        scope: "Unchanged fixture story; new title/installed version only. Not all-game progression or natural current exits." };
    });
    check("Real ADB input, immutable PNG/viewport evidence, raw scoped fatal/cache/renderer diagnostics", () => {
      const taps = runtime.commands.filter(c => c.args.slice(0, 3).join(" ") === "shell input tap");
      assert.equal(taps.length, runtime.touches.length); assert(taps.length >= 20);
      runtime.touches.forEach((t, n) => {
        assert.equal(Number(taps[n].args[3]), t.x); assert.equal(Number(taps[n].args[4]), t.y);
        assert(t.hit.x >= 0 && t.hit.y >= 0 && t.hit.x < t.hit.width && t.hit.y < t.hit.height);
      });
      assert.equal(runtime.screenshots.length, 13);
      for (const shot of runtime.screenshots) {
        verify(shot); assert.deepEqual(shot.before, shot.after);
        const bytes = fs.readFileSync(shot.path);
        let xml;
        if (shot.uiautomator) { verify(shot.uiautomator); xml = fs.readFileSync(shot.uiautomator.path, "utf8"); }
        requireNativeDisplay(shot, bytes, xml);
      }
      const log = path.join(b.output, "runtime/logcat.txt"); r.sources.push(desc(log));
      const text = fs.readFileSync(log, "utf8"), scoped = scopedRuntimeLog(text, pkg, runtime.pids);
      assert.deepEqual(scoped, runtime.logs); assert.deepEqual(scoped.fatal, []);
      r.rendererTerminationReview = rendererReview(runtime, text);
      assert.deepEqual(r.rendererTerminationReview, runtime.rendererTerminationReview);
      r.cacheWarnings = scoped.warnings;
      return { touches: taps.length, png: runtime.screenshots.length,
        xml: runtime.screenshots.filter(s => s.uiautomator).length, rendererLines: r.rendererTerminationReview.events.length,
        cacheWarnings: scoped.warnings.length, visualMatrixClaimed: false, physicalPhoneClaimed: false };
    });
    check("Independent final source preservation, staging removal, uninstall and owned emulator/ports cleanup", () => {
      assert.equal(launch.emulatorCleanupStatus, "PASS"); assert.equal(boot.emulatorCleanupStatus, "PASS");
      for (const name of ["old-staging.apk", "current-staging.apk"])
        assert(!fs.existsSync(path.join(b.output, "runtime", name)));
      for (const p of b.pair) verify(p.apk);
      const live = rows(); for (const p of boot.processes)
        assert(!live.some(l => l.ProcessId === p.ProcessId), "Owned emulator remains live");
      const ports = [q.adbPort, q.cdpPort, q.coldBoot.adbPort, q.coldBoot.grpcPort, 5554, 5555];
      assert.deepEqual(listeners(ports), []);
      return { sourceApksRetained: 2, stagingDeleted: 2, uninstall: "PASS", portsReleased: ports.length };
    });
    r.featureStatus = "PASS_LIMITED_REAL_APK_UPGRADE";
    r.status = r.rendererTerminationReview.events.length ? "BLOCKED_RENDERER_TERMINATION_REVIEW"
      : r.cacheWarnings.length ? "BLOCKED_CACHE_WARNING_REVIEW" : "PASS_LIMITED_REAL_APK_UPGRADE";
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
  r.finishedAt = new Date().toISOString();
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: r.status, featureStatus: r.featureStatus, checks: r.checks,
    error: r.error, out }, null, 2));
}
function selfTest(bindingFile) {
  const b = read(bindingFile), actual = read(path.join(b.output, "runtime/upgrade-runtime-report.json"));
  requireComplete(actual);
  const bad = [r => r.cases = [], r => r.cases.pop(), r => r.cases[0].status = "FAILED",
    r => r.restartTrials.pop(), r => r.restartTrials[0].n = 2, r => r.uninstallStatus = "NOT_RUN",
    r => r.apkCleanupStatus = "FAILED", r => r.cleanupError = "leftover"];
  for (const mutate of bad) { const r = structuredClone(actual); mutate(r); assert.throws(() => requireComplete(r)); }
  requirePreservation(actual.commands, actual.cases[3].finishedAt);
  for (const args of [["uninstall", pkg], ["shell", "pm", "clear", pkg]]) {
    const commands = structuredClone(actual.commands);
    commands.push({ at: actual.startedAt, args }); assert.throws(() => requirePreservation(commands, actual.cases[3].finishedAt));
  }
  for (const sample of actual.screenshots) requireNativeDisplay(sample, fs.readFileSync(sample.path),
    sample.uiautomator ? fs.readFileSync(sample.uiautomator.path, "utf8") : undefined);
  const shot = actual.screenshots.find(s => s.uiautomator);
  const png = fs.readFileSync(shot.path), xml = fs.readFileSync(shot.uiautomator.path, "utf8");
  requireNativeDisplay(shot, png, xml);
  for (const mutate of [s => s.before.dpr = s.after.dpr = 2,
    s => s.physical.width += 1, s => s.before.width += 1]) {
    const changed = structuredClone(shot); mutate(changed);
    assert.throws(() => requireNativeDisplay(changed, png, xml));
  }
  assert.throws(() => requireNativeDisplay(shot, png, xml.replace('bounds="[0,0][2400,1080]"', 'bounds="[1,0][2400,1080]"')
    .replace('class="android.webkit.WebView"', 'class="wrong.view"')));
  console.log(JSON.stringify({ status: "PASS", rejectedIncompleteEvidence: bad.length,
    rejectedDataDestruction: 2, rejectedDisplayEvidence: 4, rawAndroidDisplay: "PASS",
    productLaunches: 0, deviceOperations: 0 }));
}
if (require.main === module) {
  const [action, file, number] = process.argv.slice(2);
  Promise.resolve().then(() => {
    if (action === "self-test") return selfTest(file);
    assert.equal(action, "audit"); return audit(file, number);
  }).catch(e => { console.error(e); process.exitCode = 1; });
}
