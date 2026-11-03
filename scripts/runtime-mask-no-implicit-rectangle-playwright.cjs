#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const esbuild = require("../editor/node_modules/esbuild");
const Module = require("node:module");
const root = path.resolve(__dirname, "..");
const source = `import { getDefaultUISkinLayout, migrateLegacyUISkinLayout } from "./shared/cartridge/uiSkin"; export { getDefaultUISkinLayout, migrateLegacyUISkinLayout };`;
const out = esbuild.buildSync({ stdin: { contents: source, loader: "ts", resolveDir: root }, bundle: true, format: "cjs", platform: "node", write: false, logLevel: "silent" }).outputFiles[0].text;
const filename = path.join(root, "output", "runtime-mask-no-implicit-entry.cjs");
const mod = new Module(filename, module); mod.filename = filename; mod.paths = Module._nodeModulePaths(root); mod._compile(out, filename);
const layout = mod.exports.migrateLegacyUISkinLayout(mod.exports.getDefaultUISkinLayout());
const title = layout.screens.find((s) => s.screen_id === "title");
const masks = title.components.filter((c) => c.component_type === "mask");
assert.equal(masks.length, 1);
assert.equal(masks[0].component_id, "title_default_action_mask");
assert.equal(masks[0].style?.maskMode, "blur");
for (const version of ["1.0.0", "2.0.0"]) {
  const missing = structuredClone(layout);
  missing.ui_layout_version = version;
  missing.screens.find((s) => s.screen_id === "title").components =
    missing.screens.find((s) => s.screen_id === "title").components.filter((c) => c.component_type !== "mask");
  const restoredDefault = mod.exports.migrateLegacyUISkinLayout(missing);
  assert.equal(restoredDefault.screens.find((s) => s.screen_id === "title")
    .components.filter((c) => c.component_id === "title_default_action_mask").length,
  0, `${version}: deleted title mask must not be recreated`);
  assert.deepEqual(
    mod.exports.migrateLegacyUISkinLayout(JSON.parse(JSON.stringify(restoredDefault))),
    restoredDefault, `${version}: saving and reopening must preserve mask deletion`);
  const custom = structuredClone(layout);
  custom.ui_layout_version = version;
  const screen = custom.screens.find((s) => s.screen_id === "title");
  screen.components = screen.components.filter((c) => c.component_type !== "mask");
  const authored = {
    component_id: "user-title-mask", component_type: "mask",
    visible: false, rect: { x: 12, y: 8, width: 30, height: 70 },
    style: { maskMode: "solid", backgroundColor: "#123456", opacity: 0.4 },
  };
  screen.components.push(authored);
  const before = JSON.stringify(custom);
  const migrated = mod.exports.migrateLegacyUISkinLayout(custom);
  assert.equal(JSON.stringify(custom), before, "migration mutated the source project");
  const migratedMasks = migrated.screens.find((s) => s.screen_id === "title")
    .components.filter((c) => c.component_type === "mask");
  assert.deepEqual(migratedMasks, [authored], `${version}: custom/hidden mask must prevent duplicate default`);
  const reopened = mod.exports.migrateLegacyUISkinLayout(JSON.parse(JSON.stringify(migrated)));
  assert.deepEqual(reopened, migrated, `${version}: reopening changed the migrated layout`);
}
console.log("runtime-mask-default-title-action: PASS");
