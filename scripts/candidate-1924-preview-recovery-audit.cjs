"use strict";
// Independent read-only review; retain the original FAILED cleanup outcome.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const base = "F:/AgentVN/QA/Native-Dev-Preview-Repair-20261020-02/installed-03";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const file = path.join(base, "report.json"), run = read(file);
const recoveryFile = path.join(base, "profile-restoration-recovery.json"), recovery = read(recoveryFile);
const correctionFile = path.join(base, "profile-restoration-correction.json"), correction = read(correctionFile);
function geometry(g) {
  assert(g.rect.width > 0 && g.rect.height > 0 && g.rect.left >= -1 && g.rect.top >= -1 &&
    g.rect.right <= g.width + 1 && g.rect.bottom <= g.height + 1 && g.overflow <= 1 && !g.focusUnavailable);
  for (const b of g.buttons.filter(b => !b.disabled)) assert(b.hit && b.rect.width > 0 && b.rect.height > 0);
  for (let i = 0; i < g.buttons.length; i++) for (let j = i + 1; j < g.buttons.length; j++) {
    const a = g.buttons[i].rect, b = g.buttons[j].rect;
    assert(!(Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1));
  }
}
function business(run, recovery) {
  assert.equal(run.status, "FAILED"); assert(!run.error && run.finishedAt);
  assert.match(run.cleanupError, /Unexpected original path; refuse removal/);
  assert.deepEqual(run.errors, []); assert.equal(run.modelRequests, 0); assert.equal(run.version, "1.9.24");
  assert.equal(run.steps.length, 5); assert(run.steps.every(s => s.status === "PASS"));
  assert.equal(run.cases.length, 12);
  const expected = read(run.input.path).nodes[1].data.scene.commands[0].text, keys = new Set();
  for (const c of run.cases) {
    assert.equal(c.status, "PASS");
    assert([1920, 2560, 3840].includes(c.width) && [1, 2].includes(c.dpr));
    assert.equal(c.height, c.width * 9 / 16); assert.equal(typeof c.reduced, "boolean");
    const k = `${c.width}/${c.dpr}/${c.reduced}`; assert(!keys.has(k)); keys.add(k);
    assert.deepEqual(c.viewport, { width: c.width, height: c.height, dpr: c.dpr, reduced: c.reduced });
    assert.equal(c.externalText, expected); assert.equal(c.nodeText, expected);
    for (const g of [c.confirmation, c.external, c.node]) geometry(g);
  }
  assert.equal(run.players.length, 2); assert.notEqual(run.players[0].process.ProcessId, run.players[1].process.ProcessId);
  assert(run.steps[2].result.actualAdvance && run.steps[3].result.closedThroughEditorUI &&
    run.steps[4].result.externalPlayerAbsent && run.steps[4].result.independentNodeIframe);
  assert.equal(recovery.status, "PASS"); assert.equal(recovery.originalStatus, "FAILED");
  assert(recovery.originalFailurePreserved); assert.equal(recovery.deletedUserFiles, 0);
  assert.equal(recovery.aliasViewsVerified, 6); assert.equal(recovery.uniqueDirectories, 3);
  assert.equal(recovery.restored.length, 3); assert.equal(recovery.removedOwnedJunctions, 3);
  return { businessSteps: 5, externalCases: 12, nodeCases: 12, originalRunStatus: "FAILED",
    businessStatus: "PASS", separateRecoveryStatus: "PASS" };
}
if (process.argv[2] === "--self-test") {
  business(run, recovery);
  const bad = [
    r => { r.cases = []; }, r => { r.cases.pop(); }, r => { r.steps[0].status = "FAILED"; },
    r => { r.cases[0].viewport.dpr = 2; }, r => { r.cases[0].nodeText = "wrong"; },
    r => { r.cases[0].external.rect.right = 99999; }, r => { r.players.pop(); },
    r => { r.status = "PASS"; }, r => { r.cleanupError = undefined; }, r => { r.modelRequests = 1; },
  ];
  for (const mutate of bad) { const r = structuredClone(run); mutate(r); assert.throws(() => business(r, recovery)); }
  for (const patch of [{ status: "FAILED" }, { deletedUserFiles: 1 }, { aliasViewsVerified: 3 },
    { restored: [] }, { originalStatus: "PASS" }]) assert.throws(() => business(run, { ...recovery, ...patch }));
  console.log(JSON.stringify({ status: "PASS", rejectedBadEvidence: 15, productLaunches: 0 }));
} else {
  assert.equal(process.argv[2], "02");
  const out = "F:/AgentVN/QA/Editor-1.9.24-20261024-01/preview-recovery-audit-02";
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), input: desc(file),
    recovery: desc(recoveryFile), cleanupCorrection: desc(correctionFile),
    groups: [], scope: "FIVE_PREVIEW_FLOWS_WITH_SEPARATE_RECOVERY_NOT_ORIGINAL_RUN_PASS",
    productChanges: 0, builds: 0, modelRequests: 0 };
  function group(name, fn) {
    const g = { name, status: "RUNNING" }; report.groups.push(g);
    try { g.detail = fn(); g.status = "PASS"; } catch (e) { g.status = "FAILED"; throw e; }
  }
  try {
    group("Five actual flows, twelve external/node cases and separate cleanup recovery", () => business(run, recovery));
    group("Frozen installation, exact executed source adaptations and actual retained preview", () => {
      const installed = read("F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json");
      assert.equal(installed.status, "PASS"); assert.equal(installed.executable.version, "1.9.24");
      assert.equal(run.launches[0].executable.sha256, installed.executable.sha256);
      for (const f of [installed.executable, ...installed.resources, ...run.protectedFiles, ...run.tools, run.input])
        assert.equal(sha(f.path), f.sha256);
      let source = fs.readFileSync("scripts/installed-preview-current.cjs", "utf8");
      for (const c of read(path.join(base, "candidate-adaptations.json"))) {
        assert.equal(source.split(c.before).length - 1, 1); source = source.replace(c.before, c.after);
      }
      assert.equal(fs.readFileSync(path.join(base, "executed-business.cjs"), "utf8"), source);
      assert.equal(sha(path.join(base, "executed-test.cjs")), sha("scripts/candidate-1924-preview.cjs"));
      const last = run.players[1];
      const retained = name => path.join(base, "profile-5/current", name);
      assert.equal(sha(retained("script.json")), last.script.sha256);
      assert.equal(sha(retained("manifest.json")), last.manifest.sha256);
      const script = read(retained("script.json")); assert.equal(script.game_id, read(run.input.path).project_id);
      for (const p of run.players) {
        assert.equal(p.process.ParentProcessId, run.launches[0].pid);
        assert.equal(p.executable.sha256, run.player.sha256); assert.equal(sha(p.executable.path), run.player.sha256);
      }
      const database = path.join(run.launches[0].data, "backend/vn_engine.db");
      const db = new DatabaseSync(database, { readOnly: true });
      try {
        const fixture = read(run.input.path);
        const row = db.prepare("SELECT project_json FROM editor_project_details WHERE project_id=?").get(fixture.project_id);
        assert(row); const persisted = JSON.parse(row.project_json);
        assert.deepEqual(persisted.nodes.find(n => n.id === "scene").data.scene.commands, fixture.nodes[1].data.scene.commands);
        assert.deepEqual(persisted.edges, fixture.edges);
      } finally { db.close(); }
      return { version: "1.9.24", retainedSource: desc(retained("script.json")), database: desc(database) };
    });
    group("Actual PNG dimensions, all alias identities/bytes and owned process/port cleanup", () => {
      assert.equal(run.screenshots.length, 2);
      for (const s of run.screenshots) {
        assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
        const b = fs.readFileSync(s.path);
        assert.equal(b.readUInt32BE(16), s.before.width * s.before.dpr);
        assert.equal(b.readUInt32BE(20), s.before.height * s.before.dpr);
      }
      const plan = read(path.join(base, "profile-recovery-plan.json"));
      assert.equal(sha(file), plan.originalReportSha256);
      assert.equal(sha(path.join(base, "profile-protection.json")), plan.originalJournalSha256);
      assert.equal(sha(path.join(base, "profile-recovery-plan.json")), recovery.planSha256);
      const journal = read(path.join(base, "profile-protection.json"));
      assert.equal(correction.status, "PASS"); assert.equal(correction.deletedUserFiles, 0);
      assert.equal(correction.originalRunStatus, "FAILED");
      assert.equal(correction.removedOwnedNestedJunctions.length, 3); assert.equal(correction.finalViews.length, 6);
      for (const l of correction.removedOwnedNestedJunctions) {
        assert(!fs.existsSync(l.path)); assert(fs.statSync(l.target).isDirectory());
      }
      function inventory(dir, relative = "") {
        const result = [];
        for (const e of fs.readdirSync(path.join(dir, relative), { withFileTypes: true })) {
          const name = path.join(relative, e.name);
          assert(!e.isSymbolicLink(), "Unexpected extra junction after recovery");
          if (e.isDirectory()) result.push(...inventory(dir, name));
          else if (e.isFile()) result.push({ relative: name, sha256: sha(path.join(dir, name)) });
        }
        return result.sort((a, b) => a.relative.localeCompare(b.relative));
      }
      for (const r of journal.records) {
        assert(!fs.existsSync(r.held));
        assert(ps(`fsutil file queryfileid '${r.original.replace(/'/g, "''")}'`).toLowerCase().includes(r.directoryId));
        for (const f of r.files) assert.equal(sha(path.join(r.original, f.relative)), f.sha256);
        if (r.byteInventory) assert.deepEqual(inventory(r.original),
          r.files.map(f => ({ relative: f.relative, sha256: f.sha256 })).sort((a, b) => a.relative.localeCompare(b.relative)));
      }
      const id = p => `${p.ProcessId}:${p.Created}`;
      const owned = new Set([...run.knownProcesses.map(id), ...run.players.map(p => id(p.process)), ...run.cleanups.flatMap(c => c.killed)]);
      assert(!rows().some(p => owned.has(id(p))));
      const ports = [...run.launches[0].ports, run.previewPort]; assert.deepEqual(listeners(ports), []);
      assert(!fs.existsSync(run.player.path + ".qa-held-installed-preview"));
      return { screenshots: 2, aliasViews: 6, physicalDirectories: 3, ownedIdentities: owned.size, ports };
    });
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString(); report.tool = desc(__filename);
    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, out, error: report.error }));
  }
}
