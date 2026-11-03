"use strict";
// Real sealed installation + Computer Use native close. A missing input receipt
// is a QA handoff blocker, never evidence that a close request failed.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { rows, listeners, until } = require("./lib/current-native-editor-session.cjs");
const { settleEditor, dismissEnvironmentCompletion } = require("./lib/installed-acceptance.cjs");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const attempt = process.argv[2]; assert.match(attempt || "", /^\d{2}$/);
const out = path.resolve("F:/AgentVN/QA/Editor-Normal-Close-20261024-01", "installed-" + attempt);
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const installationFile = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json";
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const describe = file => ({ path: path.resolve(file), sha256: sha(file) });
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const input = path.join(out, "isolated-small.vnproj"), project = fixture("qa-close-20261024-" + attempt);
project.title = "QA 关闭检查 " + attempt; project.schema_version = "1.1.0";
project.nodes[0].data.loadingAnimation = { kind: "default" }; project.nodes[0].data.openingAudio = [];
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
const originalFile = "F:/AgentVN/QA/Android-Package-20261021-01/editor-12/report.json";
const report = { status: "RUNNING", at: new Date().toISOString(), modelRequests: 0, builds: 0, productChanges: 0,
  scope: "ACTUAL_INSTALLED_1_9_22_STANDARD_USER_HOME_AND_SAVED_PROJECT_NOT_POST_ANDROID_BUILD",
  matrixClaimed: false, processExitCodeClaimed: false, launches: [], cleanups: [], screenshots: [], errors: [], cases: [],
  tools: [__filename, "scripts/lib/installed-release-session.cjs"].map(describe),
  installation: describe(installationFile), input: describe(input), original: describe(originalFile) };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const owner = installedReleaseSession({ installationFile, out, input, report, save });
(async () => {
  save();
  const original = read(originalFile), oldRequest = read(path.join(path.dirname(originalFile), "native-input-request.json"));
  assert.equal(original.steps.at(-1).status, "FAILED");
  assert(original.steps.at(-1).error.includes("Timeout Computer Use normal Editor close"));
  assert(!fs.existsSync(oldRequest.completion), "Re-evaluate original evidence if a receipt has appeared");
  report.originalHandoff = { request: oldRequest, completionPresent: false, conclusion: "INPUT_RECEIPT_TIMEOUT_NOT_CLOSE_PROCESS_ASSERTION" };
  save();
  for (const state of ["home", "saved-project"]) {
    const row = { state, status: "RUNNING" }; report.cases.push(row); save();
    const page = await owner.start();
    if (state === "saved-project") {
      const response = await fetch(`http://127.0.0.1:${owner.current.ports[0]}/api/project/projects/import`, {
        method: "POST", headers: { "content-type": "application/octet-stream", "X-AgentVN-Filename": "isolated-small.vnproj" },
        body: fs.readFileSync(input), signal: AbortSignal.timeout(30000),
      });
      const value = await response.json();
      assert(response.ok && value.ok && value.data.project_id === project.project_id, JSON.stringify(value));
      await page.reload(); await page.locator(".project-home").waitFor();
      await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: project.title }).click();
      await page.locator(".editor-toolbar").waitFor(); await settleEditor(page); await dismissEnvironmentCompletion(page);
      row.projectId = project.project_id;
    }
    await owner.shot(state + "-before-close");
    row.launch = { pid: owner.current.pid, created: owner.current.created, ports: owner.current.ports };
    row.request = { requestId: crypto.randomUUID(), ownerPid: owner.current.pid, state,
      completion: path.join(out, state + "-input.json"), requestedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(out, "input-request.json"), JSON.stringify(row.request, null, 2));
    row.status = "WAIT_COMPUTER_USE"; save(); console.log("WAIT_COMPUTER_USE " + JSON.stringify(row.request));
    try {
      await until(() => fs.existsSync(row.request.completion), "Computer Use action receipt", 240000);
    } catch (error) {
      row.status = "BLOCKED_INPUT_HANDOFF"; throw error;
    }
    row.input = read(row.request.completion);
    assert.equal(row.input.requestId, row.request.requestId); assert.equal(row.input.ownerPid, row.request.ownerPid);
    assert.equal(row.input.status, "INPUT_COMPLETED"); assert(row.input.interaction.includes("Computer Use"));
    assert(row.input.window.app.toLowerCase().includes(owner.installation.executable.path.toLowerCase()));
    await until(() => !rows().some(p => p.ProcessId === row.launch.pid && p.Created === row.launch.created)
      && listeners(row.launch.ports).length === 0, "actual host/backend/native close", 30000);
    await owner.stop("Computer Use native normal close " + state);
    assert.deepEqual(report.cleanups.at(-1).killed, [], "Forced cleanup cannot establish normal close");
    row.status = "PASS"; row.finishedAt = new Date().toISOString(); save();
    console.log("PASS " + state);
  }
  assert.equal(report.cases.length, 2); assert(report.cases.every(row => row.status === "PASS"));
  assert.deepEqual(report.errors, []); assert.equal(sha(originalFile), report.original.sha256);
  report.status = "PASS";
})().catch(error => {
  report.status = report.cases.at(-1)?.status === "BLOCKED_INPUT_HANDOFF" ? "BLOCKED_INPUT_HANDOFF" : "FAILED";
  report.error = String(error.stack || error); process.exitCode = 1;
}).finally(async () => {
  try { await owner.stop("bounded close test finally"); }
  catch (error) { report.cleanupError = String(error.stack || error); report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
