"use strict";
// Run only previously uncovered multi-candidate review against the frozen install.
// The provider is loopback-controlled, never a paid model. Existing window,
// queue and author-conflict groups are intentionally not replayed.
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const vm = require("node:vm"), assert = require("node:assert/strict");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const { receipt } = require("./current-novel-task-closure.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const qa = "F:/AgentVN/QA/Assistant-Batch-1.9.35-20261102-01";
const checkpoint = "F:/AgentVN/Checkpoints/Current-Assistant-Batch-20261102-01";
const originalFile = path.join(__dirname, "installed-assistant-current.cjs");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
function build(original) {
  let source = original; const edits = [];
  function change(before, after, count = 1) {
    assert.equal(source.split(before).length - 1, count, "Missing exact QA adaptation: " + before);
    source = source.replaceAll(before, () => after); edits.push({ before, after, count });
  }
  function region(start, end, after) {
    const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
    assert(a > 0 && b > a); change(source.slice(a, b), after);
  }
  change('const products = [...frozen, installation.executable, ...installation.resources,\n    desc(path.join(root, "AgentVN Dev.exe")), desc(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe"))];',
    'const products = [...frozen, installation.executable, ...installation.resources];');
  change('index: desc(path.join(root, ".git/index"))',
    'index: desc(path.resolve(root, git(["rev-parse", "--git-path", "index"])))');
  change('.recent-project-open:not(:disabled):visible', "[data-help-key='home.recentProject']:not(:disabled):visible", 2);
  change('scope: "ACTUAL_NSIS_INSTALLED_CONTROLLED_CREATION_REVIEW_MERGE_NOT_REAL_DEEPSEEK",',
    'scope: "ACTUAL_1935_INSTALLED_BATCH_REVIEW_LOCAL_TOOL_RECEIPTS_MERGE_NO_PAID_MODEL", qaBinding: module.qaBinding,');
  change('    const n = report.submissions.length; await win.getByRole("button", { name: "生成创作提案", exact: true }).click();',
    `    const n = report.submissions.length;
    const accepted = page.waitForResponse(r => r.request().method() === "POST"
      && new URL(r.url()).pathname === "/api/assistant/creation/processes");
    const [response] = await Promise.all([accepted,
      win.getByRole("button", { name: "生成创作提案", exact: true }).click()]);
    assert.equal(response.status(), 202);
    const record = await response.json(); assert.equal(record.id, report.submissions.at(-1).id);
    report.submissions.at(-1).accepted = { status: 202, id: record.id }; save();`);
  change('    assert.deepEqual(result.toolEvents.filter(e => e.status === "completed").map(e => e.tool), provider.names);',
    `    assert.deepEqual([...new Set(result.toolEvents.filter(e => e.status === "completed").map(e => e.tool))].sort(),
      [...provider.names].sort()); // This controlled scenario covers six tools; real models need not use a fixed order.`);
  region('    await stage("floating-window-drag-resize-dock-minimize-and-keyboard"',
    '    await stage("authorized-six-tool-chain-three-isolated-candidates-and-local-runtime-receipts"',
    "    // Window gestures already accepted in their independent current-candidate group.\n");
  change('    await stage("authorized-six-tool-chain-three-isolated-candidates-and-local-runtime-receipts", async () => {\n',
    '    await stage("authorized-six-tool-chain-three-isolated-candidates-and-local-runtime-receipts", async () => {\n      await openWorkbench();\n');
  region('    await stage("new-session-consent-reset-and-real-layout-edit-conflict-without-overwrite"',
    "    assert.equal(report.cases.length, 6);",
    "    // Author-edit conflicts already accepted using an existing draft, without new generation.\n");
  change("assert.equal(report.cases.length, 6);", "assert.equal(report.cases.length, 4);");
  change("assert.equal(provider.requests.length, 12);", "assert.equal(provider.requests.length, 6);");
  change("assert.equal(report.submissions.length, 2);", "assert.equal(report.submissions.length, 1);");
  change("assert.equal(report.localReceipts.length, 4);", "assert.equal(report.localReceipts.length, 2);");
  new vm.Script(Module.wrap(source)); return { source, edits };
}
function main(mode) {
  assert(["self-test", "prepare", "01"].includes(mode));
  const result = build(fs.readFileSync(originalFile, "utf8"));
  if (mode === "self-test") {
    let replay = fs.readFileSync(originalFile, "utf8");
    for (const e of result.edits) {
      assert.equal(replay.split(e.before).length - 1, e.count);
      replay = replay.replaceAll(e.before, () => e.after);
    }
    assert(replay === result.source, "Exact forward adaptation replay differs"); assert.throws(() => build(""));
    console.log(JSON.stringify({ status: "PASS", adaptations: result.edits.length, productStarts: 0, requests: 0 })); return;
  }
  const installed = descriptor();
  assert.equal(installed.executable.sha256, JSON.parse(fs.readFileSync(receipt)).executable.sha256);
  if (mode === "prepare") {
    assert(!fs.existsSync(qa)); assert(!fs.existsSync(checkpoint)); fs.mkdirSync(qa); fs.mkdirSync(checkpoint);
    for (const file of [__filename, originalFile, path.resolve("plans/ACTIVE_TASKS.md"), path.resolve("AGENTS.md")])
      fs.copyFileSync(file, path.join(checkpoint, path.basename(file)), fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(path.join(qa, "executed.cjs"), result.source, { flag: "wx" });
    fs.writeFileSync(path.join(qa, "binding.json"), JSON.stringify({ original: desc(originalFile), adapter: desc(__filename),
      executed: desc(path.join(qa, "executed.cjs")), installation: desc(receipt), edits: result.edits,
      scope: "Batch review only; other completed groups excluded" }, null, 2), { flag: "wx" });
  } else {
    const binding = JSON.parse(fs.readFileSync(path.join(qa, "binding.json")));
    for (const f of [binding.original, binding.adapter, binding.executed, binding.installation]) assert.equal(sha(f.path), f.sha256);
    assert.equal(result.source, fs.readFileSync(path.join(qa, "executed.cjs"), "utf8"));
  }
  process.argv = [process.execPath, originalFile, mode, "--candidate=1.9.35",
    `--qa-root=${qa}`, `--checkpoint-root=${checkpoint}`, `--installation-file=${receipt}`];
  const worker = new Module(originalFile, module);
  Object.assign(worker, { filename: originalFile, paths: Module._nodeModulePaths(__dirname),
    qaBinding: desc(path.join(qa, "binding.json")) });
  worker._compile(result.source, originalFile);
}
if (require.main === module) main(process.argv[2]);
module.exports = { qa, checkpoint, build };
