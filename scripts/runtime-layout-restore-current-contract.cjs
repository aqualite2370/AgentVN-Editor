const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const esbuild = require("../editor/node_modules/esbuild");

const root = path.resolve(__dirname, "..");
const compiled = new Module(path.join(root, "output", "runtime-layout-restore-current-contract.cjs"), module);
compiled.filename = compiled.id;
compiled.paths = module.paths;
compiled._compile(esbuild.buildSync({
  stdin: {
    contents: `
      export { restoreRuntimeLayoutPage, repairRuntimeDialogueLayout, restoreAllRuntimeLayoutPages, resolveRuntimeLayoutEditorScreen } from "./editor/src/utils/runtimeLayoutRestore";
      export { getDefaultUISkinLayout } from "./shared/cartridge/uiSkin";
    `,
    resolveDir: root, loader: "ts",
  },
  bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent",
}).outputFiles[0].text, compiled.filename);
const { restoreRuntimeLayoutPage, repairRuntimeDialogueLayout, restoreAllRuntimeLayoutPages, getDefaultUISkinLayout } = compiled.exports;
const defaults = getDefaultUISkinLayout();
const resolveEditorScreen = compiled.exports.resolveRuntimeLayoutEditorScreen;
assert.equal(resolveEditorScreen("agentvn", "game_menu"), "player",
  "旧默认编辑会话不能重新打开没有玩家导航的示意页");
assert.equal(resolveEditorScreen("agentvn", undefined), "player");
assert.equal(resolveEditorScreen("renpy", undefined), "title");
assert.equal(resolveEditorScreen("renpy", "game_menu"), "game_menu",
  "Ren’Py共享导航仍须保留实际编辑入口");
for (const id of ["title", "player", "save_load", "preferences", "history", "gallery", "about"])
  assert.equal(resolveEditorScreen("agentvn", id), id, "既有默认页面选择不能被重置");
assert.equal(resolveEditorScreen("renpy", "help"), "help", "独立帮助页面保持可恢复");
console.log("runtime-layout-editor-screen-restore: PASS (legacy default fallback and independent Ren’Py selection)");
const protectedTypes = new Set(["quick_menu", "quick_button", "choice_option", "main_menu_custom_button_container"]);
const clone = (value) => structuredClone(value);
function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function authoredLayout() {
  const layout = clone(defaults);
  layout.name = "Authored layout, not a preset name";
  for (const screen of layout.screens) {
    for (const component of screen.components) {
      if (component.rect) component.rect = { ...component.rect, x: component.rect.x + 1, anchor: "bottom_center" };
      component.style = { ...component.style, backgroundImage: "asset:kept-ui-image", fontSize: 23, opacity: 0.73 };
      component.label = "Authored text";
      component.visible = false;
      component.action = { kind: "external_url", url: "https://example.com/kept", open_mode: "system_browser" };
    }
    screen.components.push(
      { component_id: `custom_mask_${screen.screen_id}`, component_type: "mask",
        rect: { x: 2, y: 3, width: 20, height: 30 }, style: { backgroundImage: "asset:kept-mask", backdropBlur: 17 } },
      { component_id: `custom_button_${screen.screen_id}`, component_type: "main_menu_custom_button",
        rect: { x: 4, y: 5, width: 18, height: 7 }, action: { kind: "external_url", url: "https://example.com/" } },
      { ...clone(screen.components[0]), component_id: `custom_same_type_${screen.screen_id}` },
    );
  }
  return layout;
}

