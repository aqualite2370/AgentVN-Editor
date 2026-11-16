"use strict";
// Actual installed WebView/default QA profile. Only the rejected HTTP save is injected.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process"), net = require("node:net");
const assert = require("node:assert/strict"), { isDeepStrictEqual } = require("node:util");
const { defaultEditorSession } = require("./lib/qa-default-editor-session.cjs");
const { settleEditor, dismissEnvironmentCompletion } = require("./lib/installed-acceptance.cjs");
const { until } = require("./lib/current-native-editor-session.cjs");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const { recoveryPoints } = require("./lib/native-editor-recovery-files.cjs");
const base = path.resolve(process.argv[2] || "");
assert.equal(process.argv.length, 3);
const firstBase = path.resolve("F:/testavn/Windows-Isolated-1983-20261116-01");
const followup = base === path.resolve("F:/testavn/Windows-Isolated-1983-20261116-02");
assert(followup || base === firstBase);
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const owner = read(path.join(base, "account-controller.json"));
assert.equal(require("node:os").userInfo().username, owner.account.name);
const candidate = read(path.join(base, "candidate.json")), fixture = read(path.join(base, "fixture.vnproj"));
const out = path.join(base, "resource-01"); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "ACTUAL_1983_NSIS_DEFAULT_PROFILE_AUTOSAVE_NATIVE_TIMELINE_HISTORY_RESTART_NOT_UPGRADE_OR_ANDROID",
  stages: [], launches: [], cleanups: [], screenshots: [], errors: [], backupEvidence: [], writes: [],
  modelRequests: 0, computerUse: false, storeInjection: false, controlledNativeIPC: false,
  controlledRequestDelivery: true, faultInjection: "Explicit HTTP503 for one failure/retry group; native backups are real",
  fixtureImport: "Public backend import of isolated two-node fixture, subsequent editing through installed UI" };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const graph = project => ({ nodes: project.nodes.map(node => ({ id: node.id, data: node.data, position: node.position })),
  edges: project.edges.map(({ selected, ...edge }) => edge) });
