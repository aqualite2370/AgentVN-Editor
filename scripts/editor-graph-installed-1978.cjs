"use strict";
// Actual installed Editor/default QA profile; no source server or store/IPC injection.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process"), net = require("node:net");
const assert = require("node:assert/strict");
const { defaultEditorSession } = require("./lib/qa-default-editor-session.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { until } = require("./lib/current-native-editor-session.cjs");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const base = path.resolve(process.argv[2] || "");
const prior = path.resolve("F:/testavn/Windows-Isolated-1978-20261116-01");
const followup = base === path.resolve("F:/testavn/Windows-Isolated-1978-20261116-02");
assert(followup || base === prior);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const owner = read(path.join(base, "account-controller.json"));
assert.equal(require("node:os").userInfo().username, owner.account.name);
const out = path.join(base, "resource-01"); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const fixture = read(path.join(base, "fixture.vnproj")), candidate = read(path.join(base, "candidate.json"));
const incoming = path.join(base, "route.vnproj");
const report = { status: "RUNNING", scope: "ACTUAL_NSIS_1978_DEFAULT_PROFILE_GRAPH_DELETE_ROUTE_UNDO_REDO_RESTART",
  stages: [], launches: [], cleanups: [], screenshots: [], errors: [], writes: [],
  modelRequests: 0, computerUse: false, controlledNativeIPC: false, storeInjection: false,
  controlledRequestDelivery: false, startedAt: new Date().toISOString() };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let session, page, installation, backendPort, original, deleted, withRoute;
const current = () => session.api("/api/project/projects/" + fixture.project_id);
const graph = g => ({ nodes: g.nodes.map(n => ({ id: n.id, position: n.position, data: n.data })),
  edges: g.edges.map(({ selected, ...e }) => e) });
async function step(name, operation) {
  const row = { name, status: "RUNNING" }; report.stages.push(row); save();
  try { row.detail = await operation(); row.status = "PASS"; }
  catch (error) {
    row.status = "FAILED"; row.error = error.stack;
    if (page && !page.isClosed()) await session.shot(`failed-stage-${report.stages.length}`).catch(() => {});
    throw error;
  } finally { save(); console.log(JSON.stringify(row)); }
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
}
async function open() {
  await page.locator(".recent-project-open:not(:disabled)").filter({ hasText: fixture.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
}
async function waitGraph(expected, label) {
  await until(async () => {
    const value = graph(await current());
    try { assert.deepEqual(value, expected); return true; } catch { return false; }
  }, label, 45000);
}
async function focusCanvas() {
  await page.locator(".flow-surface").click({ position: { x: 15, y: 15 } });
}
async function undo(confirm = true) {
  await focusCanvas(); await page.keyboard.press("Control+z");
  const dialog = page.getByTestId("editor-undo-confirmation"); await dialog.waitFor();
  await dialog.getByRole("button", { name: confirm ? "确认撤销" : "取消", exact: true }).click();
  await dialog.waitFor({ state: "hidden" }); await settleEditor(page);
}
function assertDeleted(value) {
  assert(!value.nodes.some(n => n.id === "target"));
  assert(!value.edges.some(e => e.source === "target" || e.target === "target"));
  const standalone = value.nodes.find(n => n.id === "branch").data.choice.choices;
  const embedded = value.nodes.find(n => n.id === "scene").data.scene.commands.find(c => c.type === "choice").choices;
  for (const choices of [standalone, embedded]) {
    assert.equal(choices[0].target_scene_id, "");
    assert.equal(choices[1].target_scene_id, "ui_acceptance");
  }
}
(async () => {
  save(); backendPort = await new Promise((resolve, reject) => {
    const server = net.createServer(); server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(e => e ? reject(e) : resolve(port)); });
  });
  await step(followup ? "reuse-prior-actual-install-and-verify-exact-payload" : "actual-nsis-install-and-exact-payload", async () => {
    if (followup) {
      const receipt = path.join(prior, "install-new.json"), failed = path.join(prior, "resource-01/report.json");
      installation = read(receipt); assert.equal(installation.status, "PASS");
      const originalRun = read(failed); assert.equal(originalRun.status, "FAILED");
      assert(originalRun.stages.slice(0, 4).every(s => s.status === "PASS"));
      report.inheritedInstall = { receipt: { path: receipt, sha256: sha(receipt) },
        failedRun: { path: failed, sha256: sha(failed) }, fixture: read(path.join(base, "inherited-fixture.json")) };
      report.installations = 0;
    } else { install("Snapshot"); installation = install("New"); report.installations = 1; }
    assert.equal(installation.executable.version, "1.9.78");
    const payload = read(candidate.payloadReport.path).deployments.find(d => d.kind === "NSIS actual payload");
    assert(payload); assert.equal(sha(installation.executable.path), payload.executable.sha256);
    for (const resource of [{ name: "build-versions.json", ...payload.versionResource }, ...payload.runtimeProvenance])
      assert.equal(sha(path.join(installation.installRoot, resource.name)), resource.sha256);
    return { executable: installation.executable, exactPayload: true, upgradeClaim: false };
  });
  await step(followup ? "fresh-default-profile-restores-prior-real-saved-103-node-graph"
    : "default-profile-import-entry-protection-and-aside-button", async () => {
    await start("first1978");
    const response = await fetch(`http://127.0.0.1:${backendPort}/api/project/projects/import`, {
      method: "POST", headers: { "content-type": "application/octet-stream" },
      body: fs.readFileSync(path.join(base, "fixture.vnproj")) });
    assert(response.ok && (await response.json()).ok);
    await page.reload(); await open(); original = graph(await current());
    if (followup) {
      assert.equal(original.nodes.length, 103); assertDeleted(original); deleted = original;
      return { database: session.current.database, inheritedSavedNodes: original.nodes.length,
        inheritedSource: report.inheritedInstall.fixture, newDefaultQaProfile: true, sameOldProfileClaim: false };
    }
    assert.equal(original.nodes.length, 4);
    const entry = page.locator(".react-flow__node[data-id='start']");
    await entry.click();
    assert(await page.locator(".inspector-panel button[data-help-key='inspector.deleteNode']").isDisabled());
    await entry.focus(); await page.keyboard.press("Backspace");
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    assert(await entry.isVisible()); assert.deepEqual(graph(await current()), original);
    const arrange = page.locator("main > aside.node-palette [data-help-key='toolbar.autoArrange']");
    // This is a DOM ownership check; arranging is already covered by the retained installed author tests.
    assert.equal(await arrange.count(), 1); assert(await arrange.isVisible());
    return { database: session.current.database, entryAndLinksPreserved: true, arrangeInsideAside: true };
  });
  if (!followup) {
  await step("inspector-delete-cancel-undo-redo-cleans-all-choice-targets", async () => {
    await page.locator(".react-flow__node[data-id='target']").click();
    await page.locator(".inspector-panel button[data-help-key='inspector.deleteNode']").click();
    await page.locator(".react-flow__node[data-id='target']").waitFor({ state: "detached" });
    await until(async () => (await current()).nodes.length === 3, "Inspector deletion saved");
    deleted = graph(await current()); assertDeleted(deleted);
    await undo(false); assert.deepEqual(graph(await current()), deleted);
    await undo(); await page.locator(".react-flow__node[data-id='target']").waitFor();
    await waitGraph(original, "Inspector undo restores graph and both choice targets");
    await focusCanvas(); await page.keyboard.press("Control+y");
    await waitGraph(deleted, "Inspector redo saved"); assertDeleted(graph(await current()));
    return { originalNodes: 4, deletedNodes: 3, undoCancelledWithoutChanges: true, cleanedChoiceTargets: 2 };
  });
  await step("keyboard-delete-restores-node-and-edges-in-one-confirmed-undo", async () => {
    await undo(); await waitGraph(original, "restore before real keyboard delete");
    const target = page.locator(".react-flow__node[data-id='target']");
    await target.click(); await target.focus(); await page.keyboard.press("Backspace");
    await target.waitFor({ state: "detached" }); await waitGraph(deleted, "keyboard deletion saved");
    await undo(); await waitGraph(original, "one confirmed undo restores node and all edges");
    await focusCanvas(); await page.keyboard.press("Control+y");
    await waitGraph(deleted, "one redo removes complete operation"); assertDeleted(graph(await current()));
    await session.shot("installed-delete-restored-and-redone");
    return { confirmedUndoSteps: 1, redoSteps: 1, restoredNodes: original.nodes.length, restoredEdges: original.edges.length };
  });
  }
  await step("real-toolbar-100-node-route-is-one-persisted-undo-and-redo", async () => {
    const existingIds = new Set(deleted.nodes.map(n => n.id));
    await page.locator("[data-help-key='toolbar.importProject'] input[type='file']").setInputFiles(incoming);
    await until(async () => (await current()).nodes.length === deleted.nodes.length + 100, "complete route persisted");
    withRoute = graph(await current());
    assert.equal(withRoute.edges.length, deleted.edges.length + 99);
    const added = withRoute.nodes.filter(n => !existingIds.has(n.id));
    assert.equal(added.length, 100); assert(added.every(n => n.data.nodeKind === "scene"));
    assert.equal(new Set(added.map(n => n.data.scene.scene_id)).size, 100);
    await undo(false); assert.deepEqual(graph(await current()), withRoute);
    await undo(); await waitGraph(deleted, "one undo removes all 100 imported nodes and 99 internal edges");
    await focusCanvas(); await page.keyboard.press("Control+y");
    await waitGraph(withRoute, "one redo restores all route nodes and edges");
    fs.writeFileSync(path.join(out, "expected-restart-graph.json"), JSON.stringify(withRoute, null, 2), { flag: "wx" });
    await session.shot("installed-complete-route");
    return { beforeNodes: deleted.nodes.length, importedNodes: 100, importedInternalEdges: 99,
      afterNodes: withRoute.nodes.length, afterEdges: withRoute.edges.length, undoSteps: 1, redoSteps: 1 };
  });
  await step("first-normal-window-close", () => session.naturalClose());
  await step("same-default-profile-restart-preserves-exact-graph-and-choice-data", async () => {
    await start("restart1978"); await open(); await waitGraph(withRoute, "same default DB exact graph after restart");
    const restored = graph(await current()); assertDeleted(restored);
    await session.shot("installed-graph-after-restart");
    return { database: session.current.database, nodes: restored.nodes.length, edges: restored.edges.length,
      expectedGraphSha256: sha(path.join(out, "expected-restart-graph.json")) };
  });
  await step(followup ? "second-normal-window-close-no-installation-registration-changes"
    : "second-normal-window-close-and-registration-restored", async () => {
    const close = await session.naturalClose(); if (!followup) install("Restore"); return close;
  });
  assert.equal(report.stages.length, followup ? 6 : 8); assert(report.stages.every(s => s.status === "PASS"));
  assert.equal(report.errors.length, 0); assert.equal(report.blockedModelRequests || 0, 0);
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = error.stack; process.exitCode = 1; })
.finally(async () => {
  try {
    await session?.stop();
    if (fs.existsSync(path.join(base, "metadata-before.json")) && !fs.existsSync(path.join(base, "metadata-restoration.json")))
      install("Restore");
    report.cleanupStatus = "PASS";
  } catch (error) { report.cleanupStatus = "FAILED"; report.cleanupError = error.stack; report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, stages: report.stages.length, error: report.error, out }));
});
