"use strict";
const assert = require("node:assert/strict"), path = require("node:path");
const root = path.resolve(__dirname, "..");
const { createRequire } = require("node:module");
const req = createRequire(path.join(root, "editor/package.json"));
const mod = { exports: {} };
const code = req("esbuild").buildSync({ stdin: { resolveDir: root, loader: "ts", contents: `
  export { resolveUILayoutBackgroundOpacity, getDefaultUISkinLayout } from "./shared/cartridge/uiSkin";
  export * from "./shared/cartridge/uiLayoutProfiles";
  export { exportEditorCartridge } from "./editor/src/cartridge/exportCartridge";
` }, bundle: true, platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text;
new Function("module", "exports", "require", code)(mod, mod.exports, req);
const api = mod.exports;
(async () => {
  let assertions = 0;
  for (const [type, expected] of [
    ["main_menu_hero", .78], ["settings_group", .78], ["save_slot_grid", .78],
    ["history_list", .78], ["about_panel", .78], ["help_panel", .78], ["gallery_grid", .78],
    ["dialog_panel", .78], ["mask", 1], ["quick_menu", .94], ["quick_button", 1],
    ["choice_list", 1], ["choice_option", 1], ["main_menu_settings_button", 1], ["main_menu_custom_button", 1],
    ["main_menu_exit_button", .78], ["main_menu_library_button", .78],
  ]) {
    const inherited = { backgroundColor: "#24384c" }, copy = structuredClone(inherited);
    assert.equal(api.resolveUILayoutBackgroundOpacity(type, inherited), expected);
    assert.deepEqual(inherited, copy); assertions += 2;
    for (const opacity of [0, .5, 1]) {
      assert.equal(api.resolveUILayoutBackgroundOpacity(type, { ...inherited, opacity }), opacity); assertions++;
    }
  }
  const settings = api.switchRuntimeUILayoutType(api.resolveRuntimeUILayoutSettings(), "renpy");
  const agentBefore = structuredClone(settings.runtimeUILayoutProfiles.profiles.agentvn);
  const hero = settings.runtimeUILayout.screens.find(s => s.screen_id === "title")
    .components.find(c => c.component_id === "title_hero");
  hero.style = { backgroundColor: "#24384c" };
  for (const value of [undefined, 0, .5, 1]) {
    if (value === undefined) delete hero.style.opacity;
    else hero.style.opacity = value;
    settings.runtimeUILayoutProfiles.profiles.renpy = settings.runtimeUILayout;
    const result = await api.exportEditorCartridge({
      gameId: "layout-opacity-test", title: "透明度隔离验收", author: "QA",
      projectAssets: [], projectAssetRefs: [], uiLayoutProfiles: settings.runtimeUILayoutProfiles,
      script: { schema_version: "1.1.0", game_id: "layout-opacity-test", title: "透明度",
        entry_scene_id: "main", characters: [], scenes: [{ scene_id: "main", title: "Main", chapter: 1,
          tags: [], commands: [{ type: "narration", text: "透明度继承回归。" }] }] },
    });
    assert.deepEqual(result.errors, []);
    const zip = await req("jszip").loadAsync(await result.blob.arrayBuffer());
    const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
    const packed = layout.screens.find(s => s.screen_id === "title").components.find(c => c.component_id === "title_hero");
    assert.deepEqual(packed.style, hero.style, "Real cartridge bytes retain absence vs explicit zero");
    assert.equal(Object.hasOwn(packed.style, "opacity"), value !== undefined);
    assert.deepEqual(settings.runtimeUILayoutProfiles.profiles.agentvn, agentBefore);
    assertions += 4;
  }
  console.log(JSON.stringify({ status: "PASS", assertions, scope: "defaults, non-mutation and real cartridge ZIP bytes",
    unchangedSemantics: "Legacy generic explicit opacity still also affects CSS element opacity" }));
})().catch(e => { console.error(e); process.exitCode = 1; });
