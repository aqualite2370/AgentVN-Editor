"use strict";
// Real UI and isolated backend; only recovery-file IPC and transport timing are controlled.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");

const out = path.resolve(process.argv[2] || "");
assert(process.argv[2] && !fs.existsSync(out), "Use a new explicit evidence directory");
assert(out.toLowerCase().replaceAll("\\", "/").startsWith("f:/testavn/"));
fs.mkdirSync(out, { recursive: true });
const input = path.join(out, "fixture.vnproj");
fs.writeFileSync(input, JSON.stringify(fixture("autosave_boundaries_" + Date.now())));
process.env.AGENTVN_TEST_PROJECT = input;
process.env.AGENTVN_WORKSPACE_OUTPUT = path.join(out, "service");
const report = {
  status: "RUNNING", cases: [], errors: [], writes: [], backups: [], nativeErrors: [],
  scope: "SOURCE_FULL_APP_ISOLATED_REAL_BACKEND_CONTROLLED_RECOVERY_IPC_AND_TRANSPORT_NOT_INSTALLED",
  builds: 0, models: 0, desktopInput: 0,
};
let service, context, page, gate, failBackup = false, failWrite = false, activeWrites = 0;
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};
async function until(predicate, label, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw Error("Timed out: " + label);
}
async function test(name, fn) {
  const row = { name, status: "RUNNING" };
  report.cases.push(row); save();
  try { await fn(row); row.status = "PASS"; }
  catch (error) {
    row.status = "FAILED"; row.error = error.stack;
    await page?.screenshot({ path: path.join(out, `failure-${report.cases.length}.png`) }).catch(() => {});
  }
  finally { failBackup = false; failWrite = false; gate?.resolve(); gate = undefined; save(); }
  console.log(JSON.stringify(row));
}
async function settings() {
  const title = page.locator(".advanced-tab-content:not([inert]) [data-help-key='settings.projectTitle']");
  if (await page.locator("[data-workspace-surface='options']").getAttribute("aria-current") !== "page") {
    await page.locator("[data-workspace-surface='options']").click();
  }
  if (!await title.isVisible()) {
    await page.locator("nav [data-help-key='advanced.tab.settings']").click();
  }
  await title.waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const input = document.querySelector(".advanced-tab-content:not([inert]) [data-help-key='settings.projectTitle']");
    return input && input.getClientRects().length && !input.closest("[inert]");
  });
  return title;
}
async function changeTitle(title) {
  await (await settings()).fill(title);
  await page.waitForFunction(async value => (await import("/src/store/projectStore.ts")).useProjectStore.getState().title === value, title);
}
async function remote() {
  const id = await page.evaluate(async () => (await import("/src/store/projectStore.ts")).useProjectStore.getState().projectId);
  const response = await fetch(`${service.backendUrl}/api/project/projects/${encodeURIComponent(id)}`);
  assert(response.ok);
  return (await response.json()).data;
}
async function clean() {
  await page.waitForFunction(async () => !(await import("/src/store/editorStore.ts")).useEditorStore.getState().dirty);
  await until(() => activeWrites === 0, "owned writes settled");
}
async function switchWorkspace(surface) {
  const old = await page.evaluate(() => window.__qaWorkspaceChanges || 0);
  await page.locator(`[data-workspace-surface='${surface}']`).click();
  await page.waitForFunction(n => (window.__qaWorkspaceChanges || 0) > n, old);
}

