"use strict";
// Full source App with real backend; recovery reads are controlled IPC.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { until } = require("./lib/current-native-editor-session.cjs");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const out = path.resolve(process.argv[2] || "");
assert(process.argv[2] && out.startsWith("F:\\testavn\\") && !fs.existsSync(out));
fs.mkdirSync(out, { recursive: true });
const project = fixture("qa_timeline_revision_20261116");
project.title = "恢复归属测试";
project.nodes[1].data.scene.commands = [{ type: "wait", duration_ms: 100 }];
const snapshot = structuredClone(project); snapshot.nodes[1].data.scene.commands[0].duration_ms = 900;
const entry = { file_name: "revision.vnproj", project_id: project.project_id, title: project.title,
  created_at: project.created_at, updated_at: project.updated_at, timestamp_ms: Date.now(),
  node_count: 2, edge_count: 1, trigger: "auto_save" };
const input = path.join(out, "fixture.vnproj"); fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
process.env.AGENTVN_TEST_PROJECT = input; process.env.AGENTVN_WORKSPACE_OUTPUT = path.join(out, "service");
const report = { status: "RUNNING", scope: "SOURCE_APP_REAL_BACKEND_CONTROLLED_TIMELINE_IPC_AND_COMPETING_CHANGES",
  cases: [], sources: [], errors: [], models: 0, computerUse: false };
