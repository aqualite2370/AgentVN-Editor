"use strict";
// The product backend is never mocked/manually spawned. Fault injection is an
// explicitly owned native frontend/backend termination, not a natural crash.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFile } = require("node:child_process"), { promisify } = require("node:util");
const { chromium } = require("../editor/node_modules/playwright");
const { settleEditor, sha256 } = require("./lib/installed-acceptance.cjs");
const { controlledAssistantProvider } = require("./lib/controlled-assistant-provider.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/installed-webview-capture.cjs");
const execute = promisify(execFile), run = "D:/AgentVN/output/installed-assistant-recovery-20261018-01";
const out = process.argv[2]; assert(out && !fs.existsSync(out)); fs.mkdirSync(out);
const readFile = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const fixture = readFile(path.join(run, "fixtures.json")), projects = fixture.projects;
const initialAttempt = Number(process.argv[3] || 1), launchSuffix = n => n === 1 ? "" : `-${String(n).padStart(2, "0")}`;
let launch = readFile(path.join(run, `launch${launchSuffix(initialAttempt)}.json`)), browser, page, cdp, peerBrowser, peerPage, peerCdp, model, before;
const report = { status: "RUNNING", at: new Date().toISOString(), cases: [], matrix: [], screenshots: [],
  errors: [], commands: [], submissions: [], tasks: [], realModelRequests: 0, productChanges: 0, error: null,
  scope: "ACTUAL_FROZEN_NSIS_EDITOR_AND_AUTOSTART_BACKEND; controlled model boundary and process-kill faults; no paid calls",
  expectedEnvironment: { AGENTVN_TEST_PROJECT: process.env.AGENTVN_TEST_PROJECT, AGENTVN_WORKSPACE_OUTPUT: process.env.AGENTVN_WORKSPACE_OUTPUT } };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mainMetrics = { width: 1920, height: 1080, dpr: 1, reduced: false };