let checked = 0;
for (const defaultScreen of defaults.screens) {
  const source = authoredLayout();
  const before = clone(source);
  const expected = clone(source);
  const target = expected.screens.find((screen) => screen.screen_id === defaultScreen.screen_id);
  for (const component of target.components) {
    const original = defaultScreen.components.find((item) => item.component_id === component.component_id);
    if (original?.rect && !component.locked && !protectedTypes.has(component.component_type)) component.rect = clone(original.rect);
  }
  const restored = restoreRuntimeLayoutPage(freeze(source), defaultScreen.screen_id);
  assert.deepEqual(restored, expected, `${defaultScreen.screen_id}: only the selected page's built-in rects may change`);
  assert.deepEqual(source, before, "restore mutated its input");
  assert.deepEqual(restoreRuntimeLayoutPage(restored, defaultScreen.screen_id), restored, "restore must be idempotent");
  // Locks are respected even when the action addresses a whole page.
  const locked = authoredLayout();
  for (const component of locked.screens.find((screen) => screen.screen_id === defaultScreen.screen_id).components) component.locked = true;
  assert.deepEqual(restoreRuntimeLayoutPage(freeze(locked), defaultScreen.screen_id), locked, "restore moved a locked component");
  checked++;
}
const changedType = authoredLayout();
changedType.screens.find((screen) => screen.screen_id === "player").components
  .find((component) => component.component_id === "speaker_label").component_type = "mask";
const originalMask = clone(changedType.screens.find((screen) => screen.screen_id === "player").components
  .find((component) => component.component_id === "speaker_label"));
const restored = restoreRuntimeLayoutPage(freeze(changedType), "player");
assert.deepEqual(restored.screens.find((screen) => screen.screen_id === "player").components
  .find((component) => component.component_id === "speaker_label"), originalMask, "ID/type mismatch must not overwrite custom data");
console.log(`runtime-layout-restore-current-contract: PASS (${checked} pages; scope, content, assets, locks, fixed geometry, immutability)`);

const dialogueIds = ["dialog_panel", "speaker_label", "dialog_text", "continue_indicator"];
for (const locked of [false, true]) {
  const source = authoredLayout();
  const player = source.screens.find((screen) => screen.screen_id === "player");
  if (locked) for (const component of player.components) {
    if (dialogueIds.includes(component.component_id)) component.locked = true;
  }
  const expected = clone(source);
  for (const component of expected.screens.find((screen) => screen.screen_id === "player").components) {
    if (dialogueIds.includes(component.component_id) && !component.locked) {
      component.rect = clone(defaults.screens.find((screen) => screen.screen_id === "player").components
        .find((item) => item.component_id === component.component_id).rect);
    }
  }
  const before = clone(source);
  const repaired = repairRuntimeDialogueLayout(freeze(source));
  assert.deepEqual(repaired, expected, "dialogue repair changed non-dialogue content or ignored locks");
  assert.deepEqual(source, before, "dialogue repair mutated its input");
  assert.deepEqual(repairRuntimeDialogueLayout(repaired), repaired, "dialogue repair must be idempotent");
}
assert.deepEqual(repairRuntimeDialogueLayout(changedType).screens.find((screen) => screen.screen_id === "player").components
  .find((component) => component.component_id === "speaker_label"), originalMask, "dialogue repair overwrote mismatched custom data");
console.log("runtime-layout-dialogue-repair-contract: PASS (only four player components; preserve materials, assets, locks and all other data)");

const allSource = authoredLayout();
allSource.tokens = { ...allSource.tokens, accent: "#123456" };
const allPlayer = allSource.screens.find((screen) => screen.screen_id === "player");
allPlayer.components.find((component) => component.component_id === "speaker_label").locked = true;
allPlayer.components.find((component) => component.component_id === "dialog_text").component_type = "mask";
const allBefore = clone(allSource);
const allExpected = clone(allSource);
for (const screen of allExpected.screens) {
  for (const component of screen.components) {
    const original = defaults.screens.find((item) => item.screen_id === screen.screen_id)?.components
      .find((item) => item.component_id === component.component_id && item.component_type === component.component_type);
    if (original?.rect && !component.locked && !protectedTypes.has(component.component_type)) component.rect = clone(original.rect);
  }
}
const allRestored = restoreAllRuntimeLayoutPages(freeze(allSource));
assert.deepEqual(allRestored, allExpected, "all-page restore changed protected content, style, actions, locks, or mismatched IDs");
assert.deepEqual(allSource, allBefore, "all-page restore mutated its input");
assert.deepEqual(restoreAllRuntimeLayoutPages(allRestored), allRestored, "all-page restore must be idempotent");
console.log("runtime-layout-restore-all-contract: PASS (eight pages, preserved custom content/theme/assets/actions, locks, ID/type mismatch, immutability)");