(async () => {
  save();
  service = await startEditorAcceptance(process.env.AGENTVN_WORKSPACE_OUTPUT, { isolateBackendWorkingDirectory: true });
  report.service = {
    url: service.url, backendUrl: service.backendUrl, backendPid: service.backendPid,
    vitePid: service.server.pid, runId: service.server.runId,
  };
  const browserTemp = path.join(out, "temp");
  fs.mkdirSync(browserTemp);
  context = await chromium.launchPersistentContext(path.join(out, "browser-profile"), {
    headless: true, viewport: { width: 1920, height: 1080 },
    env: { ...process.env, TEMP: browserTemp, TMP: browserTemp },
  });
  page = context.pages()[0]; page.setDefaultTimeout(25000);
  page.on("pageerror", error => report.errors.push(String(error)));
  await service.open(page);
  await settings();
  await clean();
  await page.exposeFunction("qaRecoveryInvoke", async (command, args) => {
    if (command === "write_project_backup") {
      const project = JSON.parse(args.projectJson);
      if (failBackup) {
        report.nativeErrors.push({ command, projectId: project.project_id, title: project.title, error: "QA_RECOVERY_DENIED" });
        throw Error("QA_RECOVERY_DENIED");
      }
      const entry = {
        file_name: `backup-${report.backups.length + 1}.vnproj`, project_id: project.project_id,
        title: project.title, timestamp_ms: Date.now(), trigger: args.trigger,
        node_count: project.nodes.length, edge_count: project.edges.length,
      };
      report.backups.push({ entry, project }); return entry;
    }
    if (command === "list_project_backups")
      return report.backups.filter(b => b.entry.project_id === args.projectId).map(b => b.entry).reverse().slice(0, 10);
    if (command === "append_frontend_error" || command === "write_error_report") return "";
    if (command === "get_project_export_directory") return null;
    throw Error("Unexpected controlled native call: " + command);
  });
  await page.evaluate(() => {
    window.__TAURI_INTERNALS__ = { invoke: (command, args) => window.qaRecoveryInvoke(command, args) };
    window.__qaWorkspaceChanges = 0;
    window.addEventListener("agentvn:workspace-surface-changed", () => { window.__qaWorkspaceChanges += 1; });
  });
  await page.route(`${service.backendUrl}/api/project/state`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    const row = { started: Date.now(), payload: route.request().postDataJSON(), activeAtStart: ++activeWrites };
    report.writes.push(row);
    const currentGate = gate;
    gate = undefined;
    try {
      if (failWrite) {
        row.status = 503;
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "QA_AUTOSAVE_DENIED" }) });
      } else {
        const response = await route.fetch();
        row.status = response.status();
        if (currentGate) { row.blocked = true; await currentGate.promise; }
        await route.fulfill({ response });
      }
    } finally { row.finished = Date.now(); activeWrites -= 1; }
  });

  await test("仅改工程标题：真实数据库保存并创建包含新标题的恢复点", async row => {
    const title = "仅标题修改恢复点";
    await changeTitle(title);
    await until(() => report.writes.some(w => w.payload.project_metadata.title === title && w.finished), "title saved");
    assert.equal((await remote()).title, title);
    await until(() => report.backups.some(b => b.project.title === title), "title-only recovery point", 5000);
    row.backup = report.backups.find(b => b.project.title === title).entry;
  });
  await test("标题保存响应在途继续修改并离页：串行提交且最终恢复点采用最新内容", async row => {
    const hold = deferred(); gate = hold;
    const titleInput = await settings();
    await changeTitle("在途标题第一版");
    await until(() => report.writes.some(w => w.payload.project_metadata.title === "在途标题第一版" && w.blocked), "held response");
    try {
      await titleInput.fill("在途标题最终版");
      await switchWorkspace("edit");
    } finally { hold.resolve(); }
    await until(() => report.writes.some(w => w.payload.project_metadata.title === "在途标题最终版" && w.finished), "final revision saved");
    assert.equal((await remote()).title, "在途标题最终版");
    await until(() => report.backups.some(b => b.project.title === "在途标题最终版"), "final revision backed up", 5000);
    assert(report.writes.every(w => w.activeAtStart === 1), "Autosaves must not overlap");
    row.maxInFlight = Math.max(...report.writes.map(w => w.activeAtStart));
  });
  await test("恢复点拒写：保存仍成立，离页触发一次重试且不重复写成功快照", async row => {
    await clean();
    failBackup = true;
    await changeTitle("恢复点失败后重试");
    await until(() => report.nativeErrors.some(e => e.title === "恢复点失败后重试"), "backup failure reached", 5000);
    await page.waitForFunction(async () => (await import("/src/store/editorStore.ts")).useEditorStore.getState()
      .lastError?.message?.includes("恢复点写入失败"));
    assert.equal((await remote()).title, "恢复点失败后重试");
    failBackup = false;
    await switchWorkspace("edit");
    await until(() => report.backups.some(b => b.project.title === "恢复点失败后重试"), "retry without another edit", 5000);
    await clean();
    const count = report.backups.length;
    await switchWorkspace("options");
    await clean();
    assert.equal(report.backups.length, count, "Unchanged workspace navigation must not create a duplicate backup");
    row.retried = report.backups.find(b => b.project.title === "恢复点失败后重试").entry;
  });
  await test("元数据保存拒绝：保留编辑内容和错误，恢复服务后仅离页也能重试", async row => {
    failWrite = true;
    await changeTitle("数据库失败后重试");
    await until(() => report.writes.some(w => w.payload.project_metadata.title === "数据库失败后重试" && w.status === 503 && w.finished), "this case's actual rejected save");
    await page.waitForFunction(async () => (await import("/src/store/editorStore.ts")).useEditorStore.getState()
      .lastError?.message?.includes("自动保存失败"));
    assert.equal(await (await settings()).inputValue(), "数据库失败后重试");
    failWrite = false;
    await switchWorkspace("edit");
    await until(() => report.writes.some(w => w.payload.project_metadata.title === "数据库失败后重试" && w.status === 200 && w.finished), "save retry without new edit", 5000);
    assert.equal((await remote()).title, "数据库失败后重试");
    await until(() => report.backups.some(b => b.project.title === "数据库失败后重试"), "retried recovery point", 5000);
    row.latestSavedTitle = (await remote()).title;
  });
  await test("节点修改仍写恢复点，恢复点与真实后端的节点和连线一致", async row => {
    await page.locator("[data-workspace-surface='edit']").click();
    await page.locator(".node-palette [data-help-key='palette.scene']").click();
    const id = await page.evaluate(async () => (await import("/src/store/editorStore.ts")).useEditorStore.getState().selectedNodeId);
    await until(() => report.backups.some(b => b.project.nodes.some(n => n.id === id)), "node recovery point");
    await clean();
    const persisted = await remote();
    const backup = report.backups.findLast(b => b.project.nodes.some(n => n.id === id));
    assert.deepEqual(backup.project.nodes.map(n => ({ id: n.id, data: n.data })), persisted.nodes.map(n => ({ id: n.id, data: n.data })));
    assert.deepEqual(backup.project.edges, persisted.edges);
    row.nodeId = id;
  });
  await test("连续真实输入超过5秒时中途已落盘，结束后保存最终标题", async row => {
    await clean();
    const input = await settings();
    const prefix = "连续编辑保护";
    const suffix = "1234567890".repeat(8);
    const first = report.writes.length;
    const started = Date.now();
    await input.fill(prefix);
    await input.pressSequentially(suffix, { delay: 100 });
    const finishedTyping = Date.now();
    await until(() => report.writes.some(w => w.payload.project_metadata.title === prefix + suffix && w.finished), "final continuously typed title");
    const writes = report.writes.slice(first);
    const duringTyping = writes.filter(w => w.started < finishedTyping && w.finished < finishedTyping);
    assert(duringTyping.some(w => w.started - started <= 6500), "The first edit deadline must save during continued typing");
    assert.equal((await remote()).title, prefix + suffix);
    assert(writes.every(w => w.activeAtStart === 1));
    row.typingDurationMs = finishedTyping - started;
    row.writes = writes.map(w => ({ startMs: w.started - started, titleLength: w.payload.project_metadata.title.length }));
  });
  await test("真实保存拒绝后网页刷新产生关闭确认，取消刷新保留编辑内容", async row => {
    failWrite = true;
    const title = "刷新取消后仍保留的标题";
    await changeTitle(title);
    await until(() => report.writes.some(w => w.payload.project_metadata.title === title && w.status === 503 && w.finished), "rejected save before reload");
    const observed = page.waitForEvent("dialog", { timeout: 6000 });
    const navigation = page.reload({ waitUntil: "domcontentloaded" }).catch(error => String(error));
    const dialog = await observed;
    row.dialogType = dialog.type();
    assert.equal(row.dialogType, "beforeunload");
    await dialog.dismiss();
    await navigation;
    assert.equal(await (await settings()).inputValue(), title);
    failWrite = false;
    await switchWorkspace("edit");
    await until(() => report.writes.some(w => w.payload.project_metadata.title === title && w.status === 200 && w.finished), "retry after canceled navigation");
    assert.equal((await remote()).title, title);
  });
  await test("保存成功后刷新不再弹未保存确认，真实重开图及标题保持", async row => {
    await clean();
    const before = await remote();
    let dialogs = 0;
    const listener = async dialog => { dialogs++; await dialog.dismiss(); };
    page.on("dialog", listener);
    try {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
      await page.locator(".recent-project-open").first().click();
      await page.locator(".editor-toolbar").waitFor();
      await clean();
      assert.equal(dialogs, 0);
      const after = await remote();
      assert.equal(after.title, before.title);
      assert.deepEqual(after.nodes.map(n => ({ id: n.id, data: n.data })), before.nodes.map(n => ({ id: n.id, data: n.data })));
      assert.deepEqual(after.edges, before.edges);
      row.nodes = after.nodes.length; row.edges = after.edges.length;
    } finally { page.off("dialog", listener); }
  });
  report.status = report.cases.length === 8 && report.cases.every(c => c.status === "PASS") && !report.errors.length ? "PASS" : "FAILED";
})().catch(error => { report.status = "FAILED"; report.error = error.stack; })
  .finally(async () => {
    gate?.resolve();
    await context?.close();
    await service?.stop();
    report.cleanup = "OWNED_BROWSER_AND_SERVICES_STOPPED_PROFILE_RETAINED_FOR_EXACT_CLEANUP";
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, cases: report.cases.map(c => ({ name: c.name, status: c.status })), error: report.error, out }));
    if (report.status !== "PASS") process.exitCode = 1;
  });
