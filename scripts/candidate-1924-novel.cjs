"use strict";
// Fresh complete novel workflow in the current installed backend; local model only.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const previous = path.join(__dirname, "installed-novel-default-current.cjs");
assert.equal(sha(previous), "7ea2f8f1fcc6874ba37a2bb9fa0f354316056314b05ff29b3993690926b94d6c");
const original = fs.readFileSync(previous, "utf8"); let source = original; const changes = [];
function replace(before, after) {
  assert.equal(source.split(before).length - 1, 1, before);
  source = source.replace(before, after); changes.push({ before, after });
}
replace('const qa = `F:/AgentVN/QA/${label}`, checkpoint = `F:/AgentVN/Checkpoints/${label}`;',
  'const qa = `F:/AgentVN/QA/${label}`, checkpoint = "F:/AgentVN/Checkpoints/Installed-Novel-1924-20261025-01";');
replace('"F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json"',
  '"F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json"');
replace('`qa-installed-novel-default-1922-20261022-${attempt}`', '`qa-installed-novel-1924-20261025-${attempt}`');
replace('`真实默认小说链隔离 1.9.22 ${attempt}`', '`真实小说链隔离 1.9.24 ${attempt}`');
replace('assert.equal(install.version, "1.9.22")', 'assert.equal(install.executable.version, "1.9.24")');
replace('assert.equal(install.executable.sha256, "189222471fe1bb83a57b40f9559b2321a8080d66a9ea3548b2692f94d3dee4dc")',
  'assert.equal(install.executable.sha256, "ef457f369303302d488e30d105295e9b40a0161cf79d7e996383958429e1a143")');
replace('const baseline = read("F:/AgentVN/QA/Editor-1.9.22-20261022-01/baseline-01.json");',
  'const baseline = install;');
replace('version: "1.9.22", startedAt:', 'version: "1.9.24", startedAt:');
replace('protectedFiles: baseline.cases.find(c => c.name === "protected-file-baseline").detail,',
  'protectedFiles: [baseline.executable, ...baseline.resources, ...baseline.protectedFiles],');
replace('  const git = spawnSync("git", ["rev-parse", "HEAD"]',
  '  fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });\n' +
  '  fs.writeFileSync(path.join(out, "adaptations.json"), JSON.stringify(module.qaChanges, null, 2), { flag: "wx" });\n' +
  '  const git = spawnSync("git", ["rev-parse", "HEAD"]');
replace('module.exports = { qa, modelStages, stages };', 'module.exports = { qa, modelStages, stages, run };');
new vm.Script(Module.wrap(source), { filename: __filename });
let replay = original;
for (const c of changes) { assert.equal(replay.split(c.before).length - 1, 1); replay = replay.replace(c.before, c.after); }
assert.equal(replay, source);
if (process.argv[2] === "--self-test") {
  assert(source.includes('assert.equal(provider.requests.length, 13)'));
  assert(source.includes('assert.deepEqual(s.project.nodes, report.completed.project.nodes)'));
  console.log(JSON.stringify({ status: "PASS", adaptations: changes.length, scope: "BINDING_ONLY_NO_PRODUCT_OR_MODEL" }));
} else {
  assert.deepEqual(process.argv.slice(2), process.argv[2] === "07" ? ["07"] : ["08", "--default-port"]);
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker.qaSource = source; worker.qaChanges = changes; worker._compile(source, __filename);
  worker.exports.run(process.argv[2]).catch(e => { console.error(e); process.exitCode = 1; });
}
