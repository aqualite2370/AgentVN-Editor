"use strict";
// Read-only product/evidence audit. No host or provider requests.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { qa, summary } = require("./native-assistant-interaction.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, "..");
const load = f => JSON.parse(fs.readFileSync(f, "utf8"));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const expected = [];
for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]])
  for (const dpr of [1, 2]) for (const reduced of [false, true]) expected.push({ width, height, dpr, reduced });
function matrix(items) {
  assert.deepEqual(items.map(({ width, height, dpr, reduced }) => ({ width, height, dpr, reduced })), expected);
}
function validate(r, baseline) {
  assert.equal(r.status, baseline ? "PRODUCT_BEHAVIOR_FAILED" : "CURRENT_NATIVE_INTERACTION_PASS");
  assert(r.finishedAt); assert.equal(r.realModelRequests, 0);
  assert.equal(r.productChanges, 0); assert.equal(r.devPublicationBuilds, 0);
  assert.deepEqual(r.errors, []); assert.equal(r.credentialCleanup, "CLEARED_TEST_ONLY_SECRET");
  for (const k of ["cleanupError", "credentialCleanupError", "immutabilityError", "error"]) assert(!r[k]);
  assert.equal(r.cases.length, 5);
  assert.deepEqual(r.cases.map(c => c.status), baseline
    ? ["PASS", "FAILED", "PASS", "PASS", "FAILED"] : ["PASS", "PASS", "PASS", "PASS", "PASS"]);
  assert(r.cases.every(c => c.finishedAt >= c.startedAt));
  matrix(r.inlineMatrix); matrix(r.focusMatrix);
  for (const c of r.inlineMatrix) {
    assert.equal(c.status, baseline && c.width === 1920 ? "FAILED" : "PASS");
    const g = c.geometry; assert(g); assert.equal(g.parentChildren, 5); assert(g.overflow <= 1);
    if (!baseline) {
      assert(g.headerHit && g.header.top >= g.rect.top - 1 && g.header.bottom <= g.rect.bottom + 1);
      assert(g.bodyGap >= -1 && g.bodyGap < 32); assert(g.trackHeight <= g.rect.height + 1);
      assert(g.input.bottom <= c.height + 1); assert(c.detailsOpened && c.detailsClosed);
    }
  }
  for (const c of r.focusMatrix) {
    assert.equal(c.status, "PASS"); assert(c.open.inside && c.open.meaningful);
    const frames = c.entry.frames.filter(f => f.exists && !f.inert);
    assert(frames.length && frames.every(f => f.activeInside));
    assert(frames.some(f => f.opacity > 0 && f.opacity < .995));
    assert(c.closing.meaningful && !c.closing.inside);
    assert(c.exit.frames.filter(f => f.exists && f.closing === "true").every(f => f.inert && !f.activeInside));
  }
  if (baseline) {
    const r0 = r.reopenObservation; assert.equal(r0.exists, false);
    assert.equal(r0.afterClose.closing, "true"); assert.equal(r0.afterOpen.closing, "true");
    const gap = r0.afterOpen.t - r0.afterClose.t; assert(gap > 0 && gap < 150);
  } else {
    matrix(r.reopenMatrix);
    for (const c of r.reopenMatrix) {
      assert.equal(c.status, "PASS"); assert(c.exists && c.focus.inside && c.sameWindow);
      assert.equal(c.afterClose.closing, "true"); assert.equal(c.afterOpen.closing, "false");
      assert(c.probe.frames.some(f => f.exists && f.closing === "true" && f.opacity > 0 && f.opacity < .995));
      assert(c.probe.frames.every(f => f.exists), "Old close must not unmount the latest open");
      assert(c.reversal.continuous && c.reversal.intermediate && c.reversal.uniqueOwner);
      const activation = c.probe.events.find(e => e.type === "click" && e.label === "在独立窗口打开创造工作台");
      assert(activation && c.probe.events.some(e => e.type === "keydown" && e.key === "Enter" &&
        e.label === "在独立窗口打开创造工作台"));
      const commit = c.probe.commits.find(v => v.closing === "false" && v.t >= activation.t);
      assert.deepEqual(c.reversal.openCommit, commit);
      const transition = commit.transitions.find(t => t.property === "opacity");
      const start = Number(transition.keyframes[0].opacity);
      assert.equal(c.reversal.startOpacity, start);
      assert(start > 0 && start <= activation.opacity + .025 && Math.abs(commit.opacity - start) < .025);
      const forward = c.probe.frames.filter(f => f.t >= commit.t && f.closing === "false");
      assert(forward.some(f => f.opacity > 0 && f.opacity < .995));
      assert(forward.every(f => f.opacity >= start - .025));
      assert(c.probe.frames.every(f => f.count === 1 && f.sameWindow &&
        (f.closing === "true" ? f.inert && !f.activeInside : !f.inert && f.activeInside)));
    }
  }
  assert.equal(r.submissions.length, 1); assert.equal(r.modelBoundary.length, 1);
  assert.match(r.modelEndpoint, /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
  assert.equal(r.providerCleanup.requests, 1); assert(r.providerCleanup.stopped);
  assert.equal(r.launches.length, 1); assert.equal(r.cleanups.length, 1);
  assert.equal(r.cleanups[0].normalExitClaimed, false);
  assert.equal(r.cleanups[0].survivors.length, 0); assert.equal(r.cleanups[0].listeners.length, 0);
  assert.equal(r.screenshots.length, baseline ? 2 : 3);
  for (const s of r.screenshots) {
    assert.deepEqual(s.before, s.after);
    assert(Math.abs(s.before.dpr - Math.round(s.before.dpr)) < 1e-6);
    assert.equal(s.png.width, s.before.width * Math.round(s.before.dpr));
    assert.equal(s.png.height, s.before.height * Math.round(s.before.dpr));
  }
}
function selfTest(r) {
  validate(r, false);
  const badChanges = [
    r => { r.cases = []; }, r => { r.inlineMatrix = []; }, r => { r.focusMatrix.pop(); },
    r => { r.inlineMatrix[0].geometry.headerHit = false; },
    r => { r.inlineMatrix[4].geometry.bodyGap = 900; },
    r => { r.inlineMatrix[0].geometry.trackHeight += 999; },
    r => { r.inlineMatrix[0].detailsOpened = false; },
    r => { r.focusMatrix[0].open.inside = false; },
    r => { r.focusMatrix[0].entry.frames.forEach(f => { f.opacity = 1; }); },
    r => { r.reopenMatrix = []; }, r => { r.reopenMatrix[0].sameWindow = false; },
    r => { r.reopenMatrix[0].afterOpen.closing = "true"; },
    r => { r.reopenMatrix[0].reversal.continuous = false; },
    r => { r.reopenMatrix[0].reversal.uniqueOwner = false; },
    r => { r.reopenMatrix[0].probe.commits = []; },
    r => { r.reopenMatrix[0].probe.frames.forEach(f => { f.sameWindow = false; }); },
    r => { r.realModelRequests = 1; }, r => { r.modelBoundary.push(r.modelBoundary[0]); },
    r => { r.cleanups[0].normalExitClaimed = true; }, r => { r.cleanups[0].survivors.push({}); },
    r => { r.screenshots[0].png.width /= 2; }, r => { r.errors.push("uncaught"); },
  ];
  for (const change of badChanges) { const b = structuredClone(r); change(b); assert.throws(() => validate(b, false)); }
  return badChanges.length;
}
function audit(name, iteration, baseline) {
  assert(/^audit-\d{2}$/.test(name)); assert(/^\d{2}$/.test(iteration));
  const out = path.join(qa, name); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const file = path.join(qa, `session-${iteration}/report.json`), r = load(file);
  const receipt = { status: "RUNNING", at: new Date().toISOString(), baseline,
    report: { path: file, sha256: sha(file) } };
  try {
    validate(r, baseline);
    if (!baseline) receipt.invalidVariantsRejected = selfTest(r);
    for (const s of r.screenshots) {
      assert.equal(sha(s.path), s.sha256);
      const b = fs.readFileSync(s.path); assert.equal(b.readUInt32BE(16), s.png.width); assert.equal(b.readUInt32BE(20), s.png.height);
    }
    const prep = load(path.join(summary, "preparation.json"));
    for (const s of r.sources) {
      const original = baseline ? prep.copied.find(c => c.path.endsWith(path.relative(root, s.path)))?.path : s.path;
      assert(original); assert.equal(sha(original), s.sha256, original);
    }
    for (const f of [...r.products, r.input]) assert.equal(sha(f.path), f.sha256, f.path);
    const live = rows();
    assert(!r.known.some(p => live.some(a => a.ProcessId === p.ProcessId && a.Created === p.Created)));
    assert.equal(listeners(r.launches.flatMap(l => l.ports)).length, 0);
    receipt.processIdentitiesAbsent = r.known.length; receipt.portsAbsent = r.launches[0].ports;
    receipt.status = baseline ? "FAILED_BEHAVIOR_EVIDENCE_VERIFIED_NOT_PRODUCT_PASS" : "CURRENT_INTERACTION_EVIDENCE_VERIFIED";
    console.log(`PASS ${receipt.status}`);
  } catch (e) { receipt.status = "FAILED"; receipt.error = String(e.stack || e); process.exitCode = 1; console.error(receipt.error); }
  finally {
    receipt.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
  }
}
audit(process.argv[2], process.argv[3], process.argv.includes("--baseline"));