async function command(script, args) {
  const entry = { command: ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args], status: "RUNNING" };
  report.commands.push(entry); save();
  try {
    const result = await execute("powershell.exe", entry.command.slice(1), { cwd: "D:/AgentVN", windowsHide: true, timeout: 85000, maxBuffer: 2e6 });
    entry.status = "PASS"; entry.exitCode = 0; entry.stdout = result.stdout; entry.stderr = result.stderr;
  } catch (e) { entry.status = "FAILED"; entry.exitCode = e.code; entry.stdout = e.stdout; entry.stderr = e.stderr; throw e; }
  finally { save(); }
}
async function read(route) {
  const r = await fetch(`http://127.0.0.1:8278${route}`, { signal: AbortSignal.timeout(10000) });
  assert(r.ok, `${route} HTTP ${r.status}`); return r.json();
}
async function postConfig(value) {
  const r = await fetch("http://127.0.0.1:8278/api/project/state", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(value), signal: AbortSignal.timeout(15000) }); assert(r.ok);
}
async function health() {
  const end = Date.now() + 50000;
  while (Date.now() < end) { try { await read("/api/health"); return; } catch {} await sleep(100); }
  throw new Error("Owned backend health did not become ready");
}
async function metrics(p, session, value) {
  await session.send("Emulation.setDeviceMetricsOverride", { width: value.width, height: value.height, deviceScaleFactor: value.dpr, mobile: false });
  await p.emulateMedia({ reducedMotion: value.reduced ? "reduce" : "no-preference" }); await readInstalledViewport(p, value);
}
async function connect(port) {
  const b = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const end = Date.now() + 20000; let p;
  while (Date.now() < end) {
    p = b.contexts().flatMap(c => c.pages()).find(p => p.url().includes("tauri.localhost"));
    if (p) break; await sleep(100);
  }
  assert(p); p.setDefaultTimeout(20000); p.on("pageerror", e => report.errors.push(String(e)));
  p.on("request", r => {
    if (r.method() === "POST" && r.url().endsWith("/api/assistant/creation/processes")) {
      const v = r.postDataJSON();
      report.submissions.push({ id: v.id, projectId: v.project_id, conversationId: v.conversation_id, userRequest: v.request.user_request }); save();
    }
  });
  const session = await p.context().newCDPSession(p); await metrics(p, session, mainMetrics);
  await p.locator(".recent-project-open:not(:disabled):visible").first().waitFor();
  return { b, p, session };
}
async function shot(name, p = page, s = cdp, value = mainMetrics) {
  report.screenshots.push(await captureInstalledWebview(p, s, path.join(out, `${name}.png`), value)); save();
}
async function stage(name, fn) {
  report.stage = name; const row = { name, status: "RUNNING" }; report.cases.push(row); save(); console.log(`START ${name}`);
  try { row.detail = await fn(); row.status = "PASS"; console.log(`PASS ${name}`); }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; } finally { save(); }
}
async function openProject(p, target = page) {
  await target.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: p.title }).click();
  await target.locator(".editor-toolbar").waitFor(); await settleEditor(target);
  assert.equal(await target.evaluate(() => window.__AGENTVN_PROJECT_STORE__.getState().projectId), p.projectId);
}
async function goHome() {
  const lock = page.getByTestId("assistant-project-lock-dialog");
  if (await lock.isVisible()) await lock.getByRole("button", { name: "返回工程列表", exact: true }).click();
  else {
    await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
    await page.getByRole("button", { name: "返回首页", exact: true }).click();
  }
  await page.locator(".recent-project-open:not(:disabled):visible").first().waitFor();
  await page.waitForFunction(() => !document.querySelector(".app-transition-stage.is-switching"));
}
async function assistant(target = page) {
  await target.locator('[data-workspace-surface="assistant"]:visible').click(); await settleEditor(target);
  const panel = target.locator(".workspace-task-panel.is-open .assistant-chat-panel"); await panel.waitFor();
  await panel.getByRole("button", { name: "创造模式", exact: true }).click();
  await panel.locator('textarea[aria-label="向大模型助手提问"]:not(:disabled)').waitFor(); return panel;
}
async function submit(panel, prompt) {
  await panel.getByTestId("assistant-new-conversation").click();
  await panel.getByLabel("向大模型助手提问", { exact: true }).fill(prompt);
  const n = report.submissions.length;
  await panel.getByRole("button", { name: "生成创作提案", exact: true }).click();
  const end = Date.now() + 10000;
  while (report.submissions.length === n && Date.now() < end) await sleep(50);
  assert.equal(report.submissions.length, n + 1);
  const task = report.submissions.at(-1); report.tasks.push(task); save(); return task;
}
async function waitProcess(id, predicate, timeout = 25000) {
  const end = Date.now() + timeout; let p;
  while (Date.now() < end) { p = await read(`/api/assistant/creation/processes/${id}`); if (predicate(p)) return p; await sleep(100); }
  report.lastProcess = p; throw new Error(`Process ${id} status ${p?.status} not expected`);
}
async function waitModel(marker) {
  const end = Date.now() + 15000;
  while (!model.requests.some(r => r.marker === marker) && Date.now() < end) await sleep(100);
  assert(model.requests.some(r => r.marker === marker), marker);
}
async function unchanged() {
  for (const p of projects) {
    const current = (await read(`/api/project/projects/${p.projectId}`)).data, original = before[p.projectId];
    assert.deepEqual(current.editor_settings, original.editor_settings);
    const authored = rows => rows.map(({ measured, ...node }) => node);
    assert.deepEqual(authored(current.nodes), authored(original.nodes)); assert.deepEqual(current.edges, original.edges);
  }
}
(async () => {
  assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), path.resolve(run));
  assert.equal(process.env.AGENTVN_TEST_PROJECT, fixture.input);
  assert.equal(sha256(fs.readFileSync(path.join(launch.installRoot, "agentvn-editor.exe"))), launch.executableSha256);
  model = await controlledAssistantProvider(); for (const marker of ["RESUME_A", "PEER_A", "INTERRUPTED_A"]) model.hold(marker);
  report.modelEndpoint = model.url;
  for (const p of projects) {
    assert.equal(sha256(fs.readFileSync(p.input)), p.sha256);
    const r = await fetch("http://127.0.0.1:8278/api/project/projects/import", { method: "POST",
      headers: { "content-type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(p.input)) },
      body: fs.readFileSync(p.input), signal: AbortSignal.timeout(30000) });
    const v = await r.json(); assert(r.ok && v.ok && v.data.project_id === p.projectId);
  }
  report.seed = "CONTROLLED_REAL_PACKAGED_BACKEND_IMPORT_NOT_NATIVE_PICKER";
  await postConfig({
    provider_connections: [{ connection_id: "controlled-recovery", provider_type: "openai_compatible", display_name: "恢复路径受控模型",
      base_url: model.url, api_key_storage: "local", enabled: true }],
    provider_models: [{ provider_id: "controlled-recovery-model", connection_id: "controlled-recovery", model_id: "controlled-model",
      model_name: "controlled-model", enabled: true, capabilities: ["text_generation"],
      default_parameters: { structured_mode: "tools", request_timeout_seconds: 120 } }],
    provider_selections: { text_generation: "controlled-recovery-model" }, provider_secrets: { "controlled-recovery": "test-only-secret" }
  });
  ({ b: browser, p: page, session: cdp } = await connect(launch.cdpPort));
  await page.reload(); await openProject(projects[0]);
  before = {}; for (const p of projects) before[p.projectId] = (await read(`/api/project/projects/${p.projectId}`)).data;
  report.baseline = before; save();
  await stage("Active creation survives frontend-only native process restart without resubmitting model request", async () => {
    const task = await submit(await assistant(), "RESUME_A 构建标题关于按钮");
    await waitProcess(task.id, p => p.status === "running"); await waitModel("RESUME_A");
    await page.getByTestId("assistant-project-lock-dialog").waitFor(); await shot("before-frontend-restart");
    await browser.close(); browser = undefined;
    await command("scripts/installed-assistant-recovery-session.ps1", ["-Action", "FrontendRestart", "-Evidence", `frontend-restart-${initialAttempt}`, "-Attempt", String(initialAttempt)]);
    const next = readFile(path.join(run, `frontend-restart-${initialAttempt}.json`)); assert.equal(next.status, "PASS");
    ({ b: browser, p: page, session: cdp } = await connect(next.cdpPort));
    await openProject(projects[0]); await page.getByTestId("assistant-project-lock-dialog").waitFor();
    assert.equal((await read(`/api/assistant/creation/processes/${task.id}`)).status, "running");
    model.release("RESUME_A");
    const final = await waitProcess(task.id, p => ["completed", "failed"].includes(p.status));
    assert.equal(final.status, "completed", JSON.stringify(final));
    await page.getByTestId("assistant-project-lock-dialog").waitFor({ state: "detached" });
    const panel = await assistant();
    await panel.getByTestId("assistant-creation-draft").getByRole("heading", { name: "RESUME_A组件", exact: true }).waitFor();
    assert.equal(model.requests.filter(r => r.marker === "RESUME_A").length, 1);
    assert.equal(report.submissions.filter(r => r.userRequest.startsWith("RESUME_A")).length, 1);
    await unchanged(); await shot("frontend-recovered-draft");
    return { task: task.id, backendPidsUnchanged: next.backendPids, actualNewEditorPid: next.editorPid, modelRequests: 1 };
  });
  await stage("Second actual native Editor process observes and cancels another project's task, across twelve UI combinations", async () => {
    const task = await submit(await assistant(), "PEER_A 构建标题帮助按钮");
    await waitProcess(task.id, p => p.status === "running"); await waitModel("PEER_A");
    await command("scripts/installed-assistant-recovery-session.ps1", ["-Action", "PeerLaunch", "-Evidence", "peer-launch", "-Attempt", String(initialAttempt)]);
    const peer = readFile(path.join(run, "peer-launch.json"));
    ({ b: peerBrowser, p: peerPage, session: peerCdp } = await connect(peer.cdpPort));
    assert(peer.editorPid !== readFile(path.join(run, `frontend-restart-${initialAttempt}.json`)).editorPid);
    await openProject(projects[1], peerPage); assert.equal(await peerPage.getByTestId("assistant-project-lock-dialog").count(), 0);
    const panel = await assistant(peerPage), monitor = panel.getByTestId("assistant-process-monitor");
    const row = monitor.locator(`li[data-process-id="${task.id}"][data-status="running"]`); await row.waitFor();
    assert.equal(await panel.getByRole("heading", { name: "PEER_A组件", exact: true }).count(), 0);
    const cancel = row.getByRole("button", { name: `取消 ${projects[0].title} 的创作进程`, exact: true });
    for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      const value = { width, height, dpr, reduced }; await metrics(peerPage, peerCdp, value); await cancel.scrollIntoViewIfNeeded(); await cancel.focus();
      const g = await cancel.evaluate(n => {
        const r = n.getBoundingClientRect(), row = n.closest("li").getBoundingClientRect();
        const h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { rect: r.toJSON(), row: row.toJSON(), hit: h === n || n.contains(h), focus: n === document.activeElement,
          overflow: document.documentElement.scrollWidth - innerWidth };
      });
      assert(g.hit && g.focus && g.overflow <= 1 && g.rect.left >= 0 && g.rect.top >= 0 && g.rect.right <= width + 1 && g.rect.bottom <= height + 1);
      report.matrix.push({ ...value, geometry: g, status: "PASS" }); await shot(`peer-${width}-${dpr}-${reduced}`, peerPage, peerCdp, value);
    }
    await cancel.click(); await waitProcess(task.id, p => p.status === "cancelling"); model.release("PEER_A");
    const final = await waitProcess(task.id, p => p.status === "cancelled");
    await page.getByTestId("assistant-project-lock-dialog").waitFor({ state: "detached" });
    await monitor.locator(`li[data-process-id="${task.id}"][data-status="cancelled"]`).waitFor();
    assert.equal(model.requests.filter(r => r.marker === "PEER_A").length, 1);
    assert.equal(await panel.getByRole("heading", { name: "PEER_A组件", exact: true }).count(), 0);
    await unchanged(); await metrics(peerPage, peerCdp, mainMetrics); await shot("peer-cancelled", peerPage, peerCdp);
    await peerBrowser.close(); peerBrowser = undefined;
    await command("scripts/installed-assistant-recovery-session.ps1", ["-Action", "PeerStop", "-Evidence", "peer-stop", "-Attempt", String(initialAttempt)]);
    return { task: task.id, finalStatus: final.status, nativePeerPid: peer.editorPid, peerWebviewOverride: peer.peerWebviewRoot,
      sameDefaultBackend: peer.backendPids, matrix: 12 };
  });
  await stage("Killed packaged worker and its queued task recover as worker_lost, unlock projects and never replay model calls", async () => {
    const running = await submit(await assistant(), "INTERRUPTED_A 构建标题按钮");
    await waitProcess(running.id, p => p.status === "running"); await waitModel("INTERRUPTED_A");
    await goHome(); await openProject(projects[1]);
    const queued = await submit(await assistant(), "INTERRUPTED_B 构建标题按钮");
    await waitProcess(queued.id, p => p.status === "queued");
    assert.equal(model.requests.filter(r => r.marker === "INTERRUPTED_B").length, 0);
    await shot("before-worker-loss"); await browser.close(); browser = undefined;
    await command("scripts/installed-assistant-recovery-session.ps1", ["-Action", "StopAll", "-Evidence", "worker-stop", "-Attempt", String(initialAttempt)]);
    model.release("INTERRUPTED_A");
    await command("scripts/installed-preview-session.ps1", ["-Suite", "assistant-recovery", "-Action", "Launch", "-Attempt", String(initialAttempt + 1)]);
    await health();
    await command("scripts/installed-preview-session.ps1", ["-Suite", "assistant-recovery", "-Action", "Observe", "-Attempt", String(initialAttempt + 1)]);
    launch = readFile(path.join(run, `launch${launchSuffix(initialAttempt + 1)}.json`));
    ({ b: browser, p: page, session: cdp } = await connect(launch.cdpPort));
    const failed = await waitProcess(running.id, p => p.status === "failed");
    assert.equal(failed.errorCode, "worker_lost"); assert(!failed.result);
    const failedQueue = await waitProcess(queued.id, p => p.status === "failed", 45000);
    assert.equal(failedQueue.errorCode, "worker_lost"); assert(!failedQueue.result);
    assert.equal(model.requests.filter(r => r.marker === "INTERRUPTED_A").length, 1);
    assert.equal(model.requests.filter(r => r.marker === "INTERRUPTED_B").length, 0);
    await openProject(projects[0]); assert.equal(await page.getByTestId("assistant-project-lock-dialog").count(), 0);
    let panel = await assistant(), row = panel.getByTestId("assistant-process-monitor").locator(`li[data-process-id="${running.id}"][data-status="failed"]`);
    await row.waitFor(); await row.locator("details").filter({ hasText: "失败详情" }).locator("summary").click();
    await row.getByTestId("assistant-process-error").filter({ hasText: "worker_lost" }).waitFor();
    await shot("worker-loss-explicit-error");
    await goHome(); await openProject(projects[1]); assert.equal(await page.getByTestId("assistant-project-lock-dialog").count(), 0);
    panel = await assistant();
    await panel.getByTestId("assistant-process-monitor").locator(`li[data-process-id="${queued.id}"][data-status="failed"]`).waitFor();
    await unchanged(); await shot("queued-worker-loss-unlocked");
    report.failedWorker = failed; report.failedQueue = failedQueue;
    return { runningId: running.id, queuedId: queued.id, runningError: failed.errorCode, queuedError: failedQueue.errorCode,
      noProviderReplay: true, bothProjectsUnlocked: true };
  });
  assert.equal(report.cases.length, 3); assert.equal(report.matrix.length, 12);
  assert.deepEqual(model.requests.map(r => r.marker), ["RESUME_A", "PEER_A", "INTERRUPTED_A"]);
  assert.equal(report.errors.length, 0); report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e);
  if (page && !page.isClosed()) {
    report.failureText = (await page.locator("body").innerText().catch(() => "")).slice(-6500);
    await shot("failure").catch(e => { report.captureError = String(e); });
  }
}).finally(async () => {
  if (model) {
    for (const t of report.tasks) try {
      const p = await read(`/api/assistant/creation/processes/${t.id}`);
      if (["running", "queued", "cancelling"].includes(p.status)) {
        const r = await fetch(`http://127.0.0.1:8278/api/assistant/creation/processes/${t.id}/cancel`,
          { method: "POST", signal: AbortSignal.timeout(10000) }); assert(r.ok);
      }
    } catch (e) { report.taskCleanupError = String(e); report.status = "FAILED"; }
    for (const m of ["RESUME_A", "PEER_A", "INTERRUPTED_A"]) model.release(m);
    report.modelRequests = model.requests; report.providerCleanup = await model.stop();
    try {
      await postConfig({ provider_connections: [], provider_models: [], provider_selections: {}, provider_secrets: {} });
      report.credentialCleanup = "CLEARED_TEST_ONLY_PROVIDER_AND_SECRET";
    } catch (e) { report.credentialCleanup = String(e); report.status = "FAILED"; }
  }
  await peerBrowser?.close(); await browser?.close();
  report.finishedAt = new Date().toISOString(); save();
  if (report.status !== "PASS") process.exitCode = 1;
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, matrix: report.matrix.length,
    screenshots: report.screenshots.length, error: report.error, out }, null, 2));
});
