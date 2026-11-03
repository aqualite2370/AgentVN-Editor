#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("../editor/node_modules/esbuild");

const root = path.resolve(__dirname, "..");
const bundle = esbuild.buildSync({
  stdin: {
    contents: "export { migrateLegacyUISkinLayout } from './shared/cartridge/uiSkin';",
    loader: "ts",
    resolveDir: root,
    sourcefile: "output/automated/ui-skin-missing-exit-layout-entry.ts",
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  write: false,
});

const runtimeModule = { exports: {} };
new Function("module", "exports", bundle.outputFiles[0].text)(
  runtimeModule,
  runtimeModule.exports,
);

const layoutPath = path.join(
  root,
  "GameCli_framework",
  "src-tauri",
  "resources",
  "embedded-cartridge",
  "ui",
  "layout.json",
);
const legacyLayout = JSON.parse(fs.readFileSync(layoutPath, "utf8"));
const title = legacyLayout.screens.find((screen) => screen.screen_id === "title");
assert.ok(title, "hidden-growth fixture must include a title screen");
assert.equal(
  title.components.some((component) => component.component_type === "main_menu_exit_button"),
  false,
  "hidden-growth fixture should reproduce the legacy missing-exit layout",
);

const migrated = runtimeModule.exports.migrateLegacyUISkinLayout(legacyLayout);
const migratedTitle = migrated.screens.find((screen) => screen.screen_id === "title");
assert.equal(
  migratedTitle.components.some((component) => component.component_type === "main_menu_exit_button"),
  false,
  "legacy migration must remove the obsolete title exit button",
);

const fixedTitleActionTypes = new Set([
  "main_menu_continue_button",
  "main_menu_start_button",
  "main_menu_save_load_button",
  "main_menu_gallery_button",
  "main_menu_settings_button",
  "main_menu_about_button",
]);

function assertNoOverlap(rects, label) {
  const visible = rects.filter(Boolean);
  for (let i = 0; i < visible.length; i += 1) {
    for (let j = i + 1; j < visible.length; j += 1) {
      const left = visible[i];
      const right = visible[j];
      const overlap =
        left.x < right.x + right.width &&
        left.x + left.width > right.x &&
        left.y < right.y + right.height &&
        left.y + left.height > right.y;
      assert.equal(
        overlap,
        false,
        `${label} title actions must not overlap: ${left.component_id} vs ${right.component_id}`,
      );
    }
  }
}

const actions = migratedTitle.components.filter((component) =>
  fixedTitleActionTypes.has(component.component_type),
);
assertNoOverlap(
  actions.map((component) => component.rect),
  "desktop",
);
assertNoOverlap(
  actions.map((component) => component.mobileRect ?? component.rect),
  "mobile",
);

console.log("PASS legacy missing-exit title actions remain separated on desktop and mobile");
