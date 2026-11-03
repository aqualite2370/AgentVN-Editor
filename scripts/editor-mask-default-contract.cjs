#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const esbuild = require("../editor/node_modules/esbuild");
const Module = require("node:module");
const root = path.resolve(__dirname, "..");
const source = `import { createDefaultMask } from "./shared/cartridge/uiSkin"; export { createDefaultMask };`;
const out = esbuild.buildSync({ stdin: { contents: source, loader: "ts", resolveDir: root }, bundle: true, format: "cjs", platform: "node", write: false, logLevel: "silent" }).outputFiles[0].text;
const filename = path.join(root, "output", "editor-mask-default-entry.cjs");
const mod = new Module(filename, module); mod.filename = filename; mod.paths = Module._nodeModulePaths(root); mod._compile(out, filename);
const style = mod.exports.createDefaultMask().style;
assert.equal(style?.maskMode, "blur"); assert.equal(style?.backdropBlur, 20); assert.equal(style?.opacity, 0.85);
assert.equal(style?.borderRadius, 9); assert.equal(style?.borderWidth, 1); assert.equal(style?.shadow, "soft");
console.log("editor-mask-default-contract: PASS");
