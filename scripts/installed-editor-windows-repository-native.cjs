"use strict";
// Keep the sealed historical workflow unchanged; attribute the current native actor.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const original = path.join(__dirname, "installed-editor-windows-candidate.cjs");
assert.equal(sha(original), "58e47daaf010f7a8b4ba2fa7bff1a23150615e230180109277c37b5d0e6c3128");
const config = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
assert.equal(config.nativeAutomation, "repository-native-v1");
let source = fs.readFileSync(original, "utf8");
function one(before, after) {
  assert.equal(source.split(before).length - 1, 1, before);
  source = source.replace(before, () => after);
}
one("  new vm.Script(Module.wrap(code));", [
  '  one(\'const upgrade=process.argv.includes("--upgrade-from-retained")?retainedUpgradeFixture():null;\',',
  '    "const upgrade=" + JSON.stringify(module.qaFixture) + ";");',
  '  one(\'const A=require("./lib/installed-acceptance.cjs");\',',
  '    \'const A=require("./lib/installed-acceptance.cjs");\\nconst N=require("./lib/windows-repository-native.cjs");\');',
  '  one("const native=await A.nativeInput(", "const native=await N.nativeInput(");',
  '  const closeStart = code.indexOf("async function normalClose(){");',
  '  const closeEnd = code.indexOf("\\n(async()=>{", closeStart);',
  '  assert(closeStart > 0 && closeEnd > closeStart);',
  '  one(code.slice(closeStart, closeEnd), "async function normalClose(){\\n" +',
  '    "  const result=await N.normalEditorClose({owner,out,report});\\n" +',
  '    "  report.normalCloseClaim=true;return result;\\n}\\n");',
  "  new vm.Script(Module.wrap(code));",
].join("\n"));
one('status: "PREPARED_NOT_PRODUCT_TESTED", out, config: c,',
  'status: "PREPARED_NOT_PRODUCT_TESTED", out, config: c, upgradeFixture: module.qaFixture,');
one("original, receipt, generated,\n", [
  "original, receipt, generated,",
  `      ${JSON.stringify(__filename)},`,
  '      path.join(__dirname, "lib/windows-repository-native.cjs"),',
  '      path.join(__dirname, "gui-directory-picker-uia.ps1"),',
  "",
].join("\n"));
new vm.Script(Module.wrap(source));
const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
worker.qaFixture = require("./installed-editor-windows-upgrade-candidate.cjs").fixtureFor(config.version);
worker._compile(source, __filename);
