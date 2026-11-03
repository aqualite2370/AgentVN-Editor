"use strict";
// Use the real packaged-backend result, not a seeded task-API result.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { qa } = require("./current-novel-backend-closure.cjs");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const files = { author: "installed-novel-consume-current.cjs", player: "installed-novel-consume-player-current.cjs",
  audit: "installed-novel-consume-current-audit.cjs" };
const backendFile = qa + "/session-02/report.json";
const auditFile = qa + "/audit-01/report.json";
const playerRoot = "F:/AgentVN/QA/Native-Runtime-State-20261101-01/installed-novel-backend-1935-01";
function build(mode, original) {
  let result;
  if (mode === "author") result = require("./current-novel-consume-closure.cjs").build(original);
  else if (mode === "player") result = require("./current-novel-player-closure.cjs").build(original);
  else { assert.equal(mode, "audit"); result = { source: original, edits: [] }; }
  let source = result.source; const edits = [...result.edits];
  function change(before, after, count = 1) {
    assert.equal(source.split(before).length - 1, count, before);
    source = source.replaceAll(before, () => after); edits.push({ before, after, count });
  }
  if (mode === "author") {
    change('const qa = "F:/AgentVN/QA/Novel-Task-1.9.35-20261102-01";', `const qa = ${JSON.stringify(qa)};`);
    const start = source.indexOf('  const sourceFile = "F:/AgentVN/QA/Novel-Task-1.9.35-20261102-01/session-01/report.json"');
    const end = source.indexOf("  const installation = read(installationFile);", start);
    assert(start > 0 && end > start);
    change(source.slice(start, end), `  const sourceFile = ${JSON.stringify(backendFile)}, source = read(sourceFile);
  const auditFile = ${JSON.stringify(auditFile)}, audit = read(auditFile);
  assert.equal(source.status, "PASS"); assert.equal(source.version, "1.9.35");
  assert.equal(audit.status, "PASS"); assert.equal(audit.featureStatus, "PASS");
  assert.equal(audit.source.sha256, sha(sourceFile)); assert.equal(source.modelRequests, 13);
  assert.equal(source.realModelRequests, 0); assert.equal(source.cases.length, 4);
  assert(source.cases.every(c => c.status === "PASS")); assert.equal(source.bundles.length, 1);
  const input = source.bundles[0]; assert.equal(sha(input.path), input.sha256);
  const inputZip = await JSZip.loadAsync(fs.readFileSync(input.path), { checkCRC32: true });
  const project = JSON.parse(await inputZip.file("project.json").async("string"));
  assert.equal(project.project_id, source.restored.project.project_id);
  assert.deepEqual(graphContent(project), graphContent(source.restored.project));
  const novelNodes = project.nodes.filter(n => n.data.editorMeta?.importSessionId === source.completed.session.session_id);
  assert.equal(novelNodes.length, 1); assert.equal(novelNodes[0].data.editorMeta.graphImportMode, "append_isolated");
  assert(!project.edges.some(e => e.source === "scene"));
`);
    change('"Two controlled task HTTP chapters; no real backend generation or DeepSeek quality"',
      '"Real packaged backend with13 loopback model calls in source run; no real DeepSeek quality or new calls"');
    change("native-reopen-and-real-handle-gesture-connects-two-chapters-without-changing-content",
      "native-reopen-and-real-handle-gesture-connects-generated-chapter-without-changing-content");
    change('assert.equal(report.exported.playback.length, 3);', 'assert.equal(report.exported.playback.length, 2);');
  } else if (mode === "player") {
    change('const { qa } = require("./current-novel-task-closure.cjs");', `const qa = ${JSON.stringify(qa)};`);
    change('F:/AgentVN/QA/Native-Runtime-State-20261101-01/installed-novel-consume-1935-${attempt}',
      'F:/AgentVN/QA/Native-Runtime-State-20261101-01/installed-novel-backend-1935-${attempt}');
    change('c.playback.length === 3', 'c.playback.length === 2');
  } else {
    change('const { qa, desc, read, sha, persistenceContent } = require("./installed-novel-consume-current.cjs");',
      'const { desc, read, sha, persistenceContent } = require("./installed-novel-consume-current.cjs");\n' +
      `const qa = ${JSON.stringify(qa)};`);
    change('"1.9.22"', '"1.9.35"', 2);
    change('F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-novel-consume-1922-${playerId}',
      'F:/AgentVN/QA/Native-Runtime-State-20261101-01/installed-novel-backend-1935-${playerId}');
    change("a6930452f451e1ef194b46ac4c4718479d66a33667277cb0ee52db0c2203db59",
      "66945ed6a9d026ab2f17370c9fe1fa207cdc741b7005f61f1ccd539c56e46b0e");
    change('assert(editor.steps[0].inheritedFrom && editor.continuation.originalFailurePreserved);',
      'assert(!editor.continuation && editor.steps.every(s => !s.inheritedFrom));');
    change('      const parent = read(editor.continuation.path);\n      for (const r of [parent, editor, player]) {',
      '      for (const r of [editor, player]) {');
    change('path.dirname(r === parent ? editor.continuation.path :\n          r === editor ? editorFile : playerFile)',
      'path.dirname(r === editor ? editorFile : playerFile)');
    change('parent.screenshots.length + editor.screenshots.length + player.screenshots.length',
      'editor.screenshots.length + player.screenshots.length');
    change('const parent = read(editor.continuation.path), all = [parent, editor, player];',
      'const all = [editor, player];');
    change('for (const r of [parent, editor]) {', 'for (const r of [editor]) {');
    change('for (const id of ["01", "02"]) assert.equal(read(path.join(qa, `session-${id}`, "report.json")).status, "FAILED");',
      `assert.equal(read(${JSON.stringify(auditFile)}).featureStatus, "PASS");`);
    change('dynamicPortNovelAnalysis: "FAILED"', 'dynamicPortNovelAnalysis: "PASS_CONTROLLED_MODEL_SEPARATELY_AUDITED"');
    change('dynamicPortFailureStillFailed: true', 'historicalOtherCandidateFailuresPreserved: true');
    change('if (require.main === module) run(process.argv[2], process.argv[3], process.argv[4]);',
      'run(process.argv[2], process.argv[3], process.argv[4]);');
    change('const report = { status: "RUNNING", startedAt:',
      'const report = { qaBinding: module.qaBinding, status: "RUNNING", startedAt:');
  }
  new vm.Script(Module.wrap(source)); return { source, edits };
}
function main(mode) {
  descriptor();
  if (mode === "self-test") {
    for (const [kind, name] of Object.entries(files)) {
      build(kind, fs.readFileSync(path.join(__dirname, name), "utf8"));
      assert.throws(() => build(kind, ""));
    }
    console.log(JSON.stringify({ status: "PASS", adapters: 3, emptySourceRejected: true, productStarts: 0 })); return;
  }
  assert(Object.hasOwn(files, mode));
  const originalFile = path.join(__dirname, files[mode]), result = build(mode, fs.readFileSync(originalFile, "utf8"));
  const binding = qa + "/consume-" + mode + "-binding-01"; assert(!fs.existsSync(binding)); fs.mkdirSync(binding);
  const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
  fs.writeFileSync(path.join(binding, "executed.cjs"), result.source, { flag: "wx" });
  fs.copyFileSync(__filename, path.join(binding, "adapter.cjs"), fs.constants.COPYFILE_EXCL);
  const bindingFile = path.join(binding, "binding.json");
  fs.writeFileSync(bindingFile, JSON.stringify({ original: desc(originalFile), adapter: desc(__filename),
    executed: desc(path.join(binding, "executed.cjs")), source: desc(backendFile), priorAudit: desc(auditFile),
    edits: result.edits, productChanges: 0, builds: 0, paidRequests: 0 }, null, 2), { flag: "wx" });
  process.env.AGENTVN_INSTALLED_GUI_QA_ROOT = path.resolve(qa);
  process.argv = [process.execPath, originalFile, ...(mode === "author" ? ["03"] :
    mode === "player" ? ["03", "01"] : ["03", "01", "01"])];
  const worker = new Module(originalFile, module);
  Object.assign(worker, { filename: originalFile, paths: Module._nodeModulePaths(__dirname), qaBinding: desc(bindingFile) });
  worker._compile(result.source, originalFile);
}
if (require.main === module) main(process.argv[2]);
module.exports = { build, qa, backendFile, auditFile, playerRoot };
