#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const esbuild = require("../editor/node_modules/esbuild");

const root = path.resolve(__dirname, "..");
const fixturePath = path.join(
  root,
  "data",
  "backup-timeline",
  "project_msiz08p7_0_89ebc8a8cb__1787496930764__project.vnproj",
);
const fixtureHashBefore = crypto.createHash("sha256").update(fs.readFileSync(fixturePath)).digest("hex");
const v12FixturePath = path.join(
  root,
  "data",
  "backup-timeline",
  "project_msiz08p7_0_89ebc8a8cb__1786898326185__project.vnproj",
);
const v12FixtureHashBefore = crypto.createHash("sha256").update(fs.readFileSync(v12FixturePath)).digest("hex");

const result = esbuild.buildSync({
  stdin: {
    contents: [
      'export { UI_LAYOUT_VERSION, getDefaultUISkinLayout, migrateLegacyUISkinLayout } from "./shared/cartridge/uiSkin";',
    ].join("\n"),
    loader: "ts",
    resolveDir: root,
    sourcefile: "output/automated/quick-menu-default-migration-entry.ts",
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
  write: false,
  logLevel: "silent",
});
const loaded = new Module(
  path.join(root, "output", "automated", "quick-menu-default-migration-entry.cjs"),
  module,
);
loaded.filename = path.join(root, "output", "automated", "quick-menu-default-migration-entry.cjs");
loaded.paths = Module._nodeModulePaths(root);
loaded._compile(result.outputFiles[0].text, loaded.filename);

const { UI_LAYOUT_VERSION, getDefaultUISkinLayout, migrateLegacyUISkinLayout } = loaded.exports;
const defaults = getDefaultUISkinLayout();
const player = defaults.screens.find((screen) => screen.screen_id === "player");
const quickMenu = player.components.find((component) => component.component_type === "quick_menu");
const defaultQuickButtons = player.components.filter((component) => component.component_type === "quick_button");

function quickMenuCluster(layout) {
  const screen = layout.screens.find((item) => item.screen_id === "player");
  return {
    quickMenu: (() => {
      const component = screen.components.find((item) => item.component_type === "quick_menu");
      if (!component) return undefined;
      const { mobileRect, ...unified } = structuredClone(component);
      return unified;
    })(),
    buttons: structuredClone(
      screen.components
        .filter((component) => component.component_type === "quick_button")
        .sort((left, right) => left.component_id.localeCompare(right.component_id)),
    ),
  };
}

const legacyDefaultSurfaceStyle = {
  backgroundColor: "#0d121f",
  color: "#f6f8ff",
  borderColor: "#d8e2ff",
  borderWidth: 1,
  borderRadius: 16,
  opacity: 0.72,
  padding: 4,
  gap: 3,
  quickMenuDirection: "up",
  quickMenuVariant: "C",
  shadow: "soft",
  backdropBlur: 16,
};
const legacyDefaultActionStyle = {
  backgroundColor: "#192234",
  color: "#f6f8ff",
  borderColor: "transparent",
  borderWidth: 1,
  borderRadius: 8,
  opacity: 0.72,
  shadow: "soft",
};

function legacyDefaultLayout(version, rect, mobileRect) {
  return {
    ui_layout_version: version,
    name: `Legacy ${version}`,
    target_runtime: "0.1.0",
    tokens: {},
    assets: [],
    screens: [
      { screen_id: "title", components: [] },
      {
        screen_id: "player",
        components: [
          {
            component_id: "quick_menu",
            component_type: "quick_menu",
            required: true,
            rect: structuredClone(rect),
            mobileRect: structuredClone(mobileRect),
            style: structuredClone(legacyDefaultSurfaceStyle),
            zIndex: 50,
          },
          ...defaultQuickButtons.map((button) => ({
            ...structuredClone(button),
            style: structuredClone(legacyDefaultActionStyle),
          })),
        ],
      },
    ],
  };
}

assert.equal(UI_LAYOUT_VERSION, "2.0.0");
assert.deepEqual(quickMenu.rect, {
  x: 93.30292735649188,
  y: 9.503216429473,
  width: 48,
  height: 8,
  anchor: "top_right",
});
assert.equal(quickMenu.mobileRect, undefined, "new layouts use one authored rect for all form factors");
assert.equal(quickMenu.style.quickMenuVariant, "C");
assert.equal(quickMenu.style.quickMenuDirection, "auto");
assert.equal(
  quickMenu.style.backgroundColor,
  undefined,
  "new default quick-menu material must bind to current theme tokens instead of a fixed color",
);
assert.equal(
  quickMenu.style.borderColor,
  undefined,
  "new default quick-menu border must bind to current theme tokens instead of a fixed color",
);
assert.equal(
  defaultQuickButtons.some((button) => button.style?.backgroundColor || button.style?.borderColor || button.style?.color),
  false,
  "new default quick-button material must bind to current theme tokens instead of fixed colors",
);

const hiddenGrowthProject = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const legacyHiddenGrowthLayout = hiddenGrowthProject.editor_settings.runtimeUILayout;
assert.equal(legacyHiddenGrowthLayout.ui_layout_version, "1.3.0");
const migratedHiddenGrowth = migrateLegacyUISkinLayout(structuredClone(legacyHiddenGrowthLayout));
const migratedPlayer = migratedHiddenGrowth.screens.find((screen) => screen.screen_id === "player");
const migratedQuickMenu = migratedPlayer.components.find((component) => component.component_type === "quick_menu");
const migratedQuickButtons = migratedPlayer.components.filter((component) => component.component_type === "quick_button");

assert.equal(migratedHiddenGrowth.ui_layout_version, UI_LAYOUT_VERSION);
assert.deepEqual(migratedQuickMenu.rect, quickMenu.rect);
assert.equal(migratedQuickMenu.mobileRect, undefined);
assert.deepEqual(migratedQuickMenu.style, quickMenu.style);
assert.equal(
  migratedQuickMenu.style.backgroundColor,
  undefined,
  "known hidden-growth defaults must migrate to theme-bound quick-menu material",
);
assert.equal(migratedQuickButtons.length, defaultQuickButtons.length);
for (const defaultButton of defaultQuickButtons) {
  const migratedButton = migratedQuickButtons.find((button) => button.component_id === defaultButton.component_id);
  assert(migratedButton, `missing migrated quick-menu button ${defaultButton.component_id}`);
  assert.deepEqual(migratedButton.style, defaultButton.style);
  assert.equal(
    migratedButton.style?.backgroundColor,
    undefined,
    `known hidden-growth default ${defaultButton.component_id} must not retain fixed material color`,
  );
  assert.equal(migratedButton.visible, defaultButton.visible);
}

const v12HiddenGrowthProject = JSON.parse(fs.readFileSync(v12FixturePath, "utf8"));
const migratedV12HiddenGrowth = migrateLegacyUISkinLayout(
  structuredClone(v12HiddenGrowthProject.editor_settings.runtimeUILayout),
);
assert.deepEqual(
  quickMenuCluster(migratedV12HiddenGrowth),
  quickMenuCluster(defaults),
  "the read-only hidden-growth v1.2 default cluster must migrate to the 2.0 default",
);

const userStyledButtonLayout = structuredClone(legacyHiddenGrowthLayout);
const userStyledButton = userStyledButtonLayout.screens
  .find((screen) => screen.screen_id === "player")
  .components.find((component) => component.component_id === "quick_rollback_button");
userStyledButton.style.backgroundColor = "#ff00ff";
const userStyledButtonBefore = quickMenuCluster(userStyledButtonLayout);
const userStyledButtonAfter = quickMenuCluster(migrateLegacyUISkinLayout(userStyledButtonLayout));
assert.deepEqual(
  userStyledButtonAfter,
  userStyledButtonBefore,
  "changing one quick-button style must preserve the entire quick-menu cluster",
);

const customClusterMutations = [
  ["desktop position", (layout) => {
    layout.screens.find((screen) => screen.screen_id === "player")
      .components.find((component) => component.component_type === "quick_menu").rect.x -= 4;
  }],
  ["authored size", (layout) => {
    layout.screens.find((screen) => screen.screen_id === "player")
      .components.find((component) => component.component_type === "quick_menu").rect.width -= 3;
  }],
  ["direction", (layout) => {
    layout.screens.find((screen) => screen.screen_id === "player")
      .components.find((component) => component.component_type === "quick_menu").style.quickMenuDirection = "down";
  }],
  ["variant", (layout) => {
    layout.screens.find((screen) => screen.screen_id === "player")
      .components.find((component) => component.component_type === "quick_menu").style.quickMenuVariant = "A";
  }],
  ["surface material", (layout) => {
    layout.screens.find((screen) => screen.screen_id === "player")
      .components.find((component) => component.component_type === "quick_menu").style.backgroundColor = "#333333";
  }],
  ["action visibility", (layout) => {
    layout.screens.find((screen) => screen.screen_id === "player")
      .components.find((component) => component.component_id === "quick_history_button").visible = false;
  }],
];
for (const [name, mutate] of customClusterMutations) {
  const custom = structuredClone(legacyHiddenGrowthLayout);
  mutate(custom);
  const before = quickMenuCluster(custom);
  const after = quickMenuCluster(migrateLegacyUISkinLayout(custom));
  assert.deepEqual(after, before, `custom quick-menu ${name} must preserve the entire cluster`);
}

const knownLegacyGeometries = [
  {
    version: "1.1.0",
    rect: { x: 98, y: 2, width: 48, height: 8, anchor: "top_right" },
    mobileRect: { x: 98, y: 2, width: 58, height: 12, anchor: "top_right" },
  },
  {
    version: "1.2.0",
    rect: { x: 98, y: 2, width: 42, height: 9, anchor: "top_right" },
    mobileRect: { x: 98, y: 2, width: 50, height: 10, anchor: "top_right" },
  },
  {
    version: "1.3.0",
    rect: { x: 93, y: 73, width: 7, height: 7, anchor: "top_right" },
    mobileRect: { x: 93, y: 61, width: 9, height: 9, anchor: "top_right" },
  },
];
for (const legacy of knownLegacyGeometries) {
  const migrated = migrateLegacyUISkinLayout(
    legacyDefaultLayout(legacy.version, legacy.rect, legacy.mobileRect),
  );
  assert.deepEqual(
    quickMenuCluster(migrated),
    quickMenuCluster(defaults),
    `${legacy.version} untouched default quick-menu cluster must migrate to the 2.0 default`,
  );
}

const fixtureHashAfter = crypto.createHash("sha256").update(fs.readFileSync(fixturePath)).digest("hex");
assert.equal(fixtureHashAfter, fixtureHashBefore, "read-only hidden-growth fixture must not be modified");
const v12FixtureHashAfter = crypto.createHash("sha256").update(fs.readFileSync(v12FixturePath)).digest("hex");
assert.equal(v12FixtureHashAfter, v12FixtureHashBefore, "read-only hidden-growth v1.2 fixture must not be modified");

console.log("quick-menu-default-migration-contract: PASS");
