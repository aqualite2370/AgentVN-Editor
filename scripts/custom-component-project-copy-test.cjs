"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");

const root = path.resolve(__dirname, "..");
const requireEditor = createRequire(path.join(root, "editor/package.json"));
const compiled = requireEditor("esbuild").buildSync({
  stdin: {
    contents: `export { addPersonalComponentToProject, addPersonalComponentToProjectLayout } from "./editor/src/renpy/customComponentProject";`,
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
const { addPersonalComponentToProject, addPersonalComponentToProjectLayout } = loaded.exports;

const layout = {
  layout_type: "renpy",
  ui_layout_version: "2.0.0",
  name: "进阶",
  target_runtime: "1.9.1",
  tokens: {},
  assets: [],
  screens: [
    { screen_id: "title", components: [] },
    { screen_id: "help", components: [] },
  ],
};
const record = {
  id: "personal-original",
  name: "标题卡",
  html: "<div class=\"root\"><span class=\"title\">标题</span></div>",
  css: ".root { display: flex; }",
  definition: {
    schemaVersion: 1,
    root: { tag: "div", className: "root", children: [
      { tag: "span", className: "title", text: "标题", children: [] },
    ] },
    styles: { ".root": { display: "flex" } },
  },
  assets: [],
};
const created = addPersonalComponentToProjectLayout(layout, "title", record, {
  componentId: "custom_component_instance_a",
  rect: { x: 12, y: 18, width: 34, height: 22 },
});

const legacyRecord = { ...record };
delete legacyRecord.assets;
const legacyCopy = addPersonalComponentToProjectLayout(layout, "title", legacyRecord, {
  componentId: "custom_component_legacy",
  rect: { x: 0, y: 0, width: 20, height: 20 },
});
assert.equal(legacyCopy.screens[0].components.length, 1,
  "旧版无 assets 字段的无素材组件应按空依赖兼容复制");

assert.equal(created.screens[0].components.length, 1, "组件副本应添加到当前工程的目标页面");
const copied = created.screens[0].components[0];
assert.equal(copied.component_type, "custom_component");
assert.equal(copied.label, "标题卡");
assert.deepEqual(copied.rect, { x: 12, y: 18, width: 34, height: 22 });
assert.deepEqual(copied.customComponent, record.definition);
assert.notEqual(copied.customComponent, record.definition, "工程组件必须是独立深副本");
copied.customComponent.root.children[0].text = "工程内修改";
assert.equal(record.definition.root.children[0].text, "标题", "工程内编辑不得污染个人库原件");
assert.equal(layout.screens[0].components.length, 0, "添加操作不得原地修改调用方布局");

for (const [screenId, badRecord, id, message] of [
  ["missing-screen", record, "safe-id", /页面不存在/],
  ["title", { ...record, assets: [{ path: "image.png", bytes: new Uint8Array([1]) }] }, "asset-id", /素材映射/],
]) {
  assert.throws(() => addPersonalComponentToProjectLayout(layout, screenId, badRecord, {
    componentId: id, rect: { x: 0, y: 0, width: 20, height: 20 },
  }), message);
}
assert.throws(() => addPersonalComponentToProjectLayout(
  { ...layout, layout_type: "agentvn" }, "title", record,
  { componentId: "wrong-type", rect: { x: 0, y: 0, width: 20, height: 20 } },
), /进阶布局/);
assert.throws(() => addPersonalComponentToProjectLayout(created, "title", record, {
  componentId: "bad-rect", rect: { x: 90, y: 0, width: 20, height: 20 },
}), /画布范围/);
assert.throws(() => addPersonalComponentToProjectLayout(created, "title", record, {
  componentId: "custom_component_instance_a", rect: { x: 0, y: 0, width: 20, height: 20 },
}), /编号冲突/);

const imageRecord = {
  ...record,
  definition: {
    ...record.definition,
    root: { ...record.definition.root, children: [
      { tag: "img", className: "icon", assetId: "preview", ariaLabel: "预览图", children: [] },
    ] },
  },
  assets: [{
    id: "preview",
    filename: "预览.png",
    mimeType: "image/png",
    bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  }],
};
const withImage = addPersonalComponentToProject(
  layout,
  "help",
  imageRecord,
  {
    componentId: "custom_component_with_asset",
    rect: { x: 4, y: 5, width: 30, height: 20 },
    createAssetId: () => "project-image-1",
  },
  [],
);
const copiedImage = withImage.layout.screens[1].components[0].customComponent.root.children[0];
assert.equal(copiedImage.assetId, "project-image-1", "工程副本应重映射素材编号，避免跨工程 ID 污染");
assert.equal(withImage.assets.length, 1);
assert.equal(withImage.assets[0].asset_type, "ui");
assert.equal(withImage.assets[0].metadata.mime_type, "image/png");
assert(withImage.assets[0].metadata.data_url.startsWith("data:image/png;base64,"));
assert.equal(imageRecord.definition.root.children[0].assetId, "preview", "素材映射不得改写个人库 AST");
assert.equal(layout.screens[1].components.length, 0, "失败或成功的复制均不得原地修改源布局");

console.log("custom-component-project-copy-test: PASS");
