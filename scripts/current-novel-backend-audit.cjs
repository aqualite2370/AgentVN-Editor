"use strict";
// Read-only binding of the independent fresh-pipeline audit.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { qa } = require("./current-novel-backend-closure.cjs");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const originalFile = path.join(__dirname, "candidate-1924-novel-audit.cjs");
function build(original) {
  let source = original; const edits = [];
  function change(before, after, count = 1) {
    assert.equal(source.split(before).length - 1, count, before);
    source = source.replaceAll(before, () => after); edits.push({ before, after, count });
  }
  change('const qa = "F:/AgentVN/QA/Installed-Novel-Default-1922-20261022-01";',
    `const qa = ${JSON.stringify(qa)};`);
  change('"1.9.24"', '"1.9.35"', 2);
  change('assert.equal(attempt, "07");', 'assert.equal(attempt, "02");');
  change('const out = "F:/AgentVN/QA/Editor-1.9.24-20261024-01/novel-audit-01";',
    `const out = ${JSON.stringify(qa + "/audit-01")};`);
  change("ef457f369303302d488e30d105295e9b40a0161cf79d7e996383958429e1a143",
    "a1ece0a5d69cc0c319fd5d8fe6a9cdca8259f88fd7eeaeae1cc18e88c4fb5dd8");
  change('return { version: i.executable.version, rawStatus: r.status };',
    'assert.equal(sha(r.qaBinding.path), r.qaBinding.sha256);\n' +
    '    return { version: i.version, rawStatus: r.status };');
  change('      validate(r);',
    '      validate(r); assert.equal(r.providerCleanup.stopped, true);\n' +
    '      assert.equal(r.providerCleanup.requests, 13); assert.equal(r.blockedModelRequests, 0);');
  change('const report = { status: "RUNNING", featureStatus:',
    'const report = { qaBinding: module.qaBinding, status: "RUNNING", featureStatus:');
  new vm.Script(Module.wrap(source)); return { source, edits };
}
function main(mode) {
  descriptor(); const result = build(fs.readFileSync(originalFile, "utf8"));
  if (mode === "self-test") {
    assert.throws(() => build(""));
    console.log(JSON.stringify({ status: "PASS", auditOnly: true, productStarts: 0 })); return;
  }
  assert.equal(mode, "run"); const binding = qa + "/audit-binding-01";
  assert(!fs.existsSync(binding)); fs.mkdirSync(binding);
  const desc = f => ({ path: path.resolve(f), sha256: sha(f) });
  fs.writeFileSync(path.join(binding, "executed.cjs"), result.source, { flag: "wx" });
  fs.copyFileSync(__filename, path.join(binding, "adapter.cjs"), fs.constants.COPYFILE_EXCL);
  const bindingFile = path.join(binding, "binding.json");
  fs.writeFileSync(bindingFile, JSON.stringify({ original: desc(originalFile),
    executed: desc(path.join(binding, "executed.cjs")), edits: result.edits,
    productStarts: 0, modelRequests: 0 }, null, 2), { flag: "wx" });
  process.argv = [process.execPath, originalFile, "02"];
  const worker = new Module(originalFile, module);
  Object.assign(worker, { filename: originalFile, paths: Module._nodeModulePaths(__dirname), qaBinding: desc(bindingFile) });
  worker._compile(result.source, originalFile);
}
if (require.main === module) main(process.argv[2]);
module.exports = { build };
