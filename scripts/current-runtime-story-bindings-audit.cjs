"use strict";
// Verify the executed QA adaptations, including active-vs-retained save grids.
// This inspects evidence only and never launches or changes the product.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const closure = require("./current-runtime-story-closure.cjs");
const session = require("./current-runtime-story-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const qa = "F:/AgentVN/QA/Runtime-Story-1.9.35-20261101-01";
const root = "F:/AgentVN/QA/Native-Runtime-State-20261101-01/installed-story-1935-03";
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const describe = file => ({ path: path.resolve(file), sha256: sha(file) });
const checked = file => { assert.equal(sha(file.path), file.sha256, file.path); return file; };
const out = qa + "/bindings-audit-03-01.json";
assert(!fs.existsSync(out), "Never overwrite evidence");
const report = { status: "RUNNING", startedAt: new Date().toISOString(), groups: [],
  productChanges: 0, builds: 0, modelRequests: 0 };
function group(name, fn) {
  const row = { name, status: "RUNNING" }; report.groups.push(row);
  try { row.detail = fn(); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); throw error; }
}
function binding(folder, adapter, mode) {
  const file = qa + "/" + folder + "/binding.json", b = read(file);
  for (const item of [b.original, b.executed, b.adapter, ...(b.baseAdapter ? [b.baseAdapter] : [])])
    checked(item);
  assert.equal(sha(qa + "/" + folder + "/frozen-adapter.cjs"), b.adapter.sha256);
  const source = fs.readFileSync(b.original.path, "utf8"), rebuilt = adapter.adapt(mode, source);
  assert.equal(fs.readFileSync(b.executed.path, "utf8"), rebuilt.source);
  assert.deepEqual(b.edits, rebuilt.edits);
  let reversed = rebuilt.source;
  for (const edit of [...rebuilt.edits].reverse())
    reversed = reversed.replaceAll(edit.after, () => edit.before);
  assert.equal(reversed, source);
  return { ...describe(file), mode, edits: b.edits.length };
}
try {
  const r = read(root + "/session.json");
  group("Frozen candidate and complete business audit", () => {
    const installed = closure.descriptor();
    assert.deepEqual(read(qa + "/derived-actual-installation.json"), installed);
    const a = read(root + "-audit-01/report.json");
    assert.equal(r.status, "PASS"); assert.equal(a.status, "PASS");
    assert.equal(a.businessStatus, "PASS"); assert.equal(a.groups.length, 5);
    assert(a.groups.every(g => g.status === "PASS"));
    assert.equal(r.cells.length, 12); assert(r.cells.every(c => c.status === "PASS"));
    checked(r.executable); checked(r.originalExport); checked(r.crossLayout);
    return { session: describe(root + "/session.json"), semanticAudit: describe(root + "-audit-01/report.json"),
      actual: checked(installed.actualInstallation) };
  });
  group("Original assertions and deterministic executed source bindings", () => {
    const bindings = [binding("export-preparation-05", closure, "export"),
      binding("continued-session-03", session, "session")];
    for (const name of [...r.cells.map(c => c.name), "cross-layout"])
      bindings.push(binding("continued-player-03-" + name, session, "player"));
    bindings.push(binding("continued-audit-03", session, "audit"));
    assert.equal(bindings.length, 16);
    return { bindings, productSourceChanged: false };
  });
  group("Six functional slots and presentation-only copies across all displays", () => {
    const files = [...r.cells.map(c => c.report), r.crossLayout];
    let samples = 0, retained = 0, duplicatesObserved = 0;
    for (const item of files) {
      checked(item); const f = read(item.path);
      assert.equal(f.status, "PASS"); assert(f.saveGridOwnership?.length > 0);
      for (const s of f.saveGridOwnership) {
        assert.equal(s.grids, 1); assert.equal(s.activeInert, false); assert.equal(s.activeSlots, 6);
        assert.match(s.owner, /^(manual|quick):[01]$/); samples++;
        for (const copy of s.retained) {
          assert.equal(copy.inert, true); assert.equal(copy.hidden, "true");
          assert.equal(copy.pointerEvents, "none"); assert.equal(copy.functionalMarkers, 0);
          assert.equal(copy.focusable, 0); retained++;
        }
        if (s.allOccupied > s.activeOccupied) duplicatesObserved++;
      }
      assert(f.saveGridOwnership.some(s => s.owner === "quick:0" && s.activeOccupied === 6));
    }
    assert(retained > 0 && duplicatesObserved > 0,
      "Actual retained copies must demonstrate why global class counts aren't the functional oracle");
    return { samples, retainedSnapshots: retained, actualGlobalOvercounts: duplicatesObserved,
      expectedFunctionalSlots: 6 };
  });
  group("Failed historical attempts retained without relabeling", () => {
    const files = ["01", "02"].map(n => root.replace(/03$/, n) + "/session.json");
    for (const file of files) { assert.equal(read(file).status, "FAILED"); }
    const failed = qa + "/continued-session-02";
    const b = read(failed + "/binding.json");
    checked(b.original); checked(b.executed);
    assert.equal(sha(failed + "/frozen-adapter.cjs"), b.adapter.sha256);
    return { priorSessions: files.map(describe), previousAdapter: describe(failed + "/frozen-adapter.cjs") };
  });
  report.status = "PASS";
} catch (error) {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString(); report.tool = describe(__filename);
  fs.writeFileSync(out, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, groups: report.groups.map(g => ({
    name: g.name, status: g.status })), error: report.error, out }));
}
