"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const original = path.join(__dirname, "installed-windows-game-upgrade-repository-native-audit.cjs");
assert.equal(sha(original), "0d3ca9366e51acd86ea42f1dffbdb005c1055f72128ccb11e45cde749ce6d6b4");
assert.equal(sha(require.resolve("./lib/windows-upgrade-preference-contract.cjs")),
  "e5c8f1d997cf920f5809d79aa4e0258db54bfc29f6c0bb0bba4597a106eaa76d");
let source = fs.readFileSync(original, "utf8");
source = source.replaceAll("validateRetained1934Source", "validateRetained1935Source")
  .replaceAll("1.9.34", "1.9.35").replaceAll('"1.0.3" : r.oldEditorVersion', '"1.0.4" : r.oldEditorVersion');
const one = (before, after) => {
  assert.equal(source.split(before).length - 1, 1, before); source = source.replace(before, () => after);
};
const marker = "new vm.Script(Module.wrap(source));";
one(marker, `
assert.equal(source.split("lib/windows-current-native-source.cjs").length - 1, 3);
source = source.replaceAll("lib/windows-current-native-source.cjs", "lib/windows-next-native-source.cjs");
one("  assert.deepEqual(r.newPreference, r.oldPreference);",
  '  assert.equal(options.editorVersion,"1.9.40");' +
  'require("./lib/windows-upgrade-preference-contract.cjs").validate(r.oldPreference,r.newPreference);');
${marker}`);
one("if (require.main === module) worker.exports.runMain().catch",
  "if (module.parent === null) worker.exports.runMain().catch");
new vm.Script(Module.wrap(source));
const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
worker._compile(source, __filename);
module.exports = worker.exports;
if (require.main === module) worker.exports.runMain().catch(e => { console.error(e); process.exitCode = 1; });
