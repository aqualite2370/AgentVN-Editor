"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const { until } = require("./lib/current-native-editor-session.cjs");
const out = path.resolve(process.argv[2] || "");
assert(out.startsWith("F:\\testavn\\Editor-Delete-Integrity-20261116-01\\") && !fs.existsSync(out));
fs.mkdirSync(out, { recursive: true });
const project = fixture("qa_route_atomic_" + Date.now()); project.title = "线路导入验收 A";
const other = fixture("qa_route_other_" + Date.now()); other.title = "线路导入验收 B";
const incoming = fixture("qa_route_external"), prototype = structuredClone(incoming.nodes[1]);
incoming.nodes = [incoming.nodes[0]]; incoming.edges = [];
for (let i = 0; i < 100; i++) {
  const node = structuredClone(prototype); node.id = `incoming_${i}`; node.data.label = `导入 ${i}`;
  node.data.scene.scene_id = `route_${i}`; node.data.scene.title = node.data.label;
  node.position = { x: i * 300, y: 200 }; incoming.nodes.push(node);
  if (i) incoming.edges.push({ id: `route_edge_${i}`, source: `incoming_${i - 1}`, target: node.id, sourceHandle: "default" });
}
incoming.edges.push({ id: "route_entry", source: "start", target: "incoming_0", sourceHandle: "default" });
const input = path.join(out, "fixture.vnproj");
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
process.env.AGENTVN_TEST_PROJECT = input; process.env.AGENTVN_WORKSPACE_OUTPUT = path.join(out, "service");
const report = { status: "RUNNING", scope: "SOURCE_FULL_APP_NORMAL_FILE_IMPORT_REAL_BACKEND_CONTROLLED_FILE_READ_DELAYS",
  cases: [], errors: [], sources: [], models: 0, computerUse: false };
