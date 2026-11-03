"use strict";
// Real frozen installation and its automatically started backend. Controlled
// responses ONLY at the external model HTTP boundary; not real DeepSeek proof.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const A = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/installed-webview-capture.cjs");
const { controlledAssistantProvider } = require("./lib/controlled-assistant-provider.cjs");
const run = "D:/AgentVN/output/installed-assistant-session-20261018-01";
const readFile = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const out = process.argv[2], phase = process.argv[3] || "lifecycle", attempt = Number(process.argv[4] || 2);
assert(out && !fs.existsSync(out)); fs.mkdirSync(out);
const launch = readFile(path.join(run, `launch${attempt === 1 ? "" : `-${String(attempt).padStart(2, "0")}`}.json`));
const fixture = readFile(path.join(run, "fixtures.json")), projects = fixture.projects;
const report = { status: "RUNNING", at: new Date().toISOString(), phase, checks: [], lockMatrix: [], historyMatrix: [],
  screenshots: [], submissions: [], errors: [], realModelRequests: 0, error: null, productChanges: 0,
  scope: "ACTUAL_INSTALLED_RELEASE_DEFAULT_PROFILES_PROTECTED; CONTROLLED_EXTERNAL_MODEL_NOT_DEEPSEEK; read-only stores/IDB evidence",
  installed: { root: launch.installRoot, sha256: launch.executableSha256 },
  environment: { AGENTVN_TEST_PROJECT: process.env.AGENTVN_TEST_PROJECT, AGENTVN_WORKSPACE_OUTPUT: process.env.AGENTVN_WORKSPACE_OUTPUT } };
