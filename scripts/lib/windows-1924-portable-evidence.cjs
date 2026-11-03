"use strict";
const fs = require("node:fs"), assert = require("node:assert/strict"), Module = require("node:module");
const { sha } = require("./installed-runtime-session.cjs");
const original = require.resolve("./windows-portable-current-evidence.cjs");
assert.equal(sha(original), "38a5e8040aaff20c8f251a9bd1c0b3a34cf90344c22af2b489de958f8b6837bd");
let source = fs.readFileSync(original, "utf8");
const changes = [
  ['assert(["1.9.16", "1.9.22"].includes(editorVersion));',
    'assert(["1.9.16", "1.9.22", "1.9.24"].includes(editorVersion));'],
  ['if (editorVersion === "1.9.22") {', 'if (["1.9.22", "1.9.24"].includes(editorVersion)) {'],
  ['assert(/native-ui-audit-02[\\\\/]report\\.json$/.test(r.sourceAudit.path));',
    'assert(new RegExp("native-ui-audit-" + (editorVersion === "1.9.24" ? "04" : "02") + "[\\\\\\\\/]report\\\\.json$").test(r.sourceAudit.path));\n' +
    '    if (editorVersion === "1.9.24") assert(/editor-05[\\\\/]report\\.json$/.test(r.sourceReport.path));'],
];
for (const [before, after] of changes) {
  assert.equal(source.split(before).length - 1, 1, before); source = source.replace(before, after);
}
const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
worker._compile(source, __filename); module.exports = worker.exports;
