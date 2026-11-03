"use strict";
// Consume the exact native-saved batch-review project in a fresh installed host.
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const vm = require("node:vm"), assert = require("node:assert/strict");
const { receipt } = require("./current-novel-task-closure.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { qa } = require("./current-assistant-batch-review.cjs");
const originalFile = path.join(__dirname, "installed-assistant-export-current.cjs");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
function build(original) {
  let source = original; const edits = [];
  function change(before, after, count = 1) {
    assert.equal(source.split(before).length - 1, count, before);
    source = source.replaceAll(before, () => after); edits.push({ before, after, count });
  }
  function region(start, end, replacement) {
    const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
    assert(a > 0 && b > a); change(source.slice(a, b), replacement);
  }
  region("const currentCandidate = process.argv.includes", "const read = f =>",
    `const currentCandidate = true, expectedVersion = "1.9.35";
const root = path.resolve(__dirname, ".."), qa = ${JSON.stringify(qa)}, previous = qa;
const installationFile = ${JSON.stringify(receipt)};
const out = path.join(qa, "session-02"); assert(!fs.existsSync(out)); fs.mkdirSync(out);
`);
  region("const audit = read(path.join(previous", "assert.equal(source.version, expectedVersion);",
    `assert.equal(source.status, "PASS"); assert.equal(source.cases.length, 4);
assert(source.cases.every(c => c.status === "PASS")); assert.equal(source.matrix.length, 12);
assert(source.cleanups.length === 2 && source.cleanups.every(c => c.status === "PASS"));
assert.equal(source.cacheRestoration, "PASS"); assert.equal(source.realModelRequests, 0);
assert.equal(source.credentialCleanup, "CLEARED_TEST_ONLY_SECRET");
for (const f of [...source.products, ...source.sources, ...source.tools]) assert.equal(sha(f.path), f.sha256);
`);
  change('scope: "ACTUAL_NSIS_INSTALLED_PORTABLE_REIMPORT_REAL_UI_CARTRIDGE_EXPORT_NO_MODEL",',
    'scope: "ACTUAL_1935_INSTALLED_BATCH_PORTABLE_REIMPORT_UI_EXPORT_NO_MODEL", qaBinding: module.qaBinding,');
  change('...(currentCandidate ? ["-CodexCacheView"] : [])',
    '...["-CodexCacheView", "-AllowedRunRoot", qa]');
  change('.recent-project-open:not(:disabled):visible', "[data-help-key='home.recentProject']:not(:disabled):visible");
  change("    assert.deepEqual(layout, project.editor_settings.runtimeUILayout);",
    `    report.ignoredBuiltinLegacyStyles = require("./lib/assistant-export-layout.cjs")
      .assertAssistantExportLayout(layout, project.editor_settings.runtimeUILayout);`);
  new vm.Script(Module.wrap(source)); return { source, edits };
}
function main(mode) {
  assert(["self-test", "run"].includes(mode));
  const result = build(fs.readFileSync(originalFile, "utf8"));
  if (mode === "self-test") {
    let replay = fs.readFileSync(originalFile, "utf8");
    for (const e of result.edits) {
      assert.equal(replay.split(e.before).length - 1, e.count);
      replay = replay.replaceAll(e.before, () => e.after);
    }
    assert(replay === result.source); assert.throws(() => build(""));
    console.log(JSON.stringify({ status: "PASS", adaptations: result.edits.length, starts: 0 })); return;
  }
  const bindingFile = path.join(qa, "export-binding.json"); assert(!fs.existsSync(bindingFile));
  const executed = path.join(qa, "export-executed.cjs"); assert(!fs.existsSync(executed));
  fs.writeFileSync(executed, result.source, { flag: "wx" });
  fs.writeFileSync(bindingFile, JSON.stringify({ original: desc(originalFile), adapter: desc(__filename),
    executed: desc(executed), inputReport: desc(path.join(qa, "session-01/report.json")),
    installation: desc(receipt), edits: result.edits }, null, 2), { flag: "wx" });
  const worker = new Module(originalFile, module);
  Object.assign(worker, { filename: originalFile, paths: Module._nodeModulePaths(__dirname), qaBinding: desc(bindingFile) });
  worker._compile(result.source, originalFile);
}
if (require.main === module) main(process.argv[2]);
module.exports = { qa };
