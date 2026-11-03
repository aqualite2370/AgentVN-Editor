"use strict";
// Preserve the old workflow and failure; account for one approved schema default.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
assert.equal(sha(require.resolve("./lib/windows-upgrade-preference-contract.cjs")),
  "e5c8f1d997cf920f5809d79aa4e0258db54bfc29f6c0bb0bba4597a106eaa76d");
const original = path.join(__dirname, "installed-windows-game-upgrade-latest-runtime.cjs");
assert.equal(sha(original), "20f405fd096e349bed8c23a50d5d67584325f775f131071cbcd53f43c32f14fc");
let source = fs.readFileSync(original, "utf8");
const marker = "new vm.Script(Module.wrap(code));";
assert.equal(source.split(marker).length - 1, 1);
source = source.replace(marker, `
one("    assert.deepEqual(report.newPreference, report.oldPreference);",
  '    assert.equal(context.editorVersion,"1.9.40");' +
  'require("./lib/windows-upgrade-preference-contract.cjs").validate(report.oldPreference,report.newPreference);');
${marker}`);
new vm.Script(Module.wrap(source));
const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
// The preserved wrapper runs only as the main module.
assert.equal(source.split("if (require.main === module) worker._compile(code, __filename);").length - 1, 1);
source = source.replace("if (require.main === module) worker._compile(code, __filename);",
  "worker._compile(code, __filename);");
worker._compile(source, __filename);
