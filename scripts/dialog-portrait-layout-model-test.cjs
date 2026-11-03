"use strict";
const assert = require("node:assert/strict"), path = require("node:path");
const loaded = { exports: {} }, root = path.resolve(__dirname, "..");
const built = require("../editor/node_modules/esbuild").buildSync({ stdin: { resolveDir: root, loader: "ts",
  contents: `
    export {getDefaultUISkinLayout,validateUISkinLayout,migrateLegacyUISkinLayout,normalizeUISkinLayoutForRuntime} from "./shared/cartridge/uiSkin";
    export {updateDialogPortraitLayout,dialogPortraitLayoutErrors} from "./shared/cartridge/dialogPortraitLayout";
    export {resolveRuntimeUILayoutSettings,switchRuntimeUILayoutType,updateActiveRuntimeUILayout,createRenpyUILayout} from "./shared/cartridge/uiLayoutProfiles";
    export {minimumRuntimeVersionForLayout} from "./shared/cartridge/runtimeCapabilities";
    export {isRuntimeCompatible} from "./shared/cartridge/compatibility";
    export {SUPPORTED_RUNTIME_VERSION} from "./shared/cartridge/constants";`,
}, bundle: true, platform: "node", format: "cjs", write: false });
new Function("module", "exports", built.outputFiles[0].text)(loaded, loaded.exports);
const a = loaded.exports, base = a.migrateLegacyUISkinLayout(a.getDefaultUISkinLayout());
const snapshot = structuredClone(base), config = { offsetX: 32, offsetY: -16, size: 48 };
const edited = a.updateDialogPortraitLayout(base, config);
assert.deepEqual(base, snapshot); assert.deepEqual(edited.screens, base.screens);
assert.equal(base.dialogPortrait, undefined); assert.deepEqual(edited.dialogPortrait, config);
config.size = 100;
assert.equal(edited.dialogPortrait.size, 48, "Author data must be copied, never aliased");
assert.deepEqual(a.migrateLegacyUISkinLayout(edited).dialogPortrait, edited.dialogPortrait);
assert.equal(a.validateUISkinLayout(edited).errors.length, 0);
let settings = a.resolveRuntimeUILayoutSettings({ runtimeUILayout: edited });
assert.equal(settings.runtimeUILayout.target_runtime, "0.22.0");
const saved = structuredClone(settings);
settings = a.switchRuntimeUILayoutType(settings, "renpy");
assert.equal(settings.runtimeUILayout.dialogPortrait, undefined, "First type switch must not inherit another type's portrait");
settings = a.updateActiveRuntimeUILayout(settings, a.updateDialogPortraitLayout(settings.runtimeUILayout, { offsetY: -72 }));
settings = a.switchRuntimeUILayoutType(settings, "agentvn");
assert.deepEqual(settings.runtimeUILayout.dialogPortrait, edited.dialogPortrait);
assert.deepEqual(settings.runtimeUILayoutProfiles.profiles.renpy.dialogPortrait, { offsetY: -72 });
assert.deepEqual(saved.runtimeUILayoutProfiles.profiles.agentvn.dialogPortrait, edited.dialogPortrait);
assert.deepEqual(a.resolveRuntimeUILayoutSettings(JSON.parse(JSON.stringify(settings))), settings, "Reopen must retain both profiles");
assert.equal(a.updateDialogPortraitLayout(edited, undefined).dialogPortrait, undefined);
assert.equal(a.updateDialogPortraitLayout(edited, {}).dialogPortrait, undefined);
assert.equal(a.minimumRuntimeVersionForLayout("0.2.0", base), "0.2.0", "Old layout requirements must not rise");
assert.equal(a.minimumRuntimeVersionForLayout("0.2.0", { ...base, dialogPortrait: {} }), "0.2.0");
assert.equal(a.minimumRuntimeVersionForLayout("0.21.0", edited), "0.22.0");
assert.equal(a.minimumRuntimeVersionForLayout("1.0.0", edited), "1.0.0", "Never downgrade higher capabilities");
assert.equal(a.isRuntimeCompatible("0.22.0", "0.21.0"), false);
assert.equal(a.isRuntimeCompatible("0.22.0", a.SUPPORTED_RUNTIME_VERSION), true);
let checks = 21;
for (const invalid of [null, [], "bad", { offsetX: NaN }, { offsetX: Infinity }, { offsetX: "0" },
  { offsetX: -1281 }, { offsetX: 1281 }, { offsetY: -721 }, { offsetY: 721 }, { size: 0 },
  { size: 257 }, { size: "48" }, { script: "never execute" }, { toString: 3 }, { constructor: 3 }]) {
  const errors = a.validateUISkinLayout({ ...base, dialogPortrait: invalid }).errors;
  assert(errors.some(e => e.path.startsWith("ui.dialogPortrait")), JSON.stringify(invalid)); checks++;
}
for (const config of [{ offsetX: -1280, offsetY: -720, size: 12 }, { offsetX: 1280, offsetY: 720, size: 256 },
  { offsetX: 0, offsetY: 0 }, { size: 12.5 }, {}]) {
  assert.equal(a.validateUISkinLayout({ ...base, dialogPortrait: config }).errors.length, 0); checks++;
}
assert.throws(() => a.updateDialogPortraitLayout(base, { offsetY: 900 }));
assert.deepEqual(base, snapshot);
console.log(`PASS ${checks + 2} portrait layout preservation, author bounds, validation, profile isolation/reset/reopen and capability checks (API, not old binary)`);
