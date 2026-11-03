const assert = require("node:assert/strict");
const path = require("node:path");
const esbuild = require("../editor/node_modules/esbuild");
const root = path.resolve(__dirname, "..");
const compiled = { exports: {} };
new Function("module", "exports", esbuild.buildSync({
  stdin: { contents: `
    export * from "./shared/cartridge/uiSkin";
    export { applyRuntimeThemePreset, applyRuntimeThemeTokens, runtimeThemePresets } from "./shared/cartridge/uiThemePresets";
  `, loader: "ts", resolveDir: root }, bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text)(compiled, compiled.exports);
const { getDefaultUISkinLayout, isBuiltinTitleButton, resolveTitleButtonStyle, editUILayoutComponentStyle,
  migrateLegacyUISkinLayout, normalizeUISkinLayoutForRuntime, validateUISkinLayout,
  applyRuntimeThemePreset, applyRuntimeThemeTokens, runtimeThemePresets } = compiled.exports;
const skin = getDefaultUISkinLayout();
const title = skin.screens.find((screen) => screen.screen_id === "title");
assert.equal(title.components.filter(isBuiltinTitleButton).length, 6);
for (const button of title.components.filter(isBuiltinTitleButton)) {
  assert.equal(button.style.backgroundColor, "transparent");
  assert.equal(button.style.borderWidth, 0);
  assert.equal(button.style.shadow, "none");
  const old = { ...button, style: { backgroundColor: "#123456", borderWidth: 6, shadow: "strong",
    backgroundImage: "asset:preserved_old_image", fontSize: 30 } };
  const before = structuredClone(old);
  assert.equal(resolveTitleButtonStyle(old).backgroundColor, "transparent", "old project settings must not opt in");
  assert.equal(resolveTitleButtonStyle(old).backgroundImage, undefined);
  assert.deepEqual(old, before, "resolving display deleted legacy source data");
  const geometryOnly = { ...old, rect: { ...old.rect, x: 40 } };
  assert.equal(resolveTitleButtonStyle(geometryOnly).backgroundColor, "transparent", "moving a button opted into its old style");
  const authored = editUILayoutComponentStyle(old, { backgroundColor: "#654321" });
  assert.equal(authored.titleButtonStyleSource, "layout");
  assert.equal(resolveTitleButtonStyle(authored).backgroundColor, "#654321");
  assert.equal(authored.style.backgroundImage, undefined, "first explicit edit resurrected a hidden legacy image");
  assert.equal(authored.style.borderWidth, 0);
  const transparent = editUILayoutComponentStyle(authored, { backgroundColor: undefined });
  assert.equal(resolveTitleButtonStyle(transparent).backgroundColor, "transparent");
  Object.assign(button, authored);
}
const custom = { component_id: "custom", component_type: "main_menu_custom_button",
  style: { backgroundImage: "asset:custom", backgroundColor: "#234567" }, action: { kind: "none" } };
assert.deepEqual(resolveTitleButtonStyle(custom), custom.style, "custom artwork changed");
assert.equal(editUILayoutComponentStyle(custom, { color: "#abcdef" }).titleButtonStyleSource, undefined);
const before = structuredClone(skin);
for (const themed of [
  ...runtimeThemePresets.map((preset) => applyRuntimeThemePreset(skin, preset)),
  applyRuntimeThemeTokens(skin, { colorControl: "#fedcba", colorControlText: "#000000", radius: 40 }),
]) {
  const validation = validateUISkinLayout(themed);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  assert.deepEqual(themed.screens.find((screen) => screen.screen_id === "title"), title,
    "theme application overrode explicit client layout styling");
}
assert.deepEqual(skin, before);
const roundTrip = migrateLegacyUISkinLayout(JSON.parse(JSON.stringify(skin)));
assert.deepEqual(roundTrip, skin, "round-trip lost style provenance");
assert.equal(validateUISkinLayout(roundTrip).ok, true);
const normalized = normalizeUISkinLayoutForRuntime(roundTrip).layout;
for (const button of normalized.screens.find((screen) => screen.screen_id === "title").components.filter(isBuiltinTitleButton)) {
  assert.equal(button.titleButtonStyleSource, "layout");
  assert.equal(button.style.backgroundColor, "#654321");
}
console.log("title-text-button-style-contract: PASS (six defaults, legacy display/source preservation, explicit edits, all themes, JSON/migration/runtime parity)");
