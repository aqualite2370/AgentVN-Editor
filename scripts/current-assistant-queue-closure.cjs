"use strict";
// Current installed queue/lock/cancel/restart coverage, without replaying the
// already-completed history/window matrices or the failed six-tool suite.
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const vm = require("node:vm"), assert = require("node:assert/strict");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const { receipt } = require("./current-novel-task-closure.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const originalFile = path.join(__dirname, "installed-assistant-lifecycle-current.cjs");
const qa = "F:/AgentVN/QA/Assistant-Queue-1.9.35-20261102-01";
const checkpoint = "F:/AgentVN/Checkpoints/Current-Assistant-Queue-20261102-01";
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
function build(original) {
  let source = original; const edits = [];
  function change(before, after, count = 1) {
    assert.equal(source.split(before).length - 1, count, before);
    source = source.replaceAll(before, () => after); edits.push({ before, after, count });
  }
  function region(start, end, replacement) {
    const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
    assert(a > 0 && b > a);
    change(source.slice(a, b), replacement);
  }
  region("const options=process.env.AGENTVN_EXIT_CANDIDATE_CONFIG", "const read = f =>",
    `const options = null, candidate1930 = false, currentCandidate = true;
const expectedVersion = "1.9.35", root = path.resolve(__dirname, "..");
const qa = ${JSON.stringify(qa)}, checkpoint = ${JSON.stringify(checkpoint)};
const installationFile = ${JSON.stringify(receipt)};
`);
  region("  const previous=currentCandidate?", "  for (const f of previous.products)",
    "  const previous = { products: [installation.executable, ...installation.resources] };\n");
  change('"plans/FULL_REGRESSION_20261017.md"', '"AGENTS.md"');
  change('index: desc(path.join(root, ".git/index"))',
    'index: desc(path.resolve(root, git(["rev-parse", "--git-path", "index"])))');
  change("1922-20261022", "1935-20261102");
  change("1.9.22 20261022", "1.9.35 20261102");
  change('.recent-project-open:not(:disabled):visible',
    "[data-help-key='home.recentProject']:not(:disabled):visible", 3);
  change('...(options||candidate1930 ? ["-AllowedRunRoot", path.resolve(qa)] : [])',
    '...["-AllowedRunRoot", path.resolve(qa)]');
  change("    const n = report.submissions.length; await panel.getByRole(\"button\", { name: \"生成创作提案\", exact: true }).click();",
    `    const n = report.submissions.length;
    const accepted = page.waitForResponse(response => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/assistant/creation/processes");
    const [response] = await Promise.all([accepted,
      panel.getByRole("button", { name: "生成创作提案", exact: true }).click()]);
    assert.equal(response.status(), 202, "Wait for durable enqueue, not the earlier request event");
    const record = await response.json();
    assert.equal(record.id, report.submissions.at(-1).id);
    report.submissions.at(-1).accepted = { id: record.id, status: response.status(), taskStatus: record.status }; save();`);
  region('    await stage("history-geometry-focus-archive-restore-and-delete-cancel"',
    "    assert.equal(report.cases.length, 7);", `    await stage("running-cancel-releases-owner-lock-without-applying-a-proposal", async () => {
      const panel = await assistant("creation");
      await panel.getByTestId("assistant-new-conversation").click();
      provider.hold("QUEUE_D");
      const task = await submit(panel, "QUEUE_D 验证运行任务取消");
      report.runningCancellation = task;
      await waitProcess(task.id, value => value.status === "running");
      await until(() => provider.requests.some(r => r.marker === "QUEUE_D"), "actual controlled running HTTP request");
      const lock = page.getByTestId("assistant-project-lock-dialog");
      await lock.waitFor();
      await lock.getByRole("button", { name: "取消此创造任务", exact: true }).click();
      provider.release("QUEUE_D");
      const terminal = await waitProcess(task.id, value => value.status === "cancelled");
      await lock.waitFor({ state: "detached" });
      await unchanged();
      return { processId: task.id, status: terminal.status, noAutomaticMerge: true };
    });
    await stage("real-host-backend-restart-retains-queue-records-and-other-project-draft-without-generation", async () => {
      const count = provider.requests.length, priorPid = host.current.pid;
      await host.stop("actual QA restart; attributed termination is not normal window-close proof");
      await launch();
      assert.notEqual(host.current.pid, priorPid);
      await openProject(projects[1]);
      const panel = await assistant("creation");
      await panel.getByTestId("assistant-creation-draft").getByRole("heading", { name: "QUEUE_C组件", exact: true }).waitFor();
      const expected = [[a.id, "completed"], [b.id, "cancelled"], [c.id, "completed"],
        [report.runningCancellation.id, "cancelled"]];
      const records = [];
      for (const [id, status] of expected) {
        const actual = await api("/api/assistant/creation/processes/" + id);
        assert.equal(actual.status, status); records.push({ id, status: actual.status, projectId: actual.projectId });
      }
      assert.equal(provider.requests.length, count);
      assert.equal(count, 4);
      await unchanged(); await host.shot("queue-after-real-restart");
      return { priorPid, currentPid: host.current.pid, requestsUnchanged: count, records };
    });
`);
  change("assert.equal(report.cases.length, 7);", "assert.equal(report.cases.length, 6);");
  change("assert.equal(report.historyMatrix.length, 12);", "assert.equal(report.historyMatrix.length, 0);");
  change('scope: "ACTUAL_NSIS_INSTALLED_CONTROLLED_INQUIRY_QUEUE_HISTORY_NOT_REAL_DEEPSEEK"',
    'scope: "ACTUAL_1935_INSTALLED_QUEUE_LOCK_CANCEL_RESTART_NOT_REAL_DEEPSEEK", qaBinding: module.qaBinding');
  new vm.Script(Module.wrap(source));
  return { source, edits };
}
function main(mode) {
  const installed = descriptor(), result = build(fs.readFileSync(originalFile, "utf8"));
  assert.equal(installed.executable.sha256, JSON.parse(fs.readFileSync(receipt)).executable.sha256);
  if (mode === "self-test") {
    let reversed = result.source;
    for (const e of [...result.edits].reverse()) reversed = reversed.replaceAll(e.after, () => e.before);
    assert.equal(reversed, fs.readFileSync(originalFile, "utf8")); assert.throws(() => build(""));
    return console.log(JSON.stringify({ status: "PASS", adaptations: result.edits.length,
      productStarts: 0, realModelRequests: 0 }));
  }
  assert(["prepare", "01"].includes(mode));
  if (mode === "prepare") {
    assert(!fs.existsSync(qa)); assert(!fs.existsSync(checkpoint));
    fs.mkdirSync(qa); fs.mkdirSync(checkpoint);
    fs.copyFileSync(__filename, checkpoint + "/adapter.cjs", fs.constants.COPYFILE_EXCL);
    fs.copyFileSync(originalFile, checkpoint + "/original.cjs", fs.constants.COPYFILE_EXCL);
    fs.copyFileSync(path.resolve("plans/ACTIVE_TASKS.md"), checkpoint + "/ACTIVE_TASKS.md", fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(qa + "/executed.cjs", result.source, { flag: "wx" });
    fs.writeFileSync(qa + "/binding.json", JSON.stringify({ original: desc(originalFile),
      executed: desc(qa + "/executed.cjs"), adapter: desc(__filename), edits: result.edits,
      installation: desc(receipt), productChanges: 0, builds: 0, realModelRequests: 0 }, null, 2), { flag: "wx" });
  } else {
    const binding = JSON.parse(fs.readFileSync(qa + "/binding.json"));
    for (const file of [binding.original, binding.executed, binding.adapter, binding.installation])
      assert.equal(sha(file.path), file.sha256);
    assert.equal(result.source, fs.readFileSync(qa + "/executed.cjs", "utf8"));
  }
  process.argv = [process.execPath, originalFile, mode];
  const worker = new Module(originalFile, module);
  Object.assign(worker, { filename: originalFile, paths: Module._nodeModulePaths(__dirname),
    qaBinding: desc(qa + "/binding.json") });
  worker._compile(result.source, originalFile);
}
if (require.main === module) main(process.argv[2]);
