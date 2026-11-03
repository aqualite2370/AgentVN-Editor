#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const designer = fs.readFileSync(path.join(root, "editor/src/components/advanced/RuntimeLayoutDesigner.tsx"), "utf8");
const previewCss = fs.readFileSync(path.join(root, "editor/src/styles/quick-menu-preview.css"), "utf8");
const runtime = fs.readFileSync(path.join(root, "GameCli_framework/src/components/player/PlaybackControls.tsx"), "utf8");
const runtimeCss = fs.readFileSync(path.join(root, "GameCli_framework/src/styles/quick-menu-contract.css"), "utf8");

// The preview must use the same semantic precision icon vocabulary as GameCLI.
assert.match(designer, /function PreviewPrecisionIcon/,
  "editor preview must render the shared precision icon geometry");
assert.doesNotMatch(designer, /quickButtonPreviewIcons\s*:/,
  "editor preview must not keep a separate Lucide quick-button icon map");
assert.doesNotMatch(designer, /[↗×]/,
  "editor preview must not render text glyphs for expand/close icons");
assert.match(designer, /data-precision-icon=\{iconName\}/,
  "preview actions must expose the same semantic precision icon names");

// One visible surface, one action layer, one toggle. No synthetic second glass panel.
assert.match(previewCss, /\.preview-quick-menu-preview::before[\s\S]*display:\s*none\s*!important/,
  "editor preview must disable the legacy synthetic surface paint");
assert.match(previewCss, /\.preview-quick-menu-preview::after[\s\S]*display:\s*none\s*!important/,
  "C preview must disable the legacy second pseudo surface");
assert.match(designer, /className="preview-quick-menu-surface"/,
  "preview must expose one explicit surface element");
assert.match(designer, /className="preview-quick-menu-action-layer"/,
  "preview must expose one explicit action layer");
assert.match(designer, /className="preview-quick-menu-toggle-layer"/,
  "preview must expose one explicit toggle hit layer");

// C is a full-container drawer while action visuals remain content-sized.
assert.match(previewCss, /\.preview-quick-menu-surface\s*\{[\s\S]*inset:\s*0[\s\S]*width:\s*100%[\s\S]*height:\s*100%/,
  "preview surface must fill the authored quick-menu container");
assert.match(previewCss, /\.preview-quick-menu-preview-c[\s\S]*\.preview-quick-menu-buttons[\s\S]*display:\s*grid/,
  "C action group must use a stable grid");
assert.match(previewCss, /\.preview-quick-menu-button[\s\S]*width:\s*100% !important/,
  "C preview buttons must fill their horizontal grid tracks");

// Runtime and preview retain a single explicit surface/action/toggle structure.
assert.match(runtime, /quick-menu-surface/);
assert.match(runtime, /className="quick-menu-action-layer"/);
assert.doesNotMatch(runtime, /quick-menu-toggle-surface/,
  "runtime must not add a redundant toggle surface container");
assert.match(runtimeCss, /\.quick-menu-surface::before,\s*[\r\n]+\s*\.playback-controls \.quick-menu-surface::after[\s\S]*display:\s*none/,
  "runtime must disable duplicate pseudo glass layers on the real surface");

console.log("quick-menu-preview-redesign-contract: PASS");
