"use strict";
// Recompute geometry from raw RAF traces. Aggregated evidence is explicitly
// distinct from one uninterrupted successful run; historical failures remain.
const fs = require("node:fs"), path = require("node:path"), zlib = require("node:zlib");
const crypto = require("node:crypto"), assert = require("node:assert/strict");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const qa = "F:/AgentVN/QA/Installed-Editor-Motion-20261021-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const delta = (a, b) => Math.max(...["x", "y", "width", "height"].map(k => Math.abs(a[k] - b[k])));
const sequence = ["history/pointer", "library/pointer", "layout/pointer", "library/pointer",
  "assets/pointer", "history/pointer", "settings/pointer", "history/keyboard", "settings/rapid-redirect"];
function validateCase(row, data) {
  assert.equal(row.status, "PASS"); assert.deepEqual(row.failures, []);
  assert.equal(row.actionError, undefined); assert.equal(row.trace.frames, data.frames.length);
  assert(data.frames.length >= 3); assert.equal(data.viewport.width, row.viewport.width);
  assert.equal(data.viewport.height, row.viewport.height);
  assert(Math.abs(data.viewport.dpr - row.viewport.dpr) <= 1e-6);
  assert.equal(data.reduced, row.viewport.reduced);
  const frames = data.frames;
  for (const [i, f] of frames.entries()) {
    assert(Number.isFinite(f.at)); if (i) assert(f.at >= frames[i - 1].at);
    for (const name of ["nav", "button", "indicator", "material", "adapter", "root"]) {
      assert(f[name]); assert(["x", "y", "width", "height", "right", "bottom"].every(k => Number.isFinite(f[name][k])));
      assert(f[name].width > 0 && f[name].height > 0);
    }
    assert(f.indicator.x >= f.nav.x - 3 && f.indicator.right <= f.nav.right + 3);
    assert(delta(f.indicator, f.material) <= 2 && delta(f.indicator, f.adapter) <= 2);
    assert(f.interactiveOwners.length <= 1);
    if (f.inspector) assert(f.root.right <= f.inspector.x + 1);
    if (f.palette) assert(f.root.x >= f.palette.right - 1);
  }
  const last = frames.at(-1);
  assert(delta(last.indicator, last.button) <= 2);
  assert.equal(last.active, row.target); assert.equal(last.selected, `advanced.tab.${row.target}`);
  assert.deepEqual(last.interactiveOwners, [row.target]); assert.equal(last.morphing, false);
  if (row.method === "keyboard") assert(frames.some(f => f.markerAnimations.some(a => a.state === "running")));
  const content = frames.flatMap(f => f.contentAnimations).filter(a => a.state === "running");
  assert(row.method === "rapid-redirect" || content.length > 0);
  assert(content.every(a => Math.abs(a.timing - 400 / 1.5) <= 1));
  if (frames.some(f => f.morphing)) {
    const morph = frames.flatMap(f => f.rootAnimations).filter(a => a.state === "running");
    assert(morph.length > 0);
    assert(morph.every(a => Math.abs(a.timing - (row.viewport.reduced ? 640 : 960) / 1.5) <= 1));
  }
  if (row.inputs) {
    const clicks = row.inputs.filter(e => e.type === "click" && e.help?.startsWith("advanced.tab."));
    assert(row.inputs.every(e => e.trusted === true));
    if (row.method === "rapid-redirect") {
      assert.deepEqual(clicks.map(e => e.help), ["advanced.tab.layout", "advanced.tab.library", "advanced.tab.settings"]);
      if (Object.hasOwn(clicks[0], "morphing")) assert(clicks.slice(1).every(e => e.morphing));
    } else assert(clicks.some(e => e.help === `advanced.tab.${row.target}`));
  }
  return frames.length;
}
function validateCoverage(cases) {
  assert.equal(cases.length, 108);
  const groups = new Map();
  for (const c of cases) {
    const v = c.viewport; assert([1, 2].some(d => Math.abs(d - v.dpr) <= 1e-6));
    assert([false, true].includes(v.reduced));
    assert([[1920,1080],[2560,1440],[3840,2160]].some(([w,h]) => v.width === w && v.height === h));
    const key = `${v.width}/${Math.round(v.dpr)}/${v.reduced}`;
    if (!groups.has(key)) groups.set(key, []); groups.get(key).push(c);
  }
  assert.equal(groups.size, 12);
  for (const group of groups.values()) assert.deepEqual(group.map(c => `${c.target}/${c.method}`), sequence);
}
async function main() {
  const out = path.join(qa, "mask-audit-01"); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", scope: "INSTALLED_RELEASE_EDITOR_MASK_AGGREGATED_NOT_UNINTERRUPTED",
    startedAt: new Date().toISOString(), source: [], historicalFailuresRetained: ["editor-02", "editor-04", "editor-05"],
    uninterruptedFullSuitePass: false, productChanges: 0, builds: 0 };
  try {
    const first = read(path.join(qa, "editor-02/report.json")), middle = read(path.join(qa, "editor-05/report.json")),
      tail = read(path.join(qa, "editor-06/report.json"));
    assert.equal(first.status, "FAILED"); assert.equal(tail.status, "PASS"); assert.equal(tail.fullMatrix, false);
    assert.equal(middle.status, "FAILED"); assert.equal(tail.filter, "--4k-dpr2-only"); assert.equal(tail.cases.length, 18);
    assert(tail.cases.every(c => Array.isArray(c.inputs) && c.inputs.length > 0));
    assert.equal(read(path.join(qa, "editor-04/report.json")).status, "FAILED");
    const cases = [...first.cases.slice(0, 72), ...middle.cases.slice(0, 18), ...tail.cases]; validateCoverage(cases);
    let frames = 0;
    for (const c of cases) {
      assert.equal(sha(c.trace.path), c.trace.sha256);
      frames += validateCase(c, JSON.parse(zlib.gunzipSync(fs.readFileSync(c.trace.path))));
    }
    let images = 0;
    for (const name of ["editor-02", "editor-03", "editor-04", "editor-05", "editor-06"]) {
      const file = path.join(qa, name, "report.json"), r = read(file);
      report.source.push({ path: file, sha256: sha(file), status: r.status });
      assert(r.cacheRestored && r.protectedUnchanged && !r.cleanupError);
      assert.equal(r.productChanges, 0); assert.equal(r.builds, 0); assert.equal(r.modelRequests, 0);
      assert.deepEqual(r.errors, []);
      assert.equal(r.launches.length, 1);
      assert.equal(r.launches[0].executable.version, "1.9.16");
      assert.equal(r.launches[0].executable.sha256, "120b1ea9b577faa24172a8854ca752e1c1320772792cab04f33cfeedbf28914c");
      assert.equal(sha(r.launches[0].executable.path), r.launches[0].executable.sha256);
      assert.equal(r.launches[0].sourceServer, false); assert.equal(r.launches[0].manualBackendSpawn, false);
      for (const f of r.protectedFiles) assert.equal(sha(f.path), f.sha256, f.path);
      // Tools can legitimately change between runs; compare the immutable
      // executed copies, not today's working-tree paths.
      for (const t of r.tools) assert.equal(sha(path.join(qa, name, path.basename(t.path))), t.sha256);
      for (const s of r.screenshots) {
        assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
        const b = fs.readFileSync(s.path);
        assert.equal(b.readUInt32BE(16), Math.round(s.before.width * s.before.dpr));
        assert.equal(b.readUInt32BE(20), Math.round(s.before.height * s.before.dpr)); images++;
      }
      const live = rows();
      assert(!(r.knownProcesses || []).some(p => live.some(n => p.ProcessId === n.ProcessId && p.Created === n.Created)));
      assert(r.cleanups.length > 0 && r.cleanups.every(c => c.status === "PASS" && !c.normalCloseClaimed));
      assert.equal(listeners(r.cleanups.flatMap(c => c.ports)).length, 0);
      assert.equal(read(path.join(qa, name, "native-cache-restoration.json")).status, "PASS");
    }
    report.status = "PASS"; report.cases = cases.length; report.frames = frames; report.pngs = images;
    report.olderPrefixLacksTrustedInputProbe = 72;
    report.current4kCasesWithTrustedInputProbe = 36;
    report.selectedEvidence = ["editor-02 cases 1..72", "editor-05 cases 1..18", "editor-06 cases 1..18"];
    report.backgroundPointerMissesInFinalTail = tail.cases.flatMap(c => c.inputs)
      .filter(e => e.type === "click" && !e.help).length;
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
}
module.exports = { validateCase, validateCoverage };
if (require.main === module) void main();
