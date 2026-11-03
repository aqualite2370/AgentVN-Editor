"use strict";
// Retain the pinned historical audit, changing only the explicitly bound native backend.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const original = path.join(__dirname, "installed-windows-native-ui-current-audit.cjs");
assert.equal(sha(original), "423da579e4e1c86b8a3b49efda26e0cdcb4150b180032cb9d90261033c0b8751");
let source = fs.readFileSync(original, "utf8");
const one = (before, after) => {
  assert.equal(source.split(before).length - 1, 1, before); source = source.replace(before, () => after);
};
one('  assert(result.interaction.includes("Computer Use"));',
  '  require("./lib/windows-repository-native.cjs").validatePicker(request, result);');
one('  assert(closing.receipt.interaction.includes("Computer Use"));',
  '  require("./lib/windows-repository-native.cjs").validateClose(closing.request, closing.receipt);');
one('    const binding = read(bindingFile), c = binding.config;',
  '    const binding = read(bindingFile), c = binding.config;\n' +
  '    assert.equal(c.nativeAutomation, "repository-native-v1");');
one('      const expected = require("./installed-editor-windows-upgrade-candidate.cjs").fixtureFor(c.version);',
  '      const expected = require("./lib/windows-upgrade-fixture-policy.cjs").fixtureFor(c);');
// This adapter is only meaningful for a sealed actual-installation binding.
one('  assert.notEqual(r.status, "RUNNING", "Do not audit a live run as terminal");',
  '  assert(bindingArg, "Repository automation requires a sealed current candidate binding");\n' +
  '  assert.notEqual(r.status, "RUNNING", "Do not audit a live run as terminal");');
new vm.Script(Module.wrap(source));
const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
worker._compile(source + "\nmodule.exports.runMain=main;\n", __filename);
module.exports = worker.exports;
if (require.main === module) worker.exports.runMain().catch(e => { console.error(e); process.exitCode = 1; });
