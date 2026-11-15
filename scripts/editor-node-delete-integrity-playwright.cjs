"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const { until } = require("./lib/current-native-editor-session.cjs");
const out = path.resolve(process.argv[2] || "");
assert(out.startsWith("F:\\testavn\\Editor-Delete-Integrity-20261116-01\\") && !fs.existsSync(out));
fs.mkdirSync(out, { recursive: true });
const report = { status: "RUNNING", scope: "SOURCE_FULL_APP_UI_REAL_BACKEND_DELETE_UNDO_REDO_REOPEN",
  cases: [], errors: [], models: 0, computerUse: false, sources: [] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
for (const relative of ["editor/src/store/editorStore.ts", "editor/src/utils/nodeFactory.ts",
  "editor/src/components/editor/VisualNovelEditor.tsx", "editor/src/components/editor/InspectorPanel.tsx"]) {
  const source = path.resolve(__dirname, "..", relative), retained = path.join(out, "sources", relative);
  fs.mkdirSync(path.dirname(retained), { recursive: true });
  fs.copyFileSync(source, retained, fs.constants.COPYFILE_EXCL);
  report.sources.push({ source, retained, sha256: sha(source) });
}
const project = fixture("qa_delete_integrity_" + Date.now());
const common = structuredClone(project.nodes[1].data);
project.viewport = { x: 40, y: 40, zoom: 0.65 };
project.nodes[1].position = { x: 280, y: 180 };
project.nodes[1].data.scene.commands.push({ type: "choice", choices: [
  { choice_id: "embedded_go", text: "前往目标", target_scene_id: "target_scene", conditions: [] },
  { choice_id: "embedded_keep", text: "保留", target_scene_id: "ui_acceptance", conditions: [] },
] });
project.nodes.push(
  { id: "branch", type: "choiceNode", position: { x: 260, y: 560 },
    data: { ...common, scene: undefined, nodeKind: "choice", label: "独立分支", choice: { type: "choice", choices: [
      { choice_id: "branch_go", text: "目标", target_scene_id: "target_scene", conditions: [] },
      { choice_id: "branch_keep", text: "保留", target_scene_id: "ui_acceptance", conditions: [] },
    ] } } },
  { id: "target", type: "sceneNode", position: { x: 780, y: 360 },
    data: { ...common, label: "待删除目标", scene: { ...common.scene, scene_id: "target_scene", title: "待删除目标" } } },
);
project.edges.push(
  { id: "branch_target", source: "branch", sourceHandle: "branch_go", target: "target" },
  { id: "branch_keep", source: "branch", sourceHandle: "branch_keep", target: "scene" },
  { id: "embedded_target", source: "scene", sourceHandle: "embedded_go", target: "target" },
);
const input = path.join(out, "fixture.vnproj");
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
process.env.AGENTVN_TEST_PROJECT = input; process.env.AGENTVN_WORKSPACE_OUTPUT = path.join(out, "service");
let service, browser, page;
async function graph() {
  return page.evaluate(async () => {
    const s = (await import("/src/store/editorStore.ts")).useEditorStore.getState();
    return JSON.parse(JSON.stringify({ nodes: s.nodes.map(n => ({ id: n.id, data: n.data })),
      edges: s.edges, past: s.graphHistory.past.length, future: s.graphHistory.future.length,
      batch: s.graphHistory.activeBatch, dirty: s.dirty }));
  });
}
const content = g => ({ nodes: g.nodes, edges: g.edges });
async function settled() {
  await until(() => page.evaluate(async () => {
    const s = (await import("/src/store/editorStore.ts")).useEditorStore.getState();
    return !s.dirty && !s.graphHistory.activeBatch;
  }), "actual deletion write and history transaction complete", 30000);
}
async function assertDeleted() {
  const g = await graph();
  assert(!g.nodes.some(n => n.id === "target"));
  assert(!g.edges.some(e => e.source === "target" || e.target === "target"));
  const choices = g.nodes.find(n => n.id === "branch").data.choice.choices;
  const embedded = g.nodes.find(n => n.id === "scene").data.scene.commands.find(c => c.type === "choice").choices;
  assert.equal(choices[0].target_scene_id, ""); assert.equal(embedded[0].target_scene_id, "");
  assert.equal(choices[1].target_scene_id, "ui_acceptance");
  assert.equal(embedded[1].target_scene_id, "ui_acceptance");
  return g;
}
async function undo(confirm = true) {
  await page.keyboard.press("Control+z");
  const dialog = page.getByTestId("editor-undo-confirmation");
  await dialog.waitFor();
  await dialog.getByRole("button", { name: confirm ? "确认撤销" : "取消", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
}
async function check(name, fn) {
  const row = { name, status: "RUNNING" }; report.cases.push(row); save();
  try { await fn(row); row.status = "PASS"; }
  catch (error) {
    row.status = "FAILED"; row.error = error.stack;
    await page?.screenshot({ path: path.join(out, `${report.cases.length}-failed.png`) }).catch(() => {});
  }
  save();
  if (row.status !== "PASS") throw Error(name + " failed");
}
(async () => {
  save(); service = await startEditorAcceptance(process.env.AGENTVN_WORKSPACE_OUTPUT,
    { isolateBackendWorkingDirectory: true });
  report.service = { url: service.url, backendUrl: service.backendUrl,
    backendPid: service.backendPid, vitePid: service.server.pid, runId: service.server.runId };
  const temporary = path.join(out, "temp"); fs.mkdirSync(temporary);
  process.env.TEMP = temporary; process.env.TMP = temporary;
  browser = await chromium.launch({ headless: true, env: { ...process.env, TEMP: temporary, TMP: temporary } });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on("pageerror", error => report.errors.push(String(error)));
  await service.open(page); await settled();
  let original, deleted;
  await check("Entry Inspector and actual keyboard deletion preserve entry and link", async row => {
    const start = page.locator(".react-flow__node[data-id='start']");
    await start.click(); await page.locator(".inspector-panel button[data-help-key='inspector.deleteNode']").waitFor();
    assert(await page.locator(".inspector-panel button[data-help-key='inspector.deleteNode']").isDisabled());
    const before = await graph(); await start.focus(); await page.keyboard.press("Backspace");
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    const after = await graph(); assert.deepEqual(content(after), content(before)); assert.equal(after.past, before.past);
    row.nodeIds = after.nodes.map(n => n.id); row.edges = after.edges.map(e => e.id);
  });
  await check("Inspector removes target and stale branch data; cancel/undo/redo is exact", async row => {
    await page.locator(".react-flow__node[data-id='target']").click();
    original = await graph();
    await page.locator(".inspector-panel button[data-help-key='inspector.deleteNode']").click();
    await page.locator(".react-flow__node[data-id='target']").waitFor({ state: "detached" });
    deleted = await assertDeleted(); assert.equal(deleted.past, original.past + 1);
    await page.locator(".flow-surface").click({ position: { x: 15, y: 15 } });
    await undo(false); assert.deepEqual(content(await graph()), content(deleted));
    await undo(); assert.deepEqual(content(await graph()), content(original));
    await page.keyboard.press("Control+y");
    assert.deepEqual(content(await assertDeleted()), content(deleted));
    row.removedIds = ["target"]; row.historySteps = 1;
  });
  await check("Real canvas keyboard deletion undoes node and all links in one step", async row => {
    await undo(); assert.deepEqual(content(await graph()), content(original));
    const target = page.locator(".react-flow__node[data-id='target']");
    await target.click(); await target.focus();
    const before = await graph();
    await page.keyboard.press("Backspace");
    await target.waitFor({ state: "detached" });
    await settled();
    const removed = await assertDeleted(); assert.equal(removed.past, before.past + 1); assert(!removed.batch);
    await page.locator(".flow-surface").click({ position: { x: 15, y: 15 } });
    await undo(); assert.deepEqual(content(await graph()), content(original));
    await page.keyboard.press("Control+y");
    deleted = await assertDeleted(); row.historySteps = 1; row.edges = deleted.edges.map(e => e.id);
  });
  await check("Automatic DB persistence and full page reopen retain deletion and clean targets", async row => {
    await settled();
    const response = await fetch(`${service.backendUrl}/api/project/projects/${project.project_id}`);
    assert(response.ok); const remote = await response.json(); assert(remote.ok);
    assert.deepEqual({ nodes: remote.data.nodes.map(n => ({ id: n.id, data: n.data })), edges: remote.data.edges }, content(deleted));
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await page.locator(".recent-project-open").filter({ hasText: project.title }).click();
    await page.locator(".editor-toolbar").waitFor(); await settled();
    assert.deepEqual(content(await assertDeleted()), content(deleted));
    row.remoteNodeIds = remote.data.nodes.map(n => n.id);
    const dimensions = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
    const screenshot = path.join(out, "reopened.png"); await page.screenshot({ path: screenshot });
    const after = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
    assert.deepEqual(after, dimensions);
    const png = fs.readFileSync(screenshot);
    assert.equal(png.readUInt32BE(16), dimensions.width * dimensions.dpr);
    assert.equal(png.readUInt32BE(20), dimensions.height * dimensions.dpr);
    row.capture = { path: screenshot, sha256: sha(screenshot), dimensions };
  });
  assert.equal(report.errors.length, 0);
  assert.equal(report.cases.length, 4);
  for (const file of report.sources) assert.equal(sha(file.source), file.sha256);
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = error.stack; }).finally(async () => {
  try {
    await browser?.close(); await service?.stop();
    report.cleanup = "OWNED_BROWSER_AND_SERVICES_STOPPED";
  } catch (error) { report.cleanup = "FAILED"; report.cleanupError = error.stack; report.status = "FAILED"; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, cases: report.cases, errors: report.errors, out }));
  if (report.status !== "PASS") process.exitCode = 1;
});
