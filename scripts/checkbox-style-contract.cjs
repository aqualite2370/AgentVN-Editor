#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "GameCli_framework/src/styles/variables.css"), "utf8");
const shellCss = fs.readFileSync(path.join(root, "GameCli_framework/src/styles/shell.css"), "utf8");
const base = css.match(/input\[type="checkbox"\]\s*\{[\s\S]*?\n\}/)?.[0] || "";
const checked = css.match(/input\[type="checkbox"\]:checked\s*\{[\s\S]*?\n\}/)?.[0] || "";
const active = css.match(/input\[type="checkbox"\]:active\s*\{[\s\S]*?\n\}/)?.[0] || "";

assert.match(base, /background:\s*transparent;/, "unchecked checkbox must be transparent");
assert.match(base, /border:\s*1px solid var\(--checkbox-border\);/, "checkbox must use a 1px token border");
assert.match(base, /border-radius:\s*7px;/, "checkbox must use a rounded-rectangle 7px radius");
assert.match(base, /box-shadow:\s*none;/, "checkbox must not use decorative shadows");
assert.doesNotMatch(base, /gradient|inset/, "checkbox base must not use gradients or inner highlights");
assert.match(checked, /background:\s*var\(--checkbox-accent\);/, "checked checkbox must use a single accent color");
assert.match(checked, /border-color:\s*var\(--checkbox-accent\);/, "checked border must match the accent");
assert.match(checked, /box-shadow:\s*none;/, "checked checkbox must not glow");
assert.doesNotMatch(checked, /gradient|color-mix/, "checked checkbox must remain single-color");
assert.match(active, /transform:\s*scale\(0\.97\);/, "checkbox press feedback must use scale(0.97)");
assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*input\[type="checkbox"\]:hover:not\(:disabled\)[\s\S]*border-color:[\s\S]*opacity:/, "checkbox hover must be fine-pointer gated and paint-only");
assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*input\[type="checkbox"\][\s\S]*transform:\s*none !important;[\s\S]*background-color 80ms linear !important/, "checkbox must retain short paint feedback under reduced motion");
assert.match(css, /input\[type="checkbox"\]::before[\s\S]*clip-path 160ms var\(--ease-out\)[\s\S]*opacity 160ms var\(--ease-out\)/, "checkmark reveal must use a restrained 160ms transition");
assert.match(shellCss, /settings-checkbox-size[\s\S]{0,500}border-radius:\s*clamp\(7px, calc\(8px \* var\(--runtime-ui-scale, 1\)\), 10px\);/, "enlarged settings checkbox must use a rounded-rectangle radius");
assert.match(shellCss, /\.settings-check > span[\s\S]{0,320}font-size:\s*clamp\(12px, calc\(13px \* var\(--runtime-ui-scale, 1\)\), 15px\)/, "mute labels must use a compact auxiliary type size");

console.log("checkbox-style-contract: PASS");
