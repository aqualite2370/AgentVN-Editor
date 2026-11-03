"use strict";
// Reuse the sealed current-candidate publishing workflow with the retained
// same-game fixture. This builds a real new package, never a fabricated old one.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
function fixtureFor(version) {
  assert.match(version, /^\d+\.\d+\.\d+$/);
  const value = require("./lib/windows-game-upgrade-fixture.cjs").retainedUpgradeFixture();
  value.version = "1.0.3"; value.newEditorVersion = version; value.marker = "QA_WINDOWS_UPGRADE_CURRENT";
  value.project.nodes[1].data.scene.commands = [0, 1, 2].map(i => ({
    type: "narration", text: `QA_WINDOWS_UPGRADE_CURRENT_${i}：同游戏新版1.0.3，验证旧存档保留与当前安装版实际剧情。`,
  }));
  return value;
}
module.exports = { fixtureFor };
if (require.main === module) {
  const original = path.join(__dirname, "installed-editor-windows-candidate.cjs");
  assert.equal(sha(original), "58e47daaf010f7a8b4ba2fa7bff1a23150615e230180109277c37b5d0e6c3128");
  const config = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
  let source = fs.readFileSync(original, "utf8");
  const one = (before, after) => {
    assert.equal(source.split(before).length - 1, 1, before);
    source = source.replace(before, () => after);
  };
  one("  new vm.Script(Module.wrap(code));", [
    '  one(\'const upgrade=process.argv.includes("--upgrade-from-retained")?retainedUpgradeFixture():null;\',',
    '    "const upgrade=" + JSON.stringify(module.qaFixture) + ";");',
    "  new vm.Script(Module.wrap(code));",
  ].join("\n"));
  one('status: "PREPARED_NOT_PRODUCT_TESTED", out, config: c,',
    'status: "PREPARED_NOT_PRODUCT_TESTED", out, config: c, upgradeFixture: module.qaFixture,');
  one("original, receipt, generated,\n", `original, receipt, generated, ${JSON.stringify(original)},\n`);
  new vm.Script(Module.wrap(source), { filename: __filename });
  const worker = new Module(__filename, module);
  worker.filename = __filename; worker.paths = module.paths;
  worker.qaFixture = fixtureFor(config.version);
  worker._compile(source, __filename);
}
