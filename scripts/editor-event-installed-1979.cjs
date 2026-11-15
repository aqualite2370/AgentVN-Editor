"use strict";
// Genuine installed Editor/default disposable profile. No source server,
// store mutation, controlled timing, native IPC injection or model invocation.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process"), net = require("node:net");
const assert = require("node:assert/strict");
const { isDeepStrictEqual } = require("node:util");
const { defaultEditorSession } = require("./lib/qa-default-editor-session.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { until } = require("./lib/current-native-editor-session.cjs");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const { recoveryPoints } = require("./lib/native-editor-recovery-files.cjs");
const base = path.resolve(process.argv[2] || "");
const prior = path.resolve("F:/testavn/Windows-Isolated-1979-20261116-01");
const remaining = base === path.resolve("F:/testavn/Windows-Isolated-1979-20261116-03");
const followup = remaining || base === path.resolve("F:/testavn/Windows-Isolated-1979-20261116-02");
assert(followup || base === prior);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const owner = read(path.join(base, "account-controller.json"));
assert.equal(require("node:os").userInfo().username, owner.account.name);
const out = path.join(base, "resource-01"); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const fixture = read(path.join(base, "fixture.vnproj")), candidate = read(path.join(base, "candidate.json"));
const report = { status: "RUNNING", scope: "ACTUAL_NSIS_1979_DEFAULT_PROFILE_EVENT_EDIT_UNDO_NATIVE_TIMELINE_RESTART",
  stages: [], launches: [], cleanups: [], screenshots: [], errors: [], writes: [], backupEvidence: [],
  modelRequests: 0, computerUse: false, controlledNativeIPC: false, storeInjection: false,
  controlledRequestDelivery: false, startedAt: new Date().toISOString() };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let session, page, installation, backendPort, backupRoot, expected;
const current = () => session.api("/api/project/projects/" + fixture.project_id);
const graph = g => ({ nodes: g.nodes.map(n => ({ id: n.id, position: n.position, data: n.data })),
  edges: g.edges.map(({ selected, ...edge }) => edge) });
const sceneCommands = g => g.nodes.find(n => n.id === "scene").data.scene.commands;
const durations = g => sceneCommands(g).map(c => c.duration_ms);
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
async function waitGraph(value, label) {
  await until(async () => {
    try { assert.deepEqual(graph(await current()), value); return true; } catch { return false; }
  }, label, 30000);
}
async function waitOrder(values) {
  await until(async () => {
    try { assert.deepEqual(durations(await current()), values); return true; } catch { return false; }
  }, "event order actually persisted", 30000);
}
async function undo(confirm = true) {
  await page.locator(".flow-surface").click({ position: { x: 15, y: 15 } });
  await page.keyboard.press("Control+z");
  const dialog = page.getByTestId("editor-undo-confirmation"); await dialog.waitFor();
  await dialog.getByRole("button", { name: confirm ? "确认撤销" : "取消", exact: true }).click();
  await dialog.waitFor({ state: "hidden" }); await settleEditor(page);
}
function points() { return recoveryPoints(backupRoot, fixture.project_id); }
function retain(point, label) {
  const target = path.join(out, "recovery-files", label + ".json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(point.path, target, fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(point.metaPath, target + ".meta.json", fs.constants.COPYFILE_EXCL);
  assert.equal(sha(target), point.sha256); assert.equal(sha(target + ".meta.json"), sha(point.metaPath));
  report.backupEvidence.push({ source: point.path, path: target, sha256: sha(target),
    metadata: { path: target + ".meta.json", sha256: sha(target + ".meta.json") }, trigger: point.meta.trigger }); save();
}
async function selectScene() {
  await page.locator(".react-flow__node[data-id='scene']").click();
  const workbench = page.locator(".floating-command-workbench");
  if (await workbench.isVisible()) {
    await workbench.locator("[data-help-key='workbench.close']").click(); await workbench.waitFor({ state: "hidden" });
  }
}
async function editFirst(value) {
  // Canvas focus clears Inspector selection as designed; restore it explicitly
  // after an undo/redo shortcut before targeting an event field.
  if (!await page.locator(".inspector-panel .command-card").count()) await selectScene();
  const first = page.locator(".inspector-panel .command-card").first();
  if (!await first.locator("input[data-help-key='command.wait.durationMs']").isVisible())
    await first.locator(".command-card-summary").click();
  const input = first.locator("input[data-help-key='command.wait.durationMs']");
  await input.fill(String(value)); await input.press("Tab");
}
(async () => {
  save();
  backendPort = await new Promise((resolve, reject) => {
    const s = net.createServer(); s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const port = s.address().port; s.close(e => e ? reject(e) : resolve(port)); });
  });
  await step(followup ? "reuse-exact-prior-actual-nsis-install-no-rebuild-or-reinstall"
    : "actual-nsis-1979-install-and-byte-verified-payload", async () => {
    if (followup) {
      const previous = read(path.join(prior, "resource-01/report.json"));
      assert.equal(previous.status, "FAILED"); assert.equal(previous.cleanupStatus, "PASS");
      assert.equal(previous.stages[0].status, "PASS"); assert.equal(previous.stages[1].status, "PASS");
      assert(previous.stages[2].error.includes("command-card-summary"));
      installation = read(path.join(prior, "install-new.json")); assert.equal(installation.status, "PASS");
      report.installations = 0;
      report.inheritedInstall = { path: path.join(prior, "install-new.json"), sha256: sha(path.join(prior, "install-new.json")) };
    } else { install("Snapshot"); installation = install("New"); report.installations = 1; }
    assert.equal(installation.executable.version, "1.9.79");
    const payload = read(candidate.payloadReport.path).deployments.find(d => d.kind === "NSIS actual payload");
    assert(payload); assert.equal(sha(installation.executable.path), payload.executable.sha256);
    for (const resource of [{ name: "build-versions.json", ...payload.versionResource }, ...payload.runtimeProvenance])
      assert.equal(sha(path.join(installation.installRoot, resource.name)), resource.sha256);
    return { executable: installation.executable, exactPayload: true, upgradeClaim: false };
  });
  await step("default-profile-project-import-and-real-event-selection", async () => {
    await start("first1979");
    const response = await fetch(`http://127.0.0.1:${backendPort}/api/project/projects/import`, {
      method: "POST", headers: { "content-type": "application/octet-stream" },
      body: fs.readFileSync(path.join(base, "fixture.vnproj")) });
    assert(response.ok && (await response.json()).ok);
    await page.reload(); await open(); await selectScene();
    assert.deepEqual(durations(await current()), remaining ? [250, 300, 100] : [100, 200, 300]);
    const arrange = page.locator("main > aside.node-palette [data-help-key='toolbar.autoArrange']");
    assert.equal(await arrange.count(), 1); assert(await arrange.isVisible());
    return { database: session.current.database, dataDirectoryOverride: false, webviewDirectoryOverride: false };
  });
  if (!remaining) await step("real-pointer-reorder-field-edit-confirmed-undo-and-redo", async () => {
    const handle = page.locator(".inspector-panel .command-drag-handle").first();
    await handle.scrollIntoViewIfNeeded();
    const target = page.locator(".inspector-panel .command-card-header").nth(2);
    await target.scrollIntoViewIfNeeded();
    const a = await handle.boundingBox(), b = await target.boundingBox(); assert(a && b);
    assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest(".command-card")
      ?.getAttribute("data-command-index"), { x: a.x + a.width / 2, y: a.y + a.height / 2 }), "0");
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move(b.x + 20, b.y + b.height - 2, { steps: 4 }); await page.mouse.up();
    await waitOrder([200, 300, 100]);
    await undo(false); await waitOrder([200, 300, 100]);
    await undo(); await waitOrder([100, 200, 300]);
    await page.keyboard.press("Control+y"); await waitOrder([200, 300, 100]);
    await editFirst(250); await waitOrder([250, 300, 100]);
    await session.shot("installed-event-reordered-and-edited");
    return { order: [250, 300, 100], confirmedUndoSteps: 1, redoSteps: 1 };
  });
  let restorePoint;
  if (!remaining) await step("event-delete-and-one-step-undo-preserve-native-recovery-point", async () => {
    restorePoint = await until(() => points().find(p => durations(p.value).join(",") === "250,300,100"),
      "native reordered-event recovery point", 30000);
    retain(restorePoint, "event-order");
    const before = graph(await current());
    await page.locator(".inspector-panel [aria-label='事件操作']").first().click();
    await page.locator(".command-card-menu-popover").getByRole("button", { name: "删除事件" }).click();
    await waitOrder([300, 100]);
    await undo(); await waitGraph(before, "deleted event restored exactly");
    return { nativeRecovery: restorePoint.sha256, deletedEventRestored: true };
  });
  await step("options-timeline-real-native-restore-backs-up-newer-events-before-replacing", async () => {
    if (remaining) {
      // Inherit the passed pointer/delete/undo group without repeating it.
      // Establish native snapshots through normal fields in the new QA profile.
      await editFirst(251); await waitOrder([251, 300, 100]);
      await until(() => points().some(p => durations(p.value).join(",") === "251,300,100"), "first native edit", 30000);
      await editFirst(250); await waitOrder([250, 300, 100]);
      restorePoint = await until(() => points().find(p => durations(p.value).join(",") === "250,300,100"),
        "new-profile native event recovery point", 30000);
      retain(restorePoint, "event-order");
    }
    await editFirst(270); await waitOrder([270, 300, 100]);
    const before = graph(await current());
    fs.writeFileSync(path.join(out, "before-restore-graph.json"), JSON.stringify(before, null, 2), { flag: "wx" });
    await until(() => points().some(p => durations(p.value).join(",") === "270,300,100"), "new edit native recovery", 30000);
    await page.locator("[data-workspace-surface='options']").click();
    const tab = page.locator("nav [data-help-key='advanced.tab.history']");
    assert.equal((await tab.textContent()).trim(), "时间线"); await tab.click();
    const panel = page.locator(".advanced-tab-content:not([inert]) .project-timeline-panel");
    await panel.locator("[data-help-key='timeline.refresh']").click();
    await panel.locator(".timeline-entry button").first().waitFor();
    const index = points().slice(0, 10).findIndex(p => p.name === restorePoint.name); assert(index >= 0);
    await panel.locator(".timeline-entry button").nth(index).click();
    const dialog = page.getByTestId("timeline-restore-confirmation"); await dialog.waitFor();
    await dialog.getByRole("button", { name: "恢复备份", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
    await waitOrder([250, 300, 100]); expected = graph(await current());
    assert.deepEqual(expected, graph(restorePoint.value));
    const candidates = points().filter(p => p.meta.trigger === "before_restore");
    for (const [i, candidate] of candidates.entries()) retain(candidate, "before-restore-candidate-" + i);
    const preserved = candidates.find(p => isDeepStrictEqual(graph(p.value), before));
    assert(preserved, "The exact newer graph must be retained before restoring");
    fs.writeFileSync(path.join(out, "expected-restart-graph.json"), JSON.stringify(expected, null, 2), { flag: "wx" });
    await session.shot("installed-options-timeline-restored");
    return { restoredOrder: [250, 300, 100], priorOrderBackedUp: [270, 300, 100], nativeFilesystem: true };
  });
  await step("first-normal-window-close-waits-for-owned-product-exit", () => session.naturalClose());
  await step("same-default-profile-native-restart-reads-exact-event-graph", async () => {
    await start("restart1979"); await open();
    await waitGraph(expected, "same default profile event graph after native restart");
    await page.locator("[data-workspace-surface='edit']").click(); await selectScene();
    assert.deepEqual(durations(await current()), [250, 300, 100]);
    await session.shot("installed-event-order-after-native-restart");
    return { database: session.current.database, expected: sha(path.join(out, "expected-restart-graph.json")) };
  });
  await step("second-normal-window-close-and-install-registration-restoration", async () => {
    const closed = await session.naturalClose(); if (!followup) install("Restore"); return closed;
  });
  assert.equal(report.stages.length, remaining ? 6 : 8); assert(report.stages.every(s => s.status === "PASS"));
  assert.equal(report.errors.length, 0); assert.equal(report.blockedModelRequests || 0, 0);
  report.status = "PASS";
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
