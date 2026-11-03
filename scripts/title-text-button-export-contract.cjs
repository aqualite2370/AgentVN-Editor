const assert = require("node:assert/strict");
const path = require("node:path");
const esbuild = require("../editor/node_modules/esbuild");
const JSZip = require("../editor/node_modules/jszip");
const root = path.resolve(__dirname, "..");
const compiled = { exports: {} };
new Function("module", "exports", "require", esbuild.buildSync({
  stdin: { contents: `
    export { getDefaultUISkinLayout, editUILayoutComponentStyle } from "./shared/cartridge/uiSkin";
    export { exportEditorCartridge, exportEditorPreviewDirectory } from "./editor/src/cartridge/exportCartridge";
  `, loader: "ts", resolveDir: root }, bundle: true, platform: "node", format: "cjs",
  define: { "import.meta.env": "{}" }, write: false, logLevel: "silent",
}).outputFiles[0].text)(compiled, compiled.exports, require);

async function main() {
  const { getDefaultUISkinLayout, editUILayoutComponentStyle, exportEditorCartridge, exportEditorPreviewDirectory } = compiled.exports;
  const layout = getDefaultUISkinLayout();
  const title = layout.screens.find((screen) => screen.screen_id === "title");
  title.components = title.components.map((component) => component.component_id === "title_start_button"
    ? editUILayoutComponentStyle(component, { backgroundColor: "#234567", borderWidth: 2, fontSize: 24 })
    : component);
  const input = { gameId: "title_text_export", title: "标题样式导出", author: "QA", version: "1.0.0",
    language: "zh-CN", description: "", includeGallery: false, includeMetadata: true, projectAssetRefs: [], uiSkin: layout,
    script: { schema_version: "1.5.0", game_id: "title_text_export", title: "标题样式导出", entry_scene_id: "scene",
      scenes: [{ scene_id: "scene", title: "Scene", chapter: 1, tags: [],
        commands: [{ type: "narration", text: "样式导出验收。" }] }] } };
  const source = structuredClone(input);
  const exported = await exportEditorCartridge(input);
  assert.deepEqual(exported.errors, []);
  const zip = await JSZip.loadAsync(await exported.blob.arrayBuffer());
  const packed = JSON.parse(await zip.file("ui/layout.json").async("string"));
  const preview = await exportEditorPreviewDirectory(input);
  const previewLayout = JSON.parse(preview.textFiles.find((file) => file.path === "ui/layout.json").contents);
  assert.deepEqual(previewLayout, packed, "external preview and cartridge disagree on title styles");
  const packedTitle = packed.screens.find((screen) => screen.screen_id === "title");
  const start = packedTitle.components.find((component) => component.component_id === "title_start_button");
  assert.equal(start.titleButtonStyleSource, "layout", "actual cartridge export stripped provenance");
  assert.equal(start.style.backgroundColor, "#234567");
  assert.equal(start.style.borderWidth, 2);
  assert.equal(start.style.fontSize, 24);
  const settings = packedTitle.components.find((component) => component.component_id === "title_settings_button");
  assert.equal(settings.style.backgroundColor, "transparent");
  assert.deepEqual(input, source, "export mutated the source project");
  console.log("title-text-button-export-contract: PASS (real editor cartridge and external preview directory; provenance, style, defaults, source preserved)");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