for (const relative of ["editor/src/store/editorStore.ts", "editor/src/components/editor/EditorToolbar.tsx",
  "editor/src/utils/projectImport.ts", "editor/src/utils/editorProjectPersistence.ts"]) {
  const source = path.resolve(__dirname, "..", relative), retained = path.join(out, "sources", relative);
  fs.mkdirSync(path.dirname(retained), { recursive: true });
  fs.copyFileSync(source, retained, fs.constants.COPYFILE_EXCL);
  report.sources.push({ source, retained, sha256: sha(source) });
}
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let service, browser, page;
async function state() {
  return page.evaluate(async () => {
    const s = (await import("/src/store/editorStore.ts")).useEditorStore.getState();
    const p = (await import("/src/store/projectStore.ts")).useProjectStore.getState();
    return JSON.parse(JSON.stringify({ graph: { nodes: s.nodes.map(n => ({ id: n.id, data: n.data })), edges: s.edges },
      projectId: p.projectId, assets: p.assetManifest, generation: s.projectLoadGeneration,
      notice: s.lastError, past: s.graphHistory.past.length, future: s.graphHistory.future.length }));
  });
}
async function settled() {
  await until(() => page.evaluate(async () =>
    !(await import("/src/store/editorStore.ts")).useEditorStore.getState().dirty),
  "actual graph write acknowledged", 30000);
}
async function home() {
  await page.locator("[data-help-key='toolbar.home']").click();
  await page.locator(".editor-toolbar").waitFor({ state: "detached" });
}
async function openRecent(title) {
  await page.locator(".recent-project-open:not(:disabled)").filter({ hasText: title }).click();
  await page.locator(".editor-toolbar").waitFor(); await settled();
}
async function undo(confirm = true) {
  await page.locator(".flow-surface").click({ position: { x: 15, y: 15 } });
  await page.keyboard.press("Control+z");
  const dialog = page.getByTestId("editor-undo-confirmation"); await dialog.waitFor();
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
  save(); if (row.status !== "PASS") throw Error(name + " failed");
}
async function holdFile(name, invalid = false) {
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    window.__qaFileHeld = false; window.__qaFileReadReturned = false;
    File.prototype.arrayBuffer = async function () {
      if (!this.name.startsWith("delayed-")) return original.call(this);
      File.prototype.arrayBuffer = original;
      window.__qaFileHeld = true;
      await new Promise(resolve => { window.__qaReleaseFile = resolve; });
      const bytes = await original.call(this);
      window.__qaFileReadReturned = true;
      return bytes;
    };
  });
  await page.locator("[data-help-key='toolbar.importProject'] input[type='file']").setInputFiles({
    name, mimeType: "application/json", buffer: Buffer.from(invalid ? "{invalid" : JSON.stringify(incoming)),
  });
  await page.waitForFunction(() => window.__qaFileHeld);
}
async function releaseFile() {
  await page.evaluate(() => window.__qaReleaseFile());
  await page.waitForFunction(() => window.__qaFileReadReturned);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
}
(async () => {
  save(); service = await startEditorAcceptance(process.env.AGENTVN_WORKSPACE_OUTPUT,
    { isolateBackendWorkingDirectory: true });
  report.service = { url: service.url, backendUrl: service.backendUrl, backendPid: service.backendPid,
    vitePid: service.server.pid, runId: service.server.runId };
  const temporary = path.join(out, "temp"); fs.mkdirSync(temporary);
  process.env.TEMP = temporary; process.env.TMP = temporary;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page = await context.newPage(); page.setDefaultTimeout(25000);
  page.on("pageerror", error => report.errors.push(String(error)));
  await service.open(page); await settled();
  const baseline = (await state()).graph; let imported;
  await check("Normal toolbar import commits 100 nodes and 99 links without a partial store state", async row => {
    await page.evaluate(async () => {
      const store = (await import("/src/store/editorStore.ts")).useEditorStore;
      window.__qaRouteStates = [];
      window.__qaStopRouteObserver = store.subscribe(s => window.__qaRouteStates.push({
        nodes: s.nodes.length, edges: s.edges.length, notice: s.lastError?.message,
      }));
    });
    await page.locator("[data-help-key='toolbar.importProject'] input[type='file']").setInputFiles({
      name: "complete-route.vnproj", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(incoming)),
    });
    await until(async () => (await state()).graph.nodes.length === 102, "full route committed", 30000);
    await settled(); imported = await state();
    assert.equal(imported.graph.edges.length, 100); assert.equal(imported.past, 1);
    const observed = await page.evaluate(() => { window.__qaStopRouteObserver(); return window.__qaRouteStates; });
    assert(observed.length > 0);
    assert(observed.every(s => (s.nodes === 2 && s.edges === 1) || (s.nodes === 102 && s.edges === 100)),
      "Subscribers must never observe a partial imported graph");
    row.observedStates = [...new Set(observed.map(s => `${s.nodes}/${s.edges}`))];
  });
  await check("Undo cancel, whole-route undo and redo retain a complete persisted graph", async row => {
    await undo(false); assert.deepEqual((await state()).graph, imported.graph);
    await undo(); assert.deepEqual((await state()).graph, baseline); await settled();
    await page.keyboard.press("Control+y");
    await until(async () => (await state()).graph.nodes.length === 102, "whole route redone", 30000);
    assert.deepEqual((await state()).graph, imported.graph); await settled();
    const response = await fetch(`${service.backendUrl}/api/project/projects/${project.project_id}`);
    const stored = await response.json(); assert(stored.ok);
    assert.deepEqual({ nodes: stored.data.nodes.map(n => ({ id: n.id, data: n.data })), edges: stored.data.edges }, imported.graph);
    row.nodes = stored.data.nodes.length; row.edges = stored.data.edges.length;
  });
  await check("Late successful file read after A→B cannot modify B", async row => {
    await holdFile("delayed-success.vnproj");
    await home();
    await page.locator(".project-import-button input").first().setInputFiles({
      name: "other-project.vnproj", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(other)),
    });
    await page.locator(".editor-toolbar").waitFor(); await settled();
    const before = await state(); assert.equal(before.projectId, other.project_id);
    await releaseFile(); assert.deepEqual(await state(), before); row.projectId = before.projectId;
  });
  await check("Late file read after A→B→A is rejected by load generation", async row => {
    await home(); await openRecent(project.title);
    await holdFile("delayed-reload.vnproj");
    const owner = await state();
    await home(); await openRecent(other.title);
    await home(); await openRecent(project.title);
    const before = await state(); assert(before.generation > owner.generation);
    await releaseFile(); assert.deepEqual(await state(), before);
    row.ownerGeneration = owner.generation; row.currentGeneration = before.generation;
  });
  await check("Late malformed file error is not shown in another project", async row => {
    await holdFile("delayed-invalid.vnproj", true);
    await home(); await openRecent(other.title);
    const before = await state();
    await releaseFile(); assert.deepEqual(await state(), before); row.projectId = before.projectId;
  });
  await check("Normal home/reopen retains the original completed route", async row => {
    await home(); await openRecent(project.title);
    assert.deepEqual((await state()).graph, imported.graph);
    const before = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
    const screenshot = path.join(out, "reopened-route.png"); await page.screenshot({ path: screenshot });
    const after = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
    assert.deepEqual(after, before);
    const png = fs.readFileSync(screenshot);
    assert.equal(png.readUInt32BE(16), before.width * before.dpr);
    assert.equal(png.readUInt32BE(20), before.height * before.dpr);
    row.capture = { path: screenshot, sha256: sha(screenshot), viewport: before };
  });
  assert.equal(report.errors.length, 0); assert.equal(report.cases.length, 6);
  for (const source of report.sources) assert.equal(sha(source.source), source.sha256);
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = error.stack; }).finally(async () => {
  try {
    await page?.evaluate(() => window.__qaReleaseFile?.()).catch(() => {});
    await browser?.close(); await service?.stop(); report.cleanup = "OWNED_BROWSER_AND_SERVICES_STOPPED";
  } catch (error) { report.cleanup = "FAILED"; report.cleanupError = error.stack; report.status = "FAILED"; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, cases: report.cases, errors: report.errors, out }));
  if (report.status !== "PASS") process.exitCode = 1;
});
