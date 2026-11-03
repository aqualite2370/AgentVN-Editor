"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const crypto = require("node:crypto");
const esbuild = require("../editor/node_modules/esbuild");
const JSZip = require("../editor/node_modules/jszip");
const root = path.resolve(__dirname, "..");
const compiled = { exports: {} };
const bundle = esbuild.buildSync({
  stdin: {
    contents: `
      export { prepareRenpyGuiImport } from "./editor/src/renpy/renpyGuiImportPlan";
      export { getDefaultUISkinLayout } from "./shared/cartridge/uiSkin";
      export { exportEditorCartridge } from "./editor/src/cartridge/exportCartridge";
      export { loadCartridgeFromArrayBuffer } from "./shared/cartridge/unpacker";
      export { validateRuntimeCartridge } from "./GameCli_framework/src/cartridge/importCartridge";
    `,
    loader: "ts",
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  define: { "import.meta.env": "{}" },
  write: false,
  logLevel: "silent",
});
new Function("module", "exports", "require", bundle.outputFiles[0].text)(
  compiled, compiled.exports, require,
);

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function main() {
  const api = compiled.exports;
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p2sAAAAASUVORK5CYII=",
    "base64",
  );
  const candidate = {
    path: "gui/button/idle.png",
    name: "idle.png",
    kind: "image",
    mimeType: "image/png",
    sizeBytes: bytes.length,
    bytes: new Uint8Array(bytes),
  };
  const fontBytes = Buffer.from([0, 1, 0, 0]);
  const fontCandidate = {
    path: "gui/fonts/interface.ttf",
    name: "interface.ttf",
    kind: "font",
    mimeType: "font/ttf",
    sizeBytes: fontBytes.length,
    bytes: new Uint8Array(fontBytes),
  };
  const buttonStateCandidates = ["normal", "hover", "selected", "disabled"].map((state, index) => ({
    path: `gui/button/${state}.png`,
    name: `${state}.png`,
    kind: "image",
    mimeType: "image/png",
    sizeBytes: bytes.length + 1,
    bytes: new Uint8Array([...bytes, index + 1]),
  }));
  const layout = api.getDefaultUISkinLayout();
  layout.layout_type = "renpy";
  const hideUiButton = layout.screens.find((screen) => screen.screen_id === "player")
    ?.components.find((component) => component.component_id === "quick_hide_ui_button");
  if (hideUiButton) hideUiButton.visible = false;
  const buttonTextColors = {
    normal: "#bbbbbb",
    hover: "#ffffff",
    selected: "#00ccdd",
    disabled: "#777777",
  };
  const buttonBorders = { left: 6, top: 8, right: 10, bottom: 12 };
  const prepared = api.prepareRenpyGuiImport({
    layout,
    existingAssets: [],
    scan: {
      parameters: { values: { shared: { buttonTextColors, buttonBorders, buttonTile: true } }, issues: [] },
      assets: [candidate, ...buttonStateCandidates, fontCandidate],
      issues: [],
      complete: true,
    },
    parameterSelection: {
      ...Object.fromEntries(Object.keys(buttonTextColors).map((state) => [`shared.buttonTextColors.${state}`, true])),
      "shared.buttonBorders": true, "shared.buttonTile": true,
    },
    assetSelection: Object.fromEntries([candidate, ...buttonStateCandidates, fontCandidate].map((asset) => [asset.path, "add"])),
    assetBindings: {
      [candidate.path]: "title_background",
      ...Object.fromEntries(buttonStateCandidates.map((asset, index) => [
        asset.path, ["button_normal", "button_hover", "button_selected", "button_disabled"][index],
      ])),
      [fontCandidate.path]: "interface_font",
    },
    createdAt: "2026-10-01T00:00:00.000Z",
  });
  const importedAsset = prepared.assets.find((asset) => asset.asset_type === "ui");
  const importedFont = prepared.assets.find((asset) => asset.asset_type === "font");
  assert(importedAsset && importedFont, "确认导入后应产生图片与字体工程素材引用");
  assert.equal(prepared.layout.tokens.fontAssetId, importedFont.asset_id,
    "导入字体应绑定到布局全局字体令牌");
  const expectedHash = sha256(bytes);
  const expectedFontHash = sha256(fontBytes);
  const importedButtonStateAssets = buttonStateCandidates.map((candidate) => {
    const asset = prepared.assets.find((item) => item.metadata.tags?.includes(`renpy_gui_path:${candidate.path}`));
    assert(asset, `已确认的 ${candidate.path} 必须进入工程素材清单`);
    return { candidate, asset, hash: sha256(candidate.bytes) };
  });
  assert.deepEqual(Object.keys(prepared.layout.renpy.shared.buttonImages).sort(),
    ["disabled", "hover", "normal", "selected"], "导出布局须保留四种按钮状态引用");
  assert.deepEqual(prepared.layout.renpy.shared.buttonTextColors, buttonTextColors,
    "导出布局须保留四种按钮文字颜色");
  const project = {
    schema_version: "1.0.0",
    project_id: "renpy_gui_roundtrip",
    title: "Ren’Py GUI 字节往返",
    author: "QA",
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
    memory_mode: "hybrid",
    asset_manifest: prepared.assets,
    nodes: [],
    edges: [],
    editor_settings: { runtimeUILayout: prepared.layout },
  };

  const titleScreen = prepared.layout.screens.find((screen) => screen.screen_id === "title");
  const titleHero = titleScreen.components.find((component) => component.component_id === "title_hero");
  assert(titleHero, "验收需使用真实默认布局中的标题主视觉组件");
  assert.equal(titleHero.style.backgroundImage, `asset:${importedAsset.asset_id}`,
    "导入用途绑定必须在不手工改布局的情况下生成卡带引用");
  const cartridge = await api.exportEditorCartridge({
    gameId: "renpy_gui_roundtrip",
    title: "Ren’Py GUI 字节往返",
    author: "QA",
    version: "1.0.0",
    language: "zh-CN",
    description: "",
    includeGallery: false,
    includeMetadata: true,
    uiSkin: prepared.layout,
    projectAssetRefs: prepared.assets,
    projectAssets: [importedAsset, ...importedButtonStateAssets.map((item) => item.asset), importedFont].map((asset) => ({
      asset_id: asset.asset_id,
      asset_type: asset.asset_type,
      path: asset.metadata.project_path,
      filename: asset.metadata.filename,
      mime_type: asset.metadata.mime_type,
      size_bytes: asset.metadata.size_bytes,
    })),
    script: {
      schema_version: "1.1.0",
      game_id: "renpy_gui_roundtrip",
      title: "Ren’Py GUI 字节往返",
      entry_scene_id: "scene",
      characters: [],
      scenes: [{
        scene_id: "scene",
        title: "场景",
        chapter: 1,
        tags: [],
        commands: [{ type: "narration", text: "实际卡带资源往返。" }],
      }],
    },
  });
  assert.deepEqual(cartridge.errors, [], "合法 GUI 图片应可生成真实卡带");
  assert.deepEqual(cartridge.assetReport.placeholderAssets, [], "卡带不能以占位图替代已导入图片");
  const cartridgeZip = await JSZip.loadAsync(await cartridge.blob.arrayBuffer());
  const packedLayout = JSON.parse(await cartridgeZip.file("ui/layout.json").async("string"));
  assert.deepEqual(packedLayout.renpy.shared.buttonBorders, buttonBorders,
    "实际卡带布局必须保留九宫格方向和数值，不只是工程草稿");
  assert.equal(packedLayout.renpy.shared.buttonTile, true, "实际卡带必须保留按钮平铺策略");
  assert.equal(JSON.parse(await cartridgeZip.file("manifest.json").async("string")).runtime_version, "0.12.0",
    "完整导入/打包链必须声明按钮框架的最低 Runtime 版本");
  const packedAsset = cartridgeZip.file(importedAsset.metadata.project_path);
  assert(packedAsset, "卡带必须包含被当前布局引用的 GUI 图片");
  const packedBytes = Buffer.from(await packedAsset.async("uint8array"));
  assert.equal(sha256(packedBytes), expectedHash, "卡带内资源字节必须与 GUI 导入源一致");
  const packedFont = cartridgeZip.file(importedFont.metadata.project_path);
  assert(packedFont, "卡带必须包含被 Ren’Py 布局令牌引用的 GUI 字体");
  assert.equal(sha256(Buffer.from(await packedFont.async("uint8array"))), expectedFontHash,
    "卡带内字体字节必须与 GUI 导入源一致");
  for (const { candidate: stateCandidate, asset: stateAsset, hash } of importedButtonStateAssets) {
    assert.equal(prepared.layout.renpy.shared.buttonImages[
      stateCandidate.path.includes("normal") ? "normal"
        : stateCandidate.path.includes("hover") ? "hover"
          : stateCandidate.path.includes("selected") ? "selected" : "disabled"
    ], `asset:${stateAsset.asset_id}`, `${stateCandidate.path} 必须指向被打包的状态资源`);
    const packedState = cartridgeZip.file(stateAsset.metadata.project_path);
    assert(packedState, `卡带必须包含 ${stateCandidate.path}`);
    const packedStateBytes = Buffer.from(await packedState.async("uint8array"));
    assert.equal(sha256(packedStateBytes), hash, `${stateCandidate.path} 卡带字节必须与导入源一致`);
  }
  const loadedCartridge = await api.loadCartridgeFromArrayBuffer(
    await cartridge.blob.arrayBuffer(),
    { maxPackageSizeMB: 32, maxSingleFileSizeMB: 8 },
  );
  const runtimeValidation = api.validateRuntimeCartridge(loadedCartridge);
  assert.equal(runtimeValidation.ok, true,
    `导出卡带必须通过 Runtime 的完整布局/素材校验：${runtimeValidation.errors.map((item) => item.message).join("; ")}`);
  assert.deepEqual(runtimeValidation.errors, [], "Runtime 不得把有效按钮状态图报为缺失素材");
  const runtimeAssetUrl = loadedCartridge.assetBlobUrls[importedAsset.asset_id];
  assert(runtimeAssetUrl, "运行时解包后必须能按 asset_id 解析导入图片");
  const runtimeBytes = Buffer.from(await fetch(runtimeAssetUrl).then((response) => response.arrayBuffer()));
  assert.equal(sha256(runtimeBytes), expectedHash, "Runtime 解包后资源字节必须保持一致");
  const runtimeFontUrl = loadedCartridge.assetBlobUrls[importedFont.asset_id];
  assert(runtimeFontUrl, "运行时解包后必须能按 asset_id 解析导入字体");
  const runtimeFontBytes = Buffer.from(await fetch(runtimeFontUrl).then((response) => response.arrayBuffer()));
  assert.equal(sha256(runtimeFontBytes), expectedFontHash, "Runtime 解包后字体字节必须保持一致");
  for (const { candidate: stateCandidate, asset: stateAsset, hash } of importedButtonStateAssets) {
    const runtimeStateUrl = loadedCartridge.assetBlobUrls[stateAsset.asset_id];
    assert(runtimeStateUrl, `Runtime 解包后必须能按 asset_id 解析 ${stateCandidate.path}`);
    const runtimeStateBytes = Buffer.from(await fetch(runtimeStateUrl).then((response) => response.arrayBuffer()));
    assert.equal(sha256(runtimeStateBytes), hash, `Runtime 解包后的 ${stateCandidate.path} 字节必须保持一致`);
    URL.revokeObjectURL(runtimeStateUrl);
  }
  URL.revokeObjectURL(runtimeAssetUrl);
  URL.revokeObjectURL(runtimeFontUrl);
  console.log(`PASS Ren’Py GUI image/button-state/font bytes survive .vncart export and Runtime unpack; SHA-256 ${expectedHash} / ${expectedFontHash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
