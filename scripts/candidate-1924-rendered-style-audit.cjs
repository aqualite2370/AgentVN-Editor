"use strict";
// Independently verify recorded paint samples. No product launch or model call.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const source = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-52";
const base = "F:/AgentVN/QA/Editor-1.9.24-20261024-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const screens = { title: "title_menu", player: "playing", save_load: "save_load", preferences: "settings",
  history: "history", gallery: "gallery", about: "about", help: "help" };
const controls = { title: "title_hero", player: "dialog_panel", save_load: "save_grid", preferences: "settings_group",
  history: "history_list", gallery: "gallery_grid", about: "about_panel", help: "help_panel" };
const key = d => `${d.width}/${d.height}/${d.dpr}/${d.reduced}`;
const combinations = [[1920, 1080], [2560, 1440], [3840, 2160]]
  .flatMap(([width, height]) => [1, 2].flatMap(dpr => [false, true].map(reduced => ({ width, height, dpr, reduced }))));
function color(sample) {
  assert.equal(sample.roots, 1); assert(sample.layers.length >= 3); assert.match(sample.expected, /^#[a-f\d]{6}$/i);
  const expected = [1, 3, 5].map(n => parseInt(sample.expected.slice(n, n + 2), 16));
  const matching = sample.layers.filter(layer => {
    if (!layer.visible || layer.opacity <= 0 || layer.pseudo) return false;
    const m = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(layer.backgroundColor);
    return m && expected.every((v, i) => v === Number(m[i + 1])) && Number(m[4] ?? 1) > 0
      && layer.rect.width > 0 && layer.rect.height > 0;
  });
  assert(matching.length, `${sample.type}/${sample.page} visible material color differs`);
  if (sample.page === "title") {
    assert.equal(sample.type, "renpy");
    assert.equal(matching.length, 1);
    assert.equal(matching[0].className, "main-menu-title-hero-background");
    assert.equal(sample.layers.filter(l => l.className === "renpy-title-heading" && !l.pseudo).length, 1);
  }
  assert.equal(sample.corresponds, true);
  return matching;
}
function matrix(r, author) {
  assert.equal(r.status, "PASS"); assert(r.finishedAt && !r.error && !r.cleanupError && !r.captureError);
  assert.equal(r.mode, "survey"); assert.equal(r.pages.length, 204); assert.equal(r.matrix.length, 12);
  assert.equal(r.renderSamples.length, 108); assert.deepEqual(r.renderFailures, []);
  assert.equal(r.steps.length, 206); assert(r.steps.every(s => s.status === "PASS" && s.finishedAt));
  assert.deepEqual(r.errors, []); assert.equal(r.modelRequests, 0); assert.equal(r.blockedModelRequests || 0, 0);
  for (const display of combinations) {
    assert.equal(r.matrix.filter(m => key(m) === key(display) && m.status === "PASS" && m.pageCount === 17).length, 1);
    const samples = r.renderSamples.filter(s => key(s.display) === key(display));
    assert.equal(samples.length, 9);
    for (const [type, ids] of [["agentvn", ["player"]], ["renpy", Object.keys(controls)]]) for (const id of ids) {
      const matches = samples.filter(s => s.type === type && s.page === id); assert.equal(matches.length, 1);
      const sample = matches[0]; assert.equal(sample.componentId, controls[id]); color(sample);
      const expected = author.profiles.profiles[type].screens.find(s => s.screen_id === id)
        .components.find(c => c.component_id === controls[id]).style.backgroundColor;
      assert.equal(sample.expected, expected);
      const pages = r.pages.filter(p => p.type === type && p.id === id && key(p.display) === key(display));
      assert.equal(pages.length, 1);
      const row = pages[0]; assert.equal(row.status, "PASS");
      assert.equal(row.preview.kind, "ACTUAL_INSTALLED_RUNTIME_IFRAME");
      assert.equal(row.preview.runtime.screen, screens[id]); assert(row.preview.runtime.overflow <= 1);
      assert.deepEqual(row.preview.controlStyle, sample);
      for (const g of [row.geometry, row.preview.geometry]) {
        assert(g.saveHit && g.overflow <= 1 && g.rail.right <= g.panel.left + 1);
        assert(g.regions.length >= 3);
        for (const { rect: b, overflow, display: mode } of g.regions)
          assert(b.width > 0 && b.height > 0 && overflow <= 1 && mode !== "none"
            && b.left >= g.panel.left - 1 && b.right <= g.panel.right + 1
            && b.top >= g.panel.top - 1 && b.bottom <= g.panel.bottom + 1);
      }
    }
  }
  return { displayConditions: 12, actualPaintSamples: 108, authorDiagramsNotClaimedAsRuntime: 96,
    scope: "VISIBLE_COMPUTED_RGB_NOT_PIXEL_MATCH_OR_EXPORTED_GAME" };
}
const r = read(path.join(source, "report.json")), author = read(r.fixturePreparation.source);
if (process.argv[2] === "--self-test") {
  const good = r.renderSamples.find(s => s.corresponds); assert(good); color(good);
  for (const mutate of [
    s => { s.roots = 0; },
    s => { s.layers = []; },
    s => { s.corresponds = false; },
    s => { s.layers.forEach(l => { l.opacity = 0; }); },
    s => { s.layers.forEach(l => { l.backgroundColor = "rgba(0, 0, 0, 0)"; }); },
    s => { s.layers.forEach(l => { l.visible = false; }); },
  ]) { const bad = structuredClone(good); mutate(bad); assert.throws(() => color(bad)); }
  assert.throws(() => matrix({ ...r, status: "RUNNING" }, author));
  assert.throws(() => matrix({ ...r, renderSamples: [] }, author));
  console.log(JSON.stringify({ status: "PASS", badEvidenceRejected: 8, scope: "AUDIT_SELF_TEST_ONLY" }));
} else {
  assert.equal(process.argv[2], "01");
  const out = path.join(base, "rendered-style-audit-01"); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), input: desc(path.join(source, "report.json")),
    groups: [], scope: "INSTALLED_1924_PREVIEW_STYLE_CORRESPONDENCE_NOT_EXPORT_GUI_CODE_OR_ANDROID",
    productChanges: 0, builds: 0, modelRequests: 0 };
  function group(name, fn) {
    const item = { name, status: "RUNNING" }; report.groups.push(item);
    try { item.detail = fn(); item.status = "PASS"; }
    catch (e) { item.status = "FAILED"; item.error = String(e.stack || e); throw e; }
  }
  try {
    group("Complete display matrix and actual control material colors", () => matrix(r, author));
    group("Frozen installation, fixture provenance and archived source replay", () => {
      const installation = read(r.installation); assert.equal(installation.status, "PASS");
      assert.equal(installation.executable.version, "1.9.24");
      for (const f of [installation.executable, ...installation.resources, ...installation.protectedFiles])
        assert.equal(sha(f.path), f.sha256);
      assert.equal(r.fixturePreparation.kind, "CONTROLLED_COPY_OF_PREVIOUS_ACTUAL_AUTHOR_PROFILES_NOT_NEW_AUTHOR_OR_EXPORT");
      assert.equal(sha(r.fixturePreparation.source), r.fixturePreparation.sha256); assert.equal(author.status, "PASS");
      assert.deepEqual(r.profiles.profiles, author.profiles.profiles);
      const adaptations = read(path.join(source, "adaptations.json"));
      assert.equal(adaptations.filter(a => a.stage).length, 9);
      const inner = adaptations.filter(a => !a.stage); assert.equal(inner.length, 7);
      let replay = fs.readFileSync(path.resolve(__dirname, "installed-layout-pages-current.cjs"), "utf8");
      for (const a of inner) { assert.equal(replay.split(a.before).length - 1, 1); replay = replay.replace(a.before, a.after); }
      assert.equal(replay, fs.readFileSync(path.join(source, "executed-business.cjs"), "utf8"));
      assert.equal(sha(path.join(source, "executed-test.cjs")), r.tool.sha256); assert.equal(sha(r.tool.path), r.tool.sha256);
      assert.equal(read("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-51/report.json").status, "FAILED");
      return { version: "1.9.24", originalFailurePreserved: true, exactBusinessTransformations: inner.length };
    });
    group("132 parameterized PNGs and actual process restart", () => {
      assert.equal(r.screenshots.length, 132); assert.equal(new Set(r.screenshots.map(s => s.path)).size, 132);
      for (const shot of r.screenshots) {
        assert.equal(sha(shot.path), shot.sha256); assert.deepEqual(shot.before, shot.after);
        assert(combinations.some(d => key(d) === key(shot.before)));
        const png = fs.readFileSync(shot.path);
        assert.equal(png.readUInt32BE(16), shot.before.width * shot.before.dpr);
        assert.equal(png.readUInt32BE(20), shot.before.height * shot.before.dpr);
      }
      assert.equal(r.launches.length, 2);
      for (const l of r.launches) {
        assert.equal(l.executable.version, "1.9.24"); assert.equal(l.sourceServer, false); assert.equal(l.manualBackendSpawn, false);
        assert.equal(l.dataDirectoryOverride, true); assert.equal(l.webviewDirectoryOverride, true);
        assert.equal(path.resolve(l.isolation.AGENTVN_WORKSPACE_OUTPUT), path.resolve(source));
        assert.equal(sha(l.backend.ExecutablePath), l.backend.sha256);
      }
      return { pngs: 132, actualInstalledLaunches: 2, physical4kOrDefaultProfileClaimed: false };
    });
    group("Original cache directory and exact process/port restoration", () => {
      assert.equal(r.nativeCacheRestoration, "PASS");
      assert.deepEqual(r.cache.map(c => c.action), ["SelfTest", "Prepare", "Restore"]); assert(r.cache.every(c => c.exitCode === 0));
      const protection = read(path.join(source, "native-cache-protection.json"));
      const restored = read(path.join(source, "native-cache-restoration.json"));
      assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
      assert.equal(restored.originalDirectory, protection.original); assert.equal(restored.originalDirectoryId, protection.directoryId);
      for (const f of protection.files) assert.equal(sha(path.join(protection.original, f.relative)), f.sha256);
      assert(!fs.existsSync(protection.held));
      const fileId = ps(`fsutil file queryfileid '${protection.original}';if($LASTEXITCODE){throw 'File id query failed'}`);
      assert(fileId.includes(protection.directoryId));
      assert.equal(r.cleanups.length, 2); assert(r.cleanups.every(c => c.status === "PASS" && c.normalCloseClaimed === false));
      assert.deepEqual(listeners(r.cleanups.flatMap(c => c.ports)), []);
      const current = rows(); assert(r.knownProcesses.length > 0);
      for (const p of r.knownProcesses) assert(!current.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created));
      return { restoredCacheFiles: protection.files.length, exactProcessIdentities: r.knownProcesses.length };
    });
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString(); report.tool = desc(__filename);
    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify(report, null, 2));
  }
}
