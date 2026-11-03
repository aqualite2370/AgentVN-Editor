"use strict";
// Actual frozen packaged backend. Control only loopback model HTTP; task APIs
// and database/persistence remain real. Never call a paid provider.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const { receipt } = require("./current-novel-task-closure.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const originalFile = path.join(__dirname, "installed-novel-default-current.cjs");
const qa = "F:/AgentVN/QA/Novel-Backend-1.9.35-20261102-01";
const checkpoint = "F:/AgentVN/Checkpoints/Current-Novel-Backend-20261102-01";
function build(original) {
  let source = original; const edits = [];
  function change(before, after, count = 1) {
    assert.equal(source.split(before).length - 1, count, before);
    source = source.replaceAll(before, () => after); edits.push({ before, after, count });
  }
  change('index: desc(path.join(root, ".git/index"))',
    'index: desc(path.resolve(root, spawnSync("git", ["rev-parse", "--git-path", "index"],\n' +
    '    { cwd: root, encoding: "utf8", windowsHide: true }).stdout.trim()))');
  change('page.locator(".recent-project-open:not(:disabled):visible")',
    'page.locator("[data-help-key=\'home.recentProject\']:not(:disabled):visible")');
  change('desc(path.join(root, "plans/FULL_REGRESSION_20261017.md"))',
    'desc(path.join(root, "AGENTS.md"))');
  change('const report = { status: "RUNNING", version:',
    'const report = { qaBinding: module.qaBinding, status: "RUNNING", version:');
  change('if (require.main === module) run(process.argv[2]).catch',
    'run(process.argv[2]).catch');
  new vm.Script(Module.wrap(source)); return { source, edits };
}
function main(mode, attempt = "01", portMode = "dynamic") {
  const actual = descriptor(), result = build(fs.readFileSync(originalFile, "utf8"));
  if (mode === "self-test") {
    assert.throws(() => build(""));
    assert.equal(actual.executable.sha256, JSON.parse(fs.readFileSync(receipt)).executable.sha256);
    console.log(JSON.stringify({ status: "PASS", modelBoundary: "Loopback HTTP only",
      taskRoutesMocked: false, productStarts: 0, realModelRequests: 0 })); return;
  }
  assert.equal(mode, "run"); assert.match(attempt, /^\d{2}$/); assert(["dynamic", "default"].includes(portMode));
  fs.mkdirSync(qa, { recursive: true }); fs.mkdirSync(checkpoint, { recursive: true });
  const binding = path.join(qa, "binding-" + attempt); assert(!fs.existsSync(binding)); fs.mkdirSync(binding);
  const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
  fs.writeFileSync(path.join(binding, "executed.cjs"), result.source, { flag: "wx" });
  fs.copyFileSync(__filename, path.join(binding, "adapter.cjs"), fs.constants.COPYFILE_EXCL);
  const bindingFile = path.join(binding, "binding.json");
  fs.writeFileSync(bindingFile, JSON.stringify({ original: desc(originalFile),
    executed: desc(path.join(binding, "executed.cjs")), adapter: desc(__filename),
    edits: result.edits, installation: desc(receipt), portMode, productChanges: 0, builds: 0,
    paidRequests: 0 }, null, 2), { flag: "wx" });
  process.argv = [process.execPath, originalFile, attempt, "--candidate=1.9.35",
    "--qa-root=" + qa, "--checkpoint-root=" + checkpoint, "--installation-file=" + receipt,
    ...(portMode === "default" ? ["--default-port"] : [])];
  const worker = new Module(originalFile, module);
  Object.assign(worker, { filename: originalFile, paths: Module._nodeModulePaths(__dirname), qaBinding: desc(bindingFile) });
  worker._compile(result.source, originalFile);
}
if (require.main === module) main(...process.argv.slice(2));
module.exports = { build, qa, checkpoint };
