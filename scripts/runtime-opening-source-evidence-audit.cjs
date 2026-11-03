"use strict";
// Independent audit of unchanged-product behavior evidence. Original failed
// reports remain failed; replacement covers only the two interrupted flows.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, ".."), attempt = process.argv[2];
assert.equal(attempt, "01");
const base = "F:/AgentVN/QA/Runtime-Opening-Time-20261024-01";
const out = path.join(base, `source-evidence-audit-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const sha = f => createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
const describe = file => ({ path: file, sha256: sha(file) });
const report = { status: "RUNNING", scope: "HARDWARE_SOURCE_RUNTIME_30_PLUS_2_NOT_INSTALLED_OR_SOFTWARE_CERTIFICATION",
  cases: [], modelRequests: 0 };
try {
  const basisFile = path.join(base, "support-02/report.json"), basis = read(basisFile);
  assert.equal(basis.status, "FAILED"); assert.equal(basis.commands.length, 3);
  assert(basis.commands.slice(0, 2).every(c => c.status === "PASS" && c.exitCode === 0));
  assert.equal(basis.commands[2].exitCode, 1);
  const fullFile = "F:/AgentVN/QA/Runtime-Opening-20261023-01/matrix-06/report.json";
  const followupFile = "F:/AgentVN/QA/Runtime-Opening-20261023-01/matrix-07/report.json";
  const full = read(fullFile), followup = read(followupFile);
  assert.equal(full.status, "FAILED"); assert.equal(full.mode, "FULL_MATRIX");
  assert.equal(full.cases.length, 32); assert(full.cases.every(c => c.contextClosed));
  const excluded = full.cases.filter(c => c.status !== "PASS");
  assert.equal(excluded.length, 2);
  for (const row of excluded) {
    assert.equal(row.interrupt, true);
    assert.match(row.error, /Abandoned opening must not finish the new boot/);
    assert.equal(row.events.filter(e => e.event === "ended").length, 0);
    assert(row.events.some(e => e.event === "loadeddata"));
  }
  assert.equal(followup.status, "PASS"); assert.equal(followup.mode, "INTERRUPTION_FOLLOWUP");
  assert.equal(followup.cases.length, 2);
  assert(followup.cases.every(c => c.interrupt && c.status === "PASS" && c.contextClosed));
  for (const value of [full, followup]) {
    assert.equal(value.renderer.features.gpu_compositing, "enabled");
    assert(/Direct3D11/.test(value.renderer.renderer) && !/SwiftShader/.test(value.renderer.renderer));
    assert.equal(value.browserClosed, true); assert.equal(value.serverStopped, true); assert(!value.cleanupError);
    for (const source of value.sources) assert.equal(sha(path.join(root, source.file)), source.sha256);
  }
  assert.deepEqual(full.sources, followup.sources, "Same product bytes for all thirty-two accepted flows");
  const observerFile = path.join(base, "presented-selftest-04/report.json"), observer = read(observerFile);
  assert.equal(observer.status, "PASS"); assert.equal(observer.cases.length, 4);
  for (const file of observer.sources) assert.equal(sha(file.path), file.sha256);
  for (const row of observer.cases) {
    assert.equal(row.status, "PASS"); assert.equal(row.acceptedContinuous, row.duration === 180);
  }
  const componentFile = path.join(base, "green-02/report.json"), component = read(componentFile);
  assert.equal(component.status, "PASS"); assert.equal(component.cases.length, 4);
  assert.equal(sha(component.source.path), component.source.sha256);
  assert(component.cases.every(c => c.status === "PASS" && c.contextClosed));
  const accepted = [...full.cases.filter(c => c.status === "PASS"), ...followup.cases];
  assert.equal(accepted.length, 32);
  const video = accepted.filter(c => c.kind === "video" && !c.interrupt);
  assert.equal(video.length, 24);
  assert.equal(new Set(video.map(c => [c.width, c.height, c.dpr, c.reduced, c.layout].join(":"))).size, 24);
  for (const row of accepted) {
    assert.equal(row.status, "PASS");
    if (row.kind !== "broken") assert.equal(row.storyBlackoutPreserved, true);
    if (!["broken", "default"].includes(row.kind)) {
      assert.equal(row.geometry.dpr, row.dpr);
      assert.equal(row.geometry.width, row.width); assert.equal(row.geometry.height, row.height);
      assert(row.geometry.overflow <= 1);
      const entry = row.frames.filter(f => f.opening && f.mediaOpacity > .02 && f.mediaOpacity < .98);
      const exit = row.frames.filter(f => f.opening && f.opacity > .02 && f.opacity < .98);
      assert(entry.length >= 2); if (!row.interrupt) assert(exit.length >= 2);
      const clocks = row.frames.flatMap(f => [...(f.mediaAnimations || []), ...(f.stageAnimations || [])]);
      assert(clocks.length > 0 && clocks.every(c => c.timing.duration === (row.reduced ? 180 : 420)));
      report.cases.push({ width: row.width, height: row.height, dpr: row.dpr, reduced: row.reduced,
        kind: row.kind, layout: row.layout, interrupt: !!row.interrupt,
        entryFrames: entry.length, exitFrames: exit.length, status: "PASS" });
    } else report.cases.push({ kind: row.kind, reduced: row.reduced, status: "PASS" });
  }
  for (const value of [full, followup]) for (const screenshot of value.screenshots) {
    assert.equal(sha(screenshot.path), screenshot.sha256);
    const png = fs.readFileSync(screenshot.path), v = screenshot.viewport;
    assert.equal(png.readUInt32BE(16), v.width * v.dpr);
    assert.equal(png.readUInt32BE(20), v.height * v.dpr);
  }
  report.sources = full.sources;
  report.evidence = [basisFile, fullFile, followupFile, observerFile, componentFile].map(describe);
  report.excluded = excluded.map(c => ({ reduced: c.reduced, error: c.error,
    reason: "New readiness diagnostics mixed with ended-only assertion; original failed report retained" }));
  report.status = "PASS";
} catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
report.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: report.status, out, cases: report.cases.length, error: report.error }));
