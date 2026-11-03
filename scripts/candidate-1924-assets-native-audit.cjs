"use strict";
// Read-only audit of completed native input and byte evidence; no app launch.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const { validateCandidateConfig } = require("./candidate-layout-consumption.cjs");
const { deriveActual } = require("./installed-profile-data-replay.cjs");
const root = "F:/AgentVN/QA/Installed-Assets-20261021-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const args = process.argv.slice(2), configArgs = args.filter(a => a.startsWith("--candidate-config="));
assert(configArgs.length <= 1);
const config = configArgs.length ? validateCandidateConfig(read(configArgs[0].slice(19))) : null;
const attempt = config ? args[1] : "08", auditAttempt = config ? args[2] : "01";
const selfTest = args[0] === "--self-test";
if (config) {
  assert(selfTest || args[0] === "run");
  assert.match(attempt ?? "", /^\d{2}$/);
  if (selfTest) assert.deepEqual(args, ["--self-test", attempt, configArgs[0]]);
  else { assert.match(auditAttempt ?? "", /^\d{2}$/); assert.deepEqual(args, ["run", attempt, auditAttempt, configArgs[0]]); }
} else assert.deepEqual(args, [selfTest ? "--self-test" : "01"]);
const base = path.join(root, `editor-${attempt}`);
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const raw = path.join(base, "report.json"), r = read(raw);
const digest = b => crypto.createHash("sha256").update(b).digest("hex");
function business(r) {
  assert.equal(r.status, "PASS"); assert(r.finishedAt && !r.error && !r.cleanupError);
  assert.deepEqual(r.errors, []); assert.equal(r.productChanges + r.builds + r.modelRequests, 0);
  assert.equal(r.cases.length, 3); assert(r.cases.every(c => c.status === "PASS" && c.finishedAt));
  assert.equal(r.requests.length, 2); assert.equal(r.launches.length, 1);
  assert.deepEqual(r.requests.map(q => q.kind), ["CANCEL", "SELECT"]);
  for (let i = 0; i < 2; i++) {
    const q = r.requests[i], d = r.cases[i].detail, a = d.completed;
    assert.deepEqual(d.request, q); assert.equal(q.ownerPid, r.launches[0].pid);
    for (const k of ["requestId", "ownerPid", "kind", "selectedPath"]) assert.equal(a[k], q[k]);
    assert.equal(a.status, "INPUT_COMPLETED");
    assert.equal(a.interaction, "COMPUTER_USE_SKY_NATIVE_DIALOG");
    assert(Number.isInteger(a.window.id) && a.window.id > 0);
    assert.equal(a.window.app, "process:" + r.launches[0].executable.path);
    assert.equal(a.timestampMeaning, "Post-input receipt recording time");
    assert(Date.parse(q.startedAt) >= Date.parse(r.startedAt));
    assert(Date.parse(a.completedAt) >= Date.parse(q.startedAt));
    assert(Date.parse(a.completedAt) <= Date.parse(r.cases[i].finishedAt));
    assert(Date.parse(r.cases[i].finishedAt) <= Date.parse(r.finishedAt));
  }
  const before = r.before, after = r.after;
  assert.equal(before.state.assets.length, 11); assert.equal(after.state.assets.length, 11);
  const id = r.cases[2].detail.changedAsset;
  assert.equal(id, "qa_background");
  for (const k of ["id", "folders", "nodes", "edges"]) assert.deepEqual(after.state[k], before.state[k]);
  assert.deepEqual(after.state.assets.filter(a => a.asset_id !== id), before.state.assets.filter(a => a.asset_id !== id));
  assert.deepEqual(after.bytes.filter(a => a.id !== id), before.bytes.filter(a => a.id !== id));
  assert.equal(r.cases[2].detail.otherAssetsUnchanged, 10);
  const a = after.state.assets.find(a => a.asset_id === id);
  assert.equal(a.asset_type, "background"); assert.equal(a.metadata.display_name, "background保留名称");
  assert.equal(a.metadata.filename, path.basename(r.selectedFile.path));
  assert.equal(a.metadata.mime_type, "image/svg+xml");
  assert.deepEqual([a.metadata.width, a.metadata.height], [900, 600]);
  const b = Buffer.from(a.metadata.data_url.split(",")[1], "base64");
  assert.equal(digest(b), r.selectedFile.sha256);
  assert.equal(after.bytes.find(a => a.id === id).sha256, r.selectedFile.sha256);
  assert.notEqual(before.bytes.find(a => a.id === id).sha256, r.selectedFile.sha256);
  assert.equal(r.cleanups.length, 1); assert.equal(r.cleanups[0].status, "PASS");
  assert.equal(r.cleanups[0].normalCloseClaimed, false);
  assert(r.protectedUnchanged); assert.equal(r.screenshots.length, 3);
  assert(r.cache.every(c => c.code === 0));
  return { nativeInputs: 2, flows: 3, identityAndGraphPreserved: true, otherAssetsUnchanged: 10 };
}
if (selfTest) {
  business(r);
  const bad = [
    x => { x.cases = []; }, x => { x.requests.pop(); }, x => { x.launches = []; },
    x => { x.cases[1].detail.completed.ownerPid++; },
    x => { x.cases[1].detail.completed.selectedPath = "unrelated.svg"; },
    x => { x.cases[0].detail.completed.interaction = "SET_INPUT_FILES"; },
    x => { x.cases[0].detail.completed.completedAt = "2100-01-01"; },
    x => { x.after.state.nodes = []; },
    x => { x.after.state.assets.find(a => a.asset_id === "qa_background").metadata.width = 600; },
    x => { x.after.bytes.find(a => a.id === "qa_background").sha256 = "old"; },
    x => { x.after.bytes.find(a => a.id === "qa_bgm").sha256 = "corrupt"; },
    x => { x.screenshots = []; }, x => { x.cleanups[0].status = "FAILED"; },
    x => { x.modelRequests = 1; }, x => { x.cache[0].code = 1; },
  ];
  for (const mutate of bad) { const x = structuredClone(r); mutate(x); assert.throws(() => business(x)); }
  console.log(JSON.stringify({ status: "PASS", rejectedBadReports: bad.length, scope: "READ_ONLY_AUDIT" }));
} else {
  const out = path.join(root, `editor-${attempt}-audit-${auditAttempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), input: desc(raw), groups: [],
    scope: `INSTALLED_${config?.version ?? "1924"}_NATIVE_ASSET_PICKER_SUPPLEMENT_ONLY`, productChanges: 0, builds: 0, modelRequests: 0 };
  function group(name, fn) {
    const g = { name, status: "RUNNING" }; report.groups.push(g);
    try { g.detail = fn(); g.status = "PASS"; } catch (e) { g.status = "FAILED"; throw e; }
  }
  try {
    group("Three completed native-input flows, ownership and byte/identity changes", () => business(r));
    group("Frozen installation, executed snapshots, source media and native receipts", () => {
      for (const f of [r.source, r.installation, r.input, r.selectedFile, r.cacheRestoration]) assert.equal(sha(f.path), f.sha256);
      for (const snap of r.snapshots) { assert.equal(sha(snap.copy.path), snap.copy.sha256); assert.equal(snap.source.sha256, snap.copy.sha256); }
      const script = r.snapshots.find(s => s.source.path.endsWith("candidate-1924-assets-native.cjs"));
      if (config) assert.equal(sha(script.source.path), script.source.sha256);
      else assert.equal(fs.readFileSync(script.source.path, "utf8"),
          fs.readFileSync(script.copy.path, "utf8").replace('completedAt: "2026-10-25T00:00:00Z" }',
            "completedAt: new Date().toISOString() }"));
      const installed = read(r.installation.path);
      if (config) {
        const actual = deriveActual(config.actual, config.version);
        assert.deepEqual(installed.actualInstallation, config.actual);
        assert.deepEqual(installed.executable, actual.executable);
        assert.deepEqual(r.currentCandidateBinding, { actualInstallation: config.actual, version: config.version });
        assert.equal(read(r.source.path).version, config.version);
        for (const f of installed.protectedAbsent) assert(!fs.existsSync(f), f);
      } else {
        assert.equal(installed.executable.version, "1.9.24");
        assert.equal(installed.executable.sha256, "ef457f369303302d488e30d105295e9b40a0161cf79d7e996383958429e1a143");
      }
      assert.equal(r.launches[0].executable.sha256, installed.executable.sha256);
      for (const f of [installed.executable, ...installed.resources, ...installed.protectedFiles]) assert.equal(sha(f.path), f.sha256);
      const origin = read(r.source.path).fixtureMedia.find(a => a.type === "background");
      assert.equal(origin.files.new.sha256, r.selectedFile.sha256);
      assert.equal(path.extname(r.selectedFile.path), ".svg");
      for (let i = 0; i < 2; i++) {
        const q = r.requests[i], d = r.cases[i].detail;
        assert.deepEqual(read(path.join(base, `native-${q.kind.toLowerCase()}-request.json`)), q);
        assert.deepEqual(read(q.completion), d.completed); assert.equal(sha(d.receipt.path), d.receipt.sha256);
      }
      return { preservedSnapshots: r.snapshots.length, actualNativeReceipts: 2, newFileHash: r.selectedFile.sha256 };
    });
    group("Three PNG parameters, native cache identity and exact process/port cleanup", () => {
      for (const s of r.screenshots) {
        assert.equal(sha(s.path), s.sha256);
        assert.deepEqual(s.before, { width: 1920, height: 1080, dpr: 1, reduced: false });
        assert.deepEqual(s.before, s.after); const b = fs.readFileSync(s.path);
        assert.equal(b.readUInt32BE(16), 1920); assert.equal(b.readUInt32BE(20), 1080);
      }
      const l = r.launches[0];
      assert(l.dataDirectoryOverride && l.webviewDirectoryOverride && !l.sourceServer && !l.manualBackendSpawn);
      const cache = read(path.join(base, "native-cache-protection.json")), restored = read(r.cacheRestoration.path);
      assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
      assert.equal(restored.originalDirectoryId, cache.directoryId);
      assert(ps(`fsutil file queryfileid '${cache.original.replace(/'/g, "''")}'`).toLowerCase().includes(cache.directoryId.toLowerCase()));
      assert(!fs.existsSync(cache.held));
      for (const f of cache.files) assert.equal(sha(path.join(cache.original, f.relative)), f.sha256);
      const identity = p => `${p.ProcessId}:${p.Created}`;
      const owned = new Set([...r.knownProcesses.map(identity), ...r.cleanups.flatMap(c => c.killed), `${l.pid}:${l.created}`]);
      assert(owned.size >= 9);
      const active = rows(); assert(!active.some(p => owned.has(identity(p))));
      assert.deepEqual(listeners(l.ports), []);
      return { png: 3, originalCacheFiles: cache.files.length, processIdentities: owned.size, ports: l.ports };
    });
    if (!config) group("Preserved earlier fixture failure and separately corrected timestamp", () => {
      const old = path.join(root, "editor-07"), failure = read(path.join(old, "report.json"));
      assert.equal(failure.status, "FAILED"); assert.match(failure.error, /Timeout 30000ms/);
      assert.equal(path.extname(failure.selectedFile.path), ".png");
      assert.equal(sha(failure.selectedFile.path), r.selectedFile.sha256);
      assert.match(fs.readFileSync(failure.selectedFile.path, "utf8"), /^<svg /);
      assert(failure.failureText.includes("无法读取图片内容"));
      const correction = read(path.join(old, "native-cancel-time-correction.json"));
      assert.equal(sha(path.join(old, "native-cancel-completed.json")), correction.originalReceiptSha256);
      report.preservedHistory = ["report.json", "native-cancel-completed.json", "native-cancel-time-correction.json"]
        .map(f => desc(path.join(old, f)));
      return { historicalStatus: "FAILED", classification: "QA_SVG_BYTES_WITH_PNG_EXTENSION",
        receiptTimeCorrectionPreserved: true, preLaunchSelfTestFailure: "UTC_FUTURE_FIXED_AFTER_BUSINESS_EXIT",
        dependencyCommandIssue: "PowerShell semicolons continued after failed self-test; no product code change" };
    });
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString(); report.tool = desc(__filename);
    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, out, error: report.error }));
  }
}
