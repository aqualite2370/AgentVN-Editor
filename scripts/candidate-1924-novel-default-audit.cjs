"use strict";
// Same fresh-flow audit, explicitly scoped to a default-port comparison.
// It does not turn the dynamic-port session-07 product failure into a pass.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const previous = path.join(__dirname, "candidate-1924-novel-audit.cjs");
assert.equal(sha(previous), "2a3302d3ec63404c44d446171abdf93bd8f54e738c7dbafe253bbd75271ef525");
const original = fs.readFileSync(previous, "utf8"); let source = original; const changes = [];
function replace(before, after) {
  assert.equal(source.split(before).length - 1, 1, before);
  source = source.replace(before, after); changes.push({ before, after });
}
replace('assert.equal(r.backendPortMode, "OWNED_DYNAMIC_PORT");',
  'assert.equal(r.backendPortMode, "EXPLICIT_8278_DIFFERENTIAL_NOT_PRODUCT_FIX");\n' +
  '  assert(r.launches.every(l => l.ports[0] === 8278));');
replace('assert.equal(attempt, "07");', 'assert.equal(attempt, "08");');
replace('Editor-1.9.24-20261024-01/novel-audit-01', 'Editor-1.9.24-20261024-01/novel-default-audit-01');
replace('scope: "FRESH_INSTALLED_NOVEL_EVIDENCE_AUDIT_NOT_REAL_MODEL_OR_FULL_ACCEPTANCE"',
  'scope: "DEFAULT_PORT_FRESH_INSTALLED_NOVEL_NOT_DYNAMIC_PORT_FIX_OR_REAL_MODEL"');
replace('  report.status = "PASS";',
  '  const failure = read(path.join(qa, "session-07/report.json"));\n' +
  '  assert.equal(failure.status, "FAILED"); assert.equal(failure.modelRequests, 0);\n' +
  '  assert(failure.network.some(n => n.url === "http://127.0.0.1:8278/openapi.json"));\n' +
  '  report.dynamicPortFailurePreserved = desc(path.join(qa, "session-07/report.json"));\n' +
  '  report.fullNovelFeatureStatus = "FAILED";\n' +
  '  report.status = "PASS";');
new vm.Script(Module.wrap(source), { filename: __filename });
if (process.argv[2] === "--self-test") {
  let replay = original;
  for (const c of changes) { assert.equal(replay.split(c.before).length - 1, 1); replay = replay.replace(c.before, c.after); }
  assert.equal(replay, source);
  console.log(JSON.stringify({ status: "PASS", adaptations: changes.length, scope: "READ_ONLY_COMPARISON_BINDING" }));
} else {
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker._compile(source, __filename);
}
