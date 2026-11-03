"use strict";
// Independent six-group review audit, bound to the new candidate evidence.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const previous = path.join(__dirname, "installed-assistant-current-audit.cjs");
assert.equal(sha(previous), "ace4df276e6b4f5f94d3f7979d2d1f2851fa9f80eca2c8e209a6de9d14f8b89a");
let source = fs.readFileSync(previous, "utf8"); const changes = [];
function replace(before, after) {
  assert.equal(source.split(before).length - 1, 1, before);
  source = source.replace(before, after); changes.push({ before, after });
}
replace('const currentCandidate=process.argv.includes("--candidate=1.9.22"),expectedVersion=currentCandidate?"1.9.22":"1.9.14";',
  'const currentCandidate=true,expectedVersion="1.9.24";');
replace('assert.match(attempt, /^\\d{2}$/); assert.match(audit, /^\\d{2}$/);',
  'assert.equal(attempt, "02"); assert.equal(audit, "02"); assert.equal(process.argv.length, 4);');
replace('prep = read(path.join(qa, "preparation.json"))', 'prep = read(path.join(qa, "preparation-1924.json"))');
replace('    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);',
  '    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);\n' +
  '    fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });\n' +
  '    fs.writeFileSync(path.join(out, "adaptations.json"), JSON.stringify(module.qaChanges, null, 2), { flag: "wx" });');
// Include all restart cleanups and explicit launch backends, not only the last known map.
replace('const now = rows(), keys = new Set(r.knownProcesses.map(p => `${p.ProcessId}:${p.Created}`));',
  'const now = rows(), keys = new Set([...r.knownProcesses.map(p => `${p.ProcessId}:${p.Created}`),\n' +
  '        ...r.cleanups.flatMap(c => c.killed), ...r.launches.map(l => `${l.backend.ProcessId}:${l.backend.Created}`)]);');
new vm.Script(Module.wrap(source), { filename: __filename });
if (process.argv.includes("--self-test")) {
  let replay = fs.readFileSync(previous, "utf8");
  for (const c of changes) { assert.equal(replay.split(c.before).length - 1, 1); replay = replay.replace(c.before, c.after); }
  assert.equal(replay, source);
  assert(source.includes('assert.equal(report.groups.length, 6)'));
  assert(source.includes('const mutations = ['));
  assert(source.includes('new DatabaseSync'));
  console.log(JSON.stringify({ status: "PASS", adaptations: changes.length, scope: "READ_ONLY_AUDIT_BINDING" }));
} else {
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker.qaSource = source; worker.qaChanges = changes; worker._compile(source, __filename);
}
