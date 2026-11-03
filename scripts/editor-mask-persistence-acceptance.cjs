#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const esbuild = require("../editor/node_modules/esbuild");
const Module = require("node:module");
const root = path.resolve(__dirname, "..");
const source = `import { getDefaultUISkinLayout, migrateLegacyUISkinLayout, normalizeUISkinLayoutForRuntime, createDefaultMask, DEFAULT_TITLE_ACTION_MASK_COMPONENT_ID, DEFAULT_TITLE_TEXT_BUTTON_STYLE } from "./shared/cartridge/uiSkin"; export { getDefaultUISkinLayout, migrateLegacyUISkinLayout, normalizeUISkinLayoutForRuntime, createDefaultMask, DEFAULT_TITLE_ACTION_MASK_COMPONENT_ID, DEFAULT_TITLE_TEXT_BUTTON_STYLE };`;
const out = esbuild.buildSync({ stdin: { contents: source, loader: "ts", resolveDir: root }, bundle: true, format: "cjs", platform: "node", write: false, logLevel: "silent" }).outputFiles[0].text;
const filename = path.join(root, "output", "editor-mask-persistence-entry.cjs");
const mod = new Module(filename, module); mod.filename = filename; mod.paths = Module._nodeModulePaths(root); mod._compile(out, filename);
const layout = mod.exports.getDefaultUISkinLayout();
const title = layout.screens.find((s) => s.screen_id === "title");
const mask = mod.exports.createDefaultMask("persisted_mask", "持久化遮罩");
title.components.push(mask);
const roundTrip = mod.exports.migrateLegacyUISkinLayout(JSON.parse(JSON.stringify(layout)));
const restored = roundTrip.screens.find((s) => s.screen_id === "title").components.find((c) => c.component_id === "persisted_mask");
assert.ok(restored); assert.deepEqual(restored.rect, mask.rect); assert.deepEqual(restored.style, mask.style);
assert.equal(Object.hasOwn(restored, "mobileRect"), false);

const defaultMask = title.components.find((component) => component.component_id === mod.exports.DEFAULT_TITLE_ACTION_MASK_COMPONENT_ID);
assert.ok(defaultMask, "new layouts must still provide the default title mask");
assert.equal(defaultMask.style?.backgroundColor, "rgba(8, 13, 22, 0.62)");
for (const component of title.components.filter((item) => item.component_type.startsWith("main_menu_") && item.component_type.endsWith("_button"))) {
  assert.equal(component.style?.backgroundColor, "transparent", `${component.component_id} must default to a text-only button`);
  assert.equal(component.style?.borderWidth, 0, `${component.component_id} must default to no button border`);
}

const deletedMaskLayout = JSON.parse(JSON.stringify(layout));
deletedMaskLayout.ui_layout_version = "1.0.0";
deletedMaskLayout.screens.find((screen) => screen.screen_id === "title").components = deletedMaskLayout.screens
  .find((screen) => screen.screen_id === "title").components
  .filter((component) => component.component_id !== mod.exports.DEFAULT_TITLE_ACTION_MASK_COMPONENT_ID);
const migratedWithoutMask = mod.exports.migrateLegacyUISkinLayout(deletedMaskLayout);
const normalizedWithoutMask = mod.exports.normalizeUISkinLayoutForRuntime(deletedMaskLayout).layout;
for (const candidate of [migratedWithoutMask, normalizedWithoutMask]) {
  const candidateTitle = candidate.screens.find((screen) => screen.screen_id === "title");
  assert.ok(candidateTitle);
  assert.equal(
    candidateTitle.components.some((component) => component.component_id === mod.exports.DEFAULT_TITLE_ACTION_MASK_COMPONENT_ID),
    false,
    "explicitly deleted title mask must not be recreated by migration or runtime normalization",
  );
}
console.log("editor-mask-persistence-acceptance: PASS");
