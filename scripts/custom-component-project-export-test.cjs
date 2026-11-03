"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");

const root = path.resolve(__dirname, "..");
const requireEditor = createRequire(path.join(root, "editor/package.json"));
const compiled = requireEditor("esbuild").buildSync({
  stdin: {
    contents: `
      export { addPersonalComponentToProject } from "./editor/src/renpy/customComponentProject";
      export { exportEditorCartridge } from "./editor/src/cartridge/exportCartridge";
      export { resolveRuntimeUILayoutSettings, switchRuntimeUILayoutType } from "./shared/cartridge/uiLayoutProfiles";
    `,
    loader: "ts",
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  write: false,
});
const loaded = { exports: {} };
new Function("module", "exports", "require", compiled.outputFiles[0].text)(
  loaded, loaded.exports, requireEditor,
);

async function main() {
  const { addPersonalComponentToProject, exportEditorCartridge, resolveRuntimeUILayoutSettings,
    switchRuntimeUILayoutType } = loaded.exports;
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3i0AAAAASUVORK5CYII=",
    "base64",
  );
  const imageDefinition = {
    schemaVersion: 1,
    root: {
      tag: "div",
      className: "root",
      children: [{ tag: "img", className: "icon", assetId: "library-image", ariaLabel: "图标", children: [] }],
    },
    styles: { ".root": { display: "flex" }, ".icon": { width: "24px", height: "24px" } },
  };
  const personalRecord = {
    id: "personal-component-export-fixture",
    name: "导出组件",
    definition: imageDefinition,
    assets: [{
      id: "library-image",
      filename: "组件图标.png",
      mimeType: "image/png",
      bytes: new Uint8Array(bytes),
    }],
  };
  const renpySettings = switchRuntimeUILayoutType(resolveRuntimeUILayoutSettings(), "renpy");
  const copied = addPersonalComponentToProject(
    renpySettings.runtimeUILayout,
    "title",
    personalRecord,
    {
      componentId: "custom_component_export_fixture",
      rect: { x: 12, y: 18, width: 30, height: 20 },
      createAssetId: () => "component-export-asset",
    },
    [],
  );
  assert.equal(copied.assets.length, 1, "工程副本应携带实际图片字节");
  const projectAsset = copied.assets[0];
  const manifestAsset = {
    asset_id: projectAsset.asset_id,
    asset_type: projectAsset.asset_type,
    path: projectAsset.metadata.project_path,
    filename: projectAsset.metadata.filename,
    mime_type: projectAsset.metadata.mime_type,
    size_bytes: projectAsset.metadata.size_bytes,
    tags: projectAsset.metadata.tags,
  };
  const profiles = structuredClone(renpySettings.runtimeUILayoutProfiles);
  profiles.profiles.renpy = copied.layout;
  const exportResult = await exportEditorCartridge({
    gameId: "custom-component-export-test",
    title: "自定义组件导出验证",
    author: "AgentVN QA",
    version: "1.0.0",
    language: "zh-CN",
    description: "验证组件结构和素材在正式卡带中的闭包。",
    includeGallery: true,
    includeMetadata: false,
    projectAssets: [manifestAsset],
    projectAssetRefs: copied.assets,
    uiLayoutProfiles: profiles,
    script: {
      schema_version: "1.1.0",
      game_id: "custom-component-export-test",
      title: "自定义组件导出验证",
      entry_scene_id: "scene_main",
      characters: [],
      scenes: [{
        scene_id: "scene_main",
        title: "入口",
        chapter: 1,
        tags: [],
        commands: [{ type: "narration", text: "卡带组件验收。" }],
      }],
    },
  });
  assert.deepEqual(exportResult.errors, [], "合法组件及依赖素材必须通过正式导出校验");
  assert.deepEqual(exportResult.assetReport.missingAssets, [], "自定义组件图片不能被报告为缺失素材");

  const zip = await requireEditor("jszip").loadAsync(await exportResult.blob.arrayBuffer());
  const packedLayout = JSON.parse(await zip.file("ui/layout.json").async("string"));
  const packedManifest = JSON.parse(await zip.file("manifest.json").async("string"));
  const component = packedLayout.screens.find((screen) => screen.screen_id === "title")
    .components.find((item) => item.component_id === "custom_component_export_fixture");
  assert.equal(component.customComponent.root.children[0].assetId, projectAsset.asset_id,
    "卡带布局必须保留映射后的工程素材 ID");
  const declaredAsset = packedManifest.assets.find((asset) => asset.asset_id === projectAsset.asset_id);
  assert(declaredAsset, "manifest 必须声明自定义组件图片");
  const packedBytes = await zip.file(declaredAsset.path).async("uint8array");
  assert.deepEqual(Buffer.from(packedBytes), bytes, "卡带中的图片字节必须与组件库原素材逐字节一致");
  const checksum = JSON.parse(await zip.file("checksum.json").async("string"));
  assert(checksum.files.some((file) => file.path === declaredAsset.path),
    "checksum 必须覆盖自定义组件依赖图片");

  console.log("custom-component-project-export-test: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
