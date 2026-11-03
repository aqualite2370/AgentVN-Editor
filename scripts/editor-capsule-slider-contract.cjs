#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const rangeControl = read("editor/src/components/common/RangeControl.tsx");
const layoutCss = read("editor/src/styles/layout.css");
const assetStudioCss = read("editor/src/styles/asset-studio.css");
const variablesCss = read("editor/src/styles/variables.css");
const slowFocusGlowCss = read("shared/ui/slowFocusGlow.css");

assert.match(rangeControl, /className="range-control-track"[\s\S]*className="range-control-fill"/, "RangeControl must render a separate capsule track and fill");
assert.match(rangeControl, /onCommit\?:\s*\(\)\s*=>\s*void/, "RangeControl must expose the optional commit callback");
assert.match(rangeControl, /onPointerUp=\{\(\)\s*=>\s*onCommit\?\.\(\)\}/, "pointer release must commit a range adjustment");
assert.match(rangeControl, /adjustmentKeys\.has\(event\.key\)[\s\S]*onCommit\?\.\(\)/, "keyboard adjustment release must commit");

const businessSources = [
  "editor/src/components/command-editors/CameraStudioDialog.tsx",
  "editor/src/components/advanced/asset-studio/AssetStudioCanvasEditor.tsx",
  "editor/src/components/advanced/asset-studio/AssetStudioComposer.tsx",
].map(read).join("\n");
assert.doesNotMatch(businessSources, /type="range"/, "editor business components must use the shared RangeControl");
assert.equal((businessSources.match(/<RangeControl\b/g) || []).length, 6, "all six remaining editor sliders must migrate to RangeControl");

const sliderCss = layoutCss.slice(layoutCss.indexOf(".range-control {"), layoutCss.indexOf(".runtime-layout-color-row input[type=\"color\"]"));
assert.match(sliderCss, /--range-track-height:\s*10px;/, "editor capsule track must be 10px");
assert.match(sliderCss, /\.range-control-track[\s\S]*height:\s*var\(--range-track-height\)/, "editor track must use the shared height token");
assert.match(sliderCss, /\.range-control-fill[\s\S]*width:\s*var\(--range-progress\)/, "editor fill must reflect the controlled progress");
assert.match(sliderCss, /::-webkit-slider-thumb[\s\S]*width:\s*1px;[\s\S]*height:\s*1px;[\s\S]*background:\s*transparent;[\s\S]*box-shadow:\s*none;/, "editor native thumb must be visually absent");
assert.doesNotMatch(sliderCss, /\.range-control::before|translateY\(-1\.5px\)|drop-shadow\(|scale\(1\.(?:08|12)\)/, "editor slider must not lift, frame, or expose a visible thumb");
assert.match(sliderCss, /--range-press-scale:\s*1\.22;/, "editor slider must share the deliberate hold scale");
assert.match(sliderCss, /--range-press-duration:\s*480ms;/, "editor hold enlargement must use the requested doubled duration");
assert.match(sliderCss, /--range-release-duration:\s*360ms;/, "editor release contraction must use the requested doubled duration");
assert.match(
  sliderCss,
  /:active\) \.range-control-track\s*\{[\s\S]*?scaleY\(var\(--range-press-scale\)\)[\s\S]*?transform var\(--range-press-duration\) var\(--ease-in-out\)/,
  "editor hold feedback must slowly enlarge only the capsule track",
);
assert.match(sliderCss, /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*:hover[\s\S]*opacity:\s*1;/, "editor hover must use paint-only emphasis");
assert.doesNotMatch(
  sliderCss.match(/@media \(hover: hover\) and \(pointer: fine\)\s*\{[\s\S]*?\n\}/)?.[0] ?? "",
  /transform|box-shadow/,
  "editor hover must not resize or reframe the slider",
);
assert.match(sliderCss, /:focus-visible\) \.range-control-track[\s\S]*0 0 0 2px/, "editor keyboard focus must follow the capsule track");
assert.match(sliderCss, /prefers-reduced-motion:\s*reduce[\s\S]*?\.range-control-track\s*\{[\s\S]*?translateY\(-50%\)\s*!important;/, "editor reduced motion must suppress hold enlargement");
assert.match(assetStudioCss, /\.asset-studio input:not\(\[type="range"\]\):focus-visible/, "asset-studio focus styling must exclude range inputs");
assert.match(variablesCss, /input:not\(\[type="range"\]\),\s*textarea,\s*select\s*\{/, "global field styling must exclude range inputs");
assert.match(variablesCss, /input:not\(\[type="range"\]\):hover,\s*textarea:hover,\s*select:hover\s*\{/, "global hover styling must exclude range inputs");
assert.doesNotMatch(slowFocusGlowCss, /:is\(input,\s*textarea,\s*select\)/, "shared focus glow must not target range inputs");
assert.match(slowFocusGlowCss, /input:not\(\[type="range"\]\)/, "shared focus glow must explicitly exclude range inputs");

console.log("editor-capsule-slider-contract: PASS");
