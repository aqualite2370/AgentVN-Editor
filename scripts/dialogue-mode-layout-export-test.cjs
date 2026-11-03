"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "..");
const requireEditor = createRequire(path.join(root, "editor/package.json"));
const bundle = requireEditor("esbuild").buildSync({
  stdin: { resolveDir: root, loader: "ts", contents: `
    export { exportEditorCartridge, exportEditorPreviewDirectory } from "./editor/src/cartridge/exportCartridge";
    export { validateVersionCompatibility } from "./shared/cartridge/validators";
    export { resolveRuntimeUILayoutSettings, switchRuntimeUILayoutType } from "./shared/cartridge/uiLayoutProfiles";` },
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
});
const loaded = { exports: {} };
new Function("module", "exports", "require", bundle.outputFiles[0].text)(loaded, loaded.exports, requireEditor);
const api = loaded.exports;

async function run() {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3i0AAAAASUVORK5CYII=", "base64");
  const font = fs.readFileSync(path.join(root, "GameCli_framework/node_modules/harfbuzzjs/test/fonts/noto/NotoSans-Regular.ttf"));
  const fixtures = [
    { id: "mode-image", type: "ui", filename: "模式背景.png", mime: "image/png", bytes: png },
    { id: "mode-font", type: "font", filename: "模式字体.ttf", mime: "font/ttf", bytes: font },
    { id: "inactive-only", type: "ui", filename: "另一布局.png", mime: "image/png", bytes: png },
  ];
  const assets = fixtures.map(asset => ({
    asset_id: asset.id, asset_type: asset.type,
    metadata: { filename: asset.filename, display_name: asset.filename, mime_type: asset.mime,
      size_bytes: asset.bytes.length, project_path: `assets/${asset.id}/${asset.filename}`,
      data_url: `data:${asset.mime};base64,${asset.bytes.toString("base64")}` },
  }));
  const manifestAssets = assets.map(asset => ({
    asset_id: asset.asset_id, asset_type: asset.asset_type, filename: asset.metadata.filename,
    mime_type: asset.metadata.mime_type, size_bytes: asset.metadata.size_bytes, path: asset.metadata.project_path,
  }));
  const settings = api.switchRuntimeUILayoutType(api.resolveRuntimeUILayoutSettings(), "renpy");
  const profiles = settings.runtimeUILayoutProfiles;
  profiles.profiles.agentvn.dialogueLayouts = { nvl: { panelStyle: { backgroundImage: "asset:inactive-only" } } };
  profiles.profiles.renpy.dialogueLayouts = {
    nvl: { rect: { x: 8, y: 15, width: 84, height: 62 }, panelStyle: { backgroundImage: "asset:mode-image" },
      textStyle: { fontAssetId: "mode-font", fontSize: 27 } },
    bubble: { rect: { x: 50, y: 18, width: 43, height: 28, anchor: "center" },
      speakerStyle: { fontAssetId: "mode-font", color: "#aaddbb" } },
  };
  const before = structuredClone(profiles);
  const input = {
    gameId: "dialogue-mode-resource-test", title: "模式资源导出", author: "QA", version: "1.0.0", language: "zh-CN",
    includeGallery: false, includeMetadata: false, projectAssets: manifestAssets, projectAssetRefs: assets,
    uiLayoutProfiles: profiles,
    script: { schema_version: "1.1.0", game_id: "dialogue-mode-resource-test", title: "模式资源导出",
      entry_scene_id: "entry", characters: [], scenes: [{ scene_id: "entry", title: "入口", chapter: 1, tags: [],
        commands: [{ type: "narration", text: "模式资源实际导出。", presentation_mode: "nvl" }] }] },
  };
  const result = await api.exportEditorCartridge(input);
  assert.deepEqual(result.errors, [], "仅由模式布局引用的图片和字体必须通过实际卡带导出");
  const zip = await requireEditor("jszip").loadAsync(await result.blob.arrayBuffer());
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
  const checksum = JSON.parse(await zip.file("checksum.json").async("string"));
  assert.equal(manifest.runtime_version, "0.25.0",
    "NVL appearance export preserves the current template's hide-UI capability floor");
  const oldPlayer = api.validateVersionCompatibility(manifest, "0.18.0");
  assert.equal(oldPlayer.ok, false, "实际导出卡带必须被旧Runtime版本门槛拒绝");
  assert(oldPlayer.errors.some(error => error.code === "runtime_version"
    && error.message.includes("0.25.0") && error.message.includes("0.18.0")),
  "拒绝结果必须明确给出所需版本、当前版本和更新建议");
  assert.equal(api.validateVersionCompatibility(manifest, "0.19.0").ok, false);
  assert.equal(api.validateVersionCompatibility(manifest, "0.25.0").ok, true);
  assert.deepEqual(layout.dialogueLayouts, profiles.profiles.renpy.dialogueLayouts);
  for (const fixture of fixtures.slice(0, 2)) {
    const declared = manifest.assets.find(asset => asset.asset_id === fixture.id);
    assert(declared, `模式独占资源${fixture.id}必须进入manifest`);
    assert.deepEqual(Buffer.from(await zip.file(declared.path).async("uint8array")), fixture.bytes,
      `实际ZIP内${fixture.id}必须与源字节完全一致`);
    assert(checksum.files.some(file => file.path === declared.path));
  }
  assert(!manifest.assets.some(asset => asset.asset_id === "inactive-only"),
    "游戏导出不得携带未激活布局独占素材");
  const preview = await api.exportEditorPreviewDirectory(input);
  assert.deepEqual(preview.errors, []);
  for (const fixture of fixtures.slice(0, 2)) {
    const source = preview.assets.find(asset => asset.assetId === fixture.id);
    assert(source, "外部GameCLI预览目录必须有相同模式资源");
    assert.deepEqual(Buffer.from(source.data), fixture.bytes);
  }
  assert.deepEqual(profiles, before, "导出不得改变另一布局或源配置");
  console.log("PASS dialogue mode actual cartridge/preview resource bytes, active-profile closure, version and input isolation");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
