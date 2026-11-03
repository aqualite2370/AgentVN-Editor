#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const esbuild = require("../editor/node_modules/esbuild");
const Module = require("node:module");
const root = path.resolve(__dirname, "..");
const source = `import { resolveFixedQuickMenuGeometry } from "./shared/cartridge/quickMenuMetrics"; export { resolveFixedQuickMenuGeometry };`;
const out = esbuild.buildSync({ stdin: { contents: source, loader: "ts", resolveDir: root }, bundle: true, format: "cjs", platform: "node", write: false, logLevel: "silent" }).outputFiles[0].text;
const filename = path.join(root, "output", "quick-menu-authored-position-entry.cjs");
const mod = new Module(filename, module); mod.filename = filename; mod.paths = Module._nodeModulePaths(root); mod._compile(out, filename);
const rect = { x: 93.30292735649188, y: 9.503216429473, width: 48, height: 8, anchor: "top_right" };
const before = mod.exports.resolveFixedQuickMenuGeometry({ frameWidth: 1280, frameHeight: 720, quickMenuRect: rect });
const after = mod.exports.resolveFixedQuickMenuGeometry({ frameWidth: 2400, frameHeight: 1080, quickMenuRect: rect });
assert.ok(before.left >= 0 && before.top >= 0 && before.left + before.width <= 1280 && before.top + before.height <= 720);
assert.ok(after.left >= 0 && after.top >= 0 && after.left + after.width <= 2400 && after.top + after.height <= 1080);
assert.equal(Math.round(before.anchorX / 1280 * 10000) / 10000, Math.round(rect.x / 100 * 10000) / 10000);
assert.equal(Math.round(after.anchorX / 2400 * 10000) / 10000, Math.round(rect.x / 100 * 10000) / 10000);
console.log("quick-menu-authored-position-recovery-playwright: PASS");
