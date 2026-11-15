"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { until } = require("./lib/current-native-editor-session.cjs");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const lateHome = process.argv[3] === "--late-home";
assert(process.argv.length === (lateHome ? 4 : 3));
const out = path.resolve(process.argv[2] || "");
assert(out.startsWith("F:\\testavn\\Editor-Home-Save-Ordering-20261116-01\\"));
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const project = fixture("qa_home_ordering_" + Date.now());
const input = path.join(out, "fixture.vnproj");
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
process.env.AGENTVN_TEST_PROJECT = input;
process.env.AGENTVN_WORKSPACE_OUTPUT = path.join(out, "service");
const report = { status: "RUNNING", scope: "SOURCE_FULL_APP_REAL_ISOLATED_BACKEND_CONTROLLED_REQUEST_DELIVERY",
  cases: [], writes: [], errors: [], sources: [], models: 0, computerUse: false };
for (const relative of ["editor/src/api/backendClient.ts", "editor/src/app/App.tsx",
  "editor/src/components/editor/useEditorProjectAutosave.ts"]) {
  const source = path.resolve(__dirname, "..", relative), retained = path.join(out, "sources", relative);
  fs.mkdirSync(path.dirname(retained), { recursive: true });
  fs.copyFileSync(source, retained, fs.constants.COPYFILE_EXCL);
  report.sources.push({ source, retained, sha256: sha(source) });
}
let service, browser, context, page, gate, blocked, activeWrites = 0;
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function nodes() {
  return page.evaluate(async () => {
    const state = (await import("/src/store/editorStore.ts")).useEditorStore.getState();
    return JSON.parse(JSON.stringify(state.nodes.map(n => ({ id: n.id, data: n.data }))));
  });
}
async function remote() {
  const response = await fetch(`${service.backendUrl}/api/project/projects/${project.project_id}`);
  assert(response.ok); const result = await response.json(); assert(result.ok); return result.data;
}
(async () => {
  save();
  service = await startEditorAcceptance(process.env.AGENTVN_WORKSPACE_OUTPUT, { isolateBackendWorkingDirectory: true });
  report.service = { url: service.url, backendUrl: service.backendUrl, backendPid: service.backendPid,
    vitePid: service.server.pid, runId: service.server.runId };
  const temporary = path.join(out, "temp"); fs.mkdirSync(temporary);
  browser = await chromium.launch({ headless: true, env: { ...process.env, TEMP: temporary, TMP: temporary } });
  context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on("pageerror", e => report.errors.push(String(e)));
  await service.open(page);
  await page.waitForFunction(async () => !(await import("/src/store/editorStore.ts")).useEditorStore.getState().dirty);
  await page.route(`${service.backendUrl}/api/project/**`, async route => {
    const request = route.request();
    if (!["POST", "PUT"].includes(request.method())) return route.continue();
    const row = { method: request.method(), url: request.url(), startedAt: Date.now(),
      payload: request.postDataJSON(), activeAtStart: ++activeWrites };
    report.writes.push(row); save();
    const block = gate && (lateHome ? request.method() === "PUT" :
      request.method() === "POST" && request.url().endsWith("/state")) ? gate : undefined;
    if (block) { gate = undefined; blocked = block; block.row = row; block.captured.resolve(); row.heldBeforeDelivery = true; save(); }
    try {
      if (block) await block.release.promise;
      const response = await route.fetch(); row.httpStatus = response.status();
      await route.fulfill({ response });
    } finally { row.finishedAt = Date.now(); activeWrites--; save(); }
  });
  const row = { name: lateHome ? "late-return-home-write-cannot-overwrite-newer-reopened-edits" :
    "old-autosave-cannot-overwrite-newer-return-home-save", status: "RUNNING" };
  report.cases.push(row); save();
  gate = { captured: deferred(), release: deferred() }; const held = gate;
  await page.locator(".node-palette [data-help-key='palette.scene']").click();
  if (lateHome) {
    await page.waitForFunction(async () => !(await import("/src/store/editorStore.ts")).useEditorStore.getState().dirty);
    await page.locator("[data-help-key='toolbar.home']").click();
    await until(() => held.row, "home write intercepted before backend delivery", 30000);
    await page.locator(".editor-toolbar").waitFor({ state: "detached" });
    await page.locator(".recent-project-open:not(:disabled)").filter({ hasText: project.title }).click();
    await page.locator(".editor-toolbar").waitFor();
    await page.evaluate(async () => {
      const { backendClient } = await import("/src/api/backendClient.ts");
      const original = backendClient.saveProjectState.bind(backendClient);
      window.__qaHomeSaveEnqueued = 0;
      backendClient.saveProjectState = (...args) => {
        window.__qaHomeSaveEnqueued++;
        return original(...args);
      };
    });
    await page.locator(".node-palette [data-help-key='palette.scene']").click();
    const expected = await nodes(); row.expectedNodeIds = expected.map(n => n.id);
    await page.waitForFunction(() => window.__qaHomeSaveEnqueued > 0);
    row.beforeRelease = { heldNodeIds: held.row.payload.nodes.map(n => n.id),
      actualNodeIds: (await remote()).nodes.map(n => n.id) };
    held.release.resolve();
    await until(() => held.row.finishedAt, "late old home write completed", 30000);
    await page.waitForFunction(async () => !(await import("/src/store/editorStore.ts")).useEditorStore.getState().dirty);
    await until(() => activeWrites === 0, "queued newer save finished", 30000);
    const value = await remote(); row.actualNodeIds = value.nodes.map(n => n.id); save();
    assert.deepEqual(value.nodes.map(n => ({ id: n.id, data: n.data })), expected,
      "A delayed return-home snapshot must not overwrite newer edits made after reopening");
    assert(report.writes.every(w => w.activeAtStart === 1), "Project detail and state writes must never overlap");
    row.status = "PASS"; assert.equal(report.errors.length, 0); report.status = "PASS";
    return;
  }
  await until(() => held.row, "first graph autosave intercepted before backend delivery", 30000);
  assert.equal(held.row.payload.project_graph.nodes.length, project.nodes.length + 1);
  await page.locator(".node-palette [data-help-key='palette.scene']").click();
  const expected = await nodes(); row.expectedNodeIds = expected.map(n => n.id);
  assert.equal(expected.length, project.nodes.length + 2);
  await page.locator("[data-help-key='toolbar.home']").click();
  await page.locator(".editor-toolbar").waitFor({ state: "detached" });
  row.beforeRelease = { writes: report.writes.length, pendingWriters: activeWrites,
    persistedNodes: (await remote()).nodes.map(n => n.id) };
  held.release.resolve();
  await until(() => report.writes.some(w => w.method === "PUT" && w.finishedAt), "return-home write acknowledged", 30000);
  await until(() => activeWrites === 0, "owned writes completed", 30000);
  const persisted = await remote();
  row.actualNodeIds = persisted.nodes.map(n => n.id); save();
  assert.deepEqual(persisted.nodes.map(n => ({ id: n.id, data: n.data })), expected,
    "Returning home must not let an older in-flight autosave remove a newer node");
  await page.locator(".recent-project-open:not(:disabled)").filter({ hasText: project.title }).click();
  await page.locator(".editor-toolbar").waitFor();
  assert.deepEqual(await nodes(), expected, "Reopening through the real home entry preserves every authored node");
  row.status = "PASS";
  assert.equal(report.errors.length, 0); report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = error.stack;
  const current = report.cases.at(-1); if (current?.status === "RUNNING") { current.status = "FAILED"; current.error = error.stack; }
  process.exitCode = 1;
}).finally(async () => {
  gate?.release.resolve(); blocked?.release.resolve();
  try { await context?.close(); await browser?.close(); await service?.stop(); report.cleanupStatus = "PROCESSES_STOPPED_TEMP_PENDING"; }
  catch (error) { report.cleanupStatus = "FAILED"; report.cleanupError = error.stack; report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, error: report.error, out }));
});
