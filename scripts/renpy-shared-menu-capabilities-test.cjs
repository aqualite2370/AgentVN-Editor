"use strict";
const assert = require("node:assert/strict"), path = require("node:path");
const root = path.resolve(__dirname, "..");
const source = require("../editor/node_modules/esbuild").buildSync({ stdin: { resolveDir: root, loader: "ts",
  contents: 'export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles"; export { minimumRuntimeVersionForLayout } from "./shared/cartridge/runtimeCapabilities"; export { SUPPORTED_RUNTIME_VERSION } from "./shared/cartridge/constants"; export { isRuntimeCompatible } from "./shared/cartridge/compatibility";' },
  bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text;
const mod = { exports: {} }; new Function("module", "exports", source)(mod, mod.exports);
const api = mod.exports;
const layout = api.createRenpyUILayout();
const shared = layout.screens.find(screen => screen.screen_id === "game_menu");
shared.components.push({ component_id: "shared-component", component_type: "custom_component", visible: true,
  rect: { x: 70, y: 90, width: 20, height: 8 }, customComponent: { schemaVersion: 1,
    root: { tag: "div", children: [] }, styles: {} } });
assert.equal(api.minimumRuntimeVersionForLayout("0.20.0", layout), "0.21.0",
  "Shared-menu consumption must declare a capability unsupported by old Runtime");
assert.equal(api.isRuntimeCompatible("0.21.0", "0.20.0"), false);
assert.equal(api.isRuntimeCompatible("0.21.0", api.SUPPORTED_RUNTIME_VERSION), true);
shared.components.pop();
assert.notEqual(api.minimumRuntimeVersionForLayout("0.20.0", layout), "0.21.0", "Legacy layout without shared overlays must not be upgraded");
shared.components.push({ component_id: "shared-mask", component_type: "mask", visible: true,
  rect: { x: 70, y: 90, width: 20, height: 8 }, style: { maskMode: "solid", backgroundColor: "#000000" } });
assert.equal(api.minimumRuntimeVersionForLayout("0.20.0", layout), "0.21.0");
console.log("PASS shared-menu capability declaration, old Runtime refusal and legacy preservation");
