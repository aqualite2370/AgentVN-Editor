"use strict";
// Exact retained 1.9.35/game1.0.4 -> installed 1.9.40/game1.0.5, preserving prior QA.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
assert.equal(sha(require.resolve("./lib/windows-upgrade-preference-contract.cjs")),
  "e5c8f1d997cf920f5809d79aa4e0258db54bfc29f6c0bb0bba4597a106eaa76d");
const original = path.join(__dirname, "installed-windows-game-upgrade-latest-runtime.cjs");
assert.equal(sha(original), "20f405fd096e349bed8c23a50d5d67584325f775f131071cbcd53f43c32f14fc");
let source = fs.readFileSync(original, "utf8");
const one = (before, after) => {
  assert.equal(source.split(before).length - 1, 1, before); source = source.replace(before, () => after);
};
one('"editor-16/report.json"', '"editor-18/report.json"');
one('const oldVersion = "1.0.3"', 'const oldVersion = "1.0.4"');
source = source.replaceAll("validateRetained1934Source", "validateRetained1935Source")
  .replaceAll("1.9.34", "1.9.35").replaceAll("1_9_34", "1_9_35")
  .replaceAll("native-ui-audit-07", "native-ui-audit-09")
  .replaceAll("setup-payload-audit-07", "setup-payload-audit-09");
const marker = "new vm.Script(Module.wrap(code));";
one(marker, `
assert.equal(code.split("lib/windows-current-native-source.cjs").length - 1, 3);
code = code.replaceAll("lib/windows-current-native-source.cjs", "lib/windows-next-native-source.cjs");
one("    assert.deepEqual(report.newPreference, report.oldPreference);",
  '    assert.equal(context.editorVersion,"1.9.40");' +
  'require("./lib/windows-upgrade-preference-contract.cjs").validate(report.oldPreference,report.newPreference);');
${marker}`);
one("if (require.main === module) worker._compile(code, __filename);",
  'if (process.argv.includes("--check-adapter")) console.log("PASS: exact pinned upgrade adaptation; no product launch");' +
  'else worker._compile(code, __filename);');
new vm.Script(Module.wrap(source));
const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
worker._compile(source, __filename);
