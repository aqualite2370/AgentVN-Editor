#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const esbuild = require("../editor/node_modules/esbuild");

const root = path.resolve(__dirname, "..");
const result = esbuild.buildSync({
  stdin: {
    contents: [
      "export { getDefaultUISkinLayout, validateUISkinHealth } from './shared/cartridge/uiSkin';",
    ].join("\n"),
    loader: "ts",
    resolveDir: root,
    sourcefile: "output/automated/ui-skin-style-component-health-entry.ts",
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  write: false,
});
const runtimeModule = { exports: {} };
new Function("module", "exports", result.outputFiles[0].text)(runtimeModule, runtimeModule.exports);
const { getDefaultUISkinLayout, validateUISkinHealth } = runtimeModule.exports;

const defaultLayout = getDefaultUISkinLayout();
const defaultHealth = validateUISkinHealth(defaultLayout);
assert.equal(
  defaultHealth.errors.some((error) => (
    error.code === "ui_component_missing_rect"
    && error.path === "ui.player.choice_option"
  )),
  false,
  `choice_option is a repeated child style template and must not require an independent rect:\n${JSON.stringify(defaultHealth.errors, null, 2)}`,
);

const brokenLayout = structuredClone(defaultLayout);
const playerScreen = brokenLayout.screens.find((screen) => screen.screen_id === "player");
const choiceList = playerScreen.components.find((component) => component.component_type === "choice_list");
delete choiceList.rect;
delete choiceList.mobileRect;
const brokenHealth = validateUISkinHealth(brokenLayout);
assert.equal(
  brokenHealth.errors.some((error) => (
    error.code === "ui_component_missing_rect"
    && error.path === "ui.player.choice_list"
  )),
  true,
  "A required positioned component must still fail health validation when its rect is missing.",
);

console.log("PASS UI skin health distinguishes style templates from positioned components");
