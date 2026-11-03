"use strict";
const fs = require("node:fs"), assert = require("node:assert/strict"), Module = require("node:module");
const { sha } = require("./installed-runtime-session.cjs");
const original = require.resolve("./windows-setup-current-evidence.cjs");
assert.equal(sha(original), "7fae64bc42a61fc6017a20cfa761b400015a602a8d9975ea49b6ba4d02a1b245");
let source = fs.readFileSync(original, "utf8");
const changes = [
  ['assert(["1.9.16", "1.9.22"].includes(editorVersion));',
    'assert(["1.9.16", "1.9.22", "1.9.24"].includes(editorVersion));'],
  ['const nativeUI = editorVersion === "1.9.22";', 'const nativeUI = ["1.9.22", "1.9.24"].includes(editorVersion);'],
  ['assert(/editor-03[\\\\/]report\\.json$/.test(r.source.path));',
    'assert(new RegExp("editor-" + (editorVersion === "1.9.24" ? "05" : "03") + "[\\\\\\\\/]report\\\\.json$").test(r.source.path));'],
  ['assert(/native-ui-audit-02[\\\\/]report\\.json$/.test(r.sourceAudit.path));',
    'assert(new RegExp("native-ui-audit-" + (editorVersion === "1.9.24" ? "04" : "02") + "[\\\\\\\\/]report\\\\.json$").test(r.sourceAudit.path));'],
  ['assert(/setup-payload-audit-02[\\\\/]report\\.json$/.test(r.payload.path));',
    'assert(new RegExp("setup-payload-audit-" + (editorVersion === "1.9.24" ? "04" : "02") + "[\\\\\\\\/]report\\\\.json$").test(r.payload.path));'],
  ['assert.equal(r.gameId, "qa_windows_native_1922_03");',
    'assert.equal(r.gameId, editorVersion === "1.9.24" ? "qa_windows_pkg_20261021_01" : "qa_windows_native_1922_03");'],
];
for (const [before, after] of changes) {
  assert.equal(source.split(before).length - 1, 1, before); source = source.replace(before, after);
}
const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
worker._compile(source, __filename); module.exports = worker.exports;
