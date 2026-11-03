"use strict";
const assert = require("node:assert/strict"), path = require("node:path");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, ".."), req = createRequire(path.join(root, "editor/package.json"));
const mod = { exports: {} };
new Function("module", "exports", "require", req("esbuild").buildSync({
  stdin: { resolveDir: root, loader: "ts", contents: `
    export * from "./shared/cartridge/uiSkin";
    export { minimumRuntimeVersionForLayout } from "./shared/cartridge/runtimeCapabilities";
    export { exportEditorCartridge } from "./editor/src/cartridge/exportCartridge";
  ` }, bundle: true, packages: "external", platform: "node", format: "cjs", write: false,
}).outputFiles[0].text)(mod, mod.exports, req);
const api = mod.exports;
(async () => {
  const original = api.getDefaultUISkinLayout();
  const layout = structuredClone(original);
  const component = layout.screens.find(s => s.screen_id === "title").components.find(c => c.component_type === "main_menu_hero");
  component.style = { backgroundColor: "#24384c", backgroundOpacity: .5, contentOpacity: .8 };
  const valid = api.validateUISkinLayout(layout);
  assert.equal(valid.errors.length, 0, JSON.stringify(valid.errors));
  assert.equal(api.resolveUILayoutBackgroundOpacity("main_menu_hero", component.style), .5);
  assert.equal(api.minimumRuntimeVersionForLayout("0.22.0", layout), "0.23.0");
  const script = { schema_version: "1.1.0", game_id: "opacity-split", title: "透明度",
    entry_scene_id: "main", characters: [], scenes: [{ scene_id: "main", title: "Main", chapter: 1,
      tags: [], commands: [{ type: "narration", text: "透明度分离，不影响剧情。" }] }] };
  for (const backgroundOpacity of [0, .5, 1]) for (const contentOpacity of [0, .8, 1]) {
    component.style = { backgroundColor: "#24384c", backgroundOpacity, contentOpacity };
    const result = await api.exportEditorCartridge({
      gameId: script.game_id, title: script.title, author: "QA", uiSkin: layout,
      projectAssets: [], projectAssetRefs: [], script,
    });
    assert.deepEqual(result.errors, []);
    const zip = await req("jszip").loadAsync(await result.blob.arrayBuffer());
    const packed = JSON.parse(await zip.file("ui/layout.json").async("string"));
    assert.deepEqual(packed.screens.find(s => s.screen_id === "title").components.find(c =>
      c.component_id === component.component_id).style, component.style);
    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    assert.equal(manifest.runtime_version, "0.23.0");
  }
  for (const field of ["backgroundOpacity", "contentOpacity"]) for (const value of [-.1, 1.1, "0.5", null]) {
    component.style = { [field]: value };
    assert(api.validateUISkinLayout(layout).errors.length > 0, `Reject ${field}=${value}`);
  }
  for (const field of ["backgroundOpacity", "contentOpacity"]) {
    const unsupported = structuredClone(original);
    unsupported.screens.find(s => s.screen_id === "player").components.find(c => c.component_type === "dialog_panel").style = { [field]: .5 };
    assert(api.validateUISkinLayout(unsupported).errors.length > 0, "Dialogue keeps its separate style contract");
    for (const slot of ["panelStyle", "titleStyle", "textStyle"]) {
      const confirmation = structuredClone(original);
      confirmation.confirmationLayout = { [slot]: { [field]: .5 } };
      assert(api.validateUISkinLayout(confirmation).errors.length > 0, "Confirmation is outside the page-layer contract");
    }
    for (const mode of ["nvl", "bubble"]) for (const slot of ["panelStyle", "textStyle", "speakerStyle"]) {
      const dialogue = structuredClone(original);
      dialogue.dialogueLayouts = { [mode]: { [slot]: { [field]: .5 } } };
      assert(api.validateUISkinLayout(dialogue).errors.length > 0, "Mode styles must not accept ignored page channels");
    }
  }
  for (const opacity of [undefined, 0, .5, 1]) {
    component.style = opacity === undefined ? { backgroundColor: "#24384c" } : { backgroundColor: "#24384c", opacity };
    const before = structuredClone(layout);
    api.normalizeUISkinLayoutForRuntime(layout);
    assert.deepEqual(layout, before, "Reading a legacy layout must not migrate or mutate its source");
    assert.equal(api.minimumRuntimeVersionForLayout("0.22.0", layout), "0.22.0");
  }
  assert.deepEqual(original, api.getDefaultUISkinLayout());
  console.log("layout-opacity-split-test: PASS (separate channels, 9 real ZIP exports, range rejection, legacy non-mutation and capability)");
})().catch(error => { console.error(error); process.exitCode = 1; });