const durations = project => project.nodes.find(node => node.id === "scene").data.scene.commands.map(command => command.duration_ms);
let session, page, installation, backendPort, backupRoot, expected, finalTitle, denySave = false;
const current = () => session.api("/api/project/projects/" + fixture.project_id);
const points = () => recoveryPoints(backupRoot, fixture.project_id);
async function step(name, action) {
  const row = { name, status: "RUNNING", startedAt: new Date().toISOString() }; report.stages.push(row); save();
  console.log("START", name);
  try { row.detail = await action(); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = error.stack; throw error; }
  finally { row.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify(row)); }
}
function install(action) {
  const result = cp.spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(__dirname, "editor-autosave-upgrade-install.ps1"), "-SessionRoot", base, "-Action", action],
  { encoding: "utf8", windowsHide: true, timeout: 240000 });
  fs.writeFileSync(path.join(out, "install-" + action.toLowerCase() + ".log"),
    (result.stdout || "") + (result.stderr || ""), { flag: "wx" });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
  return action === "New" ? read(path.join(base, "install-new.json")) : undefined;
}
async function start(label) {
  session = defaultEditorSession({ installation, out, report, save, label,
    expectedQaUser: owner.account.name, isolatedBackendPort: backendPort });
  page = await session.start();
  backupRoot = path.join(path.dirname(path.dirname(session.current.database)), "backup-timeline");
  assert(backupRoot.startsWith(path.resolve(process.env.USERPROFILE) + path.sep));
  await page.route(`http://127.0.0.1:${backendPort}/api/project/state`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    const payload = route.request().postDataJSON();
    // Startup also posts graph-only state; it is not an authored metadata save.
    if (!payload?.project_metadata) return route.continue();
    const row = { started: Date.now(), title: payload.project_metadata.title };
    report.writes.push(row);
    try {
      if (denySave) {
        row.status = 503;
        await route.fulfill({ status: 503, contentType: "application/json",
          body: JSON.stringify({ detail: "QA_SAVE_GUARD_REJECTED" }) });
      } else {
        const response = await route.fetch(); row.status = response.status(); await route.fulfill({ response });
      }
    } finally { row.finished = Date.now(); save(); }
  });
}
async function open(title = fixture.title) {
  await page.locator(".recent-project-open:not(:disabled)").filter({ hasText: title }).click();
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
}
async function settings() {
  if (await page.locator("[data-workspace-surface='options']").getAttribute("aria-current") !== "page")
    await page.locator("[data-workspace-surface='options']").click();
  await page.locator("nav [data-help-key='advanced.tab.settings']").click();
  const input = page.locator(".advanced-tab-content:not([inert]) [data-help-key='settings.projectTitle']");
  await input.waitFor(); await settleEditor(page); await dismissEnvironmentCompletion(page);
  return input;
}
async function waitTitle(title) {
  return until(async () => {
    const value = await current(); return value.title === title ? value : null;
  }, "Actual default database title: " + title, 30000);
}
function retain(point, label) {
  const target = path.join(out, label + ".vnproj");
  fs.copyFileSync(point.path, target, fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(point.metaPath, target + ".meta.json", fs.constants.COPYFILE_EXCL);
  assert.equal(sha(target), point.sha256);
  report.backupEvidence.push({ path: target, sha256: sha(target), source: point.path,
    metadata: { path: target + ".meta.json", sha256: sha(target + ".meta.json") } }); save();
}
async function canvasKey(key) {
  await page.locator("[data-workspace-surface='edit']").click();
  await settleEditor(page);
  await page.locator(".flow-surface").click({ position: { x: 15, y: 15 } });
  await page.keyboard.press(key);
}
async function editFirst(value) {
  await page.locator("[data-workspace-surface='edit']").click(); await settleEditor(page);
  await page.locator(".react-flow__node[data-id='scene']").click();
  const workbench = page.locator(".floating-command-workbench");
  if (await workbench.isVisible()) {
    await workbench.locator("[data-help-key='workbench.close']").click(); await workbench.waitFor({ state: "hidden" });
  }
  const card = page.locator(".inspector-panel .command-card").first();
  const input = card.locator("input[data-help-key='command.wait.durationMs']");
  if (!await input.isVisible()) await card.locator(".command-card-summary").click();
  await input.fill(String(value)); await input.press("Tab"); await waitDurations([value, 200, 300]);
}
async function waitDurations(values) {
  return until(async () => {
    const value = await current(); return isDeepStrictEqual(durations(value), values) ? value : null;
  }, "Actual saved event values " + values.join(","), 30000);
}
(async () => {
  save();
  backendPort = await new Promise((resolve, reject) => {
    const server = net.createServer(); server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port)); });
  });
  await step("actual1983-install-and-verified-payload", async () => {
    if (followup) {
      installation = read(path.join(firstBase, "install-new.json"));
      assert.equal(installation.status, "PASS");
      report.installations = 0; report.inheritedInstall = { path: path.join(firstBase, "install-new.json"),
        sha256: sha(path.join(firstBase, "install-new.json")), freshDefaultQaProfile: true, continuousOldProfile: false };
    } else { install("Snapshot"); installation = install("New"); report.installations = 1; }
    assert.equal(installation.executable.version, "1.9.83");
    const payload = read(candidate.payloadReport.path).deployments.find(item => item.kind === "NSIS actual payload");
    assert(payload); assert.equal(sha(installation.executable.path), payload.executable.sha256);
    assert.equal(sha(path.join(installation.installRoot, "agentvn-player.exe")), candidate.player.sha256);
    return { executable: installation.executable, installer: candidate.installer, playerUnchanged: true, upgradeClaim: false };
  });
  await step("default-profile-import-and-aside-button", async () => {
    await start("first-saveguard1983");
    const response = await fetch(`http://127.0.0.1:${backendPort}/api/project/projects/import`, {
      method: "POST", headers: { "content-type": "application/octet-stream" },
      body: fs.readFileSync(path.join(base, "fixture.vnproj")) });
    assert(response.ok && (await response.json()).ok);
    await page.reload(); await open();
    const button = page.locator("main > aside.node-palette [data-help-key='toolbar.autoArrange']");
    assert.equal(await button.count(), 1); assert(await button.isVisible());
    assert.deepEqual(durations(await current()), [100, 200, 300]);
    return { defaultDatabase: session.current.database, dataDirectoryOverride: false,
      webviewDirectoryOverride: false, nodeCount: 2, edgeCount: 1 };
  });
  await step("continuous-input-deadline-real-database-and-native-recovery", async () => {
    const input = await settings(), prefix = "连续编辑保护1983", suffix = "1234567890".repeat(10);
    const first = report.writes.length, started = Date.now();
    await input.fill(prefix); await input.pressSequentially(suffix, { delay: 100 });
    const typed = Date.now(); finalTitle = prefix + suffix;
    await waitTitle(finalTitle);
    const during = report.writes.slice(first).filter(write => write.status === 200 && write.finished < typed);
    assert(during.some(write => write.started - started <= 6500), "Deadline must persist before continuous typing ends");
    const point = await until(() => points().find(item => item.value.title === finalTitle), "Real native metadata recovery", 30000);
    retain(point, "continuous-input-native-backup");
    await session.shot("installed-continuous-autosave");
    return { durationMs: typed - started, writes: report.writes.slice(first).map(write =>
      ({ startMs: write.started - started, finishedMs: write.finished - started, status: write.status })),
    nativeBackup: true, finalTitle };
  });
  await step("explicit-rejected-save-refresh-confirmation-cancel-preserves-content", async () => {
    denySave = true; finalTitle = "安装版失败后保留修改1983";
    const input = await settings(); await input.fill(finalTitle);
    await until(() => report.writes.some(write => write.title === finalTitle && write.status === 503 && write.finished),
      "Injected save rejection", 15000);
    const observed = page.waitForEvent("dialog", { timeout: 10000 });
    const reload = page.reload({ waitUntil: "domcontentloaded" }).catch(error => String(error));
    const dialog = await observed; assert.equal(dialog.type(), "beforeunload"); await dialog.dismiss(); await reload;
    assert.equal(await input.inputValue(), finalTitle);
    assert.notEqual((await current()).title, finalTitle);
    await session.shot("installed-rejected-save-preserved");
    return { dialogType: "beforeunload", canceledReloadPreservedContent: true, failureKind: "CONTROLLED_HTTP503" };
  });
  await step("retry-success-clean-refresh-reopen-and-native-backup", async () => {
    denySave = false;
    await page.locator("[data-workspace-surface='edit']").click(); await waitTitle(finalTitle);
    const point = await until(() => points().find(item => item.value.title === finalTitle), "Retry native recovery", 30000);
    retain(point, "retry-native-backup");
    let dialogs = 0;
    const listener = async dialog => { dialogs++; await dialog.dismiss(); };
    page.on("dialog", listener);
    try {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 }); await open(finalTitle);
      assert.equal(dialogs, 0);
    } finally { page.off("dialog", listener); }
    assert.deepEqual(durations(await current()), [100, 200, 300]);
    return { savedTitle: finalTitle, dialogsAfterSave: dialogs, actualNativeRecovery: true };
  });
  await step("event-edit-undo-redo-and-options-native-timeline-restore", async () => {
    await editFirst(400);
    await canvasKey("Control+z");
    const dialog = page.getByTestId("editor-undo-confirmation"); await dialog.waitFor();
    const text = await dialog.innerText(); assert.match(text, /第\s*1\s*项/);
    await dialog.getByRole("button", { name: "取消", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
    await waitDurations([400, 200, 300]);
    await canvasKey("Control+z"); await dialog.waitFor();
    await dialog.getByRole("button", { name: "确认撤销", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
    await waitDurations([100, 200, 300]); await page.keyboard.press("Control+y"); await waitDurations([400, 200, 300]);
    const point = await until(() => points().find(item => durations(item.value).join(",") === "400,200,300"),
      "Actual event recovery", 30000); retain(point, "timeline-target");
    await editFirst(500);
    const before = graph(await current());
    await until(() => points().find(item => durations(item.value).join(",") === "500,200,300"), "Current recovery", 30000);
    await page.locator("[data-workspace-surface='options']").click();
    const tab = page.locator("nav [data-help-key='advanced.tab.history']");
    assert.equal((await tab.textContent()).trim(), "时间线"); await tab.click(); await settleEditor(page);
    const panel = page.locator(".advanced-tab-content:not([inert]) .project-timeline-panel");
    await panel.locator("[data-help-key='timeline.refresh']").click();
    await panel.locator(".timeline-entry button").first().waitFor();
    const index = points().slice(0, 10).findIndex(item => item.name === point.name); assert(index >= 0);
    await panel.locator(".timeline-entry button").nth(index).click();
    const confirm = page.getByTestId("timeline-restore-confirmation"); await confirm.waitFor();
    await confirm.getByRole("button", { name: "恢复备份", exact: true }).click(); await confirm.waitFor({ state: "hidden" });
    await waitDurations([400, 200, 300]); expected = graph(await current()); assert.deepEqual(expected, graph(point.value));
    const retained = points().find(item => item.meta.trigger === "before_restore" && isDeepStrictEqual(graph(item.value), before));
    assert(retained); retain(retained, "before-restore-native-backup");
    fs.writeFileSync(path.join(out, "expected-graph.json"), JSON.stringify(expected, null, 2), { flag: "wx" });
    await session.shot("installed-restored-timeline");
    return { confirmation: text, eventUndoAndRedo: true, restored: [400, 200, 300], beforeRestore: [500, 200, 300] };
  });
  await step("first-normal-close", () => session.naturalClose());
  await step("same-default-profile-restart-and-graph-metadata-readback", async () => {
    await start("restart-saveguard1983"); await open(finalTitle);
    const actual = await current(); assert.deepEqual(graph(actual), expected); assert.equal(actual.title, finalTitle);
    await session.shot("installed-default-profile-restart");
    return { database: session.current.database, savedTitle: actual.title, nodes: actual.nodes.length,
      edges: actual.edges.length, expectedGraphSha256: sha(path.join(out, "expected-graph.json")) };
  });
  await step("second-normal-close-and-registration-restore", async () => {
    const closed = await session.naturalClose(); if (!followup) install("Restore"); return closed;
  });
  assert.equal(report.stages.length, 9); assert(report.stages.every(row => row.status === "PASS"));
  assert.deepEqual(report.errors, []); assert.equal(report.blockedModelRequests || 0, 0); report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = error.stack; process.exitCode = 1; })
.finally(async () => {
  denySave = false;
  try {
    if (page && !page.isClosed() && report.status !== "PASS") await session.shot("failure-terminal").catch(() => {});
    await session?.stop();
    if (fs.existsSync(path.join(base, "metadata-before.json")) && !fs.existsSync(path.join(base, "metadata-restoration.json")))
      install("Restore");
    report.cleanupStatus = "PASS";
  } catch (error) { report.cleanupStatus = "FAILED"; report.cleanupError = error.stack; report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, stages: report.stages.length, out, error: report.error }));
});
