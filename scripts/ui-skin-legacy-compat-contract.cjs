#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("../editor/node_modules/esbuild");

const root = path.resolve(__dirname, "..");
const result = esbuild.buildSync({
  stdin: {
    contents: [
      "export { getDefaultUISkinLayout, normalizeUISkinLayoutForRuntime, validateUISkinLayout } from './shared/cartridge/uiSkin';",
    ].join("\n"),
    loader: "ts",
    resolveDir: root,
    sourcefile: "output/automated/ui-skin-legacy-compat-entry.ts",
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  write: false,
});

const runtimeModule = { exports: {} };
new Function("module", "exports", result.outputFiles[0].text)(runtimeModule, runtimeModule.exports);
const { getDefaultUISkinLayout, normalizeUISkinLayoutForRuntime, validateUISkinLayout } = runtimeModule.exports;

const original = getDefaultUISkinLayout();
const legacy = structuredClone(original);
const player = legacy.screens.find((screen) => screen.screen_id === "player");
const dialog = player.components.find((component) => component.component_id === "dialog_panel");
dialog.style = {
  ...(dialog.style ?? {}),
  borderColor: "var(--line)",
  backgroundColor: "color-mix(in srgb, var(--surface) 70%, transparent)",
};
const quick = player.components.find((component) => component.component_id === "quick_auto_button");
quick.style = {
  ...(quick.style ?? {}),
  borderColor: "transparent",
};
const before = JSON.stringify(legacy);
const normalized = normalizeUISkinLayoutForRuntime(legacy);

assert.equal(JSON.stringify(legacy), before, "normalization must not mutate the source layout");
assert.equal(normalized.layout.screens.find((screen) => screen.screen_id === "player").components.find((component) => component.component_id === "dialog_panel").style.borderColor, "#d8e2ff");
assert.equal(normalized.layout.screens.find((screen) => screen.screen_id === "player").components.find((component) => component.component_id === "quick_auto_button").style.borderColor, "transparent");
assert.ok(normalized.warnings.length >= 2, "legacy CSS values should produce non-blocking compatibility warnings");
assert.equal(validateUISkinLayout(normalized.layout).ok, true, "normalized legacy layout must pass schema validation");

const exportSource = fs.readFileSync(path.join(root, "editor/src/cartridge/exportCartridge.ts"), "utf8");
const previewPanelSource = fs.readFileSync(path.join(root, "editor/src/components/editor/PreviewPanel.tsx"), "utf8");
assert.match(exportSource, /uiSkinCompatibilityWarnings/, "live preview data must expose non-blocking compatibility warnings");
assert.match(previewPanelSource, /已自动兼容.*历史样式/, "preview status must distinguish automatically normalized legacy styles");
assert.match(previewPanelSource, /has-compatibility-warning/, "compatibility warnings must have a non-error preview status");

console.log("PASS legacy UI skin normalization preserves valid values and makes old layouts previewable");
