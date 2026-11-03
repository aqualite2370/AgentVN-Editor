"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const attempt = process.argv[2]; assert.match(attempt || "", /^\d{2}$/);
const out = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/exit-recovery-20261027-${attempt}`;
const file = path.join(out, "report.json"), r = read(file), reportHash = sha(file);
const installedCandidate = process.argv.includes("--installed-candidate");
const resultFile = path.join(out, "terminal-audit-01.json"); assert(!fs.existsSync(resultFile));
function validate(r) {
  assert.equal(r.status, "PASS"); assert(r.finishedAt && !r.error && !r.cleanupError && !r.profileRestoreError);
  assert.equal(r.scope, installedCandidate
    ? "CURRENT_INSTALLED_PLAYER_REAL_DISK_ACL_AND_CONFIRMED_WINDOW_EXIT_NOT_STANDALONE_OR_ANDROID"
    : "NEW_DEV_RESOURCE_NATIVE_PLAYER_REAL_DISK_ACL_AND_CONFIRMED_EXIT_NOT_INSTALLED_OR_ANDROID");
  assert.equal(r.profileRestore, "PASS"); assert.equal(r.modelRequests, 0); assert.equal(r.productChanges, 0);
  assert.equal(r.builds, 0); assert(!r.observerError); assert.deepEqual(r.pageErrors, []);
  assert.equal(r.cases.length, 6); assert.equal(r.launches.length, 12); assert.equal(r.screenshots.length, 14);
  assert.deepEqual(r.cases.map(c => [c.layout, c.kind]),
    ["agentvn", "renpy"].flatMap(l => ["manual", "discard", "auto"].map(k => [l, k])));
  for (const c of r.cases) {
    assert.equal(c.status, "PASS"); assert(c.finishedAt && !c.error);
    assert.deepEqual(c.restored, c.before);
    assert.equal(c.exits.length, 2); assert(c.exits.every(e => e.pid > 0 && e.code === 0 && e.forced === false));
    assert.equal(c.acls.length, 2); assert.deepEqual(c.acls.map(a => a.action), ["Block", "Restore"]);
    assert.equal(c.acls[0].data.isElevated, false);
    assert.equal(c.acls[0].data.probe.accessDenied, true); assert.equal(c.acls[0].data.probe.allowed, false);
    assert.equal(c.acls[1].data.comparison.permissionsMatch, true);
    assert.equal(c.acls[1].data.probe.allowed, true);
    assert.equal(c.physicalClose.length, c.kind === "manual" ? 4 : 2);
    assert.equal(c.writes.length, c.kind === "manual" ? 3 : c.kind === "auto" ? 2 : 1);
    const expected = c.kind === "manual" ? [false, false, true] : c.kind === "auto" ? [false, true] : [false];
    assert.deepEqual(c.writes.map(w => w.actualOk), expected);
    assert(c.writes.every(w => w.actualSettled && w.settledAt >= w.startedAt));
    assert(c.writes.every(w => w.args.kind === (c.kind === "auto" ? "auto" : "manual")));
    if (c.kind === "manual") assert(c.writes.every(w => w.args.slot === 1));
    for (const w of c.writes.filter(w => !w.actualOk)) assert(/os error 5|拒绝访问/.test(w.actualError));
    if (c.kind === "discard") assert.equal(c.cancelDiscardKeptOpen, true);
    if (c.kind !== "auto") assert.equal(c.errors.length, c.kind === "manual" ? 2 : 1);
  }
  assert(r.launches.every(l => l.cleanup?.status === "PASS" &&
    l.cleanup.method === "PROCESS_ALREADY_EXITED_BEFORE_CLEANUP"));
  assert(r.commands.length === 14 && r.commands.every(c => c.status === "PASS" && c.code === 0));
}
const audit = { status: "RUNNING", at: new Date().toISOString(), report: { path: file, sha256: reportHash }, checks: [],
  scope: installedCandidate ? "INSTALLED_NATIVE_REAL_DISK_WINDOW_CLOSE_TIMING_GATED_QA_NOT_STANDALONE_ANDROID"
    : "NATIVE_REAL_DISK_TIMING_GATED_QA_NOT_INSTALL_STANDALONE_ANDROID" };
function check(name, fn) {
  const c = { name, status: "RUNNING" }; audit.checks.push(c);
  try { c.detail = fn(); c.status = "PASS"; }
  catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
}
try {
  check("Complete six flows, real ACL results, real writer responses, restart and twelve natural exits", () => {
    validate(r);
    const mutations = [
      v => v.cases.pop(), v => v.status = "RUNNING", v => v.cases[0].writes = [],
      v => v.cases[0].writes[0].actualOk = true, v => v.cases[0].exits[0].forced = true,
      v => v.cases[0].acls[0].data.probe.allowed = true, v => v.cases[0].restored.command++,
      v => v.cases[1].cancelDiscardKeptOpen = false, v => v.screenshots.pop(),
      v => v.launches[0].cleanup.method = "FORCED", v => v.profileRestore = "FAILED",
      v => v.cases[0].physicalClose = [], v => v.commands[0].code = 1,
    ];
    for (const mutate of mutations) { const bad = structuredClone(r); mutate(bad); assert.throws(() => validate(bad)); }
    return { flows: 6, naturalExits: 12, rejectedInvalidResults: mutations.length };
  });
  check("Preserved executable, fixture and executed tool identities; sixteen real Computer Use receipts", () => {
    if (installedCandidate) {
      const installed = require("./candidate-1930-exit.cjs").validateInstallation(r.installation.path);
      assert.equal(r.candidateVersion, installed.version);
      assert.equal(sha(r.installation.path), r.installation.sha256);
      assert.equal(sha(r.candidateBinding.path), r.candidateBinding.sha256);
      assert.equal(path.resolve(r.candidateBinding.path),
        path.resolve(process.env.AGENTVN_EXIT_CANDIDATE_CONFIG));
      assert.deepEqual(r.prep.executable,
        installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe"));
      const predecessor = read(r.predecessor.path);
      assert.equal(sha(r.predecessor.path), r.predecessor.sha256);
      assert.equal(predecessor.status, "PASS");
      for (const f of [r.narrative.original, r.narrative.executed]) assert.equal(sha(f.path), f.sha256);
      const adapted = require("./candidate-1930-quickload-exit.cjs")
        .buildNarrative(fs.readFileSync(r.narrative.original.path, "utf8"));
      assert.deepEqual(adapted.changes, r.narrative.changes);
      assert.equal(fs.readFileSync(r.narrative.executed.path, "utf8"), adapted.source);
    }
    assert.equal(sha(r.prep.executable.path), r.prep.executable.sha256);
    for (const f of r.prep.cartridges) assert.equal(sha(f.path), f.sha256);
    for (const f of r.sources) assert.equal(sha(f.path), f.sha256);
    const all = r.cases.flatMap(c => c.physicalClose);
    assert.equal(all.length, 16);
    assert.deepEqual(all.map(e => e.data.number), Array.from({ length: 16 }, (_, i) => i + 1));
    for (const p of all) {
      assert.equal(sha(p.request.path), p.request.sha256); assert.equal(sha(p.receipt.path), p.receipt.sha256);
      const req = read(p.request.path), receipt = read(p.receipt.path);
      assert.deepEqual(receipt, p.data); assert.equal(receipt.pid, req.pid);
      assert.equal(receipt.status, "INPUT_COMPLETED"); assert.equal(receipt.key, "Alt_L+F4");
      assert.equal(receipt.observedModal, "退出游戏？"); assert(receipt.window.id > 0);
      assert.equal(receipt.method, "computer-use sky.press_key");
    }
    return { receipts: all.length, executable: r.prep.executable };
  });
  check("Actual saved snapshots and old bytes, archived physical profile and valid native PNG parameters", () => {
    for (const c of r.cases) {
      const data = c.disk.map(f => { assert.equal(sha(f.path), f.sha256); return { name: path.basename(f.path), files: read(f.path) }; });
      for (const d of data) for (const f of d.files) {
        assert(f.data.history?.some(h => c.before.text.includes(h.text)));
        assert.equal(f.data.scene_id, c.before.scene); assert.equal(f.data.command_index, c.before.command);
        assert(!JSON.stringify(f.data).includes("isUiHidden"));
      }
      if (c.kind !== "auto") {
        const before = data.find(d => /baseline/.test(d.name)).files.map(f => f.sha256);
        for (const d of data.filter(d => /failure/.test(d.name))) assert.deepEqual(d.files.map(f => f.sha256), before);
        const restart = data.find(d => /restart/.test(d.name)).files;
        assert.equal(restart.length, c.kind === "manual" ? 2 : 1);
        assert(restart.some(f => before.includes(f.sha256)));
        const archive = path.join(out, "player-roaming/saves", `qa_recovery_20261027_${attempt}_${c.layout}_${c.kind}`);
        for (const f of restart) assert.equal(sha(path.join(archive, path.basename(f.path))), f.sha256);
      }
      for (const a of c.acls) assert.equal(sha(a.path), a.sha256);
    }
    for (const s of r.screenshots) {
      assert.equal(sha(s.path), s.sha256);
      validateNativeViewport(s.before, { width: 1920, height: 1080, dpr: 1, reduced: false });
      assert.deepEqual(s.after, s.before);
      const png = fs.readFileSync(s.path); assert.equal(png.readUInt32BE(16), 1920); assert.equal(png.readUInt32BE(20), 1080);
    }
    return { pngs: r.screenshots.length, noPhysical4KClaim: true };
  });
  check("Original profile restoration and attributed process/port cleanup", () => {
    const restored = read(path.join(out, "profile-restoration.json")), protectedBefore = read(path.join(out, "profile-protection.json"));
    assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
    for (const entry of protectedBefore.records) {
      assert(!fs.existsSync(entry.held)); assert(restored.restored.some(p => p.original === entry.original && p.directoryId === entry.directoryId));
    }
    const current = rows();
    assert(!r.knownProcesses.some(p => current.some(q => p.ProcessId === q.ProcessId && p.Created === q.Created)));
    assert.deepEqual(listeners(r.launches.map(l => l.port)), []);
    return { originalProfiles: restored.restored.length, ownedLaunches: r.launches.length };
  });
  audit.status = "PASS";
} catch (e) { audit.status = "FAILED"; audit.error = String(e.stack || e); process.exitCode = 1; }
finally {
  assert.equal(sha(file), reportHash, "Never rewrite original report during audit");
  fs.writeFileSync(resultFile, JSON.stringify(audit, null, 2), { flag: "wx" });
  console.log(JSON.stringify(audit, null, 2));
}
