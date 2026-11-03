"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
assert.equal(sha(require.resolve("./lib/windows-upgrade-preference-contract.cjs")),
  "e5c8f1d997cf920f5809d79aa4e0258db54bfc29f6c0bb0bba4597a106eaa76d");
const original = path.join(__dirname, "installed-windows-game-upgrade-repository-native-audit.cjs");
assert.equal(sha(original), "0d3ca9366e51acd86ea42f1dffbdb005c1055f72128ccb11e45cde749ce6d6b4");
let source = fs.readFileSync(original, "utf8");
const marker = "new vm.Script(Module.wrap(source));";
assert.equal(source.split(marker).length - 1, 1);
source = source.replace(marker, `
one("  assert.deepEqual(r.newPreference, r.oldPreference);",
  '  assert.equal(options.editorVersion,"1.9.40");' +
  'require("./lib/windows-upgrade-preference-contract.cjs").validate(r.oldPreference,r.newPreference);');
${marker}`);
new vm.Script(Module.wrap(source));
assert.equal(source.split("if (require.main === module) worker.exports.runMain().catch(e => { console.error(e); process.exitCode = 1; });").length - 1, 1);
source = source.replace("if (require.main === module) worker.exports.runMain().catch(e => { console.error(e); process.exitCode = 1; });",
  "worker.exports.runMain().catch(e => { console.error(e); process.exitCode = 1; });");
const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
worker._compile(source, __filename);
