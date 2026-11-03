"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");

const root = path.resolve(__dirname, "..");
const requireEditor = createRequire(path.join(root, "editor/package.json"));
const compiled = requireEditor("esbuild").buildSync({
  stdin: {
    contents: `export { prepareRenpyGuiImport } from './editor/src/renpy/renpyGuiImportPlan'; export { getDefaultUISkinLayout } from './shared/cartridge/uiSkin'; export { renpyGUIErrors } from './shared/cartridge/renpyGui';`,
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
  loaded,
  loaded.exports,
  requireEditor,
);

const layout = loaded.exports.getDefaultUISkinLayout();
layout.layout_type = "renpy";
layout.target_runtime = "0.11.0";
layout.renpy = { shared: { x: 61, fontSize: 31 } };
const asset = {
  asset_id: "existing",
  asset_type: "ui",
  metadata: { filename: "manual.png", project_path: "assets/ui/manual.png", source: "imported" },
};
const candidateBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const scan = {
  parameters: {
    values: {
      shared: {
        x: 42, fontSize: 28, spacing: 6,
        buttonBorders: { left: 6, top: 8, right: 10, bottom: 12 },
        buttonTile: true,
      },
      save_load: { saveColumns: 4 },
    },
    issues: [],
  },
  assets: [{
    path: "game/gui/button/idle.png", name: "idle.png", kind: "image",
    mimeType: "image/png", sizeBytes: candidateBytes.length, bytes: candidateBytes,
  }],
  issues: [],
  complete: true,
};
const beforeLayout = structuredClone(layout);
const beforeAssets = structuredClone([asset]);
const result = loaded.exports.prepareRenpyGuiImport({
  layout,
  existingAssets: [asset],
  scan,
  parameterSelection: {
    "shared.x": true,
    "shared.fontSize": false,
    "shared.spacing": true,
    "shared.buttonBorders": true,
    "shared.buttonTile": false,
    "save_load.saveColumns": true,
  },
  assetSelection: { "game/gui/button/idle.png": "add" },
  assetBindings: { "game/gui/button/idle.png": "title_background" },
  createdAt: "2026-10-01T00:00:00.000Z",
});

assert.deepEqual(result.layout.renpy, {
  shared: {
    x: 42, fontSize: 31, spacing: 6,
    buttonBorders: { left: 6, top: 8, right: 10, bottom: 12 },
  },
  save_load: { saveColumns: 4 },
}, "用户取消的参数保持不变，确认选择的参数才覆盖");
assert.deepEqual(layout, beforeLayout, "准备导入不得修改当前草稿对象");
assert.deepEqual([asset], beforeAssets, "准备导入不得修改已有素材对象");
assert.equal(result.assets.length, 2);
assert.equal(result.assets[0].asset_id, "existing");
assert.deepEqual(result.assets[1].metadata.tags.includes("renpy_gui_import"), true);
assert.equal(result.assets[1].metadata.size_bytes, candidateBytes.length);
assert(result.assets[1].metadata.data_url.startsWith("data:image/png;base64,"));
const titleHero = result.layout.screens.find((screen) => screen.screen_id === "title")
  ?.components.find((component) => component.component_id === "title_hero");
assert(titleHero, "默认布局应包含标题页主视觉组件");
assert.equal(
  titleHero.style?.backgroundImage,
  `asset:${result.assets[1].asset_id}`,
  "选择标题主视觉用途后，导入图片应绑定到实际标题页组件",
);
assert.equal(result.assets[1].metadata.license_note, undefined,
  "导入不能伪造素材授权；界面须提示用户重新核对分发权利");
const fontCandidate = {
  path: "gui/fonts/interface.ttf",
  name: "interface.ttf",
  kind: "font",
  mimeType: "font/ttf",
  sizeBytes: 4,
  bytes: new Uint8Array([0, 1, 0, 0]),
};
const importedFont = loaded.exports.prepareRenpyGuiImport({
  layout,
  existingAssets: [asset],
  scan: {
    parameters: { values: {}, issues: [] },
    assets: [fontCandidate],
    issues: [],
    complete: true,
  },
  parameterSelection: {},
  assetSelection: { [fontCandidate.path]: "add" },
  assetBindings: { [fontCandidate.path]: "interface_font" },
});
assert.equal(importedFont.assets[1].asset_type, "font",
  "Ren’Py GUI 字体必须按字体类型进入工程素材库");
assert.equal(importedFont.layout.tokens.fontAssetId, importedFont.assets[1].asset_id,
  "选择界面字体用途后必须将字体绑定到当前 Ren’Py 布局令牌");
assert.equal(importedFont.layout.layout_type, "renpy");
assert.equal(layout.tokens.fontAssetId, undefined,
  "准备字体绑定不得改写原布局草稿");
const priorImport = {
  ...result.assets[1],
  metadata: { ...result.assets[1].metadata, license_note: "用户手工核对后的来源说明", tags: [
    ...result.assets[1].metadata.tags, "user-review",
  ] },
};
const changedCandidate = { ...scan.assets[0], bytes: new Uint8Array([...candidateBytes, 0]), sizeBytes: 9 };
const replaced = loaded.exports.prepareRenpyGuiImport({
  layout,
  existingAssets: [asset, priorImport],
  scan: { ...scan, assets: [changedCandidate] },
  parameterSelection: {},
  assetSelection: { [changedCandidate.path]: "replace" },
});
assert.equal(replaced.assets[1].asset_id, priorImport.asset_id, "同源重导必须保留素材 ID 和既有引用");
assert.equal(replaced.assets[1].metadata.license_note, "用户手工核对后的来源说明",
  "重导不能覆盖用户手工核对的授权说明");
assert(replaced.assets[1].metadata.tags.includes("user-review"));
assert.equal(replaced.assets[1].metadata.size_bytes, 9);
assert.throws(() => loaded.exports.prepareRenpyGuiImport({
  layout,
  existingAssets: [asset],
  scan,
  parameterSelection: {},
  assetSelection: { [scan.assets[0].path]: "replace" },
}), /REN’PY_GUI_REPLACE_NOT_OWNED/,
"不得将已有的非导入器素材当作同源 GUI 资产覆盖");
const stateCandidates = ["normal", "hover", "selected", "disabled"].map((state, index) => ({
  path: `game/gui/button/${state}.png`,
  name: `${state}.png`,
  kind: "image",
  mimeType: "image/png",
  sizeBytes: 5,
  bytes: new Uint8Array([137, 80, 78, 71, index]),
}));
const importedHoverState = loaded.exports.prepareRenpyGuiImport({
  layout,
  existingAssets: [],
  scan: {
    parameters: { values: {}, issues: [] },
    assets: stateCandidates,
    issues: [],
    complete: true,
  },
  parameterSelection: {},
  assetSelection: Object.fromEntries(stateCandidates.map((candidate) => [candidate.path, "add"])),
  assetBindings: Object.fromEntries(stateCandidates.map((candidate, index) => [
    candidate.path, ["button_normal", "button_hover", "button_selected", "button_disabled"][index],
  ])),
});
const importedButtonImages = Object.fromEntries(stateCandidates.map((candidate, index) => {
  const imported = importedHoverState.assets[index];
  return [["normal", "hover", "selected", "disabled"][index], `asset:${imported.asset_id}`];
}));
assert.equal(
  JSON.stringify(importedHoverState.layout.renpy?.shared?.buttonImages),
  JSON.stringify(importedButtonImages),
  "普通、悬停、选中和禁用状态图必须全部写入 Ren’Py 共享按钮样式",
);
assert.deepEqual(layout.renpy?.shared?.buttonImages, undefined,
"导入预备阶段不得污染原布局状态图引用");

const longBaseCandidate = {
  path: "官方模板/中文/game/gui/button/quick_idle_background.png",
  name: "quick_idle_background.png",
  kind: "image",
  mimeType: "image/png",
  sizeBytes: candidateBytes.length,
  bytes: candidateBytes,
};
const longBaseAsset = loaded.exports.prepareRenpyGuiImport({
  layout,
  existingAssets: [],
  scan: { parameters: { values: {}, issues: [] }, assets: [longBaseCandidate], issues: [], complete: true },
  parameterSelection: {},
  assetSelection: { [longBaseCandidate.path]: "add" },
}).assets[0];
const duplicateLongBaseAsset = loaded.exports.prepareRenpyGuiImport({
  layout,
  existingAssets: [longBaseAsset],
  scan: { parameters: { values: {}, issues: [] }, assets: [longBaseCandidate], issues: [], complete: true },
  parameterSelection: {},
  assetSelection: { [longBaseCandidate.path]: "add" },
}).assets[1];
assert.notEqual(duplicateLongBaseAsset.asset_id, longBaseAsset.asset_id,
  "长 Ren’Py GUI ID 冲突时，新素材必须得到不同 ID");
assert(duplicateLongBaseAsset.asset_id.endsWith("_2"),
  "长 Ren’Py GUI ID 冲突时，稳定后缀必须保留");
assert(duplicateLongBaseAsset.asset_id.length <= 64,
  "带稳定后缀的 Ren’Py GUI ID 必须保留在 64 字符限制内");
assert.notEqual(duplicateLongBaseAsset.metadata.project_path, longBaseAsset.metadata.project_path,
  "长 Ren’Py GUI ID 冲突时，工程路径必须同时保持唯一");
assert(duplicateLongBaseAsset.metadata.project_path.includes("_2-"),
  "工程路径必须保留区分重复素材的 ID 后缀");

const colorLayout = structuredClone(layout);
colorLayout.renpy = { shared: { buttonTextColors: { selected: "#ff00ff", disabled: "#777777" } } };
const colorImport = loaded.exports.prepareRenpyGuiImport({
  layout: colorLayout,
  existingAssets: [],
  scan: {
    parameters: { values: { shared: { buttonTextColors: { normal: "#bbbbbb", hover: "#ffffff" } } }, issues: [] },
    assets: [],
    issues: [],
    complete: true,
  },
  parameterSelection: {
    "shared.buttonTextColors.normal": true,
    "shared.buttonTextColors.hover": false,
  },
  assetSelection: {},
});
assert.deepEqual(colorImport.layout.renpy.shared.buttonTextColors, {
  normal: "#bbbbbb", selected: "#ff00ff", disabled: "#777777",
}, "应用勾选的按钮文字状态色应精确覆盖所选状态并保留未选及既有状态");
assert.deepEqual(loaded.exports.renpyGUIErrors(colorImport.layout.renpy), [],
  "静态颜色导入完成后布局必须通过 Ren’Py 配置校验");
console.log("PASS Ren’Py GUI import preparation is immutable and selection-scoped");
