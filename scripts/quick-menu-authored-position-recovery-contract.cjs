#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const esbuild = require("../editor/node_modules/esbuild");

const root = path.resolve(__dirname, "..");
const source = `
  import { resolveFixedQuickMenuGeometry } from "./shared/cartridge/quickMenuMetrics";
  export { resolveFixedQuickMenuGeometry };
`;
const output = esbuild.buildSync({
  stdin: { contents: source, loader: "ts", resolveDir: root, sourcefile: "output/quick-menu-authored-position-entry.ts" },
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
  write: false,
  logLevel: "silent",
}).outputFiles?.[0]?.text;
if (!output) throw new Error("Unable to compile authored quick-menu geometry harness.");
const filename = path.join(root, "output", "quick-menu-authored-position-entry.cjs");
const compiled = new Module(filename, module);
compiled.filename = filename;
compiled.paths = Module._nodeModulePaths(root);
compiled._compile(output, filename);

const { resolveFixedQuickMenuGeometry } = compiled.exports;
const authoredRect = { x: 93.30292735649188, y: 9.503216429473, width: 48, height: 8, anchor: "top_right" };
const before = resolveFixedQuickMenuGeometry({ frameWidth: 1280, frameHeight: 720, quickMenuRect: authoredRect });
const afterPageshow = resolveFixedQuickMenuGeometry({ frameWidth: 1280, frameHeight: 720, quickMenuRect: authoredRect });
const afterResume = resolveFixedQuickMenuGeometry({ frameWidth: 1920, frameHeight: 1080, quickMenuRect: authoredRect });

assert.deepEqual(afterPageshow, before, "pageshow/recovery with the same authored frame must preserve quick-menu geometry");
assert.equal(Math.round(afterResume.anchorX / 1920 * 10000) / 10000, Math.round(before.anchorX / 1280 * 10000) / 10000, "recovery must preserve authored-relative right anchor");
assert.equal(Math.round(afterResume.top / 1080 * 10000) / 10000, Math.round(before.top / 720 * 10000) / 10000, "recovery must preserve authored-relative top placement");
assert.ok(afterResume.left >= 0 && afterResume.top >= 0, "recovered surface must remain inside the authored frame");

console.log("quick-menu-authored-position-recovery-contract: PASS");
