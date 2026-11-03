#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const editorStore = fs.readFileSync(path.join(root, "editor/src/store/themeStore.ts"), "utf8");
const editorSelector = fs.readFileSync(path.join(root, "editor/src/components/editor/ThemeToneSelector.tsx"), "utf8");
const editorVars = fs.readFileSync(path.join(root, "editor/src/styles/variables.css"), "utf8");
const clientPresets = fs.readFileSync(path.join(root, "shared/cartridge/uiThemePresets.ts"), "utf8");

assert.match(editorStore, /ThemeTone\s*=\s*["']blue_gray["']\s*\|\s*["']white_gray["']/);
assert.doesNotMatch(editorStore, /kanagawa|nord|rose_pine/);
assert.doesNotMatch(editorVars, /data-theme=["'](kanagawa|nord|rose_pine)["']/);
assert.match(editorSelector, /toggleThemeTone/);
assert.doesNotMatch(editorSelector, /themeToneOrder|<select|<option/);

for (const id of ["kanagawa", "nord", "rose_pine"]) {
  assert.match(clientPresets, new RegExp(`makePreset\\("${id}"`), `client theme must include ${id}`);
}
assert.match(clientPresets, /defaultRuntimeThemePresetId\s*=\s*["']kanagawa["']/);
const firstThree = [...clientPresets.matchAll(/makePreset\("([^"]+)"/g)].slice(0, 3).map((match) => match[1]);
assert.deepEqual(firstThree, ["kanagawa", "nord", "rose_pine"], "new client palettes must be listed first");

console.log("editor-theme-palette-contract: PASS (editor palette restored; client palettes verified)");
