"use strict";
// First attempt stopped before any launch/build because of C-space. Reuse the
// actual installation and authored project in fresh ownership directories.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const input = require.resolve("./android-candidate-1941-continuation.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
function adapter() {
  let source = fs.readFileSync(input, "utf8");
  assert(source.includes("Android-Candidate-1941-20261103-01"));
  source = source.replaceAll("Android-Candidate-1941-20261103-01", "Android-Candidate-1941-20261103-02")
    .replaceAll('"42"', '"43"');
  new vm.Script(Module.wrap(source));
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker._compile(source, __filename); return worker.exports;
}
module.exports = { adapter };
if (require.main === module) Promise.resolve().then(async () => {
  const [mode, number] = process.argv.slice(2);
  if (mode === "prepare") {
    const oldFile = "F:/AgentVN/QA/Android-Package-20261021-01/editor-42/report.json";
    const old = JSON.parse(fs.readFileSync(oldFile, "utf8"));
    assert.equal(old.builds, 0); assert(old.finishedAt); assert.equal(old.launches.length, 0);
    assert.match(old.error, /Insufficient C-space/);
    const result = adapter().prepare();
    const base = "F:/AgentVN/QA/Android-Candidate-1941-20261103-02";
    fs.writeFileSync(path.join(base, "preparation-source.json"), JSON.stringify({
      source: { path: input, sha256: sha(input) }, retry: { path: __filename, sha256: sha(__filename) },
      previous: { path: oldFile, sha256: sha(oldFile) }, priorBuilds: 0, productChanges: 0,
    }, null, 2), { flag: "wx" });
    return result;
  }
  if (mode === "self-test") return adapter().selfTest();
  assert.equal(mode, "audit"); return adapter().audit(number);
}).then(r => { if (r) console.log(JSON.stringify(r)); })
  .catch(e => { console.error(e); process.exitCode = 1; });
