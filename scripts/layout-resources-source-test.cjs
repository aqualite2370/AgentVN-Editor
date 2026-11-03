"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { createRequire } = require("node:module");
const root = path.resolve(__dirname, "..");
const qa = "F:/AgentVN/QA/Layout-Resources-Source-20261020-01";
const checkpoint = "F:/AgentVN/Checkpoints/Layout-Resources-Source-20261020-01";
const out = path.join(root, "output/layout-resources-source-20261020-01");
const req = createRequire(path.join(root, "editor/package.json"));
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const sources = ["shared/cartridge/uiLayoutProfiles.ts", "editor/src/cartridge/exportCartridge.ts"];
function api() {
  const module = { exports: {} };
  const compiled = req("esbuild").buildSync({ stdin: { resolveDir: root, loader: "ts", contents: `
    export * from "./shared/cartridge/uiLayoutProfiles";
    export { getDefaultUISkinLayout } from "./shared/cartridge/uiSkin";
    export * from "./editor/src/cartridge/exportCartridge";
    export { assetRefToManifestItem } from "./editor/src/utils/projectAssets";
  ` }, bundle: true, platform: "node", format: "cjs", packages: "external", write: false });
  // Execute the actual bundled product, not a reimplementation of dependency selection.
  new Function("module", "exports", "require", compiled.outputFiles[0].text)(module, module.exports, req);
  return module.exports;
}
function resourceFixture() {
  const a = api(), project = require("./lib/editor-ui-acceptance.cjs").fixture("layout-resources-source-20261020-01");
  project.title = "双布局资源裁剪隔离验收";
  const roles = ["agent-only", "renpy-only", "shared", "story-protected", "shell-protected", "gallery-protected", "unused-library"];
  const resources = roles.map((role, i) => {
    const bytes = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#${(0x183148 + i * 0x10100).toString(16)}"/><text x="80" y="140" fill="white" font-size="40">${role}</text></svg>`);
    const id = `qa-res-${role}`, projectPath = `assets/ui/${id}.svg`;
    project.asset_manifest.push({ asset_id: id, asset_type: "ui", metadata: { filename: `${role}.svg`,
      project_path: projectPath, mime_type: "image/svg+xml", width: 1280, height: 720,
      data_url: `data:image/svg+xml;base64,${bytes.toString("base64")}`, size_bytes: bytes.length,
      hash_sha256: sha(bytes), source: "imported" } });
    return { id, role, projectPath, sha256: sha(bytes) };
  });
  const agentvn = a.getDefaultUISkinLayout(), renpy = a.createRenpyUILayout();
  for (const [type, layout] of [["agentvn", agentvn], ["renpy", renpy]]) {
    layout.name = `QA ${type} 独立资源`;
    const roles = type === "agentvn" ? ["agent-only", "shared"]
      : ["renpy-only", "shared", "story-protected", "shell-protected", "gallery-protected"];
    layout.assets = resources.filter(r => roles.includes(r.role)).map(r => ({ asset_id: r.id, path: r.projectPath }));
    const hero = layout.screens.find(s => s.screen_id === "title").components.find(c => c.component_id === "title_hero");
    hero.style = { ...hero.style, backgroundImage: `asset:qa-res-${type === "agentvn" ? "agent" : "renpy"}-only` };
  }
  project.editor_settings = { ...a.resolveRuntimeUILayoutSettings({ runtimeUILayoutProfiles: {
    version: 1, activeType: "agentvn", profiles: { agentvn, renpy },
  } }), packageAppearance: { titleBackgroundAssetId: "qa-res-shell-protected", titleBackgroundFit: "stretch" } };
  project.nodes[1].data.scene.commands = [
    { type: "show_image", image_id: "qa-res-story-protected", duration: 0 },
    { type: "narration", text: "RESOURCE_STORY：剧情素材不得被裁剪。" },
    { type: "gallery_anchor", anchor_id: "qa-res-gallery", asset_id: "qa-res-gallery-protected", title: "资源依赖画廊" },
    { type: "narration", text: "RESOURCE_END：原始资源逐字节验收。" },
  ];
  return { project, resources };
}
function inputFor(project, type, legacy = false) {
  const a = api(), collection = structuredClone(project.editor_settings.runtimeUILayoutProfiles);
  collection.activeType = type;
  return { gameId: project.project_id, title: project.title, author: "QA", version: "1.0.0", language: "zh-CN",
    description: "", includeGallery: true, includeMetadata: false,
    projectAssets: project.asset_manifest.map(a.assetRefToManifestItem), projectAssetRefs: project.asset_manifest,
    ...(legacy ? { uiSkin: collection.profiles[type] } : { uiLayoutProfiles: collection }),
    packageAppearance: project.editor_settings.packageAppearance,
    script: { schema_version: "1.1.0", game_id: project.project_id, title: project.title, entry_scene_id: "ui_acceptance",
      characters: [], scenes: [project.nodes[1].data.scene] } };
}
async function verifyZip(bytes, type, resources) {
  const zip = await req("jszip").loadAsync(bytes), manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  const expected = ["shared", "story-protected", "shell-protected", "gallery-protected",
    type === "agentvn" ? "agent-only" : "renpy-only"].map(r => `qa-res-${r}`).sort();
  assert.deepEqual(manifest.assets.map(a => a.asset_id).sort(), expected, "Only active layout and actual dependencies belong in a cartridge");
  for (const r of resources) {
    const asset = manifest.assets.find(a => a.asset_id === r.id), entry = zip.file(r.projectPath);
    assert.equal(Boolean(entry), expected.includes(r.id), `ZIP byte presence ${r.id}`);
    if (asset) assert.equal(sha(await zip.file(asset.path).async("nodebuffer")), r.sha256, r.id);
  }
  return { ids: expected, sha256: sha(Buffer.from(bytes)) };
}
async function extendedCases(a, report) {
  const targetId = "qa-extra-dependency", orphanId = "qa-extra-unreferenced";
  const setters = [
    ["declared-layout-resource", (input, ref) => input.uiSkin.assets.push({ asset_id: targetId, path: ref.metadata.project_path })],
    ["exact-layout-image-path", (input, ref) => {
      input.uiSkin.screens[0].components[0].style = { backgroundImage: ref.metadata.project_path };
    }],
    ...["normal", "hover", "selected", "disabled"].map(state => [`gui-${state}-state-image`, input => {
      input.uiSkin.renpy = { shared: { buttonImages: { [state]: `asset:${targetId}` } } };
    }]),
    ["shared-font", input => { input.uiSkin.tokens.fontAssetId = targetId; }, "font"],
    ["component-font", input => { input.uiSkin.screens[0].components[0].style = { fontAssetId: targetId }; }, "font"],
    ["nvl-image", input => { input.uiSkin.dialogueLayouts = { nvl: { panelStyle: { backgroundImage: `asset:${targetId}` } } }; }],
    ["bubble-font", input => { input.uiSkin.dialogueLayouts = { bubble: { textStyle: { fontAssetId: targetId } } }; }, "font"],
    ["confirmation-image", input => { input.uiSkin.confirmationLayout = { panelStyle: { backgroundImage: `asset:${targetId}` } }; }],
    ["custom-component-image", input => {
      input.uiSkin.screens[0].components.push({ component_id: "qa_custom", component_type: "custom_component",
        rect: { x: 1, y: 1, width: 10, height: 10 }, customComponent: { schemaVersion: 1,
          root: { tag: "div", className: "root", children: [{ tag: "img", assetId: targetId, children: [] }] }, styles: {} } });
    }],
    ["choice-image-id", input => { input.script.scenes[0].commands.push({ type: "choice", choices: [{
      choice_id: "one", text: "Choice", target_scene_id: "ui_acceptance", conditions: [],
      button_style: { backgroundImage: `asset:${targetId}` },
    }] }); }],
    ["choice-image-path", (input, ref) => { input.script.scenes[0].commands.push({ type: "choice", choices: [{
      choice_id: "one", text: "Choice", target_scene_id: "ui_acceptance", conditions: [],
      button_style: { backgroundImage: ref.metadata.project_path },
    }] }); }],
    ["choice-command-font", input => { input.script.scenes[0].commands.push({ type: "choice",
      button_style: { fontAssetId: targetId }, choices: [{
        choice_id: "one", text: "Choice", target_scene_id: "ui_acceptance", conditions: [],
      }] }); }, "font"],
    ["character-dialog-image", input => { input.script.characters = [{ character_id: "qa", name: "QA",
      aliases: [], dialog_style: { background_asset_id: targetId } }]; }],
    ["opening-sequence-image", input => { input.script.loading_animation = { kind: "image_sequence", image_asset_ids: [targetId] }; }],
    ["settings-background", input => { input.packageAppearance.settingsPanelBackgroundAssetId = targetId; }],
    ["settings-entry-image", input => { input.packageAppearance.settingsEntryImageAssetId = targetId; }],
  ];
  report.extended = [];
  for (const [name, set, type = "ui"] of setters) {
    const row = { name, status: "RUNNING" }; report.extended.push(row);
    try {
      const { project } = resourceFixture(), input = inputFor(project, "renpy", true);
      const raw = type === "font" ? fs.readFileSync(path.join(root,
        "GameCli_framework/node_modules/harfbuzzjs/test/fonts/noto/NotoSans-Regular.ttf"))
        : Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="red"/></svg>');
      const ref = { asset_id: targetId, asset_type: type, metadata: {
        filename: `dependency.${type === "font" ? "ttf" : "svg"}`,
        project_path: `assets/${type}/dependency.${type === "font" ? "ttf" : "svg"}`,
        mime_type: type === "font" ? "font/ttf" : "image/svg+xml", data_url:
          `data:${type === "font" ? "font/ttf" : "image/svg+xml"};base64,${raw.toString("base64")}`,
      } };
      input.projectAssetRefs.push(ref); input.projectAssets.push(a.assetRefToManifestItem(ref));
      input.projectAssets.push({ asset_id: orphanId, asset_type: "ui", filename: "orphan.svg", path: "assets/ui/orphan.svg" });
      set(input, ref); const before = structuredClone(input);
      const exported = await a.exportEditorCartridge(input), zip = await req("jszip").loadAsync(await exported.blob.arrayBuffer());
      const ids = exported.manifest.assets.map(asset => asset.asset_id);
      assert.equal(ids.length, 6); assert(ids.includes(targetId)); assert(!ids.includes(orphanId));
      assert(!ids.includes("qa-res-agent-only") && !ids.includes("qa-res-unused-library"));
      const packed = exported.manifest.assets.find(asset => asset.asset_id === targetId);
      assert.equal(sha(await zip.file(packed.path).async("nodebuffer")), sha(raw));
      assert.deepEqual(input, before); assert.deepEqual(exported.assetReport.missingAssets, []);
      assert.deepEqual(exported.assetReport.placeholderAssets, []);
      row.status = "PASS"; row.byteSha256 = sha(raw);
    } catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); }
  }
  for (const missing of [false, true]) {
    const row = { name: missing ? "missing-story-placeholder-survives-pruning" : "no-layout-story-shell-gallery-only", status: "RUNNING" };
    report.extended.push(row);
    try {
      const { project } = resourceFixture(), input = inputFor(project, "agentvn", true);
      delete input.uiSkin;
      if (missing) input.script.scenes[0].commands.unshift({ type: "show_image", image_id: "qa-missing-story" });
      const result = await a.exportEditorCartridge(input), zip = await req("jszip").loadAsync(await result.blob.arrayBuffer());
      assert.equal(result.manifest.assets.length, missing ? 4 : 3);
      if (missing) {
        const placeholder = result.manifest.assets.find(a => a.asset_id === "qa-missing-story");
        assert(placeholder.placeholder && zip.file(placeholder.path));
        assert(result.assetReport.missingAssets.some(a => a.asset_id === "qa-missing-story"));
        assert(result.warnings.some(w => w.includes("qa-missing-story")));
      }
      assert(!result.manifest.assets.some(a => a.asset_id === "qa-res-unused-library")); row.status = "PASS";
    } catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); }
  }
  assert.equal(report.extended.length, 21);
  assert(report.extended.every(c => c.status === "PASS"), "Dependency protection cases failed");
}
async function main() {
  if (["prepare", "resume-prepare"].includes(process.argv[2])) {
    if (process.argv[2] === "prepare") {
      assert(!fs.existsSync(checkpoint)); assert(!fs.existsSync(qa)); assert(!fs.existsSync(out));
    }
    assert(!fs.existsSync(path.join(out, "preparation.json")));
    fs.mkdirSync(checkpoint, { recursive: true }); fs.mkdirSync(qa, { recursive: true }); fs.mkdirSync(out, { recursive: true });
    const files = [...sources, "editor/src/cartridge/collectProjectAssets.ts", "shared/cartridge/assetScanner.ts",
      "scripts/runtime-layout-profiles-test.cjs", "plans/ACTIVE_TASKS.md", "AgentVN Dev.exe",
      "output/installed-layout-resources-20261018-01/acceptance-review.md",
      "output/installed-layout-resources-20261018-01/terminal-audit-02.json"];
    const saved = files.map(file => {
      const target = path.join(checkpoint, file); fs.mkdirSync(path.dirname(target), { recursive: true });
      if (process.argv[2] === "prepare") fs.copyFileSync(path.join(root, file), target, fs.constants.COPYFILE_EXCL);
      const hash = sha(fs.readFileSync(target)); assert.equal(hash, sha(fs.readFileSync(path.join(root, file))));
      return { file, target, sha256: hash };
    });
    const { project, resources } = resourceFixture(), input = path.join(qa, "双布局资源 隔离小工程.vnproj");
    fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
    fs.writeFileSync(path.join(out, "preparation.json"), JSON.stringify({ status: "PASS", at: new Date().toISOString(),
      checkpoint, qa, input, inputSha256: sha(fs.readFileSync(input)), resources, saved, modelRequests: 0 }, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: "PASS", checkpoint, input })); return;
  }
  const output = process.argv[2]; assert(output && !fs.existsSync(output), "Use a new report path");
  const report = { status: "RUNNING", at: new Date().toISOString(), cases: [],
    sources: sources.map(file => ({ file, sha256: sha(fs.readFileSync(path.join(root, file))) })), modelRequests: 0 };
  try {
    const a = api(), { project, resources } = resourceFixture();
    for (const legacy of [false, true]) for (const type of ["agentvn", "renpy"]) {
      const item = { type, legacy, status: "RUNNING" }; report.cases.push(item);
      try {
        const input = inputFor(project, type, legacy), before = structuredClone(input);
        const exported = await a.exportEditorCartridge(input);
        assert.deepEqual(exported.errors, []); assert.deepEqual(exported.assetReport.missingAssets, []);
        item.detail = await verifyZip(await exported.blob.arrayBuffer(), type, resources);
        const preview = await a.exportEditorPreviewDirectory(input);
        assert.deepEqual(preview.manifest.assets.map(a => a.asset_id).sort(), item.detail.ids);
        assert.deepEqual(input, before, "Export/preview must not mutate either profile, source assets or story");
        item.status = "PASS";
      } catch (e) { item.status = "FAILED"; item.error = String(e.stack || e); }
    }
    if (process.argv.includes("--extended")) await extendedCases(a, report);
    assert.equal(report.cases.length, 4); assert(report.cases.every(c => c.status === "PASS"));
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, cases: report.cases.map(c => [c.type, c.legacy, c.status]), output }));
  }
}
module.exports = { root, qa, out, sources, api, resourceFixture, inputFor, verifyZip, sha };
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
