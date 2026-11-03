"use strict";
// Preserve the historical author/export checks; bind to this run's native
// package and exact installed binaries. No generation or product changes.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { qa, receipt } = require("./current-novel-task-closure.cjs");
const originalFile = path.join(__dirname, "installed-novel-consume-current.cjs");
const sourceFile = qa + "/session-01/report.json";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
function build(original) {
  let source = original; const edits = [];
  function change(before, after, count = 1) {
    assert.equal(source.split(before).length - 1, count, before);
    source = source.replaceAll(before, () => after); edits.push({ before, after, count });
  }
  change('const qa = "F:/AgentVN/QA/Installed-Novel-Default-1922-20261022-01";',
    `const qa = ${JSON.stringify(qa)};`);
  change('const installationFile = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json";',
    `const installationFile = ${JSON.stringify(receipt)};`);
  const start = source.indexOf('  const sourceFile = path.join(qa, "session-04/report.json")');
  const end = source.indexOf("  const installation = read(installationFile);", start);
  assert(start > 0 && end > start);
  change(source.slice(start, end), `  const sourceFile = ${JSON.stringify(sourceFile)}, source = read(sourceFile);
  const auditFile = sourceFile, audit = source;
  assert.equal(source.status, "PASS"); assert.equal(source.version, "1.9.35");
  assert.equal(source.cases.length, 9); assert.equal(source.matrix.length, 12);
  assert(source.cases.every(c => c.status === "PASS")); assert(!source.cleanupError && !source.cacheRestoreError);
  const saved = source.cases.at(-1); assert.equal(saved.exportedFiles.length, 1);
  const input = desc(path.join(saved.exportDirectory, saved.exportedFiles[0]));
  const inputZip = await JSZip.loadAsync(fs.readFileSync(input.path), { checkCRC32: true });
  const project = JSON.parse(await inputZip.file("project.json").async("string"));
  assert.equal(project.project_id, "installed_novel_session-01_a");
  const novelNodes = project.nodes.filter(n => n.data.editorMeta?.sourceProcessJobId === "installed-floating-a")
    .sort((a, b) => a.data.editorMeta.sourceProcessChapterIndex - b.data.editorMeta.sourceProcessChapterIndex);
  assert.deepEqual(novelNodes, source.importedNodes); assert.equal(novelNodes.length, 2);
  assert(novelNodes.every(n => n.data.editorMeta.graphImportMode === "append_isolated"));
  assert(!project.edges.some(e => e.source === "scene"));
`);
  change('"1.9.22"', '"1.9.35"', 2);
  change("189222471fe1bb83a57b40f9559b2321a8080d66a9ea3548b2692f94d3dee4dc",
    "a1ece0a5d69cc0c319fd5d8fe6a9cdca8259f88fd7eeaeae1cc18e88c4fb5dd8");
  change('function persistenceContent(actual, expected) {\n',
    'function persistenceContent(actual, expected) {\n  if (actual === undefined || expected === undefined) { assert.equal(actual, expected); return []; }\n');
  change('    boundaries: ["Public API reimport, not native picker",',
    '    boundaries: ["Actual Windows UI Automation native picker, not Computer Use",');
  change('"Existing loopback-generated 44-character sample; no real DeepSeek quality"',
    '"Two controlled task HTTP chapters; no real backend generation or DeepSeek quality"');
  change('    knownProductFailures: ["NOVEL-BACKEND-PORT-01 remains FAILED; no analysis request is made here"]',
    '    knownProductFailures: ["Historical novel-generation branch-target failure remains FAILED; no model task here"]');
  change('    protectedFiles: source.protectedFiles,',
    '    protectedFiles: source.protectedFiles || [],');
  change('page.locator(".recent-project-open:not(:disabled):visible")',
    'page.locator("[data-help-key=\'home.recentProject\']:not(:disabled):visible")');
  const apiStart = source.indexOf('      const r = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`');
  const apiEnd = source.indexOf('      await page.evaluate(({ id, out })', apiStart);
  assert(apiStart > 0 && apiEnd > apiStart);
  change(source.slice(apiStart, apiEnd), `      const trigger = page.getByLabel("创建或打开项目").getByRole("button", { name: "导入项目", exact: true });
      report.nativePicker = await require("./current-control-closure.cjs").nativePick({
        page, trigger, out, ownerPid: host.current.pid, selectedPath: input.path });
      await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
`);
  change("public-reimport-and-real-handle-gesture-connects-existing-novel-without-changing-content",
    "native-reopen-and-real-handle-gesture-connects-two-chapters-without-changing-content");
  change('      assert.equal(report.exported.playback.length, 2);',
    '      assert.equal(report.exported.playback.length, 3);');
  change('        const old = project.asset_manifest.find(b => b.asset_id === a.id); assert(old);\n' +
    '        assert.equal(a.sha256, hash(await inputZip.file(old.metadata.project_path).async("nodebuffer")));',
    '        const old = project.asset_manifest.find(b => b.asset_id === a.id);\n' +
    '        if (old) assert.equal(a.sha256, hash(await inputZip.file(old.metadata.project_path).async("nodebuffer")));\n' +
    '        else { assert.equal(a.id, "agentvn_placeholder_background"); (report.generatedPlaceholders ??= []).push(a); }');
  change('    "scripts/lib/current-native-capture.cjs", "scripts/installed-layout-cache-session.ps1"]',
    '    "scripts/lib/current-native-capture.cjs", "scripts/installed-layout-cache-session.ps1",\n' +
    '    "scripts/current-control-closure.cjs", "scripts/gui-directory-picker-uia.ps1"]');
  change('"-RunDirectory", out, "-CodexCacheView"],',
    '"-RunDirectory", out, "-CodexCacheView", "-AllowedRunRoot", qa],');
  change('const report = { status: "RUNNING", version:', 'const report = { qaBinding: module.qaBinding, status: "RUNNING", version:');
  change('if (require.main === module) run(process.argv[2]).catch',
    'run(process.argv[2]).catch');
  new vm.Script(Module.wrap(source)); return { source, edits };
}
function main(mode, attempt = "02") {
  descriptor(); const result = build(fs.readFileSync(originalFile, "utf8"));
  if (mode === "self-test") {
    assert.throws(() => build("")); assert(!result.source.includes('/api/project/projects/import`'));
    console.log(JSON.stringify({ status: "PASS", nativePicker: true, chapters: 2, productStarts: 0 })); return;
  }
  assert.equal(mode, "run"); assert.match(attempt, /^\d{2}$/);
  const binding = qa + "/consume-binding-" + attempt; assert(!fs.existsSync(binding)); fs.mkdirSync(binding);
  const executed = path.join(binding, "executed.cjs");
  fs.writeFileSync(executed, result.source, { flag: "wx" });
  fs.copyFileSync(__filename, path.join(binding, "adapter.cjs"), fs.constants.COPYFILE_EXCL);
  const bindingFile = path.join(binding, "binding.json");
  fs.writeFileSync(bindingFile, JSON.stringify({ original: desc(originalFile), adapter: desc(__filename),
    executed: desc(executed), edits: result.edits, taskSource: desc(sourceFile),
    productChanges: 0, builds: 0, modelRequests: 0 }, null, 2), { flag: "wx" });
  process.env.AGENTVN_INSTALLED_GUI_QA_ROOT = path.resolve(qa);
  process.argv = [process.execPath, originalFile, attempt];
  const worker = new Module(originalFile, module);
  Object.assign(worker, { filename: originalFile, paths: Module._nodeModulePaths(__dirname), qaBinding: desc(bindingFile) });
  worker._compile(result.source, originalFile);
}
if (require.main === module) main(process.argv[2], process.argv[3]);
module.exports = { build };
