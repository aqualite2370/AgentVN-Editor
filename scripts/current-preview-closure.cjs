"use strict";
// Preserve the five existing external/native-node preview behavior groups.
// Adapt only exact installation, independent QA paths and current UI selectors.
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const vm = require("node:vm"), assert = require("node:assert/strict");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const { receipt } = require("./current-control-closure.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const originalFile = path.join(__dirname, "installed-preview-current.cjs");
const qa = "F:/AgentVN/QA/Preview-1.9.35-20261102-01";
const checkpoint = "F:/AgentVN/Checkpoints/Current-Preview-20261102-01";
const describe = p => ({ path: path.resolve(p), sha256: sha(p), bytes: fs.statSync(p).size });
function build(original) {
  let source = original; const edits = [];
  function change(before, after, count = 1) {
    assert.equal(source.split(before).length - 1, count, before);
    source = source.replaceAll(before, () => after); edits.push({ before, after, count });
  }
  change("1.9.14", "1.9.35", 2);
  change('const installation = read(path.join(qa, "installation.json"));',
    `const installation = read(${JSON.stringify(receipt)});`);
  change('assert.equal(installation.executable.version, report.version);',
    'assert.equal(installation.version, report.version);');
  change('assert.equal(path.dirname(path.resolve(exe)), path.resolve(qa, "installed-editor"));',
    'assert.equal(path.dirname(path.resolve(exe)), path.resolve(installation.installRoot));');
  change('const protectedFiles = [...read(path.join(qa, "checkpoint-01/report.json")).frozen,\n' +
    '  ...installation.resources, installation.executable, desc(path.join(root, "AgentVN Dev.exe"))];',
    'const protectedFiles = [...installation.resources, installation.executable];\n' +
    'report.qaBinding = module.qaBinding; report.builds = 0; report.productChanges = 0;');
  change('installationFile: path.join(qa, "installation.json")', `installationFile: ${JSON.stringify(receipt)}`);
  change('project.title = "1.9.35安装版真实预览";',
    'project.title = "1.9.35当前冻结安装版真实预览";');
  new vm.Script(Module.wrap(source)); return { source, edits };
}
function main(mode) {
  const installed = descriptor();
  const original = fs.readFileSync(originalFile, "utf8"), result = build(original);
  if (mode === "self-test") {
    let reversed = result.source;
    for (const e of [...result.edits].reverse()) reversed = reversed.replaceAll(e.after, () => e.before);
    assert.equal(reversed, original); assert.throws(() => build(""));
    assert.equal((result.source.match(/await step\("/g) || []).length, 5);
    return console.log(JSON.stringify({ status: "PASS", behaviorGroups: 5,
      reversibleAdapter: true, productStarts: 0, modelRequests: 0 }));
  }
  assert.equal(mode, "run"); assert(!fs.existsSync(qa)); assert(!fs.existsSync(checkpoint));
  fs.mkdirSync(qa, { recursive: true }); fs.mkdirSync(checkpoint, { recursive: true });
  const out = "F:/AgentVN/QA/Native-Dev-Preview-Repair-20261020-02/installed-35";
  assert(!fs.existsSync(out));
  for (const name of [__filename, originalFile, path.join(__dirname, "native-dev-preview-profile.ps1")])
    fs.copyFileSync(name, path.join(checkpoint, path.basename(name)), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(qa, "executed.cjs"), result.source, { flag: "wx" });
  const binding = path.join(qa, "binding.json");
  fs.writeFileSync(binding, JSON.stringify({ original: describe(originalFile),
    adapter: describe(__filename), executed: describe(path.join(qa, "executed.cjs")),
    installation: describe(receipt), products: [installed.executable, ...installed.resources],
    edits: result.edits, out, checkpoint, builds: 0, productChanges: 0, modelRequests: 0,
  }, null, 2), { flag: "wx" });
  process.argv = [process.execPath, originalFile, "35"];
  const worker = new Module(originalFile, module);
  Object.assign(worker, { filename: originalFile, paths: Module._nodeModulePaths(__dirname),
    qaBinding: describe(binding) });
  worker._compile(result.source, originalFile);
}
if (require.main === module) main(process.argv[2]);
module.exports = { build, qa };
