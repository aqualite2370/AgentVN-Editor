"use strict";
// Re-run the complete controlled review workflow against the sealed 1.9.24 install.
// Keep the existing exact cache boundary and all earlier reports.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const previous = path.join(__dirname, "installed-assistant-current.cjs");
assert.equal(sha(previous), "7b9b1f427a831eccdd7310b0f82e50903bfeb4786beea5d483ffe02090e7a87f");
let source = fs.readFileSync(previous, "utf8"); const changes = [];
function replace(before, after) {
  assert.equal(source.split(before).length - 1, 1, before);
  source = source.replace(before, after); changes.push({ before, after });
}
replace('const currentCandidate=process.argv.includes("--candidate=1.9.22"),expectedVersion=currentCandidate?"1.9.22":"1.9.14";',
  'const currentCandidate=true,expectedVersion="1.9.24";');
replace('const qa = `F:/AgentVN/QA/${label}`, checkpoint = `F:/AgentVN/Checkpoints/${label}`;',
  'const qa = `F:/AgentVN/QA/${label}`, checkpoint = "F:/AgentVN/Checkpoints/Installed-Assistant-Review-1924-20261025-01";');
replace('"F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json"',
  '"F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json"');
replace('  assert(fs.existsSync(checkpoint)); fs.mkdirSync(qa, { recursive: true });',
  '  assert(!fs.existsSync(checkpoint)); fs.mkdirSync(checkpoint); fs.mkdirSync(qa, { recursive: true });');
replace('assert.equal(currentCandidate?installation.version:installation.executable.version, expectedVersion);',
  'assert.equal(installation.executable.version, expectedVersion);\n' +
  '  assert.equal(installation.executable.sha256, "ef457f369303302d488e30d105295e9b40a0161cf79d7e996383958429e1a143");');
replace('const frozen = currentCandidate?read("F:/AgentVN/QA/Editor-1.9.22-20261022-01/baseline-01.json").protectedFiles:',
  'const frozen = currentCandidate?installation.protectedFiles:');
replace('currentCandidate?"1922-20261022":"20261021"', '"1924-20261025"');
replace('currentCandidate?"1.9.22 20261022":"20261021"', '"1.9.24 20261025"');
// The old QA root remains an approved isolation boundary; inputs/preparation are new.
replace('write(path.join(qa, "preparation.json")', 'write(path.join(qa, "preparation-1924.json")');
replace('const prep = read(path.join(qa, "preparation.json"))',
  'const prep = read(path.join(qa, "preparation-1924.json"))');
replace('assert.match(attempt, /^\\d{2}$/); const out', 'assert.equal(attempt, "02"); const out');
replace('  for (const f of tools) fs.copyFileSync(path.resolve(root, f), path.join(out, path.basename(f)), fs.constants.COPYFILE_EXCL);',
  '  for (const f of tools) fs.copyFileSync(path.resolve(root, f), path.join(out, path.basename(f)), fs.constants.COPYFILE_EXCL);\n' +
  '  fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });\n' +
  '  write(path.join(out, "adaptations.json"), module.qaChanges);');
new vm.Script(Module.wrap(source), { filename: __filename });
if (process.argv.includes("--self-test")) {
  let replay = fs.readFileSync(previous, "utf8");
  for (const c of changes) {
    assert.equal(replay.split(c.before).length - 1, 1); replay = replay.replace(c.before, c.after);
  }
  assert.equal(replay, source);
  assert(source.includes('assert.deepEqual(result.toolEvents.filter(e => e.status === "completed").map(e => e.tool), provider.names)'));
  assert(source.includes('assert.equal(report.matrix.length, 12)'));
  assert(source.includes('assert.equal(sha(downloaded), report.projectArtifact.sha256)'));
  console.log(JSON.stringify({ status: "PASS", adaptations: changes.length, scope: "CANDIDATE_BINDING_ONLY_NO_MODEL_OR_PRODUCT" }));
} else {
  assert(["prepare", "02"].includes(process.argv[2])); assert.equal(process.argv.length, 3);
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker.qaSource = source; worker.qaChanges = changes; worker._compile(source, __filename);
}
