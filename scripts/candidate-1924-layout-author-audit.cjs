"use strict";
// Independent inspection of the current installed Editor's authoring receipts.
// It deliberately does not infer rendered colors from persisted configuration.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const source = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-50";
const base = "F:/AgentVN/QA/Editor-1.9.24-20261024-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const standard = { title: "title_hero", player: "dialog_panel", game_menu: "game_menu_nav",
  save_load: "save_grid", preferences: "settings_group", history: "history_list", gallery: "gallery_grid", about: "about_panel" };
const renpy = { ...standard, help: "help_panel" };
const screens = { title: "title_menu", player: "playing", save_load: "save_load", preferences: "settings",
  history: "history", gallery: "gallery", about: "about", help: "help" };
function rect(r) {
  assert(r && r.width > 0 && r.height > 0);
  for (const k of ["left", "top", "right", "bottom", "width", "height"]) assert(Number.isFinite(r[k]), k);
}
function geometry(g) {
  assert(g && g.saveHit && g.overflow <= 1 && g.regions.length >= 3);
  rect(g.panel); rect(g.rail); assert(g.rail.right <= g.panel.left + 1);
  for (const entry of g.regions) {
    rect(entry.rect); const r = entry.rect;
    assert(entry.display !== "none" && entry.overflow <= 1);
    assert(r.left >= g.panel.left - 1 && r.right <= g.panel.right + 1 &&
      r.top >= g.panel.top - 1 && r.bottom <= g.panel.bottom + 1);
  }
}
function pageRow(p) {
  assert.equal(p.status, "PASS");
  const expected = p.type === "agentvn" ? standard : p.type === "renpy" ? renpy : null;
  assert(expected && expected[p.id]); geometry(p.geometry); geometry(p.preview.geometry);
  assert.equal(p.author.component, expected[p.id]); assert(p.author.otherTypeUnchanged);
  assert.match(p.author.color, /^#[a-f\d]{6}$/);
  assert.equal(p.author.persisted.component_id, expected[p.id]);
  assert.equal(p.author.persisted.style.backgroundColor, p.author.color);
  const actualPreview = p.id === "player" || p.type === "renpy" && p.id !== "game_menu";
  if (actualPreview) {
    assert.equal(p.preview.kind, "ACTUAL_INSTALLED_RUNTIME_IFRAME");
    assert.equal(p.preview.runtime.screen, screens[p.id]); assert(p.preview.runtime.overflow <= 1);
  } else assert.equal(p.preview.kind, "AUTHOR_DIAGRAM_NOT_RUNTIME");
  return actualPreview;
}
function summary(r) {
  assert.equal(r.status, "PASS"); assert(r.finishedAt && !r.error && !r.cleanupError && !r.captureError);
  assert.equal(r.mode, "author"); assert.deepEqual(r.testedTypes, ["agentvn", "renpy"]);
  assert.equal(r.expectedPages, 17); assert.equal(r.pages.length, 204); assert.equal(r.matrix.length, 12);
  assert.equal(r.steps.length, 206); assert(r.steps.every(s => s.status === "PASS" && s.finishedAt));
  assert.deepEqual(r.errors, []); assert.equal(r.modelRequests, 0); assert.equal(r.blockedModelRequests || 0, 0);
  let runtime = 0;
  for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]])
    for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      const match = v => v.width === width && v.height === height && v.dpr === dpr && v.reduced === reduced;
      const cells = r.matrix.filter(match); assert.equal(cells.length, 1);
      assert.equal(cells[0].status, "PASS"); assert.equal(cells[0].pageCount, 17);
      const pages = r.pages.filter(p => match(p.display)); assert.equal(pages.length, 17);
      for (const [type, entries] of [["agentvn", standard], ["renpy", renpy]])
        for (const id of Object.keys(entries)) {
          const matches = pages.filter(p => p.type === type && p.id === id); assert.equal(matches.length, 1);
          runtime += Number(pageRow(matches[0]));
        }
    }
  assert.equal(runtime, 108);
  return { pages: 204, actualRuntimePagePreviews: runtime, authorDiagramPreviews: 204 - runtime,
    renderedColorCorrespondenceClaimed: false };
}
if (process.argv[2] === "--self-test") {
  const r = read(path.join(source, "report.json")), valid = r.pages.find(p => p.status === "PASS" && p.preview.runtime);
  assert(valid); pageRow(valid);
  for (const mutate of [
    p => { p.geometry.saveHit = false; },
    p => { p.preview.runtime.screen = "wrong-page"; },
    p => { p.author.otherTypeUnchanged = false; },
    p => { p.author.persisted.style.backgroundColor = "#ffffff"; },
    p => { p.preview.geometry.regions[0].rect.right = p.preview.geometry.panel.right + 20; },
  ]) {
    const bad = structuredClone(valid); mutate(bad); assert.throws(() => pageRow(bad));
  }
  for (const patch of [{ status: "RUNNING" }, { status: "PASS", finishedAt: null }])
    assert.throws(() => summary({ ...r, ...patch }));
  console.log(JSON.stringify({ status: "PASS", scope: "AUDIT_TOOL_ONLY_NOT_COMPLETED_AUTHOR_MATRIX", rejectedControls: 7 }));
} else {
  assert.equal(process.argv[2], "01");
  const out = path.join(base, "layout-author-audit-01"); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), groups: [],
    scope: "INSTALLED_1924_FULL_PAGE_AUTHORING_BASELINE_NOT_RENDERED_COLORS_EXPORT_OR_ANDROID",
    productChanges: 0, modelRequests: 0, builds: 0 };
  function group(name, fn) {
    const item = { name, status: "RUNNING" }; report.groups.push(item);
    try { item.detail = fn(); item.status = "PASS"; }
    catch (error) { item.status = "FAILED"; item.error = String(error.stack || error); throw error; }
  }
  try {
    report.input = desc(path.join(source, "report.json")); const r = read(report.input.path);
    group("Complete 12-condition matrix, 204 authored pages and correct actual preview screens", () => {
      const result = summary(r);
      for (const patch of [{ ...r, pages: [] }, { ...r, matrix: r.matrix.slice(1) },
        { ...r, matrix: [...r.matrix.slice(0, -1), r.matrix[0]] }]) assert.throws(() => summary(patch));
      return result;
    });
    group("Actual installed candidate and exact archived executed source", () => {
      const bind = r.candidateBinding;
      assert.equal(bind.expectedVersion, "1.9.24");
      assert.equal(path.resolve(r.installation), path.resolve(base, "installation.json"));
      assert.equal(sha(bind.installation.path), bind.installation.sha256);
      const installed = read(bind.installation.path);
      assert.equal(installed.status, "PASS"); assert.equal(installed.metadataRestoration, "PASS");
      assert.equal(installed.executable.version, "1.9.24");
      for (const f of [installed.executable, ...installed.resources, ...installed.protectedFiles]) assert.equal(sha(f.path), f.sha256);
      const adapt = read(path.join(source, "candidate-source-adaptations.json"));
      assert.deepEqual(adapt.original, bind.originalBusiness); assert.equal(sha(adapt.original.path), adapt.original.sha256);
      assert.equal(adapt.changes.length, 3);
      let replay = fs.readFileSync(adapt.original.path, "utf8");
      for (const change of adapt.changes) {
        assert.equal(replay.split(change.before).length - 1, 1); replay = replay.replace(change.before, change.after);
      }
      assert.equal(fs.readFileSync(path.join(source, "executed-business.cjs"), "utf8"), replay);
      assert.equal(sha(r.tool.path), r.tool.sha256);
      assert.equal(sha(path.join(source, "executed-test.cjs")), r.tool.sha256);
      return { version: "1.9.24", exactSourceTransformations: 3, originalToolsUnchanged: true };
    });
    group("Persisted final controls, independent layouts and full process restart", () => {
      const profiles = r.profiles.profiles;
      for (const type of ["agentvn", "renpy"]) for (const [id, componentId] of Object.entries(type === "agentvn" ? standard : renpy)) {
        const row = r.pages.filter(p => p.type === type && p.id === id).at(-1);
        const screen = profiles[type].screens.find(s => s.screen_id === id);
        assert.deepEqual(screen.components.find(c => c.component_id === componentId), row.author.persisted);
      }
      const restart = r.steps.find(s => s.label === "Process restart preserves two layout profiles");
      assert(restart && restart.status === "PASS" && restart.finishedAt); assert.equal(r.launches.length, 2);
      for (const l of r.launches) {
        assert.equal(l.executable.version, "1.9.24"); assert.equal(l.sourceServer, false);
        assert.equal(l.manualBackendSpawn, false); assert.equal(l.dataDirectoryOverride, true); assert.equal(l.webviewDirectoryOverride, true);
        assert.equal(path.resolve(l.isolation.AGENTVN_WORKSPACE_OUTPUT), path.resolve(source));
        assert.equal(sha(l.backend.ExecutablePath), l.backend.sha256);
      }
      return { controls: 17, actualInstalledLaunches: 2, defaultProfileClaimed: false, normalCloseClaimed: false };
    });
    group("Actual display parameters, 24 PNG dimensions and original cache/process restoration", () => {
      assert.equal(r.screenshots.length, 24);
      for (const shot of r.screenshots) {
        assert.equal(sha(shot.path), shot.sha256); assert.deepEqual(shot.before, shot.after);
        const png = fs.readFileSync(shot.path), d = shot.before;
        assert.equal(png.readUInt32BE(16), d.width * d.dpr); assert.equal(png.readUInt32BE(20), d.height * d.dpr);
        assert(r.matrix.some(m => m.width === d.width && m.height === d.height && m.dpr === d.dpr && m.reduced === d.reduced));
      }
      assert.equal(r.nativeCacheRestoration, "PASS");
      assert.deepEqual(r.cache.map(c => c.action), ["SelfTest", "Prepare", "Restore"]);
      assert(r.cache.every(c => c.exitCode === 0));
      const protection = read(path.join(source, "native-cache-protection.json"));
      const restored = read(path.join(source, "native-cache-restoration.json"));
      assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
      assert.equal(restored.originalDirectory, protection.original); assert.equal(restored.originalDirectoryId, protection.directoryId);
      for (const f of protection.files) assert.equal(sha(path.join(protection.original, f.relative)), f.sha256);
      assert(!fs.existsSync(protection.held));
      assert.equal(protection.original, "C:\\Users\\1\\AppData\\Local\\Packages\\OpenAI.Codex_2p2nqsd0c76g0\\LocalCache\\Local\\com.agentvn.editor\\windows-env");
      const fileId = ps(`fsutil file queryfileid '${protection.original}';if($LASTEXITCODE){throw 'File id query failed'}`);
      assert(fileId.includes(protection.directoryId));
      assert.equal(r.cleanups.length, 2); assert(r.cleanups.every(c => c.status === "PASS" && c.normalCloseClaimed === false));
      assert.deepEqual(listeners(r.cleanups.flatMap(c => c.ports)), []);
      const all = rows(); assert(r.knownProcesses.length > 0);
      for (const p of r.knownProcesses) assert(!all.some(a => a.ProcessId === p.ProcessId && a.Created === p.Created));
      return { pngs: 24, restoredCacheFiles: protection.files.length, knownProcesses: r.knownProcesses.length };
    });
    report.status = "PASS";
  } catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString(); report.tool = desc(__filename);
    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify(report, null, 2));
  }
}
