"use strict";
// Reuse original five audit groups against exact new artifacts; original reports
// and native behavior checks remain unchanged.
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const vm = require("node:vm"), assert = require("node:assert/strict");
const { receipt } = require("./current-control-closure.cjs");
const { qa } = require("./current-preview-closure.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const originalFile = path.join(__dirname, "installed-preview-current-audit.cjs");
function build(original) {
  let source = original; const edits = [];
  function change(before, after, count = 1) {
    assert.equal(source.split(before).length - 1, count, before);
    source = source.replaceAll(before, () => after); edits.push({ before, after, count });
  }
  change('const qa = "F:/AgentVN/QA/Runtime-Dialog-Release-20261021-01";',
    `const qa = ${JSON.stringify(qa)};`);
  change('const installation = read(path.join(qa, "installation.json"));',
    `const installation = read(${JSON.stringify(receipt)});`);
  change('assert.equal(run.version, "1.9.14");', 'assert.equal(run.version, "1.9.35");');
  change('assert.equal(sha(path.join(runRoot, "executed-test.cjs")), sha(path.resolve(__dirname, "installed-preview-current.cjs")));',
    'assert.equal(sha(run.qaBinding.path), run.qaBinding.sha256);\n' +
    '    const binding = read(run.qaBinding.path);\n' +
    '    assert.equal(sha(binding.executed.path), binding.executed.sha256);\n' +
    '    assert.equal(sha(binding.adapter.path), binding.adapter.sha256);\n' +
    '    assert.equal(sha(binding.original.path), binding.original.sha256);\n' +
    '    assert.equal(sha(path.join(runRoot, "executed-test.cjs")), binding.original.sha256);\n' +
    '    assert.equal(run.builds, 0); assert.equal(run.productChanges, 0);');
  change("s.before.width * s.before.dpr", "Math.round(s.before.width * s.before.dpr)", 2);
  change("s.before.height * s.before.dpr", "Math.round(s.before.height * s.before.dpr)", 2);
  new vm.Script(Module.wrap(source)); return { source, edits };
}
function main(mode) {
  const original = fs.readFileSync(originalFile, "utf8"), result = build(original);
  if (mode === "self-test") {
    let reversed = result.source;
    for (const e of [...result.edits].reverse()) reversed = reversed.replaceAll(e.after, () => e.before);
    assert.equal(reversed, original); assert.throws(() => build(""));
    return console.log(JSON.stringify({ status: "PASS", reversibleAudit: true, productStarts: 0 }));
  }
  assert.equal(mode, "run");
  assert(!fs.existsSync(path.join(qa, "audit-binding.json")));
  const file = path.join(qa, "executed-audit.cjs");
  fs.writeFileSync(file, result.source, { flag: "wx" });
  const desc = p => ({ path: path.resolve(p), sha256: sha(p) });
  fs.writeFileSync(path.join(qa, "audit-binding.json"), JSON.stringify({
    original: desc(originalFile), executed: desc(file), adapter: desc(__filename), edits: result.edits,
    modelRequests: 0, builds: 0, productChanges: 0,
  }, null, 2), { flag: "wx" });
  process.argv = [process.execPath, originalFile, "35", "01"];
  const worker = new Module(originalFile, module);
  Object.assign(worker, { filename: originalFile, paths: Module._nodeModulePaths(__dirname) });
  worker._compile(result.source, originalFile);
}
if (require.main === module) main(process.argv[2]);
