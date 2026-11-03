#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const metrics = read("shared/cartridge/quickMenuMetrics.ts");
const defaults = read("shared/cartridge/quickMenuDefaults.ts");
const runtimeCss = read("GameCli_framework/src/styles/quick-menu-contract.css");
const playerCss = read("GameCli_framework/src/styles/player.css");
const previewCss = read("editor/src/styles/quick-menu-preview.css");
const playback = read("GameCli_framework/src/components/player/PlaybackControls.tsx");
const designer = read("editor/src/components/advanced/RuntimeLayoutDesigner.tsx");

assert.match(metrics, /variant === "C"[\s\S]*columns/);
assert.match(defaults, /drawerColumns:\s*1/);
assert.match(defaults, /drawerRows:\s*8/);
assert.match(metrics, /const requiredSurfaceWidth = 7 \* aBaseActionHitSize/);
assert.match(runtimeCss, /\.quick-menu-action-layer[\s\S]*display:\s*grid/);
assert.match(runtimeCss, /\.playback-controls\[data-quick-menu-variant="C"\] \.quick-menu-action-layer[\s\S]*grid-template-columns:\s*minmax\(0, var\(--runtime-quick-menu-cell-width\)\)/);
assert.match(runtimeCss, /\.playback-controls\[data-quick-menu-variant="C"\] \.quick-menu-action-layer[\s\S]*grid-template-rows:\s*repeat\(7, var\(--runtime-quick-menu-action-hit-size\)\)/);
assert.doesNotMatch(runtimeCss, /data-quick-menu-variant="C"[\s\S]{0,500}repeat\(2/);
assert.match(runtimeCss, /\.quick-menu-action-layer > \.quick-menu-button[\s\S]*width:\s*100% !important/);
assert.match(previewCss, /\.preview-quick-menu-action-layer[\s\S]*display:\s*grid/);
assert.match(previewCss, /\.preview-quick-menu-preview-c[\s\S]*width:\s*100%/);
assert.match(previewCss, /\.preview-quick-menu-preview-c \.preview-quick-menu-buttons[\s\S]*repeat\(7, var\(--preview-quick-menu-action-hit-size/);
assert.doesNotMatch(previewCss, /preview-quick-menu-preview-c[\s\S]{0,500}repeat\(2/);
assert.match(previewCss, /\.preview-quick-menu-button[\s\S]*width:\s*100%/);
assert.match(playback, /data-quick-menu-container-width/);
assert.match(designer, /quickMenuMetrics\.surfaceWidth/);

// Skin colors must remain readable without creating another saturated glass
// layer in the real runtime. The owner may mix the skin with an existing
// neutral token, but the skin contribution must stay below 80%.
const runtimeGlassMatch = runtimeCss.match(
  /--runtime-quick-menu-glass-background:\s*color-mix\([^;]*?skin-background[^;]*?var\(--runtime-quick-menu-material-alpha,\s*66%\)/s,
);
assert(runtimeGlassMatch, "runtime quick-menu owner must define a neutralized skin glass background");
assert.match(
  runtimeCss,
  /\.quick-menu-button[\s\S]*background-color:\s*color-mix\([^;]*runtime-quick-menu-action-background[^;]*\s(?:7\d|6\d)%/s,
  "runtime action buttons must use a low-saturation skin mix",
);
assert.match(
  runtimeCss,
  /data-quick-menu-variant="C"[\s\S]*\.quick-menu-button-label[\s\S]*display:\s*block/,
  "runtime C actions must keep readable labels in the horizontal fill contract",
);
assert.doesNotMatch(playerCss, /quick-menu|\.playback-controls/, "player.css must not retain a second quick-menu owner");

console.log("quick-menu-horizontal-fill-contract: PASS");
