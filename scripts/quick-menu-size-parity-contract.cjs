#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function assert(condition, message, details) {
  if (!condition) {
    throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`);
  }
}

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  assert(fs.existsSync(absolutePath), `missing required file: ${relativePath}`);
  return fs.readFileSync(absolutePath, "utf8");
}

const uiSkin = read("shared/cartridge/uiSkin.ts");
const metricsPath = path.join(root, "shared", "cartridge", "quickMenuMetrics.ts");
const playbackControls = read("GameCli_framework/src/components/player/PlaybackControls.tsx");
const playerCss = read("GameCli_framework/src/styles/quick-menu-contract.css");
const mobileCss = read("GameCli_framework/src/styles/quick-menu-contract.css");
const designer = read("editor/src/components/advanced/RuntimeLayoutDesigner.tsx");

assert(fs.existsSync(metricsPath), "shared quick-menu metrics module is missing");
const metrics = read("shared/cartridge/quickMenuMetrics.ts");

assert(/quickMenuVariant\?\s*:\s*(QuickMenuVariant|["']A["']\s*\|\s*["']C["'])/.test(uiSkin), "UILayoutComponentStyle must expose quickMenuVariant");
assert(/QuickMenuVariant|normalizeQuickMenuVariant/.test(metrics), "shared metrics module must define quickMenuVariant behavior");
assert(/widthMultiplier\s*:\s*5\.2/.test(metrics), "A variant must use the shared 5.2 width multiplier");
assert(/widthMultiplier\s*:\s*2\.2/.test(metrics), "C variant must use the shared 2.2 width multiplier");
assert(/heightMultiplier\s*:\s*4\.1/.test(metrics), "C variant must use the shared 4.1 height multiplier");
assert(/35/.test(metrics) && /65/.test(metrics) && /\*\s*1\.5/.test(metrics), "shared metrics must encode the 1.5x enlarged toggle visual ratio");

assert(/quickMenuVariant/.test(playbackControls), "PlaybackControls must read the configured quickMenuVariant");
assert(!/data-quick-menu-variant="C"/.test(playbackControls), "PlaybackControls must not hard-code the C variant");

assert(!/--runtime-quick-menu-drawer-width:\s*min\(154px/.test(playerCss), "runtime drawer width is still hard-coded to 154px");
assert(!/--runtime-quick-menu-drawer-height:\s*min\(286px/.test(playerCss), "runtime drawer height is still hard-coded to 286px");
assert(/saturate\(var\(--runtime-quick-menu-surface-saturation\)\)/.test(playerCss), "runtime quick-menu glass must use the shared saturation token");
assert(/--runtime-quick-menu-surface-saturation:\s*0\.5/.test(playerCss), "runtime quick-menu saturation token must be 0.5");
assert(!/saturate\(1\.15\)/.test(playerCss), "runtime quick-menu glass still boosts saturation");
assert(/backdrop-filter:\s*blur\(/.test(playerCss), "runtime quick-menu glass must keep gaussian blur");

assert(/saturate\(0?\.5\)/.test(mobileCss) || /var\(--runtime-quick-menu-surface-saturation/.test(mobileCss), "mobile quick-menu must use the shared low-saturation glass token");
assert(!/color-mix\([^;]+42%/.test(mobileCss), "mobile quick-menu still overrides the glass alpha to 42%");

assert(/quickMenuVariant/.test(designer), "layout designer must persist the selected quickMenuVariant");

console.log("quick-menu-size-parity-contract: PASS");
