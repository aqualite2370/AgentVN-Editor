"use strict";
// Actual frozen NSIS, ordinary disposable default profile, real UI and native files.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process"), net = require("node:net");
const assert = require("node:assert/strict"), { isDeepStrictEqual } = require("node:util");
const { defaultEditorSession } = require("./lib/qa-default-editor-session.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { until } = require("./lib/current-native-editor-session.cjs");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const { recoveryPoints } = require("./lib/native-editor-recovery-files.cjs");
const base = path.resolve(process.argv[2] || "");
assert.equal(process.argv.length, 3);
assert.equal(base, path.resolve("F:/testavn/Windows-Isolated-1982-20261116-01"));
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const owner = read(path.join(base, "account-controller.json"));
assert.equal(require("node:os").userInfo().username, owner.account.name);
const candidate = read(path.join(base, "candidate.json")), fixture = read(path.join(base, "fixture.vnproj"));
const out = path.join(base, "resource-01"); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "ACTUAL_1982_NSIS_FIXED_ARRANGE_IDEMPOTENCE_DEFAULT_PROFILE_HISTORY_RESTART_HOVER",
  stages: [], launches: [], cleanups: [], screenshots: [], errors: [], backupEvidence: [],
  modelRequests: 0, computerUse: false, storeInjection: false, controlledNativeIPC: false,
  controlledRequestDelivery: false, fixtureImport: "Public backend import; subsequent operations use actual installed UI" };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const graph = project => ({ nodes: project.nodes.map(node =>
  ({ id: node.id, data: node.data, position: node.position })),
  edges: project.edges.map(({ selected, ...edge }) => edge) });
