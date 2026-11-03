"use strict";
// Bind the unchanged migration workflow to the direct owned Win32 input adapter.
const fs = require("node:fs"), assert = require("node:assert/strict"), Module = require("node:module");
const filename = require.resolve("./editor-cross-wm-close-current.cjs");
const source = fs.readFileSync(filename, "utf8")
  .replaceAll("./lib/editor-cross-repository-native.cjs", "./lib/editor-cross-win32-native.cjs")
  .replaceAll("editor-migration-consent-uia.ps1", "editor-migration-consent-win32.ps1")
  .replace('files: [__filename, ${JSON.stringify(original)},',
    'files: [__filename, require.resolve("./editor-cross-wm-close-current.cjs"), require.resolve("./lib/editor-cross-repository-native.cjs"), ${JSON.stringify(original)},');
assert.notEqual(source, fs.readFileSync(filename, "utf8"));
const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
worker._compile(source, __filename);
