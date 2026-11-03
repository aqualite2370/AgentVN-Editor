import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { UILayoutComponent, UISkinLayout } from "../shared/cartridge/uiSkin.ts";

// Bundle the same module graph as the editor; Node does not resolve the
// extensionless TypeScript imports used by the shared source directly.
const require = createRequire(import.meta.url);
const esbuild = require("../editor/node_modules/esbuild");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = esbuild.buildSync({
  stdin: {
    contents: "export { migrateLegacyUISkinLayout } from './shared/cartridge/uiSkin';",
    loader: "ts",
    resolveDir: root,
    sourcefile: "output/automated/ui-unified-layout-migration-entry.ts",
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  write: false,
});
const runtimeModule: { exports: { migrateLegacyUISkinLayout?: (layout: UISkinLayout) => UISkinLayout } } = {
  exports: {},
};
new Function("module", "exports", result.outputFiles[0].text)(runtimeModule, runtimeModule.exports);
const { migrateLegacyUISkinLayout } = runtimeModule.exports;
assert.ok(migrateLegacyUISkinLayout, "migration function must be bundled");

const action = (
  componentId: string,
  componentType: UILayoutComponent["component_type"],
  y: number,
): UILayoutComponent => ({
  component_id: componentId,
  component_type: componentType,
  rect: { x: 78, y, width: 18, height: 7 },
  mobileRect: { x: 78, y, width: 18, height: 7 },
  required: true,
});

const legacy: UISkinLayout = {
  ui_layout_version: "1.0.0",
  name: "legacy-unified-layout",
  target_runtime: "0.1.0",
  assets: [],
  tokens: {},
  screens: [
    {
      screen_id: "title",
      components: [
        // The authored title mask was deleted before this legacy layout was
        // saved. Migration must not recreate it from the current defaults.
        {
          component_id: "title_custom_button_container",
          component_type: "main_menu_custom_button_container",
          label: "自定义按钮容器",
          rect: { x: 88.39, y: 90.51, width: 11.61, height: 8.75 },
          mobileRect: { x: 88.39, y: 90.51, width: 11.61, height: 8.75 },
        },
        action("title_continue_button", "main_menu_continue_button", 28),
        action("title_start_button", "main_menu_start_button", 36),
        action("title_save_load_button", "main_menu_save_load_button", 44),
        action("title_gallery_button", "main_menu_gallery_button", 52),
        action("title_settings_button", "main_menu_settings_button", 60),
        action("title_about_button", "main_menu_about_button", 68),
        {
          component_id: "title_custom_button_user",
          component_type: "main_menu_custom_button",
          label: "用户按钮",
          rect: { x: 89.4, y: 91.5, width: 9.92, height: 6.75 },
          mobileRect: { x: 8, y: 86, width: 24, height: 8 },
        },
      ],
    },
  ],
};

const migrated = migrateLegacyUISkinLayout(legacy);
const title = migrated.screens.find((screen) => screen.screen_id === "title");
assert.ok(title, "title screen must survive migration");
assert.equal(
  title.components.some((component) => component.component_type === "mask"),
  false,
  "migration must preserve an absent/deleted title mask",
);
assert.equal(
  title.components.some((component) => component.component_type === "main_menu_custom_button_container"),
  true,
  "an authored custom-button container must survive unified-layout migration",
);
assert.ok(
  title.components.some((component) => component.component_id === "title_custom_button_user"),
  "the user's actual custom button must be preserved",
);
assert.equal(
  JSON.stringify(migrated).includes("mobileRect"),
  false,
  "saved/exported unified layout must not contain mobileRect",
);

console.log("ui-unified-layout-migration-test: PASS");
