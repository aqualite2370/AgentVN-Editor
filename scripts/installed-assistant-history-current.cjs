"use strict";
// Actual installed Editor + backend + local persistence; only model HTTP is
// controlled. No arbitrary history/database/store injection or paid requests.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { controlledAssistantProvider } = require("./lib/controlled-assistant-provider.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { until } = require("./lib/current-native-editor-session.cjs");
assert.equal(process.argv.length, 4, "actual installation receipt and fresh output");
const [installationFile, out] = process.argv.slice(2).map(p => path.resolve(p));
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "ACTUAL_INSTALLED_MODE_PROJECT_HISTORY_ARCHIVE_DELETE_RESTART_CONTROLLED_LOCAL_MODEL",
  cases: [], matrix: [], launches: [], cleanups: [], screenshots: [], errors: [], submissions: [],
  realModelRequests: 0, blockedModelRequests: 0, normalClose: "NOT_RUN",
  limitations: ["Not real DeepSeek quality", "No native default-account migration, upgrade or Android proof"] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const projects = ["a", "b"].map(letter => {
  const project = fixture(`qa-history-${letter}-20261101`); project.title = `会话隔离 ${letter.toUpperCase()} 本轮安装版`;
  const file = path.join(out, `history-${letter}.vnproj`);
  fs.writeFileSync(file, JSON.stringify(project, null, 2), { flag: "wx" }); return { ...project, input: file };
});
const questions = ["HISTORY_A 说明当前工程保存", "HISTORY_B 说明另一工程保存"];
let host, page, provider, baseline, draftName;
const snapshots = p => ({ settings: p.editor_settings, assets: p.asset_manifest,
  nodes: p.nodes.map(({ measured, selected, dragging, ...n }) => n),
  edges: p.edges.map(({ selected, ...e }) => e) });
