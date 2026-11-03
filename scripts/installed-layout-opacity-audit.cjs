"use strict";
// Read-only verification of completed installed workflows; no product launches.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { DatabaseSync } = require("node:sqlite");
const { spawnSync } = require("node:child_process");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, "..");
const qa = "F:/AgentVN/QA/Installed-Layout-20261021-01";
const editorAttempt = process.argv[2] || "07", playerAttempt = process.argv[3] || "01", attempt = process.argv[4] || "01";
for (const v of [editorAttempt, playerAttempt, attempt]) assert.match(v, /^\d{2}$/);
const out = path.join(qa, `audit-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const file = path.join(out, "report.json"), save = () => fs.writeFileSync(file, JSON.stringify(report, null, 2));
const report = { status: "RUNNING", startedAt: new Date().toISOString(), groups: [],
  scope: "INSTALLED_LAYOUT_AUTHORING_PERSISTENCE_CARTRIDGE_AND_INSTALLED_PLAYER_PREVIEW_NOT_FULL_REGRESSION",
  modelRequests: 0, physical4K: false, normalClose: "NOT_RUN", nativePicker: "NOT_RUN",
  WindowsSetup: "NOT_RUN", Android: "NOT_RUN" };
function check(label, fn) {
  const row = { label, status: "RUNNING" }; report.groups.push(row); save();
  try { row.result = fn(); row.status = "PASS"; }
  catch (e) { row.error = String(e.stack || e); row.status = "FAILED"; throw e; }
  finally { save(); }
}
function matrix(cells) {
  assert.equal(cells.length, 12);
  const keys = cells.map(c => `${c.width}/${c.height}/${c.dpr}/${c.reduced}`);
  assert.equal(new Set(keys).size, 12);
  for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true])
    assert(keys.includes(`${width}/${width * 9 / 16}/${dpr}/${reduced}`));
  assert(cells.every(c => c.status === "PASS"));
}
try {
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  const efile = path.join(qa, `editor-${editorAttempt}/report.json`);
  const pfile = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-layout-opacity-${playerAttempt}/report.json`;
  const editor = read(efile), player = read(pfile), prep = read(path.join(qa, "preparation.json"));
  const materialPrepared = editor.materialPreparedViaRealAuthorUI === true;
  const inheritedMaterial = !!editor.materialAuthoringSource;
  const ancestors = new Map();
  function collectSources(document) {
    for (const source of [document.priorEditorReport, document.priorExportReport].filter(Boolean)) {
      assert.equal(sha(source.path), source.sha256);
      if (ancestors.has(source.path)) continue;
      const record = read(source.path);
      ancestors.set(source.path, { source, record }); collectSources(record);
    }
  }
  collectSources(editor);
  const prior = editor.priorEditorReport ? read(editor.priorEditorReport.path) : null;
  if (prior) assert.equal(sha(editor.priorEditorReport.path), editor.priorEditorReport.sha256);
  const exportPrior = editor.priorExportReport ? read(editor.priorExportReport.path) : null;
  if (exportPrior) assert.equal(sha(editor.priorExportReport.path), editor.priorExportReport.sha256);
  const launches = [...[...ancestors.values()].flatMap(a => a.record.launches), ...editor.launches];
  report.evidence = [desc(efile), desc(pfile), desc(path.join(qa, "preparation.json")),
    ...[...ancestors.values()].map(a => a.source)];
  check("Real installed Editor identity, complete feature steps and 12x2 controls", () => {
    assert.equal(editor.status, "EDITOR_PASS_PLAYER_NOT_RUN");
    assert.equal(editor.steps.length, materialPrepared ? 11 : 8);
    assert(editor.steps.every(s => s.status === "PASS"));
    assert.equal(launches.length, inheritedMaterial ? 5 : 4);
    assert.equal(editor.variants.length, 2); matrix(editor.matrix);
    const inheritedSteps = inheritedMaterial ? 10 : materialPrepared ? 6 : 7;
    assert.equal(editor.steps.filter(s => s.evidenceSource).length, inheritedSteps);
    assert.equal(prior.status, "FAILED"); assert.equal(editor.resumedStateVerified, true);
    if (!materialPrepared) assert.equal(exportPrior.status, "FAILED");
    for (const s of editor.steps.filter(s => s.evidenceSource)) {
      const ancestor = ancestors.get(s.evidenceSource.path); assert(ancestor);
      assert.equal(s.evidenceSource.sha256, ancestor.source.sha256);
      const original = ancestor.record.steps.find(item => item.label === s.label); assert(original);
      const { evidenceSource, ...inherited } = s;
      const { evidenceSource: oldSource, ...originalFields } = original;
      assert.deepEqual(inherited, originalFields, "Inherited execution must match the unchanged original");
    }
    if (materialPrepared) {
      for (const label of ["agentvn-real-background-material-author", "material-real-native-portable-save",
        "material-real-process-restart-restores-background"]) {
        const step = editor.steps.filter(s => s.label === label);
        assert.equal(step.length, 1); assert.equal(step[0].status, "PASS");
        if (inheritedMaterial) assert.equal(step[0].evidenceSource.sha256, editor.materialAuthoringSource.sha256);
        else assert.equal(step[0].evidenceSource, undefined);
      }
      if (inheritedMaterial) {
        assert.equal(sha(editor.materialAuthoringSource.path), editor.materialAuthoringSource.sha256);
        const original = read(editor.materialAuthoringSource.path);
        assert.equal(original.nativeSaveGeneratedInThisAttempt, true);
        assert.deepEqual(editor.portable, original.portable);
      } else assert.equal(editor.nativeSaveGeneratedInThisAttempt, true);
    }
    for (const c of editor.matrix) {
      assert.deepEqual(c.types.map(t => t.type), ["agentvn", "renpy"]);
      for (const t of c.types) {
        assert.equal(t.controls.length, 2);
        assert(t.controls.every(b => b.hit && b.overflow <= 1 && b.rect.width > 0 && b.rect.height > 0));
        assert.equal(t.shown.background, t.type === "agentvn" ? .4 : .5);
        assert.equal(t.shown.content, t.type === "agentvn" ? .7 : .8);
      }
    }
    assert.equal(editor.modelRequests, 0); assert.deepEqual(editor.errors, []);
    for (const { record } of ancestors.values()) {
      assert.equal(record.modelRequests, 0); assert.deepEqual(record.errors, []);
      assert.equal(record.cleanupError, undefined);
    }
    for (const l of launches) {
      assert.equal(sha(l.executable.path), l.executable.sha256);
      assert.equal(sha(l.backend.ExecutablePath), l.backend.sha256);
      assert(l.dataDirectoryOverride && l.webviewDirectoryOverride);
      assert(!l.sourceServer && !l.manualBackendSpawn && l.listeners.length === 2);
      const profileRun = path.dirname(launches[0].data);
      assert.equal(path.resolve(l.data), path.resolve(profileRun, "data"));
      assert.equal(path.resolve(l.webview), path.resolve(profileRun, "webview"));
    }
    return { authorSteps: editor.steps.length, displayCombinations: 12, layoutVisits: 24,
      isolatedDirectories: true, defaultPathAcceptanceClaimed: false,
      priorCompletedStepsNotRerun: inheritedSteps, originalFailuresPreserved: true,
      materialPreparedViaRealAuthorUI: materialPrepared };
  });
  check("Native saved portable bytes, two real UI cartridge ZIPs and no Downloads residue", () => {
    assert.equal(editor.downloadCleanup.status, "PASS");
    assert.equal(editor.downloadCleanup.deletedUserFiles, 0);
    assert(!fs.existsSync(editor.nativeSaveSource.path));
    assert.equal(sha(editor.portable.path), editor.portable.sha256);
    assert.equal(editor.portable.sha256, editor.nativeSaveSource.sha256);
    for (const { record } of ancestors.values()) if (record.nativeSaveSource) {
      assert.equal(record.downloadCleanup.status, "PASS");
      assert.equal(record.downloadCleanup.deletedUserFiles, 0);
      assert(!fs.existsSync(record.nativeSaveSource.path));
      assert.equal(sha(record.portable.path), record.nativeSaveSource.sha256);
    }
    for (const v of editor.variants) {
      assert.equal(sha(v.cartridge.path), v.cartridge.sha256);
      assert.equal(v.layout.layout_type ?? "agentvn", v.type);
      const style = v.layout.screens.find(s => s.screen_id === "title")
        .components.find(c => c.component_id === "title_hero").style;
      assert.equal(style.backgroundOpacity, v.type === "agentvn" ? .4 : .5);
      assert.equal(style.contentOpacity, v.type === "agentvn" ? .7 : .8);
      if (materialPrepared) assert.equal(style.backgroundColor, "#24384c");
      assert(v.currentProfileOnly && v.geometry.hit);
      assert.equal(v.manifest.runtime_version, "0.23.0");
    }
    return { portable: editor.portable, cartridges: editor.variants.map(v => v.cartridge),
      removedOnlyCurrentDownload: true };
  });
  check("Test SQLite persistence independently inspected from a copied database", () => {
    const original = path.join(launches[0].data, "backend/vn_engine.db");
    const copyRoot = path.join(out, "sqlite-copy"); fs.mkdirSync(copyRoot);
    for (const suffix of ["", "-wal", "-shm"]) if (fs.existsSync(original + suffix)) {
      const copy = path.join(copyRoot, "vn_engine.db" + suffix);
      fs.copyFileSync(original + suffix, copy, fs.constants.COPYFILE_EXCL);
      assert.equal(sha(original + suffix), sha(copy));
    }
    const db = new DatabaseSync(path.join(copyRoot, "vn_engine.db"), { readOnly: true });
    try {
      const all = db.prepare("SELECT project_id,project_json FROM editor_project_details").all();
      assert.equal(all.length, 1); assert.equal(all[0].project_id, editor.projectId);
      const project = JSON.parse(all[0].project_json), profiles = project.editor_settings.runtimeUILayoutProfiles;
      assert.equal(profiles.activeType, "renpy");
      for (const v of editor.variants) assert.deepEqual(profiles.profiles[v.type], v.layout);
      return { testDatabase: desc(original), projectId: editor.projectId, bothProfilesRetained: true, method: "readOnly SELECT on exact test DB copy" };
    } finally { db.close(); }
  });
  check("Installed Player consumes both actual exports, all 24 display cells and story text", () => {
    assert.equal(player.status, "PASS"); assert.equal(player.cases.length, 2); assert.equal(player.launches.length, 2);
    assert.equal(sha(player.source.path), player.source.sha256);
    assert.equal(sha(player.executable.path), player.executable.sha256);
    assert.deepEqual(player.errors, []); assert.equal(player.modelRequests, 0);
    for (const c of player.cases) {
      assert.equal(c.status, "PASS"); matrix(c.matrix);
      assert(c.played.text && c.played.done === "true");
      const v = editor.variants.find(v => v.type === c.type); assert(v);
      assert.equal(c.cartridge.sha256, v.cartridge.sha256); assert.equal(c.layoutSha256, v.layoutSha256);
      assert(c.matrix.every(m => m.shown.controls.length >= 4
        && m.shown.controls.every(b => b.hit && b.bounded) && m.shown.overflow <= 1));
    }
    return { displayCells: 24, actualExportConsumers: 2, realStoryText: 2, standaloneSetupClaimed: false };
  });
  check("PNG bytes match real before/after viewport, DPR and reduced-motion state", () => {
    const shots = [...[...ancestors.values()].flatMap(a => a.record.screenshots),
      ...editor.screenshots, ...player.screenshots]; assert(shots.length >= 7);
    for (const s of shots) {
      assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
      const bytes = fs.readFileSync(s.path);
      assert.equal(bytes.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(bytes.readUInt32BE(20), s.before.height * s.before.dpr);
    }
    return { screenshots: shots.map(s => desc(s.path)), notPhysicalMonitorEvidence: true };
  });
  check("Original user/product bytes and Player profiles restored, exact-owned processes/ports gone", () => {
    for (const f of prep.immutable) assert.equal(sha(f.path), f.sha256, f.path);
    assert.equal(editor.immutable.status, "PASS"); assert.equal(editor.cleanupError, undefined);
    assert.equal(player.cleanupError, undefined);
    const restored = read(player.profileRestoration.path); assert.equal(restored.status, "PASS");
    assert.equal(restored.deletedUserFiles, 0);
    for (const record of restored.restored) {
      const id = ps(`$v=(& fsutil.exe file queryfileid '${record.original.replace(/'/g, "''")}'|Out-String);` +
        `if($LASTEXITCODE -ne 0 -or $v -notmatch '0x[0-9a-fA-F]+'){throw 'No directory ID'};$Matches[0].ToLowerInvariant()`);
      assert.equal(id, record.directoryId);
      for (const f of record.files) assert.equal(sha(path.join(record.original, f.relative)), f.sha256);
    }
    const owned = [...(prior?.knownProcesses || []), ...(exportPrior?.knownProcesses || []),
      ...editor.knownProcesses, ...player.knownProcesses];
    const extraPorts = [];
    for (const name of fs.readdirSync(qa).filter(n => /^editor-\d{2}$/.test(n))) {
      const recordedFile = path.join(qa, name, "report.json");
      if (!fs.existsSync(recordedFile)) continue;
      const recorded = read(recordedFile);
      assert(["FAILED", "EDITOR_PASS_PLAYER_NOT_RUN"].includes(recorded.status), `${name} not terminal`);
      assert.equal(recorded.cleanupError, undefined, `${name} cleanup failed`);
      owned.push(...(recorded.knownProcesses || []));
      extraPorts.push(...recorded.launches.flatMap(l => l.ports));
    }
    const playerRoot = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
    for (const name of fs.readdirSync(playerRoot).filter(n => /^installed-layout-opacity-\d{2}$/.test(n))) {
      const recordedFile = path.join(playerRoot, name, "report.json");
      const recorded = read(recordedFile);
      assert(["FAILED", "PASS"].includes(recorded.status), `${name} not terminal`);
      assert.equal(recorded.cleanupError, undefined, `${name} cleanup failed`);
      assert.equal(sha(recorded.profileRestoration.path), recorded.profileRestoration.sha256);
      assert.equal(read(recorded.profileRestoration.path).status, "PASS");
      owned.push(...(recorded.knownProcesses || []));
      extraPorts.push(...recorded.launches.map(l => l.port));
    }
    const ids = new Set(owned.map(p => `${p.ProcessId}:${p.Created}`));
    assert(!rows().some(p => ids.has(`${p.ProcessId}:${p.Created}`)));
    const ports = [...launches.flatMap(l => l.ports), ...player.launches.map(l => l.port), ...extraPorts];
    assert.equal(listeners(ports).length, 0);
    assert(editor.cleanups.every(c => c.status === "PASS" && c.normalCloseClaimed === false));
    assert(player.cleanups.every(c => c.status === "PASS" && c.normalCloseClaimed === false));
    const cache = read(editor.nativeCacheRestoration.path);
    assert.equal(cache.status, "PASS"); assert.equal(cache.deletedUserFiles, 0);
    const currentCacheId = ps(`$v=(& fsutil.exe file queryfileid '${cache.originalDirectory}'|Out-String);` +
      `if($LASTEXITCODE -ne 0 -or $v -notmatch '0x[0-9a-fA-F]+'){throw 'No cache directory ID'};$Matches[0].ToLowerInvariant()`);
    assert.equal(currentCacheId, cache.originalDirectoryId);
    for (const f of cache.originalFiles) assert.equal(sha(path.join(cache.originalDirectory, f.relative)), f.sha256);
    report.nativeCacheLimitation = "editor-02 environment check wrote the system Windows environment cache before its boundary was protected; original pre-02 cache bytes were not captured. Later cache restoration does not prove pre-02 cache unchanged.";
    assert(Array.isArray(editor.incidentalEnvironmentChecks) && editor.incidentalEnvironmentChecks.length > 0);
    assert(editor.incidentalEnvironmentChecks.every(c => ["failed", "completed"].includes(c.phase)));
    report.incidentalWindowsEnvironmentStatus = editor.incidentalEnvironmentChecks.some(c => c.phase === "failed")
      ? "FAILED_UNDER_QA_CACHE_JUNCTION_NOT_NORMAL_PATH_REPRODUCTION"
      : "OBSERVED_COMPLETED_UNDER_QA_CACHE_JUNCTION_NOT_STANDALONE_EXPORT_ACCEPTANCE";
    report.incidentalWindowsEnvironmentChecks = editor.incidentalEnvironmentChecks;
    return { identities: ids.size, recordedProcessRows: owned.length, ports: [...new Set(ports)],
      immutableFiles: prep.immutable.length, deletedUserFiles: 0,
      originalPlayerProfileDirectories: restored.restored.length, forcedTerminationNotNormalClose: true };
  });
  check("QA syntax, gitpush read-only preflight and ignore boundaries without repository mutation", () => {
    const run = (command, args) => {
      const r = spawnSync(command, args, { cwd: root, encoding: "utf8", windowsHide: true, timeout: 60000 });
      assert.equal(r.status, 0, `${command} ${args.join(" ")}: ${r.stdout}\n${r.stderr}`);
      return { command, args, exitCode: r.status, stdout: r.stdout, stderr: r.stderr };
    };
    const beforeHead = run("git", ["rev-parse", "HEAD"]).stdout.trim();
    const index = path.resolve(root, run("git", ["rev-parse", "--git-path", "index"]).stdout.trim());
    const beforeIndex = sha(index);
    const scripts = ["scripts/installed-layout-opacity-flow.cjs",
      "scripts/installed-layout-opacity-player.cjs", "scripts/installed-layout-opacity-audit.cjs"];
    const commands = scripts.map(s => run(process.execPath, ["--check", s]));
    commands.push(run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", path.join(root, "scripts/push-agentvn-editor.ps1"), "-CheckOnly"]));
    const ignored = ["output/installed-layout-opacity-20261021-01/REPORT.md", "AgentVN Dev.exe"];
    for (const file of ignored) commands.push(run("git", ["check-ignore", "--", file]));
    for (const file of scripts) {
      const r = spawnSync("git", ["check-ignore", "--", file], { cwd: root, encoding: "utf8", windowsHide: true });
      assert.equal(r.status, 1, `QA source should remain publishable: ${file}`);
    }
    const afterHead = run("git", ["rev-parse", "HEAD"]).stdout.trim(), afterIndex = sha(index);
    assert.equal(beforeHead, afterHead); assert.equal(beforeIndex, afterIndex);
    return { commands, head: afterHead, indexSha256: afterIndex, ignored, publishableSources: scripts,
      actualPush: false, stagedOrCommitted: false, gitignoreChangeNeeded: false };
  });
  assert.equal(report.groups.length, 7); report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, groups: report.groups.map(g => [g.label, g.status]), error: report.error }));
}
