"use strict";
// Read-only evidence checks for the two scoped runs and the pending-write test.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const { validateExitReport } = require("./native-runtime-exit-audit.cjs");
const qa = "F:/AgentVN/QA/Exit-1.9.35-20261102-01";
const follow = qa.replace(/-01$/, "-02");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
function file(f) {
  assert.equal(sha(f.path), f.sha256, f.path);
  if (f.bytes !== undefined) assert.equal(fs.statSync(f.path).size, f.bytes);
}
function capture(s) {
  file(s); assert.deepEqual(s.before, s.after);
  const png = fs.readFileSync(s.path);
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), s.png.width);
  assert.equal(png.readUInt32BE(20), s.png.height);
  assert.equal(s.png.width, Math.round(s.before.width * s.before.dpr));
  assert.equal(s.png.height, Math.round(s.before.height * s.before.dpr));
}
function restoration(f) {
  file(f); const r = read(f.path); assert.equal(r.status, "PASS"); assert.equal(r.deletedUserFiles, 0);
  assert(r.restored.length >= 2);
  for (const p of r.restored) for (const entry of p.files) {
    const target = path.join(p.original, entry.relative);
    assert.equal(sha(target), entry.sha256); assert.equal(fs.statSync(target).size, entry.bytes);
  }
}
function main() {
  const reportFile = qa + "/evidence.json"; assert(!fs.existsSync(reportFile));
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), checks: [],
    scope: "EXIT_SAVE_EVIDENCE_NOT_COMPLETE_PRODUCT_ACCEPTANCE",
    productChanges: 0, builds: 0, modelRequests: 0, productStarts: 0 };
  function check(name, fn) {
    const row = { name, status: "RUNNING" }; report.checks.push(row);
    try { row.detail = fn(); row.status = "PASS"; }
    catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  }
  try {
    const installed = descriptor();
    const sessions = [qa, follow].map(root => {
      const session = read(root + "/session.json");
      file(session.raw); return { root, session, raw: read(session.raw.path) };
    });
    check("Frozen installation, original failed attempt and adapted source provenance", () => {
      assert.equal(sessions[0].session.status, "FAILED"); assert.equal(sessions[0].raw.status, "FAILED");
      assert.equal(sessions[1].session.status, "PASS");
      for (const { root, session, raw } of sessions) {
        assert(session.finishedAt && session.cleanupVerified && !session.cleanupError && !session.observerError);
        assert.deepEqual(session.products, [installed.executable, ...installed.resources]);
        for (const f of session.products) file(f);
        assert.equal(sha(root + "/frozen-adapter.cjs"), session.source.sha256);
        for (const binding of session.bindings) {
          file(binding.original); file(binding.executed);
          assert.equal(sha(root + "/frozen-adapter.cjs"), binding.adapter.sha256);
        }
        for (const input of raw.sources) file(input);
        assert.equal(raw.productChanges, 0); assert.equal(raw.modelRequests, 0); assert.equal(raw.builds, 0);
      }
      return { originalStatus: "FAILED_QA_PATH_CANONICALIZATION", followupStatus: "PASS" };
    });
    check("Eight distinct completed cases, thirty assertions, twenty-four modal combinations and real WM_CLOSE", () => {
      file(sessions[1].session.combinedCoverage);
      const r = read(sessions[1].session.combinedCoverage.path); validateExitReport(r, false);
      assert.equal(r.provenance.method, "COMBINED_DISTINCT_COMPLETED_CASES_NOT_A_SINGLE_RUN");
      file(r.provenance.previous);
      const normal = r.cases.filter(c => ["auto_on", "auto_off"].includes(c.kind));
      assert.equal(normal.length, 4);
      for (const c of normal) {
        file(c.nativeClose.sent); file(c.nativeClose.request);
        const sent = read(c.nativeClose.sent.path), request = read(c.nativeClose.request.path);
        assert(sent.accepted && sent.handle); assert.equal(sent.ownerPid, request.ownerPid);
        assert.equal(sent.created, request.created); assert.equal(sent.executable, request.executable);
        assert.equal(c.nativeClose.method, "WM_CLOSE_NOT_PHYSICAL_ALT_F4");
      }
      for (const a of r.acls) { file(a); assert.deepEqual(read(a.path), a.data); }
      for (const retained of r.retained) {
        assert.equal(sha(retained.retained), retained.sha256);
        const saved = read(retained.retained); assert.equal(saved.install_id, retained.installId);
      }
      return { cases: r.cases.length, checks: r.checks.length, modalMatrix: r.matrix.length,
        aclReceipts: r.acls.length, wmCloseCases: normal.length };
    });
    const pendingFile = qa + "/pending-02/report.json", pending = read(pendingFile);
    check("Autosave-disabled existing manual/quick write waits, then real native exit and new-process recovery", () => {
      assert.equal(pending.status, "PASS"); assert(pending.cleanupVerified && !pending.cleanupError);
      assert.equal(pending.cases.length, 3); assert.equal(pending.launches.length, 6);
      assert.deepEqual(pending.pageErrors, []);
      assert.equal(pending.controlledBoundary,
        "Real write_save is called unchanged; only its fulfilled promise delivery is held. Not physical disk latency.");
      file(pending.tool); file(pending.runtime); file(pending.runtimeOriginal);
      assert.deepEqual(pending.products, [installed.executable, ...installed.resources]);
      for (const c of pending.cases) {
        assert.equal(c.status, "PASS"); assert.equal(c.held.calls, 1);
        assert(c.held.received && !c.held.released && !c.held.delivered);
        assert.deepEqual(c.beforeExit, c.afterExit); assert.equal(c.beforeExit.length, 1);
        file(c.retained); assert.equal(c.retained.sha256, c.beforeExit[0].sha256);
        assert.equal(c.reopened.length, 1); assert.equal(c.reopened[0].save_kind, c.kind);
        const launches = pending.launches.filter(l => l.installId === c.installId);
        assert.equal(launches.length, 2); assert.notEqual(launches[0].pid, launches[1].pid);
        assert.equal(launches[0].cleanup.method, "REAL_UI_CONFIRMED_NATIVE_DESTROY");
        file(c.closeSent);
      }
      return { cases: 3, scope: pending.controlledBoundary };
    });
    check("Screenshot bytes/actual viewport, protected profile restoration and absent owned ports/processes", () => {
      let screenshots = 0;
      for (const { session, raw } of sessions) {
        restoration(session.restoration);
        for (const s of raw.screenshots) { capture(s); screenshots++; }
        assert.deepEqual(listeners(session.absentPorts), []);
      }
      restoration(pending.restoration);
      for (const s of pending.screenshots) { capture(s); screenshots++; }
      assert.deepEqual(listeners(pending.launches.map(l => l.port)), []);
      assert(!rows().some(p => p.Name === "agentvn-player.exe" ||
        p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes("exit-installed-1935-")));
      return { screenshots, deletedUserFiles: 0 };
    });
    report.inputs = [...sessions.map(s => desc(s.root + "/session.json")), desc(pendingFile),
      desc(sessions[1].session.combinedCoverage.path)];
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, checks: report.checks.map(c => ({ name: c.name, status: c.status })),
    report: reportFile, error: report.error }));
}
if (require.main === module) main();