let browser, page, cdp, provider, before;
let expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function read(route) {
  const response = await fetch(`http://127.0.0.1:8278${route}`, { signal: AbortSignal.timeout(10000) });
  assert(response.ok, `${route} ${response.status}`); return response.json();
}
async function configure(value) {
  const response = await fetch("http://127.0.0.1:8278/api/project/state", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify(value), signal: AbortSignal.timeout(15000) });
  assert(response.ok, "Real packaged backend provider configuration");
}
async function metrics(value) {
  expected = value;
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: value.width, height: value.height, deviceScaleFactor: value.dpr, mobile: false });
  await page.emulateMedia({ reducedMotion: value.reduced ? "reduce" : "no-preference" });
  await readInstalledViewport(page, expected);
}
async function shot(name) {
  report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, `${name}.png`), expected));
}
async function stage(name, fn) {
  report.stage = name; const row = { name, status: "RUNNING" }; report.checks.push(row); save(); console.log(`START ${name}`);
  try { row.detail = await fn(); row.status = "PASS"; console.log(`PASS ${name}`); }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  save();
}
async function goHome() {
  const win = page.getByTestId("assistant-creation-workbench-window");
  if (await win.isVisible()) {
    await win.getByRole("button", { name: "关闭工作台", exact: true }).click(); await win.waitFor({ state: "detached" });
  }
  const lock = page.getByTestId("assistant-project-lock-dialog");
  if (await lock.isVisible()) await lock.getByRole("button", { name: "返回工程列表", exact: true }).click();
  else {
    await page.locator('[data-workspace-surface="edit"]:visible').click(); await A.settleEditor(page);
    await page.getByRole("button", { name: "返回首页", exact: true }).click();
  }
  await page.locator(".recent-project-open:not(:disabled):visible").first().waitFor();
  await page.waitForFunction(() => !document.querySelector(".app-transition-stage.is-switching"));
}
async function openProject(p) {
  await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: p.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await A.settleEditor(page);
  assert.equal(await page.evaluate(() => window.__AGENTVN_PROJECT_STORE__.getState().projectId), p.projectId);
}
async function assistant(mode) {
  await page.locator('[data-workspace-surface="assistant"]:visible').click(); await A.settleEditor(page);
  const panel = page.locator(".workspace-task-panel.is-open .assistant-chat-panel"); await panel.waitFor();
  await panel.getByRole("button", { name: mode === "creation" ? "创造模式" : "问询模式", exact: true }).click();
  await panel.locator('textarea[aria-label="向大模型助手提问"]:not(:disabled)').waitFor(); return panel;
}
async function submit(panel, prompt) {
  await panel.getByLabel("向大模型助手提问", { exact: true }).fill(prompt);
  const n = report.submissions.length;
  await panel.getByRole("button", { name: "生成创作提案", exact: true }).click();
  const until = Date.now() + 10000;
  while (report.submissions.length === n && Date.now() < until) await sleep(50);
  assert.equal(report.submissions.length, n + 1); return report.submissions.at(-1);
}
async function waitProcess(id, predicate, timeout = 25000) {
  const until = Date.now() + timeout; let p;
  while (Date.now() < until) { p = await read(`/api/assistant/creation/processes/${id}`); if (predicate(p)) return p; await sleep(100); }
  report.lastProcess = p; throw new Error(`Process ${id} not ready; status=${p?.status}`);
}
async function waitModel(marker) {
  const until = Date.now() + 15000;
  while (!provider.requests.some(r => r.marker === marker) && Date.now() < until) await sleep(100);
  assert(provider.requests.some(r => r.marker === marker), `No actual external HTTP request ${marker}`);
}
async function openHistory(panel) {
  const h = panel.locator(".assistant-history-popover");
  if (!await h.evaluate(n => n.open)) await h.locator("summary").click();
  return h;
}
async function unchanged() {
  for (const p of projects) {
    const current = (await read(`/api/project/projects/${p.projectId}`)).data, base = before[p.projectId];
    assert.deepEqual(current.editor_settings, base.editor_settings);
    const authored = rows => rows.map(({ measured, ...node }) => node);
    assert.deepEqual(authored(current.nodes), authored(base.nodes)); assert.deepEqual(current.edges, base.edges);
  }
}
async function conversations() {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("agentvn-assistant-workbench");
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const r = db.transaction("conversations", "readonly").objectStore("conversations").getAll();
        r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
      });
    } finally { db.close(); }
  });
}
(async () => {
  assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), path.resolve(run));
  assert.equal(process.env.AGENTVN_TEST_PROJECT, fixture.input);
  assert.equal(A.sha256(fs.readFileSync(path.join(launch.installRoot, "agentvn-editor.exe"))), launch.executableSha256);
  if (phase === "lifecycle") {
    provider = await controlledAssistantProvider(); provider.hold("QUEUE_A");
    report.provider = { url: provider.url, secret: "TEST_ONLY_NOT_A_REAL_CREDENTIAL" }; save();
    await configure({
      provider_connections: [{ connection_id: "controlled-current", provider_type: "openai_compatible", display_name: "本轮生命周期受控模型",
        base_url: provider.url, api_key_storage: "local", enabled: true }],
      provider_models: [{ provider_id: "controlled-current-model", connection_id: "controlled-current", model_id: "controlled-model",
        model_name: "controlled-model", enabled: true, display_name: "本轮生命周期受控模型", capabilities: ["text_generation"],
        default_parameters: { structured_mode: "tools", request_timeout_seconds: 120 } }],
      provider_selections: { text_generation: "controlled-current-model" }, provider_secrets: { "controlled-current": "test-only-secret" }
    });
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(page);
  page.setDefaultTimeout(20000); page.on("pageerror", e => report.errors.push(String(e)));
  page.on("request", r => {
    if (r.method() === "POST" && r.url().endsWith("/api/assistant/creation/processes")) {
      const p = r.postDataJSON();
      report.submissions.push({ id: p.id, projectId: p.project_id, conversationId: p.conversation_id,
        userRequest: p.request.user_request, requestKeys: Object.keys(p.request) }); save();
    }
  });
  cdp = await page.context().newCDPSession(page); await metrics(expected);
  await page.reload(); await openProject(projects[0]);
  before = {}; for (const p of projects) before[p.projectId] = (await read(`/api/project/projects/${p.projectId}`)).data;
  if (phase === "reopen") {
    const prior = readFile(path.join(run, "lifecycle-finish-01/report.json")); assert.equal(prior.status, "PASS");
    await stage("Actual Editor+packaged backend restart retains inquiry/draft modes, archive/delete and project ownership", async () => {
      let panel = await assistant("creation");
      await panel.getByTestId("assistant-creation-draft").getByRole("heading", { name: "QUEUE_A组件", exact: true }).waitFor();
      panel = await assistant("inquiry");
      await panel.getByText("HISTORY_A 这是安装版历史验收回答。", { exact: true }).waitFor();
      assert.equal(await panel.getByRole("heading", { name: "QUEUE_A组件", exact: true }).count(), 0);
      await goHome(); await openProject(projects[1]); panel = await assistant("creation");
      const history = await openHistory(panel);
      assert.equal(await history.getByRole("button", { name: /^永久删除 QUEUE_C/ }).count(), 0);
      assert.equal(await panel.getByRole("heading", { name: "QUEUE_A组件", exact: true }).count(), 0);
      const rows = await conversations();
      assert(rows.some(r => r.projectId === projects[0].projectId && r.mode === "inquiry" && r.messages.some(m => m.content?.includes("HISTORY_A"))));
      assert(rows.some(r => r.projectId === projects[0].projectId && r.mode === "creation" && r.creationDraft?.name === "QUEUE_A组件"));
      assert(!rows.some(r => r.projectId === projects[1].projectId && r.title.startsWith("QUEUE_C")));
      // Evidence files are JSON; IndexedDB/structured clone can retain explicit
      // undefined optional properties. Compare all JSON-serializable fields
      // rather than treating absence vs undefined as content loss.
      assert.deepEqual(JSON.parse(JSON.stringify(rows)), prior.finalConversations);
      await shot("restart-mode-project-history"); return { records: rows.length, resubmissions: report.submissions.length };
    });
  } else if (phase === "finish") {
    const priorPath = path.join(run, "lifecycle-01/report.json"), prior = readFile(priorPath);
    assert.equal(prior.status, "FAILED"); assert.equal(prior.checks.length, 6);
    assert(prior.checks.slice(0, 5).every(r => r.status === "PASS"));
    assert(prior.error.includes("name: '永久删除'"));
    assert.equal(prior.lockMatrix.length, 12); assert.equal(prior.historyMatrix.length, 12);
    report.continuedFrom = { path: priorPath, sha256: A.sha256(fs.readFileSync(priorPath)),
      reason: "Test expected wrong confirmation label. Actual dialog uses 确认删除. Preserve original harness failure; no resubmission/model call.",
      previousPassingStagesNotRerun: 5 };
    await stage("Continue actual permanent delete through 确认删除; retain other project inquiry/draft and graph", async () => {
      await goHome(); await openProject(projects[1]); const panel = await assistant("creation");
      const history = await openHistory(panel);
      await history.getByRole("button", { name: /^永久删除 QUEUE_C/ }).click();
      const dialog = page.getByTestId("editor-delete-confirmation"); await dialog.waitFor();
      report.deleteDialogText = await dialog.innerText();
      await dialog.getByRole("button", { name: "确认删除", exact: true }).click(); await dialog.waitFor({ state: "detached" });
      await page.waitForFunction(() => !document.querySelector(".assistant-history-item strong")?.textContent?.startsWith("QUEUE_C"));
      const rows = await conversations();
      assert(!rows.some(r => r.projectId === projects[1].projectId && r.title.startsWith("QUEUE_C")));
      assert(rows.some(r => r.projectId === projects[0].projectId && r.mode === "creation" && r.creationDraft?.name === "QUEUE_A组件"));
      assert(rows.some(r => r.projectId === projects[0].projectId && r.mode === "inquiry"));
      await unchanged(); report.finalConversations = rows; await shot("permanent-delete-other-project");
      return { remainingConversations: rows.length, modelResubmissions: report.submissions.length };
    });
    report.finalProjects = {};
    for (const p of projects) report.finalProjects[p.projectId] = (await read(`/api/project/projects/${p.projectId}`)).data;
  } else {
    let taskA, taskB, taskC;
    await stage("Real inquiry transport has no writing tools and cannot create/merge a draft", async () => {
      const panel = await assistant("inquiry");
      await panel.getByLabel("向大模型助手提问", { exact: true }).fill("HISTORY_A 说明会话如何保存");
      await panel.getByRole("button", { name: "发送", exact: true }).click();
      await panel.getByText("HISTORY_A 这是安装版历史验收回答。", { exact: true }).waitFor();
      const request = provider.requests.find(r => r.marker === "HISTORY_A");
      assert(request && !request.creation && request.tools.length === 0); assert.equal(report.submissions.length, 0);
      await unchanged(); return { request, noProjectWrites: true };
    });
    await stage("Running task locks only its target project; lock traps focus across all twelve combinations", async () => {
      const panel = await assistant("creation");
      taskA = await submit(panel, "QUEUE_A 构建标题关于按钮"); await waitProcess(taskA.id, p => p.status === "running"); await waitModel("QUEUE_A");
      const lock = page.getByTestId("assistant-project-lock-dialog"); await lock.waitFor();
      for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        await metrics({ width, height, dpr, reduced });
        await lock.getByRole("button", { name: "返回工程列表", exact: true }).focus();
        const g = await lock.evaluate(n => {
          const b = n.querySelector('[aria-label="返回工程列表"]'), r = b.getBoundingClientRect(), h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return { rect: n.getBoundingClientRect().toJSON(), hit: h === b || b.contains(h), focus: n.contains(document.activeElement),
            rootInert: document.querySelector("#root").inert, overflow: document.documentElement.scrollWidth - innerWidth };
        });
        assert(g.hit && g.focus && g.rootInert && g.overflow <= 1);
        assert(g.rect.left >= 0 && g.rect.top >= 0 && g.rect.right <= width + 1 && g.rect.bottom <= height + 1);
        await page.keyboard.press("Tab"); assert(await lock.evaluate(n => n.contains(document.activeElement)));
        await page.keyboard.press("Shift+Tab"); assert(await lock.evaluate(n => n.contains(document.activeElement)));
        report.lockMatrix.push({ ...expected, geometry: g, status: "PASS" }); await shot(`lock-${width}-${dpr}-${reduced}`);
      }
      await metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });
      await goHome(); await openProject(projects[1]); assert.equal(await page.getByTestId("assistant-project-lock-dialog").count(), 0);
      const other = await assistant("creation");
      await other.getByTestId("assistant-process-monitor").locator(`li[data-process-id="${taskA.id}"][data-status="running"]`).waitFor();
      assert.equal(await other.getByRole("heading", { name: "QUEUE_A组件", exact: true }).count(), 0);
      return { task: taskA.id, lockMatrix: 12, otherProjectAccessible: true };
    });
    await stage("Queued project cancellation makes no external model call and does not edit either project", async () => {
      const panel = await assistant("creation"); taskB = await submit(panel, "QUEUE_B 构建标题按钮");
      await waitProcess(taskB.id, p => p.status === "queued");
      assert(!provider.requests.some(r => r.marker === "QUEUE_B"));
      const lock = page.getByTestId("assistant-project-lock-dialog");
      await lock.getByRole("button", { name: "取消此创造任务", exact: true }).click();
      await waitProcess(taskB.id, p => p.status === "cancelled"); await lock.waitFor({ state: "detached" });
      assert(!provider.requests.some(r => r.marker === "QUEUE_B")); await unchanged(); return { task: taskB.id };
    });
    await stage("Global FIFO one active model job; results stay in original project draft without automatic merge", async () => {
      let panel = await assistant("creation"); await panel.getByTestId("assistant-new-conversation").click();
      taskC = await submit(panel, "QUEUE_C 构建标题帮助按钮"); await waitProcess(taskC.id, p => p.status === "queued");
      assert(!provider.requests.some(r => r.marker === "QUEUE_C"));
      provider.release("QUEUE_A");
      const completedA = await waitProcess(taskA.id, p => ["completed", "failed"].includes(p.status));
      assert.equal(completedA.status, "completed", JSON.stringify(completedA));
      const completedC = await waitProcess(taskC.id, p => ["completed", "failed"].includes(p.status));
      assert.equal(completedC.status, "completed", JSON.stringify(completedC));
      await page.getByTestId("assistant-project-lock-dialog").waitFor({ state: "detached" });
      panel = await assistant("creation");
      await panel.getByTestId("assistant-creation-draft").getByRole("heading", { name: "QUEUE_C组件", exact: true }).waitFor();
      assert.equal(provider.maxConcurrentCreation, 1);
      assert.deepEqual(provider.requests.filter(r => r.creation).map(r => r.marker), ["QUEUE_A", "QUEUE_C"]);
      await unchanged(); await goHome(); await openProject(projects[0]); panel = await assistant("creation");
      await panel.getByTestId("assistant-creation-draft").getByRole("heading", { name: "QUEUE_A组件", exact: true }).waitFor();
      assert.equal(await panel.getByRole("heading", { name: "QUEUE_C组件", exact: true }).count(), 0);
      report.tasks = { taskA, taskB, taskC };
      return { providerMaxConcurrent: 1, aTools: completedA.toolEvents.map(e => ({ tool: e.tool, status: e.status })),
        cTools: completedC.toolEvents.map(e => ({ tool: e.tool, status: e.status })) };
    });
    await stage("Actual history controls hit/focus in twelve combinations; archive read-only, restore and cancel deletion", async () => {
      const panel = await assistant("creation"); let history = await openHistory(panel);
      for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        await metrics({ width, height, dpr, reduced });
        const button = history.getByRole("button", { name: /^归档 QUEUE_A/ }); await button.scrollIntoViewIfNeeded(); await button.focus();
        const g = await button.evaluate(n => {
          const r = n.getBoundingClientRect(), m = n.closest(".assistant-history-menu").getBoundingClientRect();
          const h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return { rect: r.toJSON(), menu: m.toJSON(), hit: h === n || n.contains(h), focus: document.activeElement === n,
            overflow: document.documentElement.scrollWidth - innerWidth };
        });
        assert(g.hit && g.focus && g.overflow <= 1 && g.menu.left >= 0 && g.menu.top >= 0 && g.menu.right <= width + 1 && g.menu.bottom <= height + 1);
        report.historyMatrix.push({ ...expected, geometry: g, status: "PASS" }); await shot(`history-${width}-${dpr}-${reduced}`);
      }
      await metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });
      await history.getByRole("button", { name: /^归档 QUEUE_A/ }).click();
      history = await openHistory(panel);
      await history.locator(".assistant-history-item.is-archived .assistant-history-select").click();
      await panel.getByText("已归档 · 只读历史", { exact: true }).waitFor();
      assert.equal(await panel.locator('[data-help-key="assistant.send"]').isEnabled(), false);
      history = await openHistory(panel);
      await history.getByRole("button", { name: /^恢复 QUEUE_A/ }).click(); history = await openHistory(panel);
      await history.getByRole("button", { name: /^永久删除 QUEUE_A/ }).click();
      const dialog = page.getByTestId("editor-delete-confirmation"); await dialog.waitFor();
      await dialog.getByRole("button", { name: "取消", exact: true }).click(); await dialog.waitFor({ state: "detached" });
      history = await openHistory(panel); assert.equal(await history.getByRole("button", { name: /^永久删除 QUEUE_A/ }).count(), 1);
      await unchanged(); return { matrix: 12 };
    });
    await stage("Permanent deletion belongs to selected project+mode, is actually confirmed, does not remove another project's inquiry or draft", async () => {
      await goHome(); await openProject(projects[1]); let panel = await assistant("creation");
      const history = await openHistory(panel);
      await history.getByRole("button", { name: /^永久删除 QUEUE_C/ }).click();
      const dialog = page.getByTestId("editor-delete-confirmation"); await dialog.waitFor();
      report.deleteDialogText = await dialog.innerText();
      await dialog.getByRole("button", { name: "确认删除", exact: true }).click(); await dialog.waitFor({ state: "detached" });
      const rows = await conversations(); assert(!rows.some(r => r.projectId === projects[1].projectId && r.title.startsWith("QUEUE_C")));
      assert(rows.some(r => r.projectId === projects[0].projectId && r.mode === "creation" && r.creationDraft?.name === "QUEUE_A组件"));
      assert(rows.some(r => r.projectId === projects[0].projectId && r.mode === "inquiry"));
      await unchanged(); report.finalConversations = rows; await shot("permanent-delete-other-project");
      return { remainingConversations: rows.length };
    });
    report.finalProjects = {};
    for (const p of projects) report.finalProjects[p.projectId] = (await read(`/api/project/projects/${p.projectId}`)).data;
    assert.equal(report.checks.length, 6); assert.equal(report.lockMatrix.length, 12); assert.equal(report.historyMatrix.length, 12);
  }
  assert(report.checks.length > 0); assert.equal(report.errors.length, 0);
  report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e);
  if (page) {
    report.failureText = (await page.locator("body").innerText().catch(() => "")).slice(-6500);
    await shot("failure").catch(e => { report.captureError = String(e); });
  }
}).finally(async () => {
  if (provider) {
    // Cancel only the IDs actually submitted by this session before releasing
    // held responses; never cancel another process by a broad backend query.
    for (const task of report.submissions) {
      try {
        const p = await read(`/api/assistant/creation/processes/${task.id}`);
        if (["queued", "running", "cancelling"].includes(p.status)) {
          const r = await fetch(`http://127.0.0.1:8278/api/assistant/creation/processes/${task.id}/cancel`,
            { method: "POST", signal: AbortSignal.timeout(10000) }); assert(r.ok);
        }
      } catch (e) { report.taskCleanupError = String(e); report.status = "FAILED"; }
    }
    provider.release("QUEUE_A"); report.modelBoundary = provider.requests;
    report.providerCleanup = await provider.stop();
    try {
      await configure({ provider_connections: [], provider_models: [], provider_selections: {}, provider_secrets: {} });
      report.credentialCleanup = "CLEARED_TEST_ONLY_PROVIDER_AND_SECRET";
    } catch (e) { report.credentialCleanup = String(e); report.status = "FAILED"; }
  }
  await browser?.close(); report.finishedAt = new Date().toISOString(); save();
  if (report.status !== "PASS") process.exitCode = 1;
  console.log(JSON.stringify({ status: report.status, phase, checks: report.checks.length,
    lockMatrix: report.lockMatrix.length, historyMatrix: report.historyMatrix.length, error: report.error, out }, null, 2));
});
