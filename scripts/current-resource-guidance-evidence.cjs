"use strict";
// Consolidate existing runs once. No product launch or matrix replay.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const JSZip = require("../editor/node_modules/jszip");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const qa = "F:/AgentVN/QA/Resource-Guidance-1.9.35-20261102-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f) });
const target = path.join(qa, "consolidated-evidence.json");
assert(!fs.existsSync(target));
const result = { status: "RUNNING", at: new Date().toISOString(), checks: [], newProductStarts: 0,
  newModelRequests: 0, productChanges: 0, builds: 0 };
async function check(name, fn) {
  const c = { name, status: "RUNNING" }; result.checks.push(c);
  try { c.detail = await fn(); c.status = "PASS"; }
  catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
}
(async () => {
  const files = ["01", "02", "03", "04"].map(n => path.join(qa, `session-${n}/report.json`));
  const reports = files.map(read), [first, second, third, last] = reports;
  result.inputs = files.map(desc);
  await check("frozen-sources-candidate-and-failed-attempts-retained", () => {
    for (const leaf of ["resume-binding.json", "finish-binding.json", "persistence-binding.json"]) {
      const b = read(path.join(qa, leaf));
      for (const v of Object.values(b))
        if (v?.path && v.sha256) assert.equal(sha(v.path), v.sha256);
      if (b.oracle) assert.equal(sha(b.oracle.sourceDatabase.path), b.oracle.sourceDatabase.sha256);
    }
    assert.deepEqual(reports.map(r => r.status), ["FAILED", "FAILED", "FAILED", "PASS"]);
    for (const r of reports) for (const f of r.products) assert.equal(sha(f.path), f.sha256);
    assert(first.error.includes("waitForFunction"));
    assert(second.error.includes("deepStrictEqual") || second.error.includes("deep-equal"));
    assert(third.error.includes("intercepts pointer events"));
    assert(last.cases.length === 3 && last.cases.every(c => c.status === "PASS"));
    return { originalFailuresPreserved: 3, remainingStagesPassed: 3 };
  });
  await check("original-twelve-displays-and-144-actual-field-jumps-no-replay", () => {
    assert(first.cases.slice(0, 2).every(c => c.status === "PASS"));
    const expected = [1920, 2560, 3840].flatMap(w => [1, 2].flatMap(d => [false, true]
      .map(r => [w, w * 9 / 16, d, r].join("/")))).sort();
    assert.deepEqual(first.matrix.map(m => [m.width, m.height, m.dpr, m.reduced].join("/")).sort(), expected);
    for (const m of first.matrix) {
      assert.equal(m.status, "PASS"); assert.equal(m.jumps.length, 12);
      for (const j of m.jumps) {
        const { rect: r, focus, overflow } = j.geometry;
        assert(focus && overflow <= 1 && r.left >= -1 && r.top >= -1 &&
          r.right <= m.width + 1 && r.bottom <= m.height + 1);
      }
    }
    for (const r of reports.slice(1)) assert.equal(r.matrix.length, 0);
    return { uniqueDisplays: 12, exactFieldJumps: 144, repeatedMatrices: 0 };
  });
  await check("correction-native-save-restart-fresh-import-and-resource-bytes", async () => {
    const b = read(path.join(qa, "persistence-binding.json"));
    assert.equal(sha(last.portable.path), last.portable.sha256);
    const zip = await JSZip.loadAsync(fs.readFileSync(last.portable.path), { checkCRC32: true });
    const project = JSON.parse(await zip.file("project.json").async("string"));
    assert.deepEqual(project.nodes.find(n => n.id === "scene").data.scene.commands, b.oracle.persistedCommands);
    assert.equal(project.nodes.find(n => n.id === "scene").data.scene.commands[0].background_id, "valid_background");
    const original = read(first.input.path);
    const raw = Buffer.from(original.asset_manifest[0].metadata.data_url.split(",")[1], "base64");
    const assets = Object.values(zip.files).filter(f => !f.dir && f.name.startsWith("assets/"));
    assert.equal(assets.length, 1); assert.deepEqual(await assets[0].async("nodebuffer"), raw);
    const detail = last.cases[2].detail;
    assert(detail.nativeSave && detail.differentHostPid && detail.freshDatabase && detail.imageBytesPreserved);
    assert.equal(detail.missingCount, 20);
    assert(last.downloadCleanup.removed && !fs.existsSync(last.downloadCleanup.path));
    assert.equal(sha(last.downloadCleanup.retained.path), last.portable.sha256);
    return { portable: desc(last.portable.path), unresolvedDependencies: 20,
      playableExportNotClaimed: true, userFilesDeleted: 0 };
  });
  await check("actual-captures-cache-restoration-and-all-owned-process-identities", () => {
    const shots = [...new Map(reports.flatMap(r => r.screenshots).map(s => [s.path, s])).values()];
    for (const s of shots) {
      assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
      const b = fs.readFileSync(s.path);
      assert.equal(b.readUInt32BE(16), s.png.width); assert.equal(b.readUInt32BE(20), s.png.height);
      assert(Math.abs(s.before.width * s.before.dpr - s.png.width) < .01);
      assert(Math.abs(s.before.height * s.before.dpr - s.png.height) < .01);
    }
    const identities = reports.flatMap(r => r.cleanups.flatMap(c => {
      assert.equal(c.status, "PASS"); return c.killed;
    }));
    assert(!rows().some(p => identities.includes(`${p.ProcessId}:${p.Created}`)));
    const ports = reports.flatMap(r => r.launches.flatMap(l => l.ports));
    assert.equal(listeners(ports).length, 0);
    for (const r of reports) {
      assert.equal(read(r.cacheRestoration.path).status, "PASS");
      assert.equal(r.modelRequests, 0); assert.equal(r.productChanges, 0); assert.equal(r.builds, 0);
    }
    return { pngs: shots.length, uniqueProcessIdentities: new Set(identities).size,
      uniquePorts: new Set(ports).size, remainingOwnedProcesses: 0, originalCachesRestored: true };
  });
  result.status = "PASS";
})().catch(e => { result.status = "FAILED"; result.error = String(e.stack || e); process.exitCode = 1; })
  .finally(() => {
    result.finishedAt = new Date().toISOString();
    fs.writeFileSync(target, JSON.stringify(result, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: result.status, checks: result.checks.length, target, error: result.error }));
  });
