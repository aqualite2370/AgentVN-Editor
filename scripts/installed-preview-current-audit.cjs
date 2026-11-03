"use strict";
// Read-only evidence verification; a preview is not a standalone game export.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { DatabaseSync } = require("node:sqlite");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const qa = "F:/AgentVN/QA/Runtime-Dialog-Release-20261021-01";
const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
const auditAttempt = process.argv[3] || attempt; assert.match(auditAttempt, /^\d{2}$/);
const ownershipArgument = process.argv[4];
assert(ownershipArgument === undefined || /^--ownership=\d{2}$/.test(ownershipArgument));
const runRoot = `F:/AgentVN/QA/Native-Dev-Preview-Repair-20261020-02/installed-${attempt}`;
const out = path.join(qa, `preview-audit-${auditAttempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const sourceFile = path.join(runRoot, "report.json"), run = read(sourceFile);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), source: desc(sourceFile), groups: [],
  modelRequests: 0, scope: "CURRENT_NSIS_TOP_AND_NODE_PREVIEW_EVIDENCE_NOT_STANDALONE_OR_PHYSICAL_NATIVE_INPUT" };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
function check(label, fn) {
  const row = { label, status: "RUNNING" }; report.groups.push(row); save();
  try { row.result = fn(); row.status = "PASS"; console.log(`PASS ${label}`); }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; } finally { save(); }
}
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
try {
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  const installation = read(path.join(qa, "installation.json"));
  const journal = read(path.join(runRoot, "profile-protection.json"));
  const expected = read(run.input.path).nodes[1].data.scene.commands[0].text;
  check("Exact actual installation, captured tools, nonempty five-step flow and fault/retry", () => {
    assert.equal(run.status, "PASS"); assert.equal(run.version, "1.9.14"); assert(run.finishedAt);
    assert.equal(run.cleanupError, undefined); assert.deepEqual(run.errors, []); assert.equal(run.modelRequests, 0);
    assert.equal(run.steps.length, 5); assert(run.steps.every(s => s.status === "PASS"));
    for (const f of run.tools) assert.equal(sha(f.path), f.sha256);
    assert.equal(sha(path.join(runRoot, "executed-test.cjs")), sha(path.resolve(__dirname, "installed-preview-current.cjs")));
    assert.equal(run.launches.length, 1);
    assert.equal(run.launches[0].executable.sha256, installation.executable.sha256);
    assert.equal(path.resolve(run.launches[0].backend.ExecutablePath), path.resolve(installation.installRoot, "creator-backend.exe"));
    assert(!run.launches[0].sourceServer && !run.launches[0].manualBackendSpawn);
    assert(run.launches[0].dataDirectoryOverride && run.launches[0].webviewDirectoryOverride);
    assert.equal(run.launches[0].previewCdpPort, run.previewPort);
    assert.match(run.steps[1].result.message, /GameCLI executable was not found/);
    assert.match(run.steps[1].result.faultInjection, /exact QA installation/);
    geometry(run.steps[0].result); geometry(run.steps[1].result.geometry);
    assert.equal(sha(run.player.path), run.player.sha256);
    assert(!fs.existsSync(run.player.path + ".qa-held-installed-preview"));
    return { version: run.version, steps: 5, originalPlayerRestored: true, actualModelRequests: 0 };
  });
  check("Twelve external and node display cases; actual advance, close and relaunch", () => {
    assert.equal(run.cases.length, 12); const keys = new Set();
    for (const c of run.cases) {
      const key = `${c.width}/${c.dpr}/${c.reduced}`; assert(!keys.has(key)); keys.add(key);
      assert.equal(c.status, "PASS"); assert.equal(c.height, c.width * 9 / 16);
      validateNativeViewport(c.viewport, c);
      assert.equal(c.externalText, expected); assert.equal(c.nodeText, expected);
      assert(c.confirmation.buttons.length > 0 && c.node.buttons.length > 0);
      for (const g of [c.confirmation, c.external, c.node]) geometry(g);
    }
    for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true])
      assert(keys.has(`${width}/${dpr}/${reduced}`));
    assert.equal(run.steps[2].result.actualAdvance, true); assert.equal(run.steps[4].result.externalPlayerAbsent, true);
    assert.equal(run.players.length, 2);
    assert.notEqual(run.steps[3].result.first, run.steps[3].result.second);
    const previewRecord = journal.records.find(r => r.original.endsWith("gamecli-preview")); assert(previewRecord);
    for (const p of run.players) {
      assert.equal(p.process.ParentProcessId, run.launches[0].pid);
      assert.equal(path.resolve(p.process.ExecutablePath), path.resolve(run.player.path));
      assert.equal(p.executable.sha256, run.player.sha256);
      assert.match(p.process.CommandLine, /--mode preview --preview-root/);
      assert.equal(p.script.sha256, run.players[1].script.sha256);
    }
    // The shared "current" payload was replaced by the second real launch.
    // Read its retained F-drive target, not the restored user's C-drive cache.
    const last = run.players[1];
    function retained(file) {
      const relative = path.relative(previewRecord.original, file);
      assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
      return path.join(previewRecord.target, relative);
    }
    assert.equal(sha(retained(last.script.path)), last.script.sha256);
    assert.equal(sha(retained(last.manifest.path)), last.manifest.sha256);
    const script = read(retained(last.script.path));
    assert.equal(script.game_id, read(run.input.path).project_id);
    assert(script.scenes.some(s => s.commands.some(c => c.text === expected)));
    return { cases: keys.size, launches: 2, retainedScript: desc(retained(last.script.path)),
      firstManifestBytesRetainedSeparately: false };
  });
  check("Actual screenshot DPR/media and physical PNG dimensions", () => {
    assert.equal(run.screenshots.length, 2);
    for (const s of run.screenshots) {
      assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
      validateNativeViewport(s.before, s.after); const png = fs.readFileSync(s.path);
      assert.equal(png.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(png.readUInt32BE(20), s.before.height * s.before.dpr);
    }
    return run.screenshots;
  });
  check("Isolated installed backend really persisted the fixture in SQLite", () => {
    const original = path.join(run.launches[0].data, "backend"), target = path.join(out, "sqlite"); fs.mkdirSync(target);
    for (const name of ["vn_engine.db", "vn_engine.db-wal", "vn_engine.db-shm"]) {
      const file = path.join(original, name); if (!fs.existsSync(file)) continue;
      fs.copyFileSync(file, path.join(target, name), fs.constants.COPYFILE_EXCL);
      assert.equal(sha(file), sha(path.join(target, name)));
    }
    const db = new DatabaseSync(path.join(target, "vn_engine.db"), { readOnly: true });
    try {
      const p = read(run.input.path), row = db.prepare("SELECT project_json FROM editor_project_details WHERE project_id=?").get(p.project_id);
      assert(row); const persisted = JSON.parse(row.project_json);
      assert.deepEqual(persisted.nodes.find(n => n.id === "scene").data.scene.commands, p.nodes.find(n => n.id === "scene").data.scene.commands);
      assert.deepEqual(persisted.edges, p.edges);
      return { projectId: p.project_id, database: desc(path.join(target, "vn_engine.db")) };
    } finally { db.close(); }
  });
  check("Original profiles/preview cache restored; owned identities/ports absent; protected bytes unchanged", () => {
    assert.equal(run.cleanups.length, 1); assert.equal(run.cleanups[0].status, "PASS"); assert(!run.cleanups[0].normalCloseClaimed);
    const current = rows(), known = new Set([...run.knownProcesses, ...run.players.map(p => p.process)].map(p => `${p.ProcessId}:${p.Created}`));
    assert(!current.some(p => known.has(`${p.ProcessId}:${p.Created}`)));
    assert(!current.some(p => p.Name === "agentvn-player.exe" || p.Name === "msedgewebview2.exe" &&
      (p.CommandLine?.includes(runRoot.replaceAll("/", "\\")) || /com\.agentvn\.player/.test(p.CommandLine || ""))));
    const ports = [...run.launches[0].ports, run.previewPort]; assert.equal(listeners(ports).length, 0);
    assert.equal(sha(run.profileRestoration.path), run.profileRestoration.sha256);
    const restored = read(run.profileRestoration.path); assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
    assert.equal(journal.records.length, 3); assert.equal(restored.restored.length, 3);
    for (const r of journal.records) {
      const record = restored.restored.find(a => a.original === r.original); assert(record);
      assert.deepEqual(record.files, r.files); assert.equal(record.directoryId, r.directoryId); assert(!fs.existsSync(r.held));
      if (r.directoryId) {
        const actualId = ps(`$v=(& fsutil.exe file queryfileid '${r.original}'|Out-String);` +
          `if($LASTEXITCODE -ne 0 -or $v -notmatch '0x[0-9a-fA-F]+'){throw 'Missing ID'};$Matches[0].ToLowerInvariant()`);
        assert.equal(actualId, r.directoryId);
      }
      for (const f of r.files) assert.equal(sha(path.join(r.original, f.relative)), f.sha256);
    }
    for (const f of run.protectedFiles) assert.equal(sha(f.path), f.sha256);
    assert.equal(sha(run.input.path), run.input.sha256);
    return { knownIdentities: known.size, ports, protectedFiles: run.protectedFiles.length, originalDirectories: 3 };
  });
  if (ownershipArgument) check("Identical independent Player survives the installed Editor preview close", () => {
    const suffix = ownershipArgument.split("=")[1];
    const file = path.join(path.dirname(runRoot), `ownership-${suffix}/report.json`), value = read(file);
    assert.equal(value.status, "PASS"); assert.equal(value.version, run.version); assert(value.finishedAt);
    assert.equal(sha(value.source.path), value.source.sha256); assert.equal(value.source.sha256, sha(sourceFile));
    assert.equal(value.steps.length, 3); assert(value.steps.every(s => s.status === "PASS"));
    assert.equal(value.cleanupError, undefined); assert.deepEqual(value.errors, []); assert.equal(value.modelRequests, 0);
    assert.equal(value.owned.process.ParentProcessId, value.launches[0].pid);
    assert.notEqual(value.sentinel.process.ParentProcessId, value.launches[0].pid);
    assert.notEqual(value.owned.process.ProcessId, value.sentinel.process.ProcessId);
    assert.equal(value.owned.executable.sha256, run.player.sha256); assert.equal(value.sentinel.executable.sha256, run.player.sha256);
    assert.equal(path.resolve(value.owned.process.ExecutablePath), path.resolve(value.sentinel.process.ExecutablePath));
    assert.equal(value.owned.previewRoot, value.sentinel.previewRoot);
    assert.equal(value.steps[2].result.actualIndependentStoryAdvance, true);
    const known = new Set(value.observedProcesses.map(p => `${p.ProcessId}:${p.Created}`)); assert(known.size > 0);
    assert(!rows().some(p => known.has(`${p.ProcessId}:${p.Created}`)));
    assert.equal(listeners([...value.launches[0].ports, ...value.ports]).length, 0);
    assert.equal(value.cleanups.length, 1); assert.equal(value.cleanups[0].status, "PASS");
    assert.equal(sha(value.profileRestoration.path), value.profileRestoration.sha256);
    const restored = read(value.profileRestoration.path), protection = read(path.join(path.dirname(file), "profile-protection.json"));
    assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
    assert.equal(restored.restored.length, 3);
    for (const r of protection.records) {
      assert(!fs.existsSync(r.held)); const actual = restored.restored.find(p => p.original === r.original); assert(actual);
      assert.deepEqual(actual.files, r.files); assert.equal(actual.directoryId, r.directoryId);
      for (const f of r.files) assert.equal(sha(path.join(r.original, f.relative)), f.sha256);
    }
    assert.equal(value.screenshots.length, 1);
    for (const s of value.screenshots) {
      assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
      const b = fs.readFileSync(s.path);
      assert.equal(b.readUInt32BE(16), s.before.width * s.before.dpr); assert.equal(b.readUInt32BE(20), s.before.height * s.before.dpr);
    }
    for (const f of value.protectedFiles) assert.equal(sha(f.path), f.sha256);
    return { evidence: desc(file), observedProcessIdentities: known.size, screenshotScope: "Editor status, not independent Player screenshot" };
  });
  assert.equal(report.groups.length, ownershipArgument ? 6 : 5); report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: report.status, out, error: report.error })); }
