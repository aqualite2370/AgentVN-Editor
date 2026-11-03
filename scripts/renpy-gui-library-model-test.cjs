"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."), attempt = process.argv[2];
assert.match(attempt, /^(red|green)-\d{2}$/);
const out = `F:/AgentVN/QA/Renpy-Redesign-20261021-01/gui-library-model-${attempt}`;
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const compiled = require("../editor/node_modules/esbuild").buildSync({
  stdin: { loader: "ts", resolveDir: root, contents: `
    export * from "./editor/src/renpy/guiPackLibrary";
    export * from "./editor/src/renpy/guiPackApplication";
    export {scanRenpyGuiArchive} from "./editor/src/renpy/renpyGuiImport";
    export {createRenpyUILayout} from "./shared/cartridge/uiLayoutProfiles";
    export {renpyGUIErrors} from "./shared/cartridge/renpyGui";` },
  bundle: true, platform: "node", format: "cjs", write: false,
});
const mod = { exports: {} };
new Function("module", "exports", "require", compiled.outputFiles[0].text)(mod, mod.exports, require);
const api = mod.exports;
const report = { status: "RUNNING", scope: "SOURCE_REAL_SCANNER_LIBRARY_AND_APPLICATION_PREPARATION", cases: [] };
const check = async (name, fn) => { await fn(); report.cases.push({ name, status: "PASS" }); };
(async () => {
  const JSZip = require("../editor/node_modules/jszip"), zip = new JSZip();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Lz4AAAAASUVORK5CYII=", "base64");
  zip.file("gui.rpy", "define gui.navigation_xpos = 44\ndefine gui.navigation_spacing = 12\n");
  zip.file("中文/idle.png", png);
  const scan = await api.scanRenpyGuiArchive(await zip.generateAsync({ type: "uint8array" }));
  const options = { name: "中文 GUI", sourceName: "C:/explicit/source/模板.zip", assetPaths: ["中文/idle.png"],
    parameterSelection: { "shared.x": true }, assetBindings: { "中文/idle.png": "title_background" } };
  let record;
  await check("curated-record-byte-roundtrip-no-machine-path-or-project-identity", () => {
    const before = structuredClone(scan);
    record = api.createGuiPack(scan, options);
    assert.equal(record.sourceName, "模板.zip");
    assert.deepEqual(api.decodeGuiPack(api.encodeGuiPack(record)), record);
    assert.equal(Buffer.from(record.scan.assets[0].bytes).compare(png), 0);
    assert.deepEqual(scan, before);
    assert(!api.encodeGuiPack(record).includes("C:/explicit"));
  });
  await check("reimport-is-a-new-reviewable-revision-not-mutation", () => {
    const original = api.encodeGuiPack(record);
    const revision = api.createGuiPack(scan, { ...options, previous: record });
    assert.notEqual(revision.id, record.id); assert.equal(revision.parentId, record.id); assert.equal(revision.revision, 2);
    assert.equal(api.encodeGuiPack(record), original);
    const independent = api.createGuiPack(scan, options);
    assert.notEqual(independent.id, record.id); assert.equal(independent.revision, 1);
  });
  await check("invalid-records-and-unsafe-scans-rejected-before-persistence", () => {
    const bad = JSON.parse(api.encodeGuiPack(record));
    bad.projectId = "private"; assert.throws(() => api.decodeGuiPack(JSON.stringify(bad)), /INVALID/);
    for (const invalid of ["../escape.png", "C:/outside.png", "gui\\x.png"]) {
      assert.throws(() => api.createGuiPack({ ...scan, assets: [{ ...scan.assets[0], path: invalid }] }, options), /INVALID/);
    }
    assert.throws(() => api.createGuiPack({ ...scan, issues: [{ code: "symbolic_link", message: "blocked" }] }, options), /INVALID/);
    assert.throws(() => api.createGuiPack(scan, { ...options, assetPaths: [], parameterSelection: {} }), /INVALID/);
  });
  const layout = api.createRenpyUILayout();
  const base = { layout, existingAssets: [], scan, parameterSelection: {},
    assetSelection: { "中文/idle.png": "add" }, assetBindings: { "中文/idle.png": "control_background" },
    scope: { kind: "control", screenId: "title", componentId: "title_start_button", state: "hover" } };
  await check("one-control-one-state-keeps-graphical-code-and-other-controls", () => {
    const selected = layout.screens.find(s => s.screen_id === "title").components.find(c => c.component_id === "title_start_button");
    selected.presentation = { version: 1, html: '<span class="root"><slot name="content"></slot></span>', css: ".root { color: #ffffff; }" };
    const original = structuredClone(layout);
    const result = api.prepareGuiPackApplication(base);
    const actual = result.layout.screens.find(s => s.screen_id === "title").components.find(c => c.component_id === selected.component_id);
    assert.deepEqual(actual.presentation, selected.presentation);
    assert.equal(actual.stateStyles.hover.backgroundImage, `asset:${result.importedAssetIds[0]}`);
    assert.equal(actual.stateStyles.selected, selected.stateStyles?.selected);
    assert.deepEqual(layout, original);
    for (const screen of result.layout.screens) for (const c of screen.components)
      if (c.component_id !== selected.component_id)
        assert.deepEqual(c, original.screens.find(s => s.screen_id === screen.screen_id).components.find(v => v.component_id === c.component_id));
    assert.equal(Buffer.from(result.assets[0].metadata.data_url.split(",")[1], "base64").compare(png), 0);
  });
  await check("page-application-never-adds-unsupported-gui-scope", () => {
    const result = api.prepareGuiPackApplication({ ...base, assetBindings: {}, scope: { kind: "page", screenId: "game_menu" } });
    assert.deepEqual(api.renpyGUIErrors(result.layout.renpy), []);
    assert.deepEqual(result.layout.renpy, layout.renpy, "No selected GUI parameters means no GUI object write");
  });
  await check("page-parameter-application-does-not-touch-shared-or-other-page", () => {
    const result = api.prepareGuiPackApplication({ ...base, assetBindings: {}, parameterSelection: { "shared.x": true },
      scope: { kind: "page", screenId: "help" } });
    assert.equal(result.layout.renpy.help.x, 44);
    assert.deepEqual(result.layout.renpy.shared, layout.renpy?.shared);
    assert.deepEqual(result.layout.renpy.about, layout.renpy?.about);
    assert.deepEqual(api.renpyGUIErrors(result.layout.renpy), []);
    assert.throws(() => api.prepareGuiPackApplication({ ...base, parameterSelection: { "shared.x": true } }), /SCOPE_PARAMETERS/);
  });
  await check("scope-conflicts-locked-controls-and-duplicate-targets-are-atomic", () => {
    const original = structuredClone(layout);
    assert.throws(() => api.prepareGuiPackApplication({ ...base,
      scope: { kind: "control", screenId: "player", componentId: "stage_background", state: "normal" } }), /LOCKED/);
    assert.throws(() => api.prepareGuiPackApplication({ ...base,
      assetBindings: { "中文/idle.png": "interface_font" } }), /FONT/);
    const second = { ...scan.assets[0], path: "中文/other.png", name: "other.png" };
    assert.throws(() => api.prepareGuiPackApplication({ ...base, scan: { ...scan, assets: [...scan.assets, second] },
      assetSelection: { "中文/idle.png": "add", "中文/other.png": "add" },
      assetBindings: { "中文/idle.png": "control_background", "中文/other.png": "control_background" } }), /CONFLICT/);
    assert.deepEqual(layout, original);
  });
  await check("local-scope-cannot-replace-bytes-shared-by-other-controls", () => {
    const prior = api.prepareGuiPackApplication({ ...base, scope: { kind: "project" },
      assetBindings: { "中文/idle.png": "title_background" } });
    const original = structuredClone(prior.assets);
    assert.throws(() => api.prepareGuiPackApplication({ ...base, layout: prior.layout, existingAssets: prior.assets,
      assetSelection: { "中文/idle.png": "replace" } }), /SCOPE_REPLACE/,
      "A local-scope application must copy dependencies rather than replacing bytes used elsewhere");
    assert.deepEqual(prior.assets, original);
  });
  await check("active-layout-scope-cannot-replace-bytes-referenced-by-inactive-layout", () => {
    const prior = api.prepareGuiPackApplication({ ...base, scope: { kind: "project" },
      assetBindings: { "中文/idle.png": "title_background" } });
    const original = structuredClone(prior);
    assert.throws(() => api.prepareGuiPackApplication({ ...base, layout: prior.layout, existingAssets: prior.assets,
      scope: { kind: "project" }, assetBindings: { "中文/idle.png": "title_background" },
      assetSelection: { "中文/idle.png": "replace" } }), /SCOPE_REPLACE/,
      "Even active-layout scope must copy; shared asset IDs can be referenced by the inactive profile");
    assert.deepEqual(prior, original);
    const copied = api.prepareGuiPackApplication({ ...base, layout: prior.layout, existingAssets: prior.assets,
      scope: { kind: "project" }, assetBindings: { "中文/idle.png": "title_background" } });
    assert.equal(copied.assets.length, prior.assets.length + 1);
    assert.notEqual(copied.importedAssetIds[0], prior.importedAssetIds[0]);
    assert.deepEqual(copied.assets[0], prior.assets[0]);
  });
  assert.equal(report.cases.length, 9); report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
  .finally(() => { fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, out })); });
