"use strict";
// Audit raw current-native evidence, filesystem restoration and exact process
// identities. Does not launch, stop, reconnect to or modify a running Player.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { openingNativeBuildEvidence } = require("./lib/opening-native-build-evidence.cjs");
const attempt = process.argv[2]; assert.equal(attempt, "01");
const base = "F:/AgentVN/QA/Runtime-Opening-Time-20261024-01";
const nativeRoot = "F:/AgentVN/QA/Native-Runtime-State-20261020-01/opening-native-time02-01";
const out = path.join(base, "native-audit-" + attempt);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const sha = f => createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: f, sha256: sha(f) });
const report = { status: "RUNNING", cases: [], modelRequests: 0,
  scope: "CURRENT_DEV_BUNDLED_PLAYER_NOT_INSTALLED_STANDALONE_EXPORT_UPGRADE_OR_ANDROID" };
try {
  const reportFile = path.join(nativeRoot, "report.json"), native = read(reportFile);
  assert.equal(native.status, "PASS"); assert(native.finishedAt && !native.cleanupError);
  assert.equal(native.mode, "FULL_MATRIX");
  assert.equal(native.cases.length, 32);
  assert.equal(native.launches.length, 32);
  const build = openingNativeBuildEvidence(path.join(base, "build-02/report.json"), nativeRoot);
  for (const tool of native.tools) assert.equal(sha(tool.path), tool.sha256);
  for (const item of native.fixtures) assert.equal(sha(item.path), item.sha256);
  assert.equal(sha(path.join(nativeRoot, "opening-probe.webm")), native.video.sha256);
  const observed = rows(), identities = new Map();
  for (const launch of native.launches) {
    assert.equal(launch.cleanup.status, "PASS"); assert(!launch.cleanupError);
    assert.equal(launch.normalCloseClaimed, false); assert.equal(launch.mode, "preview");
    assert.equal(launch.executable.sha256, build.executable.sha256);
    assert.equal(path.resolve(launch.executable.path), path.resolve(build.executable.path));
    assert.equal(launch.renderer.features.gpu_compositing, "enabled");
    assert(launch.knownProcesses.some(p => p.ProcessId === launch.pid &&
      p.Created === launch.identity.Created && path.resolve(p.ExecutablePath) === path.resolve(build.executable.path)));
    for (const identity of launch.knownProcesses) identities.set(`${identity.ProcessId}:${identity.Created}`, identity);
  }
  assert.equal(listeners(native.launches.map(l => l.port)).length, 0);
  assert(!observed.some(p => identities.has(`${p.ProcessId}:${p.Created}`)),
    "No original process identity may remain; a reused PID is not the same process");
  report.cleanup = { status: "PASS", launches: native.launches.length, identities: identities.size,
    ports: native.launches.map(l => l.port), forcedAttributedTeardown: true, normalCloseClaimed: false };
  assert.equal(native.cases.filter(c => c.kind === "video" && !c.interrupt).length, 24);
  assert.equal(new Set(native.cases.filter(c => c.kind === "video" && !c.interrupt)
    .map(c => [c.width, c.height, c.dpr, c.reduced, c.layout].join(":"))).size, 24);
  for (const row of native.cases) {
    assert.equal(row.status, "PASS"); assert.equal(row.contextClosed, true);
    if (row.kind !== "broken") assert.equal(row.storyBlackoutPreserved, true);
    if (!["default", "broken"].includes(row.kind)) {
      const entry = row.frames.filter(f => f.opening && f.mediaOpacity > .02 && f.mediaOpacity < .98);
      const exit = row.frames.filter(f => f.opening && f.opacity > .02 && f.opacity < .98);
      assert(entry.length >= 2); if (!row.interrupt) assert(exit.length >= 2);
      const clocks = row.frames.flatMap(f => [...(f.mediaAnimations || []), ...(f.stageAnimations || [])]);
      assert(clocks.length > 0 && clocks.every(c => c.timing.duration === (row.reduced ? 180 : 420)));
      assert.equal(row.geometry.dpr, row.dpr); assert(row.geometry.overflow <= 1);
      assert.deepEqual(row.input, { focused: true, backgroundInert: true, titleBlocked: true });
      if (row.kind === "video") {
        assert.equal(row.events.filter(e => e.event === "ended").length, row.interrupt ? 0 : 1);
      }
      report.cases.push({ width: row.width, height: row.height, dpr: row.dpr, reduced: row.reduced,
        kind: row.kind, layout: row.layout, interrupt: !!row.interrupt,
        entryFrames: entry.length, exitFrames: exit.length, status: "PASS" });
    } else report.cases.push({ kind: row.kind, reduced: row.reduced, status: "PASS" });
  }
  assert.equal(native.screenshots.length, 28);
  for (const shot of native.screenshots) {
    assert.equal(sha(shot.path), shot.sha256);
    const png = fs.readFileSync(shot.path);
    assert.deepEqual(shot.before, shot.after);
    assert.equal(png.readUInt32BE(16), shot.before.width * shot.before.dpr);
    assert.equal(png.readUInt32BE(20), shot.before.height * shot.before.dpr);
  }
  const restorationFile = path.join(nativeRoot, "profile-restoration.json"), restoration = read(restorationFile);
  assert.equal(restoration.status, "PASS");
  assert.equal(native.profileRestoration.sha256, sha(restorationFile));
  const protectionFile = path.join(nativeRoot, "profile-protection.json"), protection = read(protectionFile);
  for (const record of protection.records) {
    assert.equal(fs.existsSync(record.held), false, "Original profile must no longer be held aside");
    assert.equal(fs.existsSync(record.original), record.existed);
    if (record.existed) assert.equal(fs.lstatSync(record.original).isSymbolicLink(), false);
    for (const file of record.files) assert.equal(sha(path.join(record.original, file.relative)), file.sha256);
  }
  report.evidence = [reportFile, restorationFile, protectionFile, build.receipt.path].map(desc);
  report.player = build.executable; report.status = "PASS";
} catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
report.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: report.status, out, cases: report.cases.length, error: report.error }));