for (const relative of ["editor/src/components/timeline/ProjectTimelinePanel.tsx", "editor/src/utils/editorProjectPersistence.ts"]) {
  const source = path.resolve(__dirname, "..", relative), retained = path.join(out, "sources", relative);
  fs.mkdirSync(path.dirname(retained), { recursive: true }); fs.copyFileSync(source, retained, fs.constants.COPYFILE_EXCL);
  report.sources.push({ source, retained, sha256: sha(source) });
}
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let service, browser, page, pendingRead, readCount = 0, writeCount = 0;
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function state() {
  return page.evaluate(async () => {
    const s = (await import("/src/store/editorStore.ts")).useEditorStore.getState();
    const p = (await import("/src/store/projectStore.ts")).useProjectStore.getState();
    return JSON.parse(JSON.stringify({ nodes: s.nodes, edges: s.edges, generation: s.projectLoadGeneration,
      title: p.title, settings: p.settings, assets: p.assetManifest, notice: s.lastError }));
  });
}
async function reset() {
  pendingRead?.resolve(); pendingRead = undefined;
  const dialog = page.getByTestId("timeline-restore-confirmation");
  if (await dialog.isVisible()) {
    await dialog.getByRole("button", { name: "取消", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
  }
  await page.evaluate(async value => {
    (await import("/src/store/editorStore.ts")).useEditorStore.getState().importProject(value);
    (await import("/src/store/projectStore.ts")).useProjectStore.getState().loadProjectMetadata(value);
  }, project);
  await page.locator(".advanced-tab-content:not([inert]) .timeline-entry button").waitFor();
}
async function test(name, action) {
  const row = { name, status: "RUNNING" }; report.cases.push(row); save();
  try { await reset(); await action(row); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = error.stack;
    await page.screenshot({ path: path.join(out, `failed-${report.cases.length}.png`) }).catch(() => {}); }
  finally { pendingRead?.resolve(); pendingRead = undefined; save(); console.log(JSON.stringify(row)); }
}
async function beginRead() {
  const before = readCount; pendingRead = deferred();
  await page.locator(".advanced-tab-content:not([inert]) .timeline-entry button").click();
  const dialog = page.getByTestId("timeline-restore-confirmation");
  await dialog.getByRole("button", { name: "恢复备份", exact: true }).click();
  await until(() => readCount === before + 1, "actual backup read started", 5000);
  await until(() => page.evaluate(() => document.querySelector(
    "[data-testid='timeline-restore-confirmation'] [role='dialog']")?.getAttribute("aria-busy") === "true"),
    "actual recovery dialog busy", 5000);
  return dialog;
}
(async () => {
  save(); service = await startEditorAcceptance(process.env.AGENTVN_WORKSPACE_OUTPUT, { isolateBackendWorkingDirectory: true });
  report.service = { url: service.url, backendUrl: service.backendUrl, backendPid: service.backendPid,
    vitePid: service.server.pid, runId: service.server.runId };
  const temporary = path.join(out, "temp"); fs.mkdirSync(temporary);
  browser = await chromium.launch({ headless: true, env: { ...process.env, TEMP: temporary, TMP: temporary } });
  page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(12000); page.on("pageerror", error => report.errors.push(String(error)));
  await service.open(page);
  await page.exposeFunction("qaRevisionInvoke", async (command, args) => {
    if (command === "list_project_backups") return args.projectId === project.project_id ? [entry] : [];
    if (command === "read_project_backup") { readCount++; const gate = pendingRead; await gate?.promise; return JSON.stringify(snapshot); }
    if (command === "write_project_backup") { writeCount++; return { ...entry, trigger: args.trigger }; }
    if (command === "append_frontend_error") return "";
    throw Error("Unexpected controlled IPC " + command);
  });
  await page.evaluate(() => { window.__TAURI_INTERNALS__ = { invoke: (command, args) => window.qaRevisionInvoke(command, args) }; });
  await page.locator("[data-workspace-surface='options']").click();
  await page.locator("nav [data-help-key='advanced.tab.history']").click();
  for (const kind of ["graph", "title", "settings", "assets"]) {
    await test(`Delayed backup read must preserve newer ${kind} and reject the expired restore`, async row => {
      const writes = writeCount; const dialog = await beginRead();
      await page.evaluate(async kind => {
        const s = (await import("/src/store/editorStore.ts")).useEditorStore;
        const p = (await import("/src/store/projectStore.ts")).useProjectStore;
        if (kind === "graph") s.getState().updateSceneCommands("scene", [{ type: "wait", duration_ms: 777 }]);
        if (kind === "title") p.getState().setMetadata({ title: "确认后新增标题" });
        if (kind === "settings") p.getState().setDefaultSpriteScale(1.35);
        if (kind === "assets") p.getState().setAssetManifest([{ asset_id: "new", kind: "background",
          name: "新增背景", metadata: { url: "/qa-new.png" } }]);
      }, kind);
      const latest = await state(); pendingRead.resolve();
      await until(() => page.evaluate(() => {
        const dialog = document.querySelector("[data-testid='timeline-restore-confirmation'] [role='dialog']");
        return !dialog || dialog.getAttribute("aria-busy") === "false";
      }), "restore read settled", 8000);
      const after = await state();
      assert.equal(after.generation, latest.generation, "A read cannot replace content edited after confirmation");
      for (const key of ["nodes", "edges", "title", "settings", "assets"]) assert.deepEqual(after[key], latest[key], key);
      assert.match(after.notice?.message || "", /内容.*变化|重新载入/);
      assert.equal(writeCount, writes, "No before_restore or restore write should start for a superseded read");
      row.notice = after.notice.message;
      await dialog.getByRole("button", { name: "取消", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
    });
  }
  await test("Unchanged content still restores from the selected record with a before_restore backup", async row => {
    const before = await state(), writes = writeCount; const dialog = await beginRead(); pendingRead.resolve();
    await until(async () => (await state()).generation === before.generation + 1, "valid restoration committed", 8000);
    const after = await state(); assert.equal(after.nodes[1].data.scene.commands[0].duration_ms, 900);
    assert.equal(writeCount, writes + 1); await dialog.waitFor({ state: "hidden" });
    row.beforeRestoreWrites = writeCount - writes;
  });
  assert.equal(report.cases.length, 5); assert(report.cases.every(row => row.status === "PASS")); assert.deepEqual(report.errors, []);
  for (const source of report.sources) assert.equal(sha(source.source), source.sha256);
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = error.stack; process.exitCode = 1; })
.finally(async () => {
  pendingRead?.resolve();
  try { await browser?.close(); await service?.stop(); report.cleanup = "OWNED_BROWSER_AND_SERVICES_STOPPED"; }
  catch (error) { report.status = "FAILED"; report.cleanup = "FAILED"; report.cleanupError = error.stack; process.exitCode = 1; }
  report.reads = readCount; report.writes = writeCount; report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, out, error: report.error }));
});
