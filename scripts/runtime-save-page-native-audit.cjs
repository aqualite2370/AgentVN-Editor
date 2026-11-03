"use strict";
// Read-only independent audit of raw native traces, PNGs and teardown.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto"), { gunzipSync } = require("node:zlib");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { savePageNativeBuildEvidence } = require("./lib/save-page-native-build-evidence.cjs");
const attempt = process.argv[2]; assert(/^\d{2}$/.test(attempt || ""));
const handoff=process.argv.includes("--handoff");
const base = handoff ? "F:/AgentVN/QA/Runtime-SavePage-Handoff-20261024-01"
  : "F:/AgentVN/QA/Runtime-SavePage-Time-20261024-01";
const nativeRoot = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/${handoff?"save-page-handoff-native03":"save-page-native-time01"}-${attempt}`;
const out = path.join(base, `native-audit-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const sha = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const describe = file => ({ path: file, sha256: sha(file) });
const report = { status: "RUNNING", startedAt: new Date().toISOString(), cases: [], modelRequests: 0,
  scope: "CURRENT_DEV_NATIVE_PLAYER_PREVIEW_NOT_INSTALLATION_EXPORT_UPGRADE_OR_ANDROID" };
try {
  const nativeFile = path.join(nativeRoot, "report.json"), native = read(nativeFile);
  assert.equal(native.status, "PASS"); assert(native.finishedAt && !native.cleanupError);
  assert.equal(native.handoff,handoff);
  const buildFile = path.join(base, handoff?"build-03/report.json":"build-01/report.json");
  const build = savePageNativeBuildEvidence(buildFile, nativeRoot);
  assert.equal(native.build.sha256, build.receipt.sha256);
  assert.equal(native.player.sha256, build.executable.sha256);
  assert.throws(() => savePageNativeBuildEvidence(
    "F:/AgentVN/QA/Runtime-Opening-Time-20261024-01/build-02/report.json", nativeRoot));
  assert.throws(() => savePageNativeBuildEvidence(buildFile,
    "F:/AgentVN/QA/Native-Runtime-State-20261020-01/opening-native-time02-01"));
  report.receiptBoundaries = { status: "PASS", rejected: 2 };
  for (const file of [...native.tools, ...native.fixtures]) assert.equal(sha(file.path), file.sha256);
  assert.equal(native.cases.length, 24);
  assert.equal(new Set(native.cases.map(c => [c.layout,c.width,c.height,c.dpr,c.reduced].join(":"))).size, 24);
  for (const row of native.cases) {
    assert.equal(row.status, "PASS"); assert.deepEqual(row.before, row.after);
    assert.equal(row.before.width, row.width); assert.equal(row.before.height, row.height);
    assert(Math.abs(row.before.dpr - row.dpr) < 1e-6); assert.equal(row.before.reduced, row.reduced);
    assert.deepEqual(row.traces.map(t => t.label), ["next","rapid-reverse","keyboard","leave-during-flip"]);
    const g = row.geometry;
    assert(g.backHit && g.nextHit && g.overflow <= 1);
    assert(g.nav.top >= g.grid.bottom - 1);
    assert(Math.abs(g.prev.left-g.grid.left)<28 && Math.abs(g.next.right-g.grid.right)<28);
    for (const rect of [g.grid,g.nav,g.back]) assert(rect.left >= -1 && rect.top >= -1
      && rect.right <= row.width+1 && rect.bottom <= row.height+1);
    const traces = [];
    for (const trace of row.traces) {
      assert.equal(sha(trace.path), trace.sha256);
      const frames = JSON.parse(gunzipSync(fs.readFileSync(trace.path)).toString());
      assert.equal(frames.length, trace.frames); assert(frames.length >= 2);
      const moving = frames.filter(f => f.layers.some(l =>
        l.opacity > .05 && l.opacity < .95 && l.transform !== "none"));
      assert(moving.length >= 2); assert.equal(moving.length, trace.moving);
      const clocks = frames.flatMap(f => f.layers.flatMap(l => l.animations));
      assert(clocks.length && clocks.every(a => a.duration === (row.reduced ? 220 : 420)));
      const live = frames.filter(f => f.layers.length); assert(live.length);
      assert(live.every(f => f.layers.filter(l => !l.inert).length === 1 && f.grids === 1));
      assert(frames.every(f => !f.unavailableFocus && f.overflow <= 1));
      for (const field of ["viewport","screen","navigation","toolbar","back"]) {
        const first = live[0][field]; assert(first);
        for (const frame of live) for (const key of ["x","y","width","height"])
          assert(Math.abs(frame[field][key] - first[key]) <= .25);
      }
      assert.equal(frames.at(-1).layers.length, trace.label === "leave-during-flip" ? 0 : 1);
      traces.push({ label: trace.label, frames: frames.length, moving: moving.length });
    }
    report.cases.push({ layout: row.layout,width: row.width,height: row.height,dpr: row.dpr,reduced: row.reduced,
      traces,status: "PASS" });
  }
  assert.equal(native.screenshots.length, 24);
  for (const shot of native.screenshots) {
    assert.equal(sha(shot.path), shot.sha256); assert.deepEqual(shot.before, shot.after);
    const png = fs.readFileSync(shot.path);
    assert.equal(png.readUInt32BE(16), shot.before.width * shot.before.dpr);
    assert.equal(png.readUInt32BE(20), shot.before.height * shot.before.dpr);
  }
  assert.equal(native.launches.length, 2);
  const identities = new Set();
  for (const launch of native.launches) {
    assert.equal(launch.cleanup.status, "PASS"); assert(!launch.cleanupError);
    assert.equal(launch.mode, "preview"); assert.equal(launch.normalCloseClaimed, false);
    assert.equal(launch.renderer.features.gpu_compositing, "enabled");
    assert.equal(launch.executable.sha256, build.executable.sha256);
    assert(launch.knownProcesses.some(p => p.ProcessId === launch.pid
      && p.Created === launch.identity.Created && path.resolve(p.ExecutablePath) === path.resolve(build.executable.path)));
    for (const p of launch.knownProcesses) identities.add(`${p.ProcessId}:${p.Created}`);
  }
  assert.equal(listeners(native.launches.map(l => l.port)).length, 0);
  assert(!rows().some(p => identities.has(`${p.ProcessId}:${p.Created}`)));
  report.cleanup = { status: "PASS", identities: identities.size, ports: native.launches.map(l => l.port),
    attributedTeardown: true, normalCloseClaimed: false };
  const restorationFile = path.join(nativeRoot,"profile-restoration.json");
  assert.equal(read(restorationFile).status,"PASS");
  assert.equal(native.profileRestoration.sha256,sha(restorationFile));
  const protectionFile = path.join(nativeRoot,"profile-protection.json");
  for (const record of read(protectionFile).records) {
    assert.equal(fs.existsSync(record.held),false);
    assert.equal(fs.existsSync(record.original),record.existed);
    if (record.existed) assert.equal(fs.lstatSync(record.original).isSymbolicLink(),false);
    for (const file of record.files) assert.equal(sha(path.join(record.original,file.relative)),file.sha256);
  }
  report.evidence = [nativeFile,buildFile,protectionFile,restorationFile].map(describe);
  report.status = "PASS";
} catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
report.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2),{flag:"wx"});
console.log(JSON.stringify({status:report.status,out,cases:report.cases.length,error:report.error}));
