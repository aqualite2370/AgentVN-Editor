"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), zlib = require("node:zlib");
const assert = require("node:assert/strict");
const { validateLoadingEvidence } = require("./lib/installed-editor-loading-evidence.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const qa = "F:/AgentVN/QA/Installed-Editor-Motion-20261021-01", attempt = process.argv[2] || "07";
assert.match(attempt, /^\d{2}$/);
const directory = path.join(qa, `editor-${attempt}`), out = path.join(directory, "audit-01");
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const report = { status: "RUNNING", startedAt: new Date().toISOString(), source: [], productChanges: 0, modelRequests: 0 };
try {
  const file = path.join(directory, "report.json"), parent = read(file), raw = read(parent.raw.path);
  report.source = [file, parent.raw.path].map(p => ({ path: p, sha256: sha(p) }));
  assert.equal(parent.status, "PASS"); assert.equal(sha(parent.raw.path), parent.raw.sha256);
  report.coverage = validateLoadingEvidence(raw);
  let frames = 0, trustedInputs = 0, pngs = 0;
  for (const g of [...raw.matrix, ...raw.timeoutCases]) for (const e of g.episodes) {
    assert.equal(sha(e.trace.path), e.trace.sha256);
    const t = JSON.parse(zlib.gunzipSync(fs.readFileSync(e.trace.path)));
    assert.equal(t.frames.length, e.trace.frames); assert(!t.limitReached);
    assert(t.inputs.some(i => i.trusted)); trustedInputs += t.inputs.filter(i => i.trusted).length;
    for (const [i, f] of t.frames.entries()) {
      assert(!f.pageHidden && f.visibilityState === "visible");
      assert.equal(f.width, g.width); assert.equal(f.height, g.height);
      assert(Math.abs(f.dpr - g.dpr) <= 1e-6); assert.equal(f.reduced, g.reduced);
      assert(Number.isFinite(f.at)); if (i) assert(f.at >= t.frames[i - 1].at);
      assert(f.overflow <= 1);
      assert(f.layers.filter(l => l.interactive === "true" && !l.inert).length <= 1);
      assert(!f.focus.inUnavailable);
      if (f.panel && f.inspector) assert(f.panel.rect.right <= f.inspector.rect.left + 1);
      if (f.panel && f.palette) assert(f.panel.rect.left >= f.palette.rect.right - 1);
    }
    frames += t.frames.length;
  }
  for (const s of raw.screenshots) {
    assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
    const b = fs.readFileSync(s.path);
    assert.equal(b.readUInt32BE(16), Math.round(s.before.width * s.before.dpr));
    assert.equal(b.readUInt32BE(20), Math.round(s.before.height * s.before.dpr)); pngs++;
  }
  assert(parent.cacheRestored && parent.protectedUnchanged && !parent.cleanupError);
  assert.equal(read(path.join(directory, "native-cache-restoration.json")).status, "PASS");
  assert.equal(parent.modelRequests, 0); assert.equal(parent.productChanges, 0); assert.equal(parent.builds, 0);
  assert.deepEqual(parent.errors, []);
  for (const f of parent.protectedFiles) assert.equal(sha(f.path), f.sha256);
  for (const f of parent.tools) assert.equal(sha(path.join(directory, path.basename(f.path))), f.sha256);
  assert.equal(parent.launches[0].executable.version, "1.9.16");
  assert.equal(parent.launches[0].executable.sha256, "120b1ea9b577faa24172a8854ca752e1c1320772792cab04f33cfeedbf28914c");
  assert.equal(sha(parent.launches[0].executable.path), parent.launches[0].executable.sha256);
  const live = rows();
  assert(!(parent.knownProcesses || []).some(p => live.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created)));
  assert(parent.cleanups.length && parent.cleanups.every(c => c.status === "PASS" && !c.normalCloseClaimed));
  assert.equal(listeners(parent.cleanups.flatMap(c => c.ports)).length, 0);
  report.frames = frames; report.trustedInputs = trustedInputs; report.pngs = pngs; report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
report.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify(report, null, 2));
