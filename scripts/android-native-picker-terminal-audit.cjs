"use strict";
// Read-only audit of a terminal native-input timeout; never relaunches a build.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { ps, rows, listeners } = require("./lib/current-native-editor-session.cjs");
const qa = "F:/AgentVN/QA/Android-Package-20261021-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
function validate(r, admin, task) {
  assert.equal(r.status, "FAILED"); assert(r.finishedAt);
  assert.match(r.error, /Native android-output-select input not completed before its deadline/);
  assert.equal(r.cleanupError, undefined); assert.equal(r.protectedUnchanged, true);
  assert.equal(r.builds, 0); assert.equal(r.modelRequests, 0); assert.equal(r.productChanges, 0);
  assert.equal(r.androidDeviceStatus, "NOT_RUN"); assert.equal(r.version, "1.9.22");
  assert.equal(r.steps.length, 3);
  assert.deepEqual(r.steps.map(s => s.status), ["PASS", "PASS", "FAILED"]);
  assert.equal(r.normalClose, undefined); assert.equal(r.artifacts, undefined);
  assert(r.cleanups.length === 1 && r.cleanups[0].status === "PASS");
  assert.equal(r.cleanups[0].normalCloseClaimed, false);
  assert.equal(admin.isElevated, true); assert.equal(admin.exitCode, 1);
  assert(admin.finishedAt && admin.probe.success && admin.probe.isElevated);
  assert.equal(admin.policyRestoration, "PASS"); assert.equal(admin.physicalProtectionRestoration, "PASS");
  assert.equal(task.status, "TERMINAL"); assert.equal(task.cleanup, "PASS"); assert(task.finishedAt);
}
async function main() {
  const attempt = process.argv[2], audit = process.argv[3];
  assert.match(attempt, /^\d{2}$/); assert.match(audit, /^\d{2}$/);
  const out = path.join(qa, `picker-terminal-${attempt}-${audit}`); fs.mkdirSync(out);
  fs.copyFileSync(__filename, path.join(out, "executed.cjs"), fs.constants.COPYFILE_EXCL);
  const editor = path.join(qa, "editor-" + attempt), administrator = path.join(qa, "administrator-" + attempt);
  const result = { status: "RUNNING", scope: "NATIVE_PICKER_TIMEOUT_TERMINAL_CLEANUP_NOT_APK_PASS",
    checkedAt: new Date().toISOString(), sources: [], checks: [], mutations: 0,
    productResult: "NOT_TESTED_APK_NOT_BUILT", nextRequires: "NATIVE_DIRECTORY_INPUT" };
  const load = f => { result.sources.push({ path: f, sha256: sha(f) }); return read(f); };
  const check = (name, fn) => {
    const c = { name, status: "RUNNING" }; result.checks.push(c);
    try { c.evidence = fn(); c.status = "PASS"; }
    catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); }
  };
  try {
    const r = load(path.join(editor, "report.json")), admin = load(path.join(administrator, "result.json"));
    const origin = load(path.join(administrator, "origin.json")), task = load(path.join(administrator, "task-engine.json"));
    check("Exact timeout remains failed; false completion and cleanup claims rejected", () => {
      validate(r, admin, task);
      const bad = [
        x => { x.status = "PASS"; }, x => { x.builds = 1; },
        x => { x.steps[2].status = "PASS"; }, x => { x.protectedUnchanged = false; },
        x => { x.cleanups[0].normalCloseClaimed = true; }, x => { x.cleanupError = "not restored"; },
      ];
      for (const mutate of bad) { const copy = structuredClone(r); mutate(copy); assert.throws(() => validate(copy, admin, task)); }
      const badAdmin = structuredClone(admin); badAdmin.policyRestoration = "FAILED";
      assert.throws(() => validate(r, badAdmin, task));
      const badTask = structuredClone(task); badTask.cleanup = "FAILED";
      assert.throws(() => validate(r, admin, badTask)); result.mutations = bad.length + 2;
      assert.equal(origin.originIsElevated, false); assert.equal(origin.userSid, admin.userSid);
      assert.equal(origin.originProcessId, admin.originProcessId);
      return { feature: "BLOCKED_NATIVE_INPUT", apkBuilds: r.builds, normalClose: false, finishedAt: r.finishedAt };
    });
    check("Owned processes and ports absent now; task and temporary policy restored", () => {
      const live = rows(), owned = r.knownProcesses.concat(r.buildKnownProcesses || []);
      assert(!owned.some(p => live.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created)));
      for (const [pid, created] of [[admin.processId, admin.created], [admin.nodeProcessId, admin.nodeCreated],
        [task.processId, null]]) {
        assert(!live.some(p => p.ProcessId === pid && (!created || p.Created === created)));
      }
      const ports = r.launches.flatMap(l => l.ports); assert.deepEqual(listeners(ports), []);
      assert.equal(task.taskName, `AgentVN-QA-Android-Build-20261021-${attempt}`);
      const state = JSON.parse(ps("$ErrorActionPreference='Stop';" +
        "$p=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine," +
        "[Microsoft.Win32.RegistryView]::Registry64);" +
        "$k=$p.OpenSubKey('SOFTWARE\\Policies\\Microsoft\\Edge\\WebView2\\AdditionalBrowserArguments');" +
        "$v=if($k){$k.GetValue('agentvn-editor.exe',$null)}else{$null};" +
        `$t=Get-ScheduledTask -TaskName '${task.taskName}' -ErrorAction SilentlyContinue;` +
        "@{policyValue=$v;taskExists=($null -ne $t)}|ConvertTo-Json -Compress"));
      const policy = load(path.join(administrator, "webview-policy.json"));
      assert.equal(policy.existed, false); assert.equal(state.policyValue, null); assert.equal(state.taskExists, false);
      assert(!fs.existsSync(admin.probe.probeRoot));
      const restored = load(path.join(administrator, "webview-policy-restoration.json"));
      assert.equal(restored.status, "PASS"); assert.equal(restored.originalValueRestored, true);
      return { identities: owned.length, ports, state };
    });
    check("Original caches, protected products and source artifacts retain exact bytes", () => {
      const differences = result.currentByteDifferences = [];
      const exact = (file, expected, category) => {
        const actual = fs.existsSync(file) ? sha(file) : null;
        if (actual !== expected) differences.push({ path: file, category, expected, actual,
          lastModifiedAt: actual ? fs.statSync(file).mtime.toISOString() : null });
      };
      const caches = load(path.join(editor, "cache-protection.json"));
      const restored = load(path.join(editor, "cache-restoration.json"));
      assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
      assert.equal(restored.rows.length, 4);
      result.currentCachePaths = [];
      for (const row of caches.rows) {
        const observation = { path: row.original, expectedExists: row.existed, exists: fs.existsSync(row.original),
          heldExists: fs.existsSync(row.held), ownedExists: fs.existsSync(row.owned) };
        observation.symbolicLink = observation.exists ? fs.lstatSync(row.original).isSymbolicLink() : false;
        result.currentCachePaths.push(observation);
        if (observation.heldExists || observation.ownedExists || observation.symbolicLink
          || observation.exists !== row.existed) differences.push({ category: "current-cache-path", ...observation });
        for (const f of row.files) exact(path.join(row.original, f.relative), f.sha256, "current-cache");
      }
      for (const f of [...r.protectedFiles, ...origin.tools, r.installation, r.input, r.cartridge])
        exact(f.path, f.sha256, "protected-product-tool-or-input");
      assert.deepEqual(fs.readdirSync(path.join(editor, "Android 输出")), []);
      assert(!fs.existsSync(path.join(editor, "android-output-select-completed.json")));
      assert.deepEqual(differences, [], "Current bytes differ; original restoration receipt is historical evidence only");
      return { caches: 4, protectedFiles: r.protectedFiles.length, deletedUserFiles: 0, outputApks: 0 };
    });
    check("Real WebView screenshots have matching parameters and PNG dimensions", () => {
      assert.equal(r.screenshots.length, 3);
      for (const s of r.screenshots) {
        assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
        assert.equal(s.before.width, 1920); assert.equal(s.before.height, 1080);
        assert(Math.abs(s.before.dpr - 1) < 1e-6); assert.equal(s.before.reduced, false);
        const b = fs.readFileSync(s.path); assert.equal(b.subarray(1, 4).toString(), "PNG");
        assert.equal(b.readUInt32BE(16), 1920); assert.equal(b.readUInt32BE(20), 1080);
      }
      return { screenshots: 3, scope: "1080p_DPR1_normal_only" };
    });
    result.status = result.checks.every(c => c.status === "PASS")
      ? "CLEANUP_AUDIT_PASS_FEATURE_BLOCKED_NATIVE_INPUT" : "FAILED";
    if (result.status === "FAILED") process.exitCode = 1;
  } catch (e) { result.status = "FAILED"; result.error = String(e.stack || e); process.exitCode = 1; }
  for (const f of result.sources) assert.equal(sha(f.path), f.sha256);
  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(result, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: result.status, out, checks: result.checks, error: result.error }, null, 2));
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { validate };
