#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const esbuild = require("../editor/node_modules/esbuild");

const root = path.resolve(__dirname, "..");
const source = `
  import {
    getDefaultUISkinLayout,
    resolveTitleButtonLabel,
  } from "./shared/cartridge/uiSkin";

  export function run() {
    const layout = getDefaultUISkinLayout();
    const title = layout.screens.find((screen) => screen.screen_id === "title");
    if (!title) throw new Error("Missing title screen.");
    return {
      defaults: Object.fromEntries(
        title.components
          .filter((component) => component.component_type.startsWith("main_menu_") && component.component_type.endsWith("_button"))
          .map((component) => [component.component_type, component.label]),
      ),
      custom: resolveTitleButtonLabel("main_menu_settings_button", "设置与退出", "设置"),
      legacySettings: resolveTitleButtonLabel("main_menu_settings_button", "选项按钮", "设置"),
      oldDefaultSettings: resolveTitleButtonLabel("main_menu_settings_button", "选项", "设置"),
      legacyStart: resolveTitleButtonLabel("main_menu_start_button", "开始/重新开始按钮", "重新开始"),
      defaultStart: resolveTitleButtonLabel("main_menu_start_button", "开始游戏", "重新开始"),
      blank: resolveTitleButtonLabel("main_menu_about_button", "   ", "关于"),
    };
  }
`;

const result = esbuild.buildSync({
  stdin: {
    contents: source,
    loader: "ts",
    resolveDir: root,
    sourcefile: "output/title-button-label-sync-entry.ts",
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
  write: false,
  logLevel: "silent",
});
const output = result.outputFiles?.[0]?.text;
if (!output) throw new Error("Unable to compile title button label sync harness.");
const filename = path.join(root, "output", "title-button-label-sync-entry.cjs");
const compiled = new Module(filename, module);
compiled.filename = filename;
compiled.paths = Module._nodeModulePaths(root);
compiled._compile(output, filename);

const actual = compiled.exports.run();
assert.deepEqual(
  actual.defaults,
  {
    main_menu_continue_button: "继续游戏",
    main_menu_start_button: "开始游戏",
    main_menu_save_load_button: "存档",
    main_menu_gallery_button: "画廊",
    main_menu_settings_button: "设置",
    main_menu_about_button: "关于",
  },
  "default fixed title button labels must be short player-facing copy",
);
assert.equal(actual.custom, "设置与退出", "user-authored fixed button copy must win");
assert.equal(actual.legacySettings, "设置", "legacy default settings label must fall back to current copy");
assert.equal(actual.oldDefaultSettings, "设置", "old generated default settings copy must use the current player-facing label");
assert.equal(actual.legacyStart, "重新开始", "legacy default start label must preserve dynamic state copy");
assert.equal(actual.defaultStart, "重新开始", "default start label must preserve dynamic state copy");
assert.equal(actual.blank, "关于", "blank fixed button label must use fallback copy");

console.log("title-button-label-sync-contract: PASS");
