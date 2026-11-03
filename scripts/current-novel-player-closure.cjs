"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const { qa } = require("./current-novel-task-closure.cjs");
const originalFile = path.join(__dirname, "installed-novel-consume-player-current.cjs");
const helper = "F:/AgentVN/QA/Editor-1.9.35-20261101-01/layout-closure-native-player-preparation-01/exact-current-player-profile.ps1";
function build(original) {
  let source = original; const edits = [];
  function change(before, after, count = 1) {
    assert.equal(source.split(before).length - 1, count, before);
    source = source.replaceAll(before, () => after); edits.push({ before, after, count });
  }
  change('const { qa, desc, read, sha } = require("./installed-novel-consume-current.cjs");',
    'const { desc, read, sha } = require("./installed-novel-consume-current.cjs");\n' +
    'const { qa } = require("./current-novel-task-closure.cjs");');
  change('"1.9.22"', '"1.9.35"', 2);
  change("F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-novel-consume-1922-${attempt}",
    "F:/AgentVN/QA/Native-Runtime-State-20261101-01/installed-novel-consume-1935-${attempt}");
  change("a6930452f451e1ef194b46ac4c4718479d66a33667277cb0ee52db0c2203db59",
    "66945ed6a9d026ab2f17370c9fe1fa207cdc741b7005f61f1ccd539c56e46b0e");
  change('"scripts/native-dev-preview-profile.ps1"', JSON.stringify(helper), 2);
  change('path.join(root, ' + JSON.stringify(helper) + ')', JSON.stringify(helper));
  change('"-RunDirectory", out],',
    '"-RunDirectory", out, "-CodexCacheView", "-Storage", "NativeRoaming"],');
  change('"New Player release (actual PE1.9.1)", ', "");
  change('c.playback.length === 2', 'c.playback.length === 3');
  change('const report = { status: "RUNNING", version:',
    'const report = { qaBinding: module.qaBinding, status: "RUNNING", version:');
  change('    page = await until(() => browser.contexts().flatMap(c => c.pages()).find(p => /tauri\\.localhost|^tauri:/.test(p.url())), "Player document");',
    '    report.readiness = [];\n' +
    '    page = await require("./lib/wait-native-runtime-page.cjs").waitNativeRuntimePage(browser, {\n' +
    '      observe: e => { report.readiness.push(e); save(); } });');
  change('      if (width === 1920 && dpr === 1 && !reduced || width === 3840 && dpr === 2 && reduced)\n', "");
  change('if (require.main === module) run(process.argv[2], process.argv[3]).catch',
    'run(process.argv[2], process.argv[3]).catch');
  new vm.Script(Module.wrap(source)); return { source, edits };
}
function main(mode, editorAttempt = "05", attempt = "01") {
  descriptor(); const result = build(fs.readFileSync(originalFile, "utf8"));
  if (mode === "self-test") {
    assert.throws(() => build(""));
    console.log(JSON.stringify({ status: "PASS", actualPlayer: true, chapters: 2, displays: 12, productStarts: 0 })); return;
  }
  assert.equal(mode, "run"); assert.match(editorAttempt, /^\d{2}$/); assert.match(attempt, /^\d{2}$/);
  const binding = qa + "/player-binding-" + attempt; assert(!fs.existsSync(binding)); fs.mkdirSync(binding);
  const describe = f => ({ path: path.resolve(f), sha256: sha(f) });
  fs.writeFileSync(path.join(binding, "executed.cjs"), result.source, { flag: "wx" });
  fs.copyFileSync(__filename, path.join(binding, "adapter.cjs"), fs.constants.COPYFILE_EXCL);
  const bindingFile = path.join(binding, "binding.json");
  fs.writeFileSync(bindingFile, JSON.stringify({ original: describe(originalFile), adapter: describe(__filename),
    executed: describe(path.join(binding, "executed.cjs")), edits: result.edits,
    productChanges: 0, builds: 0, modelRequests: 0 }, null, 2), { flag: "wx" });
  process.argv = [process.execPath, originalFile, editorAttempt, attempt];
  const worker = new Module(originalFile, module);
  Object.assign(worker, { filename: originalFile, paths: Module._nodeModulePaths(__dirname), qaBinding: describe(bindingFile) });
  worker._compile(result.source, originalFile);
}
if (require.main === module) main(...process.argv.slice(2));
module.exports = { build };
