"use strict";
// Isolated Node process only. Exercise existing engine/save flows with the
// actual source bootstrap, not a JSON clone or a test-specific clone function.
const assert = require("node:assert/strict"), path = require("node:path");
const root = path.resolve(__dirname, "..");
const built = require("../GameCli_framework/node_modules/esbuild").buildSync({
  stdin: {
    resolveDir: root, loader: "ts",
    contents: 'import "./GameCli_framework/src/utils/runtimeCompatibility";',
  },
  bundle: true, platform: "node", format: "cjs", write: false,
});
const nativeClone = globalThis.structuredClone;
globalThis.structuredClone = undefined;
globalThis.PerformanceMark = undefined;
globalThis.ResizeObserver = undefined;
const loaded = { exports: {} };
new Function("module", "exports", "require", built.outputFiles[0].text)(loaded, loaded.exports, require);
assert.equal(typeof globalThis.structuredClone, "function");
assert.notEqual(globalThis.structuredClone, nativeClone);
assert.equal(typeof globalThis.ResizeObserver, "function");
console.log("PASS actual Runtime bootstrap installed missing APIs without PerformanceMark; following tests use fallback clone");
