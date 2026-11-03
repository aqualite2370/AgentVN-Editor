"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const previous = path.join(__dirname, "installed-components-current-player.cjs");
assert.equal(sha(previous), "85838cdc3d33f66e0b08ed35e4419e4329faf1b28cefe0c883f28198ca8a252a");
let source = fs.readFileSync(previous, "utf8"); const changes = [];
function replace(before, after) { assert.equal(source.split(before).length - 1, 1);
  source = source.replace(before, after); changes.push({ before, after }); }
replace('const candidate = require("./lib/installed-components-candidate.cjs");', `const candidate = {
  current: true, expected: { version: "1.9.24", sha256: "ef457f369303302d488e30d105295e9b40a0161cf79d7e996383958429e1a143" },
  installationFile: "F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json"
};`);
replace('assert.match(editorAttempt, /^\\d{2}$/); assert.match(attempt, /^\\d{2}$/);',
  'assert.equal(editorAttempt, "10"); assert.equal(attempt, "01"); assert.equal(process.argv.length, 4);');
replace('installed-components-current-${attempt}', 'components-installed-1924-${attempt}');
replace('  unchanged(); save();', `  unchanged(); save();
  fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });
  fs.writeFileSync(path.join(out, "adaptations.json"), JSON.stringify(module.qaChanges, null, 2), { flag: "wx" });`);
replace('  report.finishedAt = new Date().toISOString(); save();',
  '  report.finishedAt = new Date().toISOString(); report.tool = desc(__filename); save();');
new vm.Script(Module.wrap(source), { filename: __filename });
if (process.argv.includes("--self-test")) {
  let replay = fs.readFileSync(previous, "utf8");
  for (const c of changes) { assert.equal(replay.split(c.before).length - 1, 1); replay = replay.replace(c.before, c.after); }
  assert.equal(replay, source);
  assert(source.includes('assert(report.cases.every(c => c.status === "PASS" && c.actions.length === 3))'));
  assert(source.includes('assert.equal(await cs.count(), 3)'));
  assert(source.includes('await ready("playing")'));
  console.log(JSON.stringify({ status: "PASS", changes: changes.length, scope: "QA_BINDING_ONLY_NO_PRODUCT_RUN" }));
} else {
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker.qaSource = source; worker.qaChanges = changes; worker._compile(source, __filename);
}
