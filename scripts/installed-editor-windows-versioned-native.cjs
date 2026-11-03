"use strict";
// A newer game fixture is necessary because the retained 1.9.34 export is already 1.0.3.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const template = path.join(__dirname, "installed-editor-windows-repository-native.cjs");
assert.equal(sha(template), "da67edc72f3725856d5863758ce8ac179beae2612229a5180b69ebc15482c078");
let source = fs.readFileSync(template, "utf8");
const one = (before, after) => {
  assert.equal(source.split(before).length - 1, 1, before); source = source.replace(before, () => after);
};
one('worker.qaFixture = require("./installed-editor-windows-upgrade-candidate.cjs").fixtureFor(config.version);',
  'worker.qaFixture = require("./lib/windows-upgrade-fixture-policy.cjs").fixtureFor(config);');
one("  '      path.join(__dirname, \"gui-directory-picker-uia.ps1\"),',", [
  "  '      path.join(__dirname, \"gui-directory-picker-uia.ps1\"),',",
  `  '      ${JSON.stringify(template).replaceAll("\\", "\\\\")},',`,
  "  '      path.join(__dirname, \"lib/windows-upgrade-fixture-policy.cjs\"),',",
].join("\n"));
new vm.Script(Module.wrap(source));
const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
worker._compile(source, __filename);
