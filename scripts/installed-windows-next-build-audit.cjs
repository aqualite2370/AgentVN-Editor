"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const original = path.join(__dirname, "installed-windows-repository-native-audit.cjs");
assert.equal(sha(original), "898720d1de8f784db82bb3cc157963a710c8440df4d08fad48cbdf32cb14a165");
let source = fs.readFileSync(original, "utf8");
assert.equal(source.split("lib/windows-upgrade-fixture-policy.cjs").length - 1, 1);
source = source.replace("lib/windows-upgrade-fixture-policy.cjs", "lib/windows-next-upgrade-fixture.cjs");
assert.equal(source.split("if (require.main === module) worker.exports.runMain()").length - 1, 1);
source = source.replace("if (require.main === module) worker.exports.runMain()",
  "if (module.parent === null) worker.exports.runMain()");
new vm.Script(Module.wrap(source));
const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
worker._compile(source, __filename);
module.exports = worker.exports;
if (require.main === module) worker.exports.runMain().catch(e => { console.error(e); process.exitCode = 1; });
