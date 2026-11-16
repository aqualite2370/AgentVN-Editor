"use strict";
// Installed Editor with its own ordinary disposable Windows user's default DB.
// Real fields, shortcuts, native backup files and restart; no store/IPC injection.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process"), net = require("node:net");
const assert = require("node:assert/strict");
const { isDeepStrictEqual } = require("node:util");
const { defaultEditorSession } = require("./lib/qa-default-editor-session.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { until } = require("./lib/current-native-editor-session.cjs");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const { recoveryPoints } = require("./lib/native-editor-recovery-files.cjs");
const base = path.resolve(process.argv[2] || "");
assert.equal(base, path.resolve("F:/testavn/Windows-Isolated-1980-20261116-01"));
assert.equal(process.argv.length, 3);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const owner = read(path.join(base, "account-controller.json"));
assert.equal(require("node:os").userInfo().username, owner.account.name);
const out = path.join(base, "resource-01"); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const fixture = read(path.join(base, "fixture.vnproj")), candidate = read(path.join(base, "candidate.json"));
const report = { status: "RUNNING", scope: "ACTUAL_NSIS_1980_DEFAULT_PROFILE_HISTORY_FEEDBACK_NATIVE_TIMELINE_RESTART",
  stages: [], launches: [], cleanups: [], screenshots: [], errors: [], writes: [], backupEvidence: [],
  modelRequests: 0, computerUse: false, controlledNativeIPC: false, storeInjection: false,
  controlledRequestDelivery: false, startedAt: new Date().toISOString() };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let session, page, installation, backendPort, backupRoot, expected;
const graph = g => ({ nodes: g.nodes.map(n => ({ id: n.id, position: n.position, data: n.data })),
  edges: g.edges.map(({ selected, ...edge }) => edge) });
const current = () => session.api("/api/project/projects/" + fixture.project_id);
const durations = g => g.nodes.find(n => n.id === "scene").data.scene.commands.map(c => c.duration_ms);
const points = () => recoveryPoints(backupRoot, fixture.project_id);
async function step(name, action) {
  const row = { name, status: "RUNNING" }; report.stages.push(row); save(); console.log("START", name);
  try { row.detail = await action(); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = error.stack; throw error; }
  finally { save(); console.log(JSON.stringify(row)); }
}
function install(action) {
  const result = cp.spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(__dirname, "editor-autosave-upgrade-install.ps1"), "-SessionRoot", base, "-Action", action],
  { encoding: "utf8", windowsHide: true, timeout: 240000 });
  fs.writeFileSync(path.join(out, `install-${action.toLowerCase()}.log`), (result.stdout || "") + (result.stderr || ""), { flag: "wx" });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
  return action === "New" ? read(path.join(base, "install-new.json")) : undefined;
}
async function start(label) {
  session = defaultEditorSession({ installation, out, report, save, label,
    expectedQaUser: owner.account.name, isolatedBackendPort: backendPort });
  page = await session.start();
  page.on("requestfinished", request => {
    if (["PUT", "POST"].includes(request.method()) && request.url().includes("/api/project/")) {
      report.writes.push({ method: request.method(), url: request.url(), at: new Date().toISOString() }); save();
    }
  });
  backupRoot = path.join(path.dirname(path.dirname(session.current.database)), "backup-timeline");
  assert(backupRoot.startsWith(path.resolve(process.env.USERPROFILE) + path.sep));
}
async function open() {
  await page.locator(".recent-project-open:not(:disabled)").filter({ hasText: fixture.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
}
async function waitOrder(order) {
  await until(async () => {
    try { assert.deepEqual(durations(await current()), order); return true; } catch { return false; }
  }, "actual saved event values", 30000);
}
async function canvasKey(key) {
  await page.locator(".flow-surface").click({ position: { x: 15, y: 15 } });
  await page.keyboard.press(key);
}
async function selectScene() {
  await page.locator(".react-flow__node[data-id='scene']").click();
  const workbench = page.locator(".floating-command-workbench");
  if (await workbench.isVisible()) {
    await workbench.locator("[data-help-key='workbench.close']").click(); await workbench.waitFor({ state: "hidden" });
  }
}
async function editFirst(value) {
  if (!await page.locator(".inspector-panel .command-card").count()) await selectScene();
  const card = page.locator(".inspector-panel .command-card").first();
  const input = card.locator("input[data-help-key='command.wait.durationMs']");
  if (!await input.isVisible()) await card.locator(".command-card-summary").click();
  await input.fill(String(value)); await input.press("Tab"); await waitOrder([value, 200, 300]);
}
async function visibleNotice(text) {
  // Read visible UI, not editor store internals.
  await page.getByText(text, { exact: true }).filter({ visible: true }).first().waitFor();
  return text;
}
function retain(point, label) {
  const target = path.join(out, "recovery-files", label + ".json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(point.path, target, fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(point.metaPath, target + ".meta.json", fs.constants.COPYFILE_EXCL);
  assert.equal(sha(target), point.sha256);
  report.backupEvidence.push({ source: point.path, path: target, sha256: sha(target),
    metadata: { path: target + ".meta.json", sha256: sha(target + ".meta.json") }, trigger: point.meta.trigger }); save();
}
(async () => {
  save();
  backendPort = await new Promise((resolve, reject) => {
    const s = net.createServer(); s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const port = s.address().port; s.close(e => e ? reject(e) : resolve(port)); });
  });
  await step("actual-nsis-1980-install-and-byte-verified-payload", async () => {
    install("Snapshot"); installation = install("New"); report.installations = 1;
    assert.equal(installation.executable.version, "1.9.80");
    const payload = read(candidate.payloadReport.path).deployments.find(d => d.kind === "NSIS actual payload");
    assert(payload); assert.equal(sha(installation.executable.path), payload.executable.sha256);
    for (const resource of [{ name: "build-versions.json", ...payload.versionResource }, ...payload.runtimeProvenance])
      assert.equal(sha(path.join(installation.installRoot, resource.name)), resource.sha256);
    return { executable: installation.executable, exactPayload: true, upgradeClaim: false };
  });
  await step("default-profile-import-empty-undo-and-redo-notices", async () => {
    await start("first1980");
    const response = await fetch(`http://127.0.0.1:${backendPort}/api/project/projects/import`, {
      method: "POST", headers: { "content-type": "application/octet-stream" },
      body: fs.readFileSync(path.join(base, "fixture.vnproj")) });
    assert(response.ok && (await response.json()).ok);
    await page.reload(); await open();
    const before = graph(await current());
    await canvasKey("Control+z"); await visibleNotice("没有可撤销的操作。");
    assert.equal(await page.getByTestId("editor-undo-confirmation").count(), 0);
    await canvasKey("Control+y"); await visibleNotice("没有可重做的操作。");
    assert.deepEqual(graph(await current()), before);
    const arrange = page.locator("main > aside.node-palette [data-help-key='toolbar.autoArrange']");
    assert.equal(await arrange.count(), 1); assert(await arrange.isVisible());
    return { emptyUndo: true, emptyRedo: true, graphUnchanged: true, defaultDatabase: session.current.database };
  });
  await step("input-native-text-undo-does-not-open-graph-confirmation", async () => {
    await selectScene();
    const title = page.locator(".inspector-panel input[data-help-key='field.title']");
    await title.focus(); await title.press("End"); await page.keyboard.type("ABC"); await page.keyboard.press("Control+z");
    assert.equal(await page.getByTestId("editor-undo-confirmation").count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-help-key")), "field.title");
    assert(!/ABC$/.test(await title.inputValue()));
    await title.fill("雨夜车站"); await title.press("Tab");
    return { nativeTextUndo: true, graphConfirmationOpened: false };
  });
  await step("specific-event-undo-description-cancel-confirm-and-redo", async () => {
    await editFirst(400); const edited = graph(await current());
    const dialog = page.getByTestId("editor-undo-confirmation");
    await canvasKey("Control+z"); await dialog.waitFor();
    const text = await dialog.innerText();
    assert.match(text, /雨夜车站/); assert.match(text, /第\s*1\s*项/); assert.match(text, /等待/);
    await dialog.getByRole("button", { name: "取消", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
    assert.deepEqual(graph(await current()), edited);
    await canvasKey("Control+z"); await dialog.waitFor();
    await dialog.getByRole("button", { name: "确认撤销", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
    await waitOrder([100, 200, 300]);
    await page.keyboard.press("Control+y");
    const redoNotice = await visibleNotice("已重做上一次撤销。");
    await waitOrder([400, 200, 300]);
    assert.deepEqual(graph(await current()), edited);
    await session.shot("installed-specific-undo-feedback");
    return { text, cancelPreservesGraph: true, confirmedUndo: [100, 200, 300], redo: [400, 200, 300], redoNotice };
  });
  await step("options-timeline-native-backup-restore-and-exact-pre-restore-retention", async () => {
    const point = await until(() => points().find(p => durations(p.value).join(",") === "400,200,300"),
      "actual native recovery point", 30000); retain(point, "restore-target");
    await editFirst(500); const before = graph(await current());
    fs.writeFileSync(path.join(out, "before-restore-graph.json"), JSON.stringify(before, null, 2), { flag: "wx" });
    await until(() => points().some(p => durations(p.value).join(",") === "500,200,300"), "native current recovery", 30000);
    await page.locator("[data-workspace-surface='options']").click();
    const tab = page.locator("nav [data-help-key='advanced.tab.history']");
    assert.equal((await tab.textContent()).trim(), "时间线"); await tab.click();
    const panel = page.locator(".advanced-tab-content:not([inert]) .project-timeline-panel");
    await panel.locator("[data-help-key='timeline.refresh']").click();
    await panel.locator(".timeline-entry button").first().waitFor();
    const index = points().slice(0, 10).findIndex(p => p.name === point.name); assert(index >= 0);
    await panel.locator(".timeline-entry button").nth(index).click();
    const dialog = page.getByTestId("timeline-restore-confirmation"); await dialog.waitFor();
    await dialog.getByRole("button", { name: "恢复备份", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
    await waitOrder([400, 200, 300]); expected = graph(await current());
    assert.deepEqual(expected, graph(point.value));
    const candidates = points().filter(p => p.meta.trigger === "before_restore");
    for (const [i, entry] of candidates.entries()) retain(entry, "before-restore-" + i);
    assert(candidates.some(p => isDeepStrictEqual(graph(p.value), before)), "Newer content must be retained exactly");
    fs.writeFileSync(path.join(out, "expected-restart-graph.json"), JSON.stringify(expected, null, 2), { flag: "wx" });
    await session.shot("installed-timeline-restored");
    return { restored: [400, 200, 300], beforeRestore: [500, 200, 300], nativeFilesystem: true,
      controlledRaceReproduction: false };
  });
  await step("normal-window-close-waits-for-product-and-backend-exit", () => session.naturalClose());
  await step("same-default-profile-restart-reads-saved-events-and-edges", async () => {
    await start("restart1980"); await open();
    assert.deepEqual(graph(await current()), expected);
    await page.locator("[data-workspace-surface='edit']").click(); await selectScene();
    assert.deepEqual(durations(await current()), [400, 200, 300]);
    await session.shot("installed-after-default-profile-restart");
    return { database: session.current.database, expected: sha(path.join(out, "expected-restart-graph.json")) };
  });
  await step("second-normal-close-and-install-registration-restoration", async () => {
    const closed = await session.naturalClose(); install("Restore"); return closed;
  });
  assert.equal(report.stages.length, 8); assert(report.stages.every(s => s.status === "PASS"));
  assert.deepEqual(report.errors, []); assert.equal(report.blockedModelRequests || 0, 0); report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = error.stack; process.exitCode = 1; })
.finally(async () => {
  try {
    if (page && !page.isClosed() && report.status !== "PASS") await session.shot("failure-terminal").catch(() => {});
    await session?.stop();
    if (fs.existsSync(path.join(base, "metadata-before.json")) && !fs.existsSync(path.join(base, "metadata-restoration.json")))
      install("Restore");
    report.cleanupStatus = "PASS";
  } catch (error) { report.cleanupStatus = "FAILED"; report.cleanupError = error.stack; report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, stages: report.stages.length, error: report.error, out }));
});
