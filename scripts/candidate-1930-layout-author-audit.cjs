"use strict";
// Independent terminal audit of all-page installed authoring, not new UI execution.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const base = "F:/AgentVN/QA/Editor-1.9.30-20261026-01";
const root = "F:/AgentVN/QA/Installed-Layout-20261021-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const standard = { title: "title_hero", player: "dialog_panel", game_menu: "game_menu_nav",
  save_load: "save_grid", preferences: "settings_group", history: "history_list",
  gallery: "gallery_grid", about: "about_panel" };
const special = ["confirmation", "nvl", "bubble"];
const pages = t => ({ ...standard, ...(t === "renpy" ? { help: "help_panel" } : {}),
  confirmation: "confirmation_panelStyle", nvl: "nvl_panelStyle", bubble: "bubble_panelStyle" });
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
    assert(r.left >= g.panel.left - 1 && r.right <= g.panel.right + 1
      && r.top >= g.panel.top - 1 && r.bottom <= g.panel.bottom + 1);
  }
}
function pageRow(p) {
  assert.equal(p.status, "PASS"); assert(["agentvn", "renpy"].includes(p.type));
  assert(pages(p.type)[p.id]); geometry(p.geometry); geometry(p.preview.geometry);
  assert(p.author.otherTypeUnchanged); assert.match(p.author.color, /^#[a-f\d]{6}$/);
  const actual = special.includes(p.id) || p.id === "player" || p.type === "renpy" && p.id !== "game_menu";
  if (special.includes(p.id)) {
    assert.equal(p.author.region, pages(p.type)[p.id]); assert(p.author.unrelatedSettingsUnchanged);
    assert.equal(p.author.persisted.panelStyle.backgroundColor, p.author.color);
    const r = p.preview.runtime, style = p.author.effectivePanelStyle;
    assert.deepEqual(r, p.previewProbe);
    const channels = r.renderedBackground.match(/^rgba?\(([^)]+)\)$/);
    assert(channels); const rgba = channels[1].split(",").map(Number);
    if (rgba.length === 3) rgba.push(1);
    const rgb = p.author.color.slice(1).match(/../g).map(n => parseInt(n, 16));
    const split = p.id === "confirmation" && (style.backgroundOpacity !== undefined || style.contentOpacity !== undefined);
    const alpha = style.backgroundOpacity ?? style.opacity ?? .78;
    assert.deepEqual(rgba, [...rgb, split ? 1 : alpha]);
    assert.equal(Number(r.opacity), split ? alpha : style.opacity ?? 1);
    assert(r.visible && r.opacity > 0 && !r.focusUnavailable && r.overflow <= 1);
    rect(r.rect);
    assert(r.rect.left >= -1 && r.rect.top >= -1
      && r.rect.right <= r.viewport.width + 1 && r.rect.bottom <= r.viewport.height + 1);
    if (p.id === "confirmation") assert.equal(r.layoutType, p.type);
    else { assert.equal(r.mode, p.id); assert(r.content.trim()); }
    assert(p.preview.savedStyleConsumed);
  } else {
    assert.equal(p.author.component, pages(p.type)[p.id]);
    assert.equal(p.author.persisted.component_id, p.author.component);
    assert.equal(p.author.persisted.style.backgroundColor, p.author.color);
    if (actual) assert.equal(p.preview.runtime.screen, screens[p.id]);
  }
  assert.equal(p.preview.kind, actual ? "ACTUAL_INSTALLED_RUNTIME_IFRAME" : "AUTHOR_DIAGRAM_NOT_RUNTIME");
  if (actual) assert(p.preview.runtime.overflow <= 1);
  return actual;
}
function summary(r) {
  assert.equal(r.status, "PASS"); assert(r.finishedAt && !r.error && !r.cleanupError && !r.captureError);
  assert.equal(r.candidateVersion, "1.9.30"); assert.equal(r.mode, "author");
  assert.deepEqual(r.testedTypes, ["agentvn", "renpy"]); assert.equal(r.expectedPages, 23);
  assert.equal(r.pages.length, 276); assert.equal(r.matrix.length, 12); assert.equal(r.steps.length, 278);
  assert(r.steps.every(s => s.status === "PASS" && s.finishedAt));
  assert.deepEqual(r.errors, []); assert.equal(r.modelRequests, 0); assert.equal(r.blockedModelRequests || 0, 0);
  let runtime = 0;
  for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]])
    for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      const match = v => v.width === width && v.height === height && v.dpr === dpr && v.reduced === reduced;
      const cells = r.matrix.filter(match); assert.equal(cells.length, 1);
      assert.equal(cells[0].status, "PASS"); assert.equal(cells[0].pageCount, 23);
      const cellPages = r.pages.filter(p => match(p.display)); assert.equal(cellPages.length, 23);
      for (const type of ["agentvn", "renpy"]) for (const id of Object.keys(pages(type))) {
        const found = cellPages.filter(p => p.type === type && p.id === id); assert.equal(found.length, 1);
        runtime += Number(pageRow(found[0]));
      }
    }
  assert.equal(runtime, 180);
  return { displays: 12, pages: 276, actualRuntimePreviews: runtime, authorDiagrams: 96,
    specialSavedMaterialPreviews: 72, allOtherPageRenderedColorCorrespondenceClaimed: false };
}
function selfTest() {
  const r = read(path.join(root, "editor-69/report.json"));
  const normal = r.pages.find(p => p.status === "PASS" && p.id === "player");
  const specialRow = r.pages.find(p => p.status === "PASS" && p.id === "confirmation");
  assert(normal && specialRow); pageRow(normal); pageRow(specialRow);
  let rejected = 0;
  for (const [input, mutate] of [
    [normal, p => p.geometry.saveHit = false], [normal, p => p.preview.runtime.screen = "wrong"],
    [normal, p => p.author.otherTypeUnchanged = false],
    [normal, p => p.author.persisted.style.backgroundColor = "#ffffff"],
    [normal, p => p.geometry.regions[0].rect.right = p.geometry.panel.right + 20],
    [specialRow, p => p.preview.runtime.renderedBackground = "rgb(55, 73, 112)"],
    [specialRow, p => p.author.unrelatedSettingsUnchanged = false],
    [specialRow, p => p.preview.runtime.rect.right = p.preview.runtime.viewport.width + 50],
    [specialRow, p => p.preview.runtime.focusUnavailable = true],
    [specialRow, p => p.preview.savedStyleConsumed = false],
  ]) {
    const bad = structuredClone(input); mutate(bad); assert.throws(() => pageRow(bad)); rejected++;
  }
  for (const mutate of [x => x.status = "RUNNING", x => x.pages = [], x => x.matrix = [],
    x => x.finishedAt = null]) {
    const bad = structuredClone(r); mutate(bad); assert.throws(() => summary(bad)); rejected++;
  }
  console.log(JSON.stringify({ status: "PASS", rejected, nativeApps: 0, modelRequests: 0 }));
}
function audit(attempt, auditAttempt) {
  assert.match(attempt, /^\d{2}$/); assert.match(auditAttempt, /^\d{2}$/);
  const source = path.join(root, `editor-${attempt}`), out = path.join(base, `layout-author-audit-${attempt}-${auditAttempt}`);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), groups: [],
    scope: "INSTALLED_1930_ALL_PAGE_AUTHORING_NOT_STANDALONE_EXPORT_OR_ANDROID",
    productChanges: 0, modelRequests: 0, builds: 0 };
  function group(name, fn) {
    const item = { name, status: "RUNNING" }; report.groups.push(item);
    try { item.detail = fn(); item.status = "PASS"; }
    catch (e) { item.status = "FAILED"; item.error = String(e.stack || e); throw e; }
  }
  try {
    report.input = desc(path.join(source, "report.json")); const r = read(report.input.path);
    group("276 authored pages, 12 displays and72 saved special-page Runtime materials", () => {
      const actual = summary(r);
      const malformed = [
        x => x.pages = [], x => x.matrix = [], x => x.matrix[1] = x.matrix[0],
        x => x.pages[1] = x.pages[0], x => x.steps.pop(),
        x => x.modelRequests = 1, x => x.pages[0].geometry.saveHit = false,
        x => x.pages.find(p => p.id === "confirmation").preview.savedStyleConsumed = false,
        x => x.pages.find(p => p.id === "confirmation").preview.runtime.renderedBackground = "rgb(0, 0, 0)",
      ];
      for (const mutate of malformed) { const bad = structuredClone(r); mutate(bad); assert.throws(() => summary(bad)); }
      return { ...actual, malformedCompleteReportsRejected: malformed.length };
    });
    group("Actual installation receipt and exact original/executed QA bytes", () => {
      const installed = require("./candidate-1930-exit.cjs").validateInstallation(r.installation);
      const prep = path.join(base, `layout-author-preparation-${attempt}`), binding = read(path.join(prep, "binding.json"));
      for (const f of [binding.source, binding.executed, binding.adapter, r.tool]) assert.equal(sha(f.path), f.sha256);
      assert.equal(sha(path.join(source, "executed-test.cjs")), r.tool.sha256);
      const built = require("./candidate-1930-layout-author.cjs").build(fs.readFileSync(binding.source.path, "utf8"));
      assert.deepEqual(built.adaptations, binding.adaptations);
      assert.equal(built.source, fs.readFileSync(binding.executed.path, "utf8"));
      return { installedVersion: installed.version, exactTransformations: built.adaptations.length };
    });
    group("Persisted independent profiles, real process restart and readonly SQLite", () => {
      assert.equal(r.launches.length, 2);
      for (const launch of r.launches) {
        assert(launch.dataDirectoryOverride && launch.webviewDirectoryOverride && !launch.sourceServer && !launch.manualBackendSpawn);
        assert.equal(sha(launch.executable.path), launch.executable.sha256);
        assert.equal(sha(launch.backend.ExecutablePath), launch.backend.sha256);
        assert.equal(launch.backend.ParentProcessId, launch.pid); assert.equal(launch.listeners.length, 2);
        assert.equal(path.resolve(launch.isolation.AGENTVN_WORKSPACE_OUTPUT), path.resolve(source));
      }
      assert.notEqual(r.launches[0].created, r.launches[1].created);
      for (const type of ["agentvn", "renpy"]) for (const id of Object.keys(pages(type))) {
        const p = r.pages.filter(p => p.type === type && p.id === id).at(-1), layout = r.profiles.profiles[type];
        const final = id === "confirmation" ? layout.confirmationLayout
          : special.includes(id) ? layout.dialogueLayouts[id]
            : layout.screens.find(s => s.screen_id === id).components.find(c => c.component_id === pages(type)[id]);
        assert.deepEqual(final, p.author.persisted);
        if (special.includes(id)) {
          const shared = layout.screens.find(s => s.screen_id === "player").components.find(c => c.component_type === "dialog_panel").style;
          assert.deepEqual(p.author.effectivePanelStyle, { ...(id === "confirmation" ? {} : shared), ...final.panelStyle });
        }
      }
      const original = path.join(source, "data/backend/vn_engine.db"), before = desc(original), copy = path.join(out, "vn_engine.readonly.db");
      fs.copyFileSync(original, copy, fs.constants.COPYFILE_EXCL);
      const db = new DatabaseSync(copy, { readOnly: true });
      try {
        const all = db.prepare("SELECT project_json FROM editor_project_details").all();
        assert.equal(all.length, 1);
        assert.deepEqual(JSON.parse(all[0].project_json).editor_settings.runtimeUILayoutProfiles, r.profiles);
      } finally { db.close(); }
      assert.equal(sha(original), before.sha256); assert.equal(sha(copy), before.sha256);
      return { savedControls: 23, actualHostStarts: 2, database: before, defaultProfileOrNormalCloseClaimed: false };
    });
    group("96 real PNG dimensions, viewport/DPR/media and zero capture side effects", () => {
      assert.equal(r.screenshots.length, 96);
      for (const shot of r.screenshots) {
        assert.equal(sha(shot.path), shot.sha256); assert.deepEqual(shot.before, shot.after);
        const cell = r.matrix.find(m => m.width === shot.before.width && m.height === shot.before.height
          && Math.abs(m.dpr - shot.before.dpr) <= 1e-6 && m.reduced === shot.before.reduced);
        assert(cell); validateNativeViewport(shot.before, cell); validateNativeViewport(shot.after, cell);
        const bytes = fs.readFileSync(shot.path);
        assert.equal(bytes.readUInt32BE(16), cell.width * cell.dpr); assert.equal(bytes.readUInt32BE(20), cell.height * cell.dpr);
      }
      return { pngs: 96, physical4KClaimed: false };
    });
    group("Original cache identity/bytes restored, every owned process and port closed", () => {
      assert.equal(r.nativeCacheRestoration, "PASS");
      assert.deepEqual(r.cache.map(c => c.action), ["SelfTest", "Prepare", "Restore"]);
      assert(r.cache.every(c => c.exitCode === 0));
      const protection = read(path.join(source, "native-cache-protection.json"));
      const restored = read(path.join(source, "native-cache-restoration.json"));
      assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
      assert.equal(restored.originalDirectory, protection.original); assert.equal(restored.originalDirectoryId, protection.directoryId);
      assert(!fs.existsSync(protection.held));
      for (const f of protection.files) assert.equal(sha(path.join(protection.original, f.relative)), f.sha256);
      assert(ps(`fsutil file queryfileid '${protection.original}';if($LASTEXITCODE){throw 'File id query failed'}`).includes(protection.directoryId));
      assert.equal(r.cleanups.length, 2); assert(r.cleanups.every(c => c.status === "PASS" && c.normalCloseClaimed === false));
      assert.deepEqual(listeners(r.cleanups.flatMap(c => c.ports)), []);
      const all = rows(); assert(r.knownProcesses.length > 0);
      for (const p of r.knownProcesses) assert(!all.some(a => a.ProcessId === p.ProcessId && a.Created === p.Created));
      return { restoredFiles: protection.files.length, ownedProcesses: r.knownProcesses.length, survivors: 0 };
    });
    assert.equal(sha(report.input.path), report.input.sha256);
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString(); report.tool = desc(__filename);
    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify(report, null, 2));
  }
}
module.exports = { pageRow, summary };
if (require.main === module) process.argv[2] === "--self-test" ? selfTest() : audit(process.argv[2], process.argv[3]);
