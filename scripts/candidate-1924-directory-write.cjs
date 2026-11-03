"use strict";
// Existing actual-ACL regression against the frozen candidate. No picker claim.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const original = path.join(__dirname, "project-directory-write-native.cjs");
assert.equal(sha(original), "c06d895488cfd906c06451867f0ae3e149f745074610d2eaec1df0ec062390cf");
const installationFile = "F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json";
const installation = JSON.parse(fs.readFileSync(installationFile, "utf8"));
assert.equal(installation.executable.version, "1.9.24");
for (const f of [installation.executable, ...installation.resources, ...installation.protectedFiles])
  assert.equal(sha(f.path), f.sha256, f.path);
let source = fs.readFileSync(original, "utf8");
const changes = [];
function replace(before, after) {
  assert.equal(source.split(before).length - 1, 1, before);
  source = source.replace(before, after); changes.push({ before, after });
}
replace('"F:/AgentVN/QA/Editor-Repair-Release-20261024-01/installation.json"', JSON.stringify(installationFile));
replace('"F:/AgentVN/QA/Editor-Repair-Release-20261024-01/directory"',
  '"F:/AgentVN/QA/Project-Directory-Write-20261024-01/installed-1924"');
replace('assert.equal(installation.executable.version,"1.9.23")',
  'assert.equal(installation.executable.version,"1.9.24")');
replace('"ACTUAL_INSTALLED_1_9_23_REAL_ACL_AND_RUST_IO_NOT_NATIVE_PICKER_ACCEPTANCE"',
  '"ACTUAL_INSTALLED_1_9_24_REAL_ACL_AND_RUST_IO_NOT_NATIVE_PICKER_ACCEPTANCE"');
replace(' save();page=await owner.start();',
  ' fs.writeFileSync(path.join(out,"executed-business.cjs"),module.qaSource,{flag:"wx"});\n' +
  ' fs.writeFileSync(path.join(out,"adaptations.json"),JSON.stringify(module.qaChanges,null,2),{flag:"wx"});\n' +
  ' save();page=await owner.start();');
new vm.Script(Module.wrap(source), { filename: __filename });
let replay = fs.readFileSync(original, "utf8");
for (const c of changes) {
  assert.equal(replay.split(c.before).length - 1, 1);
  replay = replay.replace(c.before, c.after);
}
assert.equal(replay, source);
for (const text of [
  'assert.equal(report.cases.length,single?1:12)',
  'assert.deepEqual(fs.readdirSync(directory),["old.vnproj"])',
  'assert.equal(downloads,0)',
  'assert.equal(sha(old),report.old.sha256)',
  'assert(!row.summary.includes("请确认素材仍可在素材库中预览")',
]) assert(source.includes(text), text);
if (process.argv[2] === "--self-test") {
  console.log(JSON.stringify({ status: "PASS", transformations: changes.length,
    scope: "CANDIDATE_BINDING_ONLY_ALL_TWELVE_ACL_ASSERTIONS_UNCHANGED" }));
} else {
  assert.deepEqual(process.argv.slice(2), ["green-01"]);
  process.argv.push("--installed=" + installationFile);
  const worker = new Module(__filename, module);
  worker.filename = __filename; worker.paths = module.paths;
  worker.qaSource = source; worker.qaChanges = changes;
  worker._compile(source, __filename);
}
