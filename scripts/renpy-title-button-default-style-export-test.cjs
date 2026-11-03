"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const esbuild = require("../editor/node_modules/esbuild");
const JSZip = require("../editor/node_modules/jszip");

const root = path.resolve(__dirname, "..");
const compiled = { exports: {} };
const bundle = esbuild.buildSync({
  stdin: {
    contents: `
      export {
        getDefaultUISkinLayout,
        isBuiltinTitleButton,
        normalizeUISkinLayoutForRuntime,
        resolveTitleButtonStyle,
      } from "./shared/cartridge/uiSkin";
      export { exportEditorCartridge } from "./editor/src/cartridge/exportCartridge";
    `,
    loader: "ts",
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  define: { "import.meta.env": "{}" },
  write: false,
  logLevel: "silent",
});
new Function("module", "exports", "require", bundle.outputFiles[0].text)(
  compiled,
  compiled.exports,
  require,
);

async function main() {
  const {
    getDefaultUISkinLayout,
    isBuiltinTitleButton,
    normalizeUISkinLayoutForRuntime,
    resolveTitleButtonStyle,
    exportEditorCartridge,
  } = compiled.exports;

  const layout = getDefaultUISkinLayout();
  layout.layout_type = "renpy";
  const title = layout.screens.find((screen) => screen.screen_id === "title");
  assert(title);

  const sourceButton = title.components.find((component) =>
    component.component_id === "title_start_button" && isBuiltinTitleButton(component));
  assert(sourceButton);
  assert.equal(sourceButton.titleButtonStyleSource, undefined);
  assert(sourceButton.style, "the default project layout stores a concrete button style");

  const expected = resolveTitleButtonStyle(sourceButton);
  assert(expected, "the runtime default style must be resolvable");
  const input = {
    gameId: "renpy_default_title_button_style",
    title: "Ren’Py 默认标题按钮样式",
    author: "QA",
    version: "1.0.0",
    language: "zh-CN",
    description: "",
    includeGallery: false,
    includeMetadata: true,
    uiSkin: structuredClone(layout),
    projectAssetRefs: [],
    projectAssets: [],
    script: {
      schema_version: "1.5.0",
      game_id: "renpy_default_title_button_style",
      title: "Ren’Py 默认标题按钮样式",
      entry_scene_id: "scene",
      scenes: [{
        scene_id: "scene",
        title: "Scene",
        chapter: 1,
        tags: [],
        commands: [{ type: "narration", text: "样式导出验收。" }],
      }],
    },
  };

  const normalized = normalizeUISkinLayoutForRuntime(input.uiSkin).layout;
  const normalizedButton = normalized.screens
    .find((screen) => screen.screen_id === "title")
    .components.find((component) => component.component_id === sourceButton.component_id);
  assert.deepEqual(normalizedButton.style, expected);

  const exported = await exportEditorCartridge(input);
  assert.deepEqual(exported.errors, []);
  const zip = await JSZip.loadAsync(await exported.blob.arrayBuffer());
  const packed = JSON.parse(await zip.file("ui/layout.json").async("string"));
  const packedButton = packed.screens
    .find((screen) => screen.screen_id === "title")
    .components.find((component) => component.component_id === sourceButton.component_id);

  assert.deepEqual(
    packedButton.style,
    expected,
    "Ren’Py export must preserve the same resolved default title-button style as the saved/runtime layout",
  );
  assert.equal(
    packedButton.titleButtonStyleSource,
    sourceButton.titleButtonStyleSource,
    "export must preserve the absence of an explicit style provenance marker",
  );
  console.log("renpy-title-button-default-style-export: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
