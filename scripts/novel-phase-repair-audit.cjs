"use strict";
// Read-only final stage audit. No product launches, models, or data mutation.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const base = "F:/AgentVN/QA/Novel-Phase-Repair-20261020-01";
const partial = "F:/AgentVN/QA/Native-Novel-Partial-20261020-01";
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const load = f => JSON.parse(fs.readFileSync(f, "utf8"));
async function main() {
  const name = process.argv[2]; assert(/^closeout-\d{2}$/.test(name));
  const out = path.join(base, name); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const files = {
    gates: path.join(base, "gates-01/report.json"),
    behavior: path.join(partial, "session-06/report.json"),
    behaviorAudit: path.join(partial, "audit-04/receipt.json"),
    matrix: path.join(base, "matrix-02/report.json"),
    originalRepro: path.join(partial, "phase-03/report.json"),
  };
  const r = { at: new Date().toISOString(), status: "RUNNING", evidence: Object.fromEntries(
    Object.entries(files).map(([key, file]) => [key, { path: file, sha256: sha(file) }])) };
  try {
    const g = load(files.gates), b = load(files.behavior), a = load(files.behaviorAudit);
    const m = load(files.matrix), p = load(files.originalRepro);
    assert.equal(g.status, "NOVEL_PHASE_GATES_AND_ACTUAL_DEV_COPY_PASS");
    assert.equal(g.steps.length, 9); assert(g.steps.every(s => s.status === "PASS" && s.code === 0));
    for (const s of g.steps) assert.equal(sha(s.log.path), s.log.sha256);
    assert.equal(sha(g.dev.path), g.dev.sha256); assert.equal(sha(g.built.path), g.dev.sha256);
    assert(Date.parse(g.dev.modifiedAt) >= Date.parse(g.steps.find(s => s.label === "dev-build").startedAt));
    assert.equal(b.status, "CURRENT_NATIVE_NOVEL_PARTIAL_PASS");
    assert.equal(b.verifyGraphPhases, true); assert.equal(b.phaseFacts.length, 7);
    assert.equal(a.status, "CURRENT_NATIVE_NOVEL_PARTIAL_EVIDENCE_VERIFIED");
    assert.equal(a.report.sha256, sha(files.behavior)); assert.equal(a.invalidVariantsRejected, 29);
    assert.equal(m.status, "NOVEL_PHASE_NATIVE_DISPLAY_MATRIX_PASS");
    assert.equal(m.matrix.length, 24); assert.equal(m.modelRequests, 0); assert.deepEqual(m.errors, []);
    const keys = new Set();
    for (const sample of m.matrix) {
      const v = sample.viewport;
      keys.add([sample.project, v.width, v.height, v.dpr, v.reduced].join(":"));
      assert.equal(sample.status, "PASS"); assert.equal(sample.rows.length, 2);
      assert([1920, 2560, 3840].includes(v.width)); assert([1, 2].includes(v.dpr));
      assert.equal(sample.metrics.width, v.width); assert.equal(sample.metrics.height, v.height);
      assert(Math.abs(sample.metrics.dpr - v.dpr) <= 1e-6); assert.equal(sample.metrics.reduced, v.reduced);
      for (const row of sample.rows) {
        assert(row.visible && row.hit && !row.horizontalOverflow);
        assert(["completed", "cancelled"].includes(row.status));
        assert.equal(row.percent, row.status === "completed" ? 100 : 0);
      }
      assert(sample.controls.length >= 2 && sample.controls.every(c => c.visible && c.hit));
    }
    assert.equal(keys.size, 24);
    assert.equal(m.screenshots.length, 3);
    for (const s of m.screenshots) {
      const bytes = fs.readFileSync(s.path);
      assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
      assert.equal(bytes.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(bytes.readUInt32BE(20), s.before.height * s.before.dpr);
    }
    assert.equal(p.status, "CURRENT_NATIVE_PHASE_STATUS_PASS");
    assert.deepEqual(p.falsePhases, []); assert.equal(p.actualImportedNodes, 0); assert.equal(p.modelRequests, 0);
    assert.equal(load(path.join(partial, "phase-01/report.json")).status, "REPRODUCED_PRODUCT_PHASE_STATUS_FAILURE");
    assert.equal(load(path.join(partial, "session-03/report.json")).status, "FAILED");
    for (const report of [b, m]) {
      for (const f of [...(report.sources ?? []), ...(report.products ?? [])]) assert.equal(sha(f.path), f.sha256);
      const binary = report.products.find(f => /AgentVN Dev\.exe$/.test(f.path));
      assert.equal(binary.sha256, g.dev.sha256);
    }
    const live = rows(), ports = [...new Set([b, m, p].flatMap(x => x.launches.flatMap(l => l.ports)))];
    let identities = 0;
    for (const report of [b, m, p]) {
      assert(report.cleanups.length > 0); assert(!report.cleanupError);
      for (const c of report.cleanups) {
        assert.equal(c.normalExitClaimed, false);
        assert.equal(c.survivors.length, 0); assert.equal(c.listeners.length, 0);
      }
      for (const known of report.known) {
        assert(!live.some(v => v.ProcessId === known.ProcessId && v.Created === known.Created));
        identities++;
      }
    }
    assert.equal(listeners(ports).length, 0);
    r.processIdentitiesAbsent = identities; r.portsAbsent = ports;
    r.dev = g.dev; r.player = g.player; r.realModelRequests = 0;
    r.status = "NOVEL_PHASE_REPAIR_CURRENT_DEV_EVIDENCE_VERIFIED";
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    r.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify(r, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: r.status, out, error: r.error, dev: r.dev }));
  }
}
main().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
