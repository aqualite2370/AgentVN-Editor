"use strict";
const assert = require("node:assert/strict");
// Independent export oracle. Only ignored builtin Ren'Py title styles are
// canonicalized; explicit edits, components, states and all other data remain exact.
function assertAssistantExportLayout(actual, authored) {
  const expected = structuredClone(authored), canonicalized = [];
  const builtin = new Set(["main_menu_continue_button", "main_menu_start_button",
    "main_menu_save_load_button", "main_menu_gallery_button",
    "main_menu_settings_button", "main_menu_about_button"]);
  if (expected.layout_type === "renpy")
    for (const screen of expected.screens) for (const component of screen.components)
      if (screen.screen_id === "title" && builtin.has(component.component_type) &&
          component.titleButtonStyleSource !== "layout") {
        if (component.style !== undefined)
          canonicalized.push({ component: component.component_id, ignoredLegacyStyle: component.style });
        delete component.style;
      }
  assert.deepEqual(actual, expected);
  return canonicalized;
}
module.exports = { assertAssistantExportLayout };
