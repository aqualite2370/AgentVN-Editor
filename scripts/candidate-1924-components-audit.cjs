"use strict";
// Reuse all six independent checks, including SQLite and real dependency bytes.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const previous = path.join(__dirname, "installed-components-current-audit.cjs");
assert.equal(sha(previous), "16c864a0930f9b5863ec4301b2b3b9570f71836fae427cf57a9aa232259163d8");
let source = fs.readFileSync(previous, "utf8"); const changes = [];
function replace(before, after) { assert.equal(source.split(before).length - 1, 1, before);
  source = source.replace(before, after); changes.push({ before, after }); }
replace('const candidate = require("./lib/installed-components-candidate.cjs");', `const candidate = {
  current: true, expected: { version: "1.9.24", sha256: "ef457f369303302d488e30d105295e9b40a0161cf79d7e996383958429e1a143" },
  installationFile: "F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json"
};`);
replace('for (const n of [editorAttempt, playerAttempt, attempt]) assert.match(n, /^\\d{2}$/);',
  'assert.equal(editorAttempt, "10"); assert.equal(playerAttempt, "01"); assert.equal(attempt, "04"); assert.equal(process.argv.length, 5);');
replace('installed-components-current-${playerAttempt}', 'components-installed-1924-${playerAttempt}');
replace('candidate.current ? install.version : install.executable.version', 'install.executable.version');
replace('  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);',
  '  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);\n' +
  '  fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });\n' +
  '  fs.writeFileSync(path.join(out, "adaptations.json"), JSON.stringify(module.qaChanges, null, 2), { flag: "wx" });');
new vm.Script(Module.wrap(source), { filename: __filename });
if (process.argv.includes("--self-test")) {
  let replay = fs.readFileSync(previous, "utf8");
  for (const c of changes) { assert.equal(replay.split(c.before).length - 1, 1); replay = replay.replace(c.before, c.after); }
  assert.equal(replay, source);
  assert(source.includes('new DatabaseSync'));
  assert(source.includes('playerCounterexamplesRejected: badPlayer.length'));
  assert(source.includes('validateSolidComponentPreview(preview.samples)'));
  console.log(JSON.stringify({ status: "PASS", adaptations: changes.length, scope: "AUDIT_ADAPTER_ONLY" }));
} else {
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker.qaSource = source; worker.qaChanges = changes; worker._compile(source, __filename);
}