async function step(name, body) {
  const row = { name, status: "RUNNING", startedAt: new Date().toISOString() };
  report.cases.push(row); save(); console.log(`START ${name}`);
  try { row.detail = await body(); row.status = "PASS"; console.log(`PASS ${name}`); }
  catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); throw error; }
  finally { row.finishedAt = new Date().toISOString(); save(); }
}
async function open(project) {
  await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: project.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
}
async function assistant(mode) {
  await page.locator('[data-workspace-surface="assistant"]:visible').click(); await settleEditor(page);
  const panel = page.locator(".workspace-task-panel.is-open .assistant-chat-panel");
  await panel.getByRole("button", { name: mode === "inquiry" ? "问询模式" : "创造模式", exact: true }).click();
  await panel.locator('textarea[aria-label="向大模型助手提问"]:not(:disabled)').waitFor(); return panel;
}
async function home() {
  await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await page.locator(".recent-project-open:not(:disabled):visible").first().waitFor(); await settleEditor(page);
}
async function history(panel) {
  const h = panel.locator(".assistant-history-popover");
  if (!await h.evaluate(n => n.open)) await h.locator("summary").click();
  return h;
}
async function readHistory() {
  return page.evaluate(async () => {
    const request = indexedDB.open("agentvn-assistant-workbench");
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("conversations", "readonly"), q = tx.objectStore("conversations").getAll();
        tx.oncomplete = () => resolve(q.result); tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  });
}
async function unchanged() {
  for (const project of projects)
    assert.deepEqual(snapshots(await host.api(`/api/project/projects/${project.project_id}`)), baseline[project.project_id]);
}
async function archiveRoundTrip(panel, prefix) {
  let h = await history(panel); await h.getByRole("button", { name: new RegExp(`^归档 ${prefix}`) }).click();
  const archived = h.locator(".assistant-history-item.is-archived"); await archived.waitFor();
  await archived.locator(".assistant-history-select").click();
  await panel.getByText("已归档 · 只读历史", { exact: true }).waitFor();
  assert.equal(await panel.locator('[data-help-key="assistant.send"]').isEnabled(), false);
  h = await history(panel); await h.getByRole("button", { name: new RegExp(`^恢复 ${prefix}`) }).click();
  await panel.getByText("已载入本机历史", { exact: true }).waitFor();
  h = await history(panel); await h.getByRole("button", { name: new RegExp(`^永久删除 ${prefix}`) }).click();
  const confirm = page.getByTestId("editor-delete-confirmation"); await confirm.waitFor();
  await confirm.getByRole("button", { name: "取消", exact: true }).click(); await confirm.waitFor({ state: "detached" });
  h = await history(panel); assert.equal(await h.getByRole("button", { name: new RegExp(`^永久删除 ${prefix}`) }).count(), 1);
}
async function deleteHistory(panel, prefix) {
  const h = await history(panel); await h.getByRole("button", { name: new RegExp(`^永久删除 ${prefix}`) }).click();
  const confirm = page.getByTestId("editor-delete-confirmation"); await confirm.waitFor();
  await confirm.getByRole("button", { name: "确认删除", exact: true }).click();
  await confirm.waitFor({ state: "detached" }); await panel.getByText("已永久删除该对话", { exact: true }).waitFor();
}
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL); save();
  provider = await controlledAssistantProvider();
  host = installedReleaseSession({ installationFile, out, report, save, input: projects[0].input,
    controlledCreation: { endpoint: provider.url, projectIds: projects.map(p => p.project_id), inquiryQuestions: questions } });
  report.installation = host.installation; page = await host.start();
  for (const project of projects) {
    const response = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
      method: "POST", headers: { "content-type": "application/octet-stream",
        "X-AgentVN-Filename": encodeURIComponent(path.basename(project.input)) }, body: fs.readFileSync(project.input),
      signal: AbortSignal.timeout(20000) });
    assert(response.ok); assert((await response.json()).ok);
  }
  await host.rawApi("/api/project/state", {
    provider_connections: [{ connection_id: "qa-review", provider_type: "openai_compatible", display_name: "本机受控会话验收",
      base_url: provider.url, api_key_storage: "local", enabled: true }],
    provider_models: [{ provider_id: "qa-model", connection_id: "qa-review", model_id: "controlled-model", model_name: "controlled-model",
      enabled: true, capabilities: ["text_generation"], default_parameters: { structured_mode: "tools", request_timeout_seconds: 120 } }],
    provider_selections: { text_generation: "qa-model" }, provider_secrets: { "qa-review": "test-only-secret" },
  });
  await page.reload(); await page.locator(".project-home").waitFor();
  // Materialize legacy defaults for both small fixtures before measuring any
  // user-authored field; do not discard fields in later comparisons.
  baseline = {};
  for (const project of projects) {
    await open(project); await settleEditor(page);
    await page.locator('[data-help-key="toolbar.saveProject"]').click();
    const saved = page.getByTestId("project-save-confirmation"); await saved.waitFor();
    // The ordinary native download is tracked and removed only after retaining
    // an exact copy below, not treated as an unowned Downloads file.
    const text = await saved.innerText();
    const matches = text.match(/[A-Za-z]:\\[^\r\n]*?\.vnproj/g); assert(matches?.length, text);
    const source = matches[0], target = path.join(out, `${project.project_id}-baseline.vnproj`);
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    (report.nativeDownloads ??= []).push({ source, target,
      sha256: require("./lib/installed-acceptance.cjs").sha256(fs.readFileSync(target)) });
    await saved.getByRole("button", { name: "OK", exact: true }).click(); await saved.waitFor({ state: "detached" });
    baseline[project.project_id] = snapshots(await host.api(`/api/project/projects/${project.project_id}`)); await home();
  }
  report.baselineProjects = baseline;
  await step("actual-inquiry-no-write-tools-and-project-mode-isolation", async () => {
    await open(projects[0]); const panel = await assistant("inquiry");
    await panel.getByLabel("向大模型助手提问", { exact: true }).fill(questions[0]);
    await panel.getByRole("button", { name: "发送", exact: true }).click();
    await panel.getByText("HISTORY_A 这是安装版历史验收回答。", { exact: true }).waitFor();
    await panel.getByText("对话已保存到本机", { exact: true }).waitFor();
    const request = provider.requests.find(r => r.marker === "HISTORY_A");
    assert(request && !request.creation && request.tools.length === 0);
    await assistant("creation");
    assert.equal(await panel.getByText("HISTORY_A 这是安装版历史验收回答。", { exact: true }).count(), 0);
    await unchanged(); return { modelWriteTools: 0, isolation: true };
  });
  await step("one-controlled-creation-history-no-automerge-acknowledged-enqueue", async () => {
    const panel = await assistant("creation");
    await panel.getByLabel("向大模型助手提问", { exact: true }).fill("QUEUE_C 构建标题关于按钮");
    const acknowledged = page.waitForResponse(r => r.request().method() === "POST"
      && new URL(r.url()).pathname === "/api/assistant/creation/processes");
    const [response] = await Promise.all([acknowledged,
      panel.getByRole("button", { name: "生成创作提案", exact: true }).click()]);
    assert.equal(response.status(), 202); const accepted = await response.json();
    assert.equal(accepted.projectId, projects[0].project_id); report.submissions.push(accepted);
    const process = await until(async () => {
      const p = await host.rawApi(`/api/assistant/creation/processes/${accepted.id}`);
      return ["completed", "failed", "cancelled"].includes(p.status) && p;
    }, "one acknowledged controlled task terminal", 45000);
    assert.equal(process.status, "completed", JSON.stringify(process));
    await page.getByTestId("assistant-project-lock-dialog").waitFor({ state: "detached" });
    draftName = "QUEUE_C组件";
    await panel.getByTestId("assistant-creation-draft").getByRole("heading", { name: draftName, exact: true }).waitFor();
    await unchanged();
    await assistant("inquiry"); await panel.getByText("HISTORY_A 这是安装版历史验收回答。", { exact: true }).waitFor();
    assert.equal(await panel.getByRole("heading", { name: draftName, exact: true }).count(), 0);
    return { processId: process.id, processStatus: process.status, unchangedProject: true };
  });
  await step("history-accessibility-and-confirmation-priority-twelve-displays", async () => {
    const panel = await assistant("inquiry");
    for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      const m = { width, height: width * 9 / 16, dpr, reduced }, viewport = await host.metrics(m);
      const h = await history(panel), button = h.getByRole("button", { name: /^永久删除 HISTORY_A/ });
      await button.scrollIntoViewIfNeeded(); await button.focus(); await button.click({ trial: true });
      const geometry = await button.evaluate(n => {
        const r = n.getBoundingClientRect(), menu = n.closest(".assistant-history-menu").getBoundingClientRect();
        return { rect: r.toJSON(), menu: menu.toJSON(), focused: document.activeElement === n,
          hit: n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
          overflow: document.documentElement.scrollWidth - innerWidth };
      });
      assert(geometry.focused && geometry.hit && geometry.overflow <= 1 && geometry.menu.left >= 0 && geometry.menu.top >= 0
        && geometry.menu.right <= width + 1 && geometry.menu.bottom <= m.height + 1);
      await button.click(); const confirm = page.getByTestId("editor-delete-confirmation"); await confirm.waitFor();
      await confirm.getByRole("button", { name: "取消", exact: true }).focus();
      await page.keyboard.press("Tab"); assert(await confirm.evaluate(n => n.contains(document.activeElement)));
      await page.keyboard.press("Shift+Tab"); assert(await confirm.evaluate(n => n.contains(document.activeElement)));
      await host.shot(`history-confirm-${width}-${dpr}-${reduced}`);
      await page.keyboard.press("Escape"); await confirm.waitFor({ state: "detached" });
      report.matrix.push({ ...m, viewport, geometry, status: "PASS" }); save();
    }
    await host.metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });
    return { matrix: report.matrix.length, deleteCancelled: true, focusContained: true };
  });
  await step("both-modes-archive-readonly-restore-and-delete-cancel", async () => {
    await archiveRoundTrip(await assistant("inquiry"), "HISTORY_A");
    await archiveRoundTrip(await assistant("creation"), "QUEUE_C");
    const current = await readHistory();
    assert.equal(current.length, 2); assert(current.every(c => c.projectId === projects[0].project_id && !c.archivedAt));
    report.historyBeforeRestart = current; await unchanged(); return { persistedConversations: 2, modes: current.map(c => c.mode) };
  });
  await step("cross-project-history-and-actual-restart-preserve-mode-isolation", async () => {
    await home(); await open(projects[1]); let panel = await assistant("inquiry");
    assert.equal(await panel.getByText("HISTORY_A 这是安装版历史验收回答。", { exact: true }).count(), 0);
    await panel.getByLabel("向大模型助手提问", { exact: true }).fill(questions[1]);
    await panel.getByRole("button", { name: "发送", exact: true }).click();
    await panel.getByText("HISTORY_B 这是安装版历史验收回答。", { exact: true }).waitFor();
    await panel.getByText("对话已保存到本机", { exact: true }).waitFor();
    const count = provider.requests.length; assert.equal(count, 3);
    await host.stop("Actual history restart; forced stop is not normal-close acceptance");
    page = await host.start(); await open(projects[0]); panel = await assistant("creation");
    await panel.getByTestId("assistant-creation-draft").getByRole("heading", { name: draftName, exact: true }).waitFor();
    panel = await assistant("inquiry"); await panel.getByText("HISTORY_A 这是安装版历史验收回答。", { exact: true }).waitFor();
    assert.equal(await panel.getByText("HISTORY_B 这是安装版历史验收回答。", { exact: true }).count(), 0);
    await home(); await open(projects[1]); panel = await assistant("inquiry");
    await panel.getByText("HISTORY_B 这是安装版历史验收回答。", { exact: true }).waitFor();
    await assistant("creation"); assert.equal(await panel.getByRole("heading", { name: draftName, exact: true }).count(), 0);
    assert.equal(provider.requests.length, count); await unchanged();
    return { histories: (await readHistory()).length, noResubmissionOnRestart: true };
  });
  await step("confirmed-both-mode-deletion-survives-second-process-restart", async () => {
    await home(); await open(projects[0]);
    await deleteHistory(await assistant("inquiry"), "HISTORY_A");
    await deleteHistory(await assistant("creation"), "QUEUE_C");
    let records = await readHistory(); assert.equal(records.length, 1); assert.equal(records[0].projectId, projects[1].project_id);
    await host.stop("Second actual history restart after confirmed deletion");
    page = await host.start(); await open(projects[0]);
    for (const mode of ["inquiry", "creation"]) {
      const panel = await assistant(mode), h = await history(panel);
      assert.equal(await h.locator(".assistant-history-item").count(), 0);
    }
    records = await readHistory(); assert.equal(records.length, 1); assert.equal(records[0].projectId, projects[1].project_id);
    assert.equal(provider.requests.length, 3); await unchanged(); report.finalHistory = records;
    await host.shot("history-deletion-after-second-restart");
    return { deletedConversations: 2, otherProjectPreserved: true, controlledRequests: 3 };
  });
  assert.equal(report.cases.length, 6); assert(report.cases.every(c => c.status === "PASS"));
  assert.equal(report.matrix.length, 12); assert.deepEqual(report.errors, []); assert.equal(report.blockedModelRequests, 0);
  report.status = "PASS";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page && !page.isClosed()) {
    report.failureDOM = await page.locator("body").innerText().catch(String);
    await host.shot("failure").catch(e => { report.captureError = String(e); });
  }
}).finally(async () => {
  try {
    if (host?.current) {
      const active = (await host.rawApi("/api/assistant/creation/processes?include_terminal=false")).processes || [];
      for (const p of active.filter(p => projects.some(project => project.project_id === p.projectId)))
        await host.rawApi(`/api/assistant/creation/processes/${p.id}/cancel`, {});
      await host.rawApi("/api/project/state", { provider_secrets: {} });
      const state = await host.api("/api/project/state"); assert.deepEqual(state.provider_secrets ?? {}, {});
      report.credentialsCleared = true;
    }
  } catch (error) { report.credentialCleanupError = String(error.stack || error); report.status = "FAILED"; process.exitCode = 1; }
  try {
    await host?.stop("Final exact-owned history group cleanup");
    if (provider) { report.modelBoundary = provider.requests; report.providerCleanup = await provider.stop(); }
    for (const download of report.nativeDownloads || []) {
      const hash = require("./lib/installed-acceptance.cjs").sha256;
      assert.equal(hash(fs.readFileSync(download.source)), download.sha256);
      assert.equal(hash(fs.readFileSync(download.target)), download.sha256);
      const downloads = require("./lib/current-native-editor-session.cjs").ps("$s=New-Object -ComObject Shell.Application;$s.NameSpace('shell:Downloads').Self.Path");
      assert.equal(path.dirname(path.resolve(download.source)).toLowerCase(), path.resolve(downloads).toLowerCase());
      require("./lib/current-native-editor-session.cjs").ps(`Remove-Item -LiteralPath '${download.source.replace(/'/g, "''")}' -Force -ErrorAction Stop`);
      download.cleaned = true;
    }
  } catch (error) { report.cleanupError = String(error.stack || error); report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, cases: report.cases.length, error: report.error,
    cleanupError: report.cleanupError, credentialCleanupError: report.credentialCleanupError }));
});
