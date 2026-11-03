"use strict";
// Prepare the full prior read-only audit without touching a running publisher.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const original = path.join(__dirname, "installed-windows-native-ui-current-audit.cjs");
assert.equal(sha(original), "c8d2548ec51d3cba8f3d6c043d215aee2d13ecd37ddbbcdfe4979d04d6e6aca1");
function adapt() {
  let source = fs.readFileSync(original, "utf8"); const changes = [];
  function replace(before, after) {
    assert.equal(source.split(before).length - 1, 1, before);
    source = source.replace(before, after); changes.push({ before, after });
  }
  replace('require("./lib/windows-game-upgrade-fixture.cjs")', 'require("./lib/windows-1924-upgrade-fixture.cjs")');
  replace('ACTUAL_INSTALLED_1_9_22_NORMAL_PUBLISH_UI_NATIVE_PICKER_WINDOWS_BUILD',
    'ACTUAL_INSTALLED_1_9_24_NORMAL_PUBLISH_UI_NATIVE_PICKER_WINDOWS_BUILD');
  replace('assert.equal(installed.version, "1.9.22")', 'assert.equal(installed.executable.version, "1.9.24")');
  replace('sha(path.join(__dirname, "installed-windows-native-ui-current.cjs"))',
    'sha(path.join(__dirname, "candidate-1924-windows-native.cjs"))');
  replace('read(f.path).editorVersion === "1.9.22"', 'read(f.path).editorVersion === "1.9.24"');
  replace('return { editorVersion: installed.version, playerPE: pe, artifacts: r.artifacts.length };',
    'return { editorVersion: installed.executable.version, playerPE: pe, artifacts: r.artifacts.length };');
  replace('      const installed = read(r.installation.path);\n      assert.equal(installed.executable.version, "1.9.24");',
    '      const installed = read(r.installation.path);\n' +
    '      assert.equal(installed.executable.version, "1.9.24");\n' +
    '      assert.deepEqual(r.priorUpgradeFixture, require("./lib/windows-1924-upgrade-fixture.cjs").expectedFixture().previous);\n' +
    '      let executed = fs.readFileSync(path.join(__dirname,"installed-windows-native-ui-current.cjs"),"utf8");\n' +
    '      for(const c of read(path.join(run,"candidate-adaptations.json"))) {\n' +
    '        assert.equal(executed.split(c.before).length-1,1); executed=executed.replace(c.before,c.after);\n' +
    '      }\n' +
    '      assert.equal(executed,fs.readFileSync(path.join(run,"executed-business.cjs"),"utf8"));');
  new vm.Script(Module.wrap(source), { filename: __filename });
  return { source, changes };
}
const adapted = adapt(), worker = new Module(__filename, module);
worker.filename = __filename; worker.paths = module.paths;
worker._compile(adapted.source + "\nmodule.exports.runMain=main;\n", __filename);
module.exports = worker.exports;
if (require.main === module) {
  if (process.argv[2] === "--self-test") {
    const { expectedFixture, validateUpgradeFixture } = require("./lib/windows-1924-upgrade-fixture.cjs");
    const { current } = expectedFixture(); validateUpgradeFixture(current);
    for (const mutate of [x => x.project.project_id = "different",
      x => x.project.nodes[1].data.scene.commands.pop(), x => x.version = "1.0.1",
      x => x.newEditorVersion = "1.9.22", x => x.project.edges = []]) {
      const copy = structuredClone(current); mutate(copy); assert.throws(() => validateUpgradeFixture(copy));
    }
    // Synthetic validator self-test only. No pending candidate result is promoted.
    const historical = JSON.parse(fs.readFileSync(
      "F:/AgentVN/QA/Windows-Package-20261021-01/editor-04/report.json", "utf8"));
    const synthetic = structuredClone(historical);
    synthetic.scope = "ACTUAL_INSTALLED_1_9_24_NORMAL_PUBLISH_UI_NATIVE_PICKER_WINDOWS_BUILD";
    synthetic.upgradeFixture = current; synthetic.priorUpgradeFixture = expectedFixture().previous;
    worker.exports.validate(synthetic);
    const rejected = worker.exports.selfTest(synthetic);
    console.log(JSON.stringify({ status: "PASS", transformations: adapted.changes.length,
      rejectedReportVariants: rejected, rejectedFixtureVariants: 5,
      scope: "SYNTHETIC_VALIDATOR_AND_EXACT_ADAPTATION_ONLY", productLaunches: 0 }));
  } else {
    assert.deepEqual(process.argv.slice(2), ["05", "04"]);
    worker.exports.runMain().catch(e => { console.error(e); process.exitCode = 1; });
  }
}
