"use strict";
// Actual owned native Editor and persistent profile. Only task HTTP is controlled;
// no AI request, frontend source import, or user database.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const A = require("./lib/installed-acceptance.cjs");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { startInstalledEditor } = require("./lib/owned-installed-editor.cjs");
const { captureInstalledWebview } = require("./lib/installed-webview-capture.cjs");
assert(process.argv[2] && process.argv[3], "Pass installation audit and fresh output directory");
const out = path.resolve(process.argv[3]), audit = path.resolve(process.argv[2]);
const requireCommit = process.argv.includes("--native-commit");
assert(!fs.existsSync(out), "Never overwrite prior evidence");
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT || ""), out);
const input = path.resolve(process.env.AGENTVN_TEST_PROJECT || "");
assert(A.inside(out, input) && input.endsWith(".vnproj"), "Explicit isolated fixture required");
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(audit, path.join(out, "installer-resource-report.json"), fs.constants.COPYFILE_EXCL);
const project = fixture(`card_crash_${path.basename(out)}`);
project.title = "任务卡片异常终止隔离验收";
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "OWNED_INSTALLED_EDITOR_FORCE_KILL_POSITION_DURABILITY_NOT_POWER_LOSS",
  requireCommit,
  input, audit: { path: audit, sha256: A.sha256(fs.readFileSync(audit)) },
  launches: [], cases: [], cleanup: [], errors: [], forbiddenRequests: [] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const task = { projectId: project.project_id, events: [], job: {
  jobId: "card-crash-controlled-job", novelTitle: "受控解析任务", status: "running",
  totalChunks: 4, completedChunks: 2, progressPercent: 50, failedChunks: 0,
  selectedChapterCount: 1, cancelledChunks: 0, runningAgentCount: 1,
  estimatedRemainingChunks: 2, agents: [], chapters: [], source: "api",
  tokenStats: { totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0,
    byAgent: [], byChapter: [] },
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
} };
const key = `agentvn.novelTask.position.${encodeURIComponent(project.project_id)}`;
let owner, browser, page, cdp;
async function connect() {
  const verified = A.readInstalledSession(out), state = owner.state;
  report.launches.push({ ...state, exeSha256: verified.exeSha256 }); save();
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${state.cdpPort}`);
  const context = browser.contexts()[0];
  await context.route("**/api/novel/**", async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === "GET" && url.pathname.endsWith(`/${task.job.jobId}/panel`))
      return route.fulfill({ json: task.job });
    if (request.method() === "GET" && url.pathname.endsWith(`/${task.job.jobId}/events`))
      return route.fulfill({ json: [] });
    report.forbiddenRequests.push({ method: request.method(), url: request.url() });
    return route.abort("blockedbyclient");
  });
  const deadline = Date.now() + 45000;
  while (!(page = context.pages().find(p => /^http:\/\/tauri\.localhost/.test(p.url())))) {
    assert(Date.now() < deadline, "Actual installed WebView missing");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  page.setDefaultTimeout(30000);
  page.on("pageerror", error => report.errors.push(String(error)));
  cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride",
    { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await page.emulateMedia({ reducedMotion: "no-preference" });
}
const card = () => page.getByTestId("novel-task-mini-entry");
async function open() {
  await page.locator(".recent-project-open:not(:disabled):visible")
    .filter({ hasText: project.title }).first().click();
  await page.locator(".editor-toolbar").waitFor();
  await A.settleEditor(page);
  await card().waitFor();
  assert.equal(await card().getAttribute("data-project-id"), project.project_id);
  assert.equal((await A.projectSnapshot(owner.state.backendPort)).projectId, project.project_id);
}
async function readPosition() {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) || "null"), key);
}
async function committed() {
  if (!requireCommit) return;
  assert.equal(await card().getAttribute("data-position-storage"), "native", "Must be real native persistence");
  await page.waitForFunction(() => document.querySelector('[data-testid="novel-task-mini-entry"]')
    ?.getAttribute("data-position-persistence") === "saved");
}
function nativeRecordFile() {
  const directory = path.join(out, "isolated-data/ui-preferences/novel-card-positions");
  const name = require("node:crypto").createHash("sha256").update(project.project_id).digest("hex") + ".json";
  const file = path.join(directory, name);
  assert(A.inside(out, file)); return file;
}
async function stop() {
  if (owner) { report.cleanup.push(await owner.stop()); owner = undefined; }
  if (browser) { await browser.close().catch(() => {}); browser = undefined; }
  save();
}
(async () => {
  owner = await startInstalledEditor(out); await connect();
  const response = await fetch(`http://127.0.0.1:${owner.state.backendPort}/api/project/projects/import`, {
    method: "POST", headers: { "content-type": "application/octet-stream",
      "X-AgentVN-Filename": encodeURIComponent(path.basename(input)) }, body: fs.readFileSync(input),
    signal: AbortSignal.timeout(15000),
  });
  assert(response.ok, "Import isolated fixture through actual installed backend");
  await page.evaluate(task => localStorage.setItem(
    `agentvn.novelProcessTaskWorkbench.snapshot.${encodeURIComponent(task.projectId)}`,
    JSON.stringify(task)), task);
  await page.reload({ waitUntil: "domcontentloaded" }); await open();
  // Flush bootstrap task/project normally before the independent crash trigger.
  const closed = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    `$p=Get-Process -Id ${Number(owner.state.editorPid)} -ErrorAction Stop; ` +
    `if(-not $p.CloseMainWindow()){throw 'Close refused'}; ` +
    `if(-not $p.WaitForExit(15000)){throw 'Normal close timed out'}`],
  { windowsHide: true, encoding: "utf8", timeout: 20000 });
  assert.equal(closed.status, 0, closed.stderr || String(closed.error));
  await stop();
  owner = await startInstalledEditor(out, { restart: true }); await connect(); await open();
  const before = await card().boundingBox();
  assert.equal(await readPosition(), null, "Crash test starts from known default");
  const grip = await card().getByRole("button", { name: "拖动小说任务卡片" }).boundingBox();
  await page.mouse.move(grip.x + 40, grip.y + grip.height / 2); await page.mouse.down();
  await page.mouse.move(grip.x - 140, grip.y - 90, { steps: 8 }); await page.mouse.up();
  // Only a host-acknowledged write is committed. No fixed delay or graceful
  // close is used to give WebView localStorage time to flush.
  await committed();
  const moved = await card().boundingBox(), saved = await readPosition();
  assert(before.x - moved.x > 100 && before.y - moved.y > 40);
  assert(saved && saved.x >= 0 && saved.x <= 1 && saved.y >= 0 && saved.y <= 1);
  assert(!await page.getByTestId("novel-task-workbench").isVisible(), "Drag must not expand");
  report.trigger = { before, moved, saved, at: new Date().toISOString(),
    ownerPid: owner.state.editorPid, profile: owner.state.webviewRoot, key,
    persistence: await card().getAttribute("data-position-persistence") };
  save();
  // No screenshot or navigation before kill: avoid accidentally granting the
  // asynchronous WebView cache a flush grace period.
  await stop();
  if (requireCommit) {
    const file = nativeRecordFile(), bytes = fs.readFileSync(file), record = JSON.parse(bytes);
    assert.deepEqual(record, { schemaVersion: 1, projectId: project.project_id, position: saved });
    report.nativeAfterCrash = { path: file, sha256: A.sha256(bytes), record };
    save();
  }
  owner = await startInstalledEditor(out, { restart: true }); await connect(); await open();
  const restored = await card().boundingBox(), persisted = await readPosition();
  report.restored = { rect: restored, saved: persisted, profile: owner.state.webviewRoot };
  report.screenshot = await captureInstalledWebview(page, cdp,
    path.join(out, "after-force-kill.png"), { width: 1920, height: 1080, dpr: 1, reduced: false });
  save();
  assert.equal(report.restored.profile, report.trigger.profile, "Exactly the same WebView profile");
  assert.deepEqual(persisted, saved, "Committed position must survive owned process force-kill");
  assert(Math.abs(restored.x - moved.x) < 2 && Math.abs(restored.y - moved.y) < 2,
    "Restored card must retain committed geometry");
  if (requireCommit) {
    await committed();
    report.cases.push({ name: "actual-native-file-and-host-ack-survive-process-kill", status: "PASS" });
    const file = nativeRecordFile(), backup = path.join(out, "preserved-before-controlled-path-block.json");
    const originalBytes = fs.readFileSync(file);
    fs.renameSync(file, backup); fs.mkdirSync(file);
    try {
      const grip = await card().getByRole("button", { name: "拖动小说任务卡片" }).boundingBox();
      await page.mouse.move(grip.x + 40, grip.y + 14); await page.mouse.down();
      await page.mouse.move(grip.x - 40, grip.y - 25, { steps: 6 }); await page.mouse.up();
      await page.getByRole("alert").waitFor();
      assert.equal(await card().getAttribute("data-position-persistence"), "error");
      assert.deepEqual(fs.readFileSync(backup), originalBytes, "Failed native write must preserve prior bytes");
      const retry = page.getByRole("button", { name: "重试保存任务卡片位置" });
      assert(await retry.isVisible());
    } finally {
      // Only this run's exact empty blocker, never a broad preference root.
      assert(A.inside(out, file)); fs.rmdirSync(file);
      fs.copyFileSync(backup, file, fs.constants.COPYFILE_EXCL);
    }
    await page.getByRole("button", { name: "重试保存任务卡片位置" }).click(); await committed();
    const retried = JSON.parse(fs.readFileSync(file));
    assert.deepEqual(retried.position, await readPosition());
    assert.notDeepEqual(retried.position, saved);
    report.cases.push({ name: "actual-native-write-refusal-keeps-old-bytes-and-visible-retry-commits", status: "PASS" });
    await card().getByRole("button", { name: "恢复任务卡片默认位置" }).click(); await committed();
    const tombstone = JSON.parse(fs.readFileSync(file));
    assert.deepEqual(tombstone, { schemaVersion: 1, projectId: project.project_id, position: null });
    await stop();
    owner = await startInstalledEditor(out, { restart: true }); await connect(); await open(); await committed();
    const reset = await card().boundingBox();
    assert.equal(await readPosition(), null);
    assert(Math.abs(reset.x - before.x) < 2 && Math.abs(reset.y - before.y) < 2);
    assert.deepEqual(JSON.parse(fs.readFileSync(file)), tombstone);
    report.resetAfterCrash = { rect: reset, file, tombstone };
    report.cases.push({ name: "native-default-reset-survives-second-force-kill", status: "PASS" });
  }
  assert.equal(report.forbiddenRequests.length, 0);
  assert.equal(report.errors.length, 0);
  report.cases.push({ name: "actual-drag-force-kill-same-profile-and-project-recovery", status: "PASS" });
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error);
  console.error(report.error); process.exitCode = 1;
}).finally(async () => {
  await stop().catch(error => { report.cleanupError = String(error); report.status = "FAILED"; process.exitCode = 1; });
  report.finishedAt = new Date().toISOString(); save(); console.log(`Evidence: ${out}`);
});
