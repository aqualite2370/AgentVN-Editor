#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");

const root = path.resolve(__dirname, "..");
const requireFromEditor = createRequire(path.join(root, "editor/package.json"));
const bundle = requireFromEditor("esbuild").buildSync({
  stdin: {
    resolveDir: root,
    loader: "ts",
    contents: `
      export { resolveRenpyButtonRole } from "./shared/cartridge/renpyGui";
      export { renpyGUIErrors } from "./shared/cartridge/renpyGui";
    `,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
});
const loaded = { exports: {} };
new Function("module", "exports", "require", bundle.outputFiles[0].text)(
  loaded,
  loaded.exports,
  requireFromEditor,
);
const { resolveRenpyButtonRole, renpyGUIErrors } = loaded.exports;

const gui = {
  shared: {
    buttonTextColors: { normal: "#eeeeee", hover: "#ffffff", selected: "#80ddff", disabled: "#777777" },
    buttonRoles: {
      title_action: {
        geometry: { width: 240, height: 48, paddingX: 16, paddingY: 8, fontSize: 20 },
        states: {
          normal: { backgroundColor: "#111111", geometry: { width: 220, height: 44 } },
          hover: { backgroundColor: "#222222", geometry: { width: 280, height: 56 } },
          selected: { borderColor: "#80ddff" },
          disabled: { opacity: 0.45 },
        },
      },
    },
  },
  title: {
    buttonRoles: {
      title_action: {
        geometry: { fontSize: 24 },
        states: { hover: { borderColor: "#00c8d7" } },
      },
    },
  },
};

const resolved = resolveRenpyButtonRole(gui, "title_action", "title");
assert.equal(resolved.geometry.width, 280, "the largest state width must reserve a stable layout envelope");
assert.equal(resolved.geometry.height, 56, "the largest state height must reserve a stable layout envelope");
assert.equal(resolved.geometry.fontSize, 24, "page geometry overrides only the matching shared field");
assert.equal(resolved.states.normal.textColor, "#eeeeee", "legacy shared state colors remain a fallback");
assert.equal(resolved.states.normal.backgroundColor, "#111111");
assert.equal(resolved.states.hover.backgroundColor, "#222222");
assert.equal(resolved.states.hover.borderColor, "#00c8d7", "page state overrides shared state fields");
assert.equal(resolved.states.selected.borderColor, "#80ddff");
assert.equal(resolved.states.disabled.opacity, 0.45);
for (const state of ["normal", "hover", "selected", "disabled"]) {
  assert.equal(resolved.states[state].geometry.width, 280, `${state} must use the shared width envelope`);
  assert.equal(resolved.states[state].geometry.height, 56, `${state} must use the shared height envelope`);
}
const playerQuickBar = resolveRenpyButtonRole({
  player: { buttonRoles: { quick_bar: { geometry: { height: 50 }, states: { normal: { backgroundColor: "#101820" } } } } },
}, "quick_bar", "player");
assert.equal(playerQuickBar.geometry.height, 50, "player-only role configuration must resolve on Runtime playback");
assert.equal(playerQuickBar.states.normal.backgroundColor, "#101820");

const roles = [
  "title_action",
  "page_navigation",
  "category_pagination",
  "story_choice",
  "quick_bar",
  "modal_action",
];
for (const role of roles) {
  const value = resolveRenpyButtonRole({}, role, "title");
  assert.equal(value.role, role);
  assert.deepEqual(Object.keys(value.states).sort(), ["disabled", "hover", "normal", "selected"]);
  assert(value.geometry.width > 0 && value.geometry.height > 0, `${role} must have usable default geometry`);
}

assert.deepEqual(
  renpyGUIErrors({ shared: { buttonRoles: { unknown_role: {} } } }),
  ["renpy.shared.buttonRoles.unknown_role"],
  "unknown role identifiers must be rejected",
);
assert.deepEqual(
  renpyGUIErrors({ shared: { buttonRoles: { title_action: { states: { hover: { opacity: 2 } } } } } }),
  ["renpy.shared.buttonRoles.title_action.states.hover.opacity"],
  "invalid state values must be rejected rather than silently ignored",
);
assert.deepEqual(renpyGUIErrors(gui), [], "valid shared/page role configuration must pass schema validation");
assert.deepEqual(renpyGUIErrors({ player: { buttonRoles: { quick_bar: { geometry: { height: 50 } } } } }), [],
  "player page button-role configuration must pass layout schema validation");

console.log("renpy-button-role-model-test: PASS");
