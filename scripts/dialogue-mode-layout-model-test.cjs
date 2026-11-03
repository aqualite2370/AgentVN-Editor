"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const loaded = { exports: {} };
const built = require("../editor/node_modules/esbuild").buildSync({
  stdin: { contents: `
    export { getDefaultUISkinLayout, validateUISkinLayout, migrateLegacyUISkinLayout } from "./shared/cartridge/uiSkin";
    export { resolveDialogueModeLayout, updateDialogueModeLayout, constrainDialogueLayoutRect } from "./shared/cartridge/dialogueModeLayout";
    export { isRuntimeCompatible } from "./shared/cartridge/compatibility";
    export { resolveRuntimeUILayoutSettings } from "./shared/cartridge/uiLayoutProfiles";
    export { minimumRuntimeVersionForLayout } from "./shared/cartridge/runtimeCapabilities";`,
    resolveDir: root, loader: "ts" },
  bundle: true, platform: "node", format: "cjs", write: false,
});
new Function("module", "exports", built.outputFiles[0].text)(loaded, loaded.exports);
const api = loaded.exports;
const original = api.migrateLegacyUISkinLayout(api.getDefaultUISkinLayout());
const snapshot = structuredClone(original);
const untouched = api.resolveDialogueModeLayout(original, "nvl");
assert.equal(untouched.overridden, false, "旧工程不得自动新增模式覆盖");
const edited = api.updateDialogueModeLayout(original, "nvl", {
  rect: { x: 8, y: 15, width: 84, height: 62, anchor: "top_left" },
  panelStyle: { backgroundColor: "#224466", borderRadius: 7 },
  textStyle: { color: "#eeddaa", fontSize: 25 },
});
assert.deepEqual(original, snapshot, "模式编辑不得修改调用方工程");
assert.deepEqual(edited.screens, original.screens, "模式编辑不得改写普通对白或其他页面");
assert.equal(api.resolveDialogueModeLayout(edited, "bubble").overridden, false);
assert.equal(api.resolveDialogueModeLayout(edited, "nvl").textStyle.fontSize, 25);
// The current template also exposes hide-UI (0.25). Editing NVL must never
// downgrade that independent requirement to the older mode-only floor.
assert.equal(api.minimumRuntimeVersionForLayout("0.18.0", edited), "0.25.0");
assert.equal(api.isRuntimeCompatible(api.minimumRuntimeVersionForLayout("0.18.0", edited), "0.18.0"), false);
assert.equal(api.isRuntimeCompatible(api.minimumRuntimeVersionForLayout("0.18.0", edited), "0.19.0"), false);
assert.equal(api.isRuntimeCompatible(api.minimumRuntimeVersionForLayout("0.18.0", edited), "0.25.0"), true);
const modeOnly = structuredClone(edited);
for (const screen of modeOnly.screens)
  screen.components = screen.components.filter(c => c.component_id !== "quick_hide_ui_button");
assert.equal(api.minimumRuntimeVersionForLayout("0.18.0", modeOnly), "0.19.0",
  "Isolated NVL appearance still requires its exact 0.19 floor");
const canonical = api.resolveRuntimeUILayoutSettings({ runtimeUILayout: edited });
assert.equal(canonical.runtimeUILayout.target_runtime, "0.25.0");
assert.deepEqual(canonical.runtimeUILayoutProfiles.profiles.agentvn.dialogueLayouts, edited.dialogueLayouts);
assert.equal(api.validateUISkinLayout(edited).errors.length, 0);
const reset = api.updateDialogueModeLayout(edited, "nvl", undefined);
assert.equal(reset.dialogueLayouts, undefined);
assert.deepEqual(reset.screens, original.screens);
assert.equal(api.resolveDialogueModeLayout(reset, "nvl").overridden, false);
const invalid = structuredClone(edited);
invalid.dialogueLayouts.nvl.rect.width = -1;
assert(api.validateUISkinLayout(invalid).errors.some(issue => issue.path.includes("dialogueLayouts.nvl.rect")));
const unknown = structuredClone(edited);
unknown.dialogueLayouts.nvl.script = "do not execute";
assert(api.validateUISkinLayout(unknown).errors.some(issue => issue.path.includes("dialogueLayouts.nvl.script")));
assert.deepEqual(api.constrainDialogueLayoutRect({ x: 18, y: 99, width: 84, height: 62, anchor: "top_left" }),
  { x: 16, y: 38, width: 84, height: 62, anchor: "top_left" });
assert.deepEqual(api.constrainDialogueLayoutRect({ x: 2, y: 99, width: 40, height: 28, anchor: "center" }),
  { x: 20, y: 86, width: 40, height: 28, anchor: "center" });
console.log("PASS dialogue mode layout inheritance, independent edits/reset, validation and runtime capability");
