#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const playback = fs.readFileSync(path.join(root, "GameCli_framework/src/components/player/PlaybackControls.tsx"), "utf8");
const playerCss = fs.readFileSync(path.join(root, "GameCli_framework/src/styles/player.css"), "utf8");
const mobileCss = fs.readFileSync(path.join(root, "GameCli_framework/src/styles/mobile.css"), "utf8");
const runtimeCss = fs.readFileSync(path.join(root, "GameCli_framework/src/styles/quick-menu-contract.css"), "utf8");
const designer = fs.readFileSync(path.join(root, "editor/src/components/advanced/RuntimeLayoutDesigner.tsx"), "utf8");
const previewCss = fs.readFileSync(path.join(root, "editor/src/styles/quick-menu-preview.css"), "utf8");

assert.match(playback, /--runtime-quick-menu-surface-width/);
assert.match(playback, /--runtime-quick-menu-surface-height/);
assert.match(playback, /data-quick-menu-container-width/);
assert.match(playback, /data-quick-menu-container-height/);
assert.match(
  runtimeCss,
  /\.playback-controls\.ui-layouted[\s\S]*width:\s*var\(--runtime-quick-menu-root-width,\s*var\(--runtime-quick-menu-surface-width\)\)/,
  "runtime quick-menu root must own the collapsed/expanded width with a surface fallback",
);
assert.match(
  runtimeCss,
  /\.playback-controls\.ui-layouted[\s\S]*height:\s*var\(--runtime-quick-menu-root-height,\s*var\(--runtime-quick-menu-surface-height\)\)/,
  "runtime quick-menu root must own the collapsed/expanded height with a surface fallback",
);
assert.match(runtimeCss, /\.quick-menu-surface\s*\{[\s\S]*inset:\s*0/);
assert.match(runtimeCss, /\.quick-menu-action-layer\s*\{[\s\S]*inset:\s*0/);
assert.match(runtimeCss, /\.playback-controls\[data-quick-menu-variant="C"\][\s\S]*grid-template-columns:\s*repeat/);
assert.doesNotMatch(playerCss, /quick-menu|\.playback-controls/, "player.css must not retain a second quick-menu owner");
assert.doesNotMatch(mobileCss, /quick-menu|\.playback-controls/, "mobile.css must not retain quick-menu overrides");
assert.match(designer, /width:\s*\`\$\{quickMenuPreviewSurfaceWidth\}px\`/);
assert.match(designer, /quickMenuMetrics\.surfaceWidth/);
assert.match(previewCss, /\.preview-quick-menu-surface[\s\S]*width:\s*100%/);
assert.match(previewCss, /\.preview-quick-menu-surface[\s\S]*height:\s*100%/);
assert.match(previewCss, /\.preview-quick-menu-action-layer[\s\S]*inset:\s*0/);

console.log("quick-menu-container-contract: PASS");
