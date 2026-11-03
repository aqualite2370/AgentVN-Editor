"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const original = path.join(__dirname, "installed-windows-game-upgrade-audit.cjs");
assert.equal(sha(original), "f08066e247278aa975a85595334139de02a8c8e3385c372bb247332fc53a037a");
let source = fs.readFileSync(original, "utf8");
const one = (before, after) => {
  assert.equal(source.split(before).length - 1, 1, before); source = source.replace(before, () => after);
};
one('  const oldVersion = options.oldVersion || "1.0.0", newVersion = options.newVersion || "1.0.1";',
  '  assert.equal(r.nativeAutomation, "repository-native-v1");\n' +
  '  assert.equal(r.nativeAutomationSources.length, 4);\n' +
  '  for(const f of r.nativeAutomationSources) assert.equal(sha(f.path),f.sha256);\n' +
  '  const oldVersion = options.oldVersion || "1.0.0", newVersion = options.newVersion || "1.0.1";');
one('c.receipt.interaction.includes("Computer Use")',
  'c.receipt.interaction === require("./lib/windows-repository-native.cjs").CLOSE');
one('    assert.equal(c.receipt.method, "SKY_NATIVE_ALT_F4_AND_EXIT_CONFIRMATION");',
  '    require("./lib/windows-repository-native.cjs").validateClose(c.request,c.receipt);\n' +
  '    assert.equal(c.receipt.confirmation.testId, "confirm-exit-game");\n' +
  '    assert(c.receipt.confirmation.dialogText.includes("退出"));');
one('  const oldMarker = options.oldEditorVersion === "1.9.24" ? "QA_WINDOWS_UPGRADE_NEW" : "QA_WINDOWS_SAVE";',
  '  const oldMarker = options.oldEditorVersion === "1.9.34" ? "QA_WINDOWS_UPGRADE_CURRENT" :\n' +
  '    options.oldEditorVersion === "1.9.24" ? "QA_WINDOWS_UPGRADE_NEW" : "QA_WINDOWS_SAVE";');
one('if (options.editorVersion) assert(l.actualText.includes("新版1.0.3"));',
  'if (options.editorVersion) assert(l.actualText.includes(`新版${newVersion}`));');
one('oldVersion: r.oldEditorVersion === "1.9.24" ? "1.0.2" : "1.0.0",',
  'oldVersion: r.oldEditorVersion === "1.9.34" ? "1.0.3" : r.oldEditorVersion === "1.9.24" ? "1.0.2" : "1.0.0",');
one('assert(["1.9.16", "1.9.24"].includes(options.oldEditorVersion))',
  'assert(["1.9.16", "1.9.24", "1.9.34"].includes(options.oldEditorVersion))');
one('      if (options.oldEditorVersion === "1.9.24") require("./lib/windows-current-native-source.cjs").validateRetained1924Source(old);',
  '      if (options.oldEditorVersion === "1.9.34") require("./lib/windows-current-native-source.cjs").validateRetained1934Source(old);\n' +
  '      else if (options.oldEditorVersion === "1.9.24") require("./lib/windows-current-native-source.cjs").validateRetained1924Source(old);');
one('["install", options.oldEditorVersion === "1.9.24"\n',
  '["install", ["1.9.24", "1.9.34"].includes(options.oldEditorVersion)\n');
new vm.Script(Module.wrap(source));
const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
worker._compile(source + "\nmodule.exports.runMain=main;\n", __filename);
module.exports = worker.exports;
if (require.main === module) worker.exports.runMain().catch(e => { console.error(e); process.exitCode = 1; });