const content = project => ({ nodes: project.nodes.map(node => ({ id: node.id, data: node.data })), edges: graph(project).edges });
let session, page, installation, backendPort, original, arranged;
const current = () => session.api("/api/project/projects/" + fixture.project_id);
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
}
async function open() {
  await page.locator(".recent-project-open:not(:disabled)").filter({ hasText: fixture.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
}
const button = () => page.locator("main > aside.node-palette [data-help-key='toolbar.autoArrange']");
async function geometry() {
  assert.equal(await button().count(), 1); assert(await button().isVisible());
  assert.equal(await page.locator(".flow-surface [data-help-key='toolbar.autoArrange']").count(), 0);
  const result = await button().evaluate(el => {
    const rail = el.closest("aside.node-palette"), box = el.getBoundingClientRect(), parent = rail.getBoundingClientRect();
    return { button: { x: box.x, y: box.y, width: box.width, height: box.height },
      rail: { x: parent.x, y: parent.y, width: parent.width, height: parent.height },
      bottomGap: parent.bottom - box.bottom,
      actualHit: document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest("button") === el,
      correctOwner: rail.parentElement?.tagName === "MAIN" };
  });
  assert(result.correctOwner && result.actualHit); assert(result.bottomGap >= 0 && result.bottomGap <= 32);
  for (const target of await page.locator("main > aside.node-palette button").all()) {
    await target.hover({force:true});
    assert(["none","normal"].includes(await target.evaluate(el=>getComputedStyle(el,"::after").content)));
  }
  return result;
}
async function waitGraph(expected, label) {
  return until(async () => {
    const actual = await current(); return isDeepStrictEqual(graph(actual), expected) ? actual : null;
  }, label, 30000);
}
async function undo(confirm) {
  await page.locator(".flow-surface").click({ position: { x: 15, y: 15 } });
  await page.keyboard.press("Control+z");
  const dialog = page.getByTestId("editor-undo-confirmation"); await dialog.waitFor();
  const text = await dialog.innerText();
  await dialog.getByRole("button", { name: confirm ? "确认撤销" : "取消", exact: true }).click();
  await dialog.waitFor({ state: "hidden" }); return text;
}
(async () => {
  save();
  backendPort = await new Promise((resolve, reject) => {
    const server = net.createServer(); server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port)); });
  });
  await step("actual1982-install-and-payload", async () => {
    install("Snapshot"); installation = install("New"); report.installations = 1;
    assert.equal(installation.executable.version, "1.9.82");
    const payload = read(candidate.payloadReport.path).deployments.find(item => item.kind === "NSIS actual payload");
    assert(payload); assert.equal(sha(installation.executable.path), payload.executable.sha256);
    return { executable: installation.executable, installer: candidate.installer, builds: 0, upgradeClaim: false };
  });
  await step("default-profile-import-and-left-aside-real-hit", async () => {
    await start("first-organize1982");
    const response = await fetch(`http://127.0.0.1:${backendPort}/api/project/projects/import`, {
      method: "POST", headers: { "content-type": "application/octet-stream" },
      body: fs.readFileSync(path.join(base, "fixture.vnproj")) });
    assert(response.ok && (await response.json()).ok);
    await page.reload(); await open(); original = graph(await current());
    fs.writeFileSync(path.join(out, "original-graph.json"), JSON.stringify(original, null, 2), { flag: "wx" });
    return { geometry: await geometry(), defaultDatabase: session.current.database,
      dataDirectoryOverride: false, webviewDirectoryOverride: false };
  });
  await step("real-pointer-organize-persists-positions-preserves-events-and-connections", async () => {
    await button().click();
    const saved = await until(async () => {
      const value = await current();
      return !isDeepStrictEqual(graph(value).nodes.map(node => node.position), original.nodes.map(node => node.position)) ? value : null;
    }, "Actual pointer organize persisted positions", 30000);
    arranged = graph(saved);
    assert.deepEqual(content(saved), content(original));
    await page.getByText(/^已整理画布：移动 \d+ 个节点。$/).filter({ visible: true }).first().waitFor();
    await until(async () => page.locator(".react-flow__node").evaluateAll(nodes => {
      const entry = nodes.find(node => node.querySelector(".node-kind-start") || node.dataset.id === "start");
      if (!entry) return null;
      const box = entry.getBoundingClientRect(), surface = entry.closest(".flow-surface").getBoundingClientRect();
      return box.width > 0 && box.x >= surface.x && box.right <= surface.right &&
        box.y >= surface.y && box.bottom <= surface.bottom ? { entryVisible: true } : null;
    }), "Organized entry visible after real fitView", 15000);
    fs.writeFileSync(path.join(out, "arranged-graph.json"), JSON.stringify(arranged, null, 2), { flag: "wx" });
    const directory = path.join(path.dirname(path.dirname(session.current.database)), "backup-timeline");
    const point = await until(() => recoveryPoints(directory, fixture.project_id)
      .find(item => isDeepStrictEqual(graph(item.value), arranged)), "Native automatic checkpoint retains arranged graph", 30000);
    const retained = path.join(out, "arranged-native-backup.vnproj");
    fs.copyFileSync(point.path, retained, fs.constants.COPYFILE_EXCL);
    fs.copyFileSync(point.metaPath, retained + ".meta.json", fs.constants.COPYFILE_EXCL);
    assert.equal(sha(retained), point.sha256);
    report.backupEvidence.push({ path: retained, sha256: sha(retained), source: point.path,
      metadata: { path: retained + ".meta.json", sha256: sha(retained + ".meta.json") } }); save();
    await session.shot("installed-left-aside-organized");
    return { positionsChanged: true, nodeDataAndConnectionsUnchanged: true, nativeAutomaticBackup: true,
      entryVisible: true, geometry: await geometry() };
  });
  await step("organize-confirm-cancel-undo-redo-and-keyboard-noop", async () => {
    const cancelText = await undo(false); await waitGraph(arranged, "Cancel preserves organized graph");
    const confirmText = await undo(true); await waitGraph(original, "One confirmed undo restores pre-organize graph");
    await page.keyboard.press("Control+y"); await waitGraph(arranged, "One redo restores organized graph");
    await button().focus(); await button().press("Enter");
    await page.getByText("已整理画布：移动 0 个节点。", { exact: true }).filter({ visible: true }).first().waitFor();
    assert.deepEqual(graph(await current()), arranged);
    const focus = await button().evaluate(el => document.activeElement === el); assert(focus);
    for (let i=0;i<3;i++) await button().click();
    assert.deepEqual(graph(await current()), arranged);
    await undo(true); await waitGraph(original, "Noop keyboard organize does not consume an undo step");
    await page.keyboard.press("Control+y"); await waitGraph(arranged, "Final arranged graph persisted");
    return { cancelText, confirmText, keyboardNoopPreservesGraph: true, focusRetained: focus,
      undoSteps: 1, redoSteps: 1 };
  });
  await step("first-normal-close", () => session.naturalClose());
  await step("same-default-profile-restart-and-native-graph-readback", async () => {
    await start("restart-organize1982"); await open();
    assert.deepEqual(graph(await current()), arranged);
    await session.shot("installed-left-aside-restart");
    return { geometry: await geometry(), defaultDatabase: session.current.database,
      nodes: arranged.nodes.length, edges: arranged.edges.length,
      expectedGraphSha256: sha(path.join(out, "arranged-graph.json")) };
  });
  await step("second-normal-close-and-own-registration-restore", async () => {
    const closed = await session.naturalClose(); install("Restore"); return closed;
  });
  assert.equal(report.stages.length, 7); assert(report.stages.every(row => row.status === "PASS"));
  assert.deepEqual(report.errors, []); assert.equal(report.blockedModelRequests || 0, 0);
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
  console.log(JSON.stringify({ status: report.status, stages: report.stages.length, out, error: report.error }));
});
