"use strict";
// Actual installed Editor/backend/Runtime. Only external model responses are controlled.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { buildSync } = require("../editor/node_modules/esbuild");
const JSZip = require("../editor/node_modules/jszip");
const A = require("./lib/installed-acceptance.cjs");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const { startInstalledEditor } = require("./lib/owned-installed-editor.cjs");
const { startOwnedCreationApi } = require("./lib/owned-creation-api.cjs");
const { verifyInstalledSharedMenu } = require("./lib/installed-shared-menu-player.cjs");
const { controlledAssistantProvider } = require("./lib/controlled-assistant-provider.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/current-native-capture.cjs");
const crypto = require("node:crypto");
assert(process.argv[2] && process.argv[3], "Pass actual installation audit and fresh run root");
const auditFile = path.resolve(process.argv[2]), out = path.resolve(process.argv[3]);
assert(!fs.existsSync(out));
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT || ""), out);
assert(process.env.AGENTVN_TEST_PROJECT && A.inside(out, process.env.AGENTVN_TEST_PROJECT));
fs.mkdirSync(out, { recursive: true }); fs.copyFileSync(auditFile, path.join(out, "installer-resource-report.json"));
const batchSize = Number(process.env.AGENTVN_CREATION_AGENT_BATCH_SIZE || "1");
assert([1, 2].includes(batchSize), "Controlled fixture must return validation and preview receipts before final proposal");
const report = { status: "RUNNING", scope: "Actual isolated NSIS installed Editor/backend/Runtime; controlled external HTTP model; no store/API mocks or paid requests", cases: [], matrix: [], queueMatrix: [], errors: [], submissions: [], cleanup: [],
  controlledModelBatchSize: batchSize, realModelRequests: 0, cancelReceipts: [] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l8sAAAAASUVORK5CYII=", "base64");
let owner, model, queueModel, browser, page, session, state, project, original, merged, cartridge, rawSubmission;
const recoveryOnly = process.env.AGENTVN_CREATION_RECOVERY_ONLY === "1";
const continuationPath = process.env.AGENTVN_CREATION_CONTINUATION_REPORT;
const continuation = continuationPath ? JSON.parse(fs.readFileSync(continuationPath, "utf8")) : undefined;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function read(route) {
  const response = await fetch(`http://127.0.0.1:${state.backendPort}${route}`, { signal: AbortSignal.timeout(10000) });
  assert(response.ok, `${route} HTTP ${response.status}`); return response.json();
}
async function waitProcess(id, predicate) {
  const deadline = Date.now() + 45000; let value;
  while (Date.now() < deadline) { value = await read(`/api/assistant/creation/processes/${id}`); if (predicate(value)) return value; await sleep(150); }
  report.lastProcess = value; throw new Error(`Process did not settle: ${id} ${value?.status}`);
}
async function stage(name, operation) {
  if (continuation && continuation.cases.some(item => item.name === name && item.status === "PASS")) return;
  report.stage = name; save(); console.log(`START ${name}`); await operation();
  report.cases.push({ name, status: "PASS" }); save(); console.log(`PASS ${name}`);
}
async function connect() {
  state = owner.state;
  if (state.source) {
    report.scope = "Source full Editor/backend recovery regression; controlled external model; NOT installed Release evidence";
    browser = await chromium.launch(); const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    page = await context.newPage();
    // Source browsers cannot read native filePath fallbacks. Forward the service's
    // declared default asset URL to this run's real isolated API; no fake bytes/responses.
    await page.route("http://127.0.0.1:8278/api/project/assets/**", route => route.continue({ url: `http://127.0.0.1:${state.backendPort}${new URL(route.request().url()).pathname}` }));
    await page.goto(state.sourceUrl);
  } else {
  const verified = A.readInstalledSession(out);
  const payload = verified.installation.deployments.find(item => item.kind === "NSIS actual payload"
    && item.executable.sha256 === verified.exeSha256);
  assert(payload?.runtimeProvenance?.length);
  const runtimeProvenance = payload.runtimeProvenance.map(({ name, sha256 }) => {
    const actualSha256 = A.sha256(fs.readFileSync(path.join(state.installRoot, name)));
    assert.equal(actualSha256, sha256, `Installed runtime changed: ${name}`);
    return { name, sha256: actualSha256 };
  });
  report.installed = { installRoot: state.installRoot, version: verified.installation.version,
    exeSha256: verified.exeSha256, runtimeProvenance, databasePath: state.databasePath, webviewRoot: state.webviewRoot };
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${state.cdpPort}`);
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { page = browser.contexts().flatMap(context => context.pages()).find(candidate => /tauri\.localhost/.test(candidate.url())); if (page) break; await sleep(100); }
  }
  assert(page); page.setDefaultTimeout(30000); session = await browser.contexts()[0].newCDPSession(page);
  page.on("pageerror", error => report.errors.push(String(error)));
  page.on("request", request => { if (request.method() === "POST" && request.url().endsWith("/api/assistant/creation/processes")) {
    const body = request.postDataJSON(); rawSubmission = body; report.submissions.push({ id: body.id, projectId: body.project_id, request: { ...body.request, provider_selection: "[redacted]" } });
  } });
  page.on("response", response => {
    const match = new URL(response.url()).pathname.match(/^\/api\/assistant\/creation\/processes\/([^/]+)\/cancel$/);
    if (!match || response.request().method() !== "POST") return;
    // Body ownership can disappear on the deliberate reload below. The real
    // backend status is independently awaited by waitProcess at each cancel.
    report.cancelReceipts.push({ processId: match[1], httpStatus: response.status(),
      observedAt: new Date().toISOString() });
    if (!response.ok()) report.errors.push(`Cancel HTTP ${response.status()}: ${match[1]}`);
  });
  // The app may have hydrated an empty list before the public setup import.
  // Wait for the real Home surface; the caller reloads to read the seeded list.
  await page.getByRole("button", { name: "导入项目", exact: true }).first().waitFor();
}
async function openProject() {
  await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: project.title }).first().click();
  await page.locator(".editor-toolbar").waitFor(); await A.settleEditor(page);
}
async function workbench() {
  const publishing = page.getByRole("button", { name: "关闭发布与打包", exact: true });
  if (await publishing.isVisible().catch(() => false)) {
    await publishing.click(); await page.locator('.workspace-task-panel.is-open[data-workspace-task="publish"]').waitFor({ state: "hidden" }); await A.settleEditor(page);
  }
  await page.locator('[data-workspace-surface="assistant"]:visible').click(); await A.settleEditor(page);
  const panel = page.locator(".workspace-task-panel.is-open .assistant-chat-panel");
  await panel.getByRole("button", { name: "创造模式", exact: true }).click();
  await panel.getByRole("button", { name: "在独立窗口打开创造工作台", exact: true }).click();
  const window = page.getByTestId("assistant-creation-workbench-window"); await window.waitFor(); return window;
}
async function submit(window, prompt) {
  await window.getByLabel("向大模型助手提问", { exact: true }).fill(prompt);
  const count = report.submissions.length;
  // A request event precedes SQLite commit. GET before the corresponding 202
  // can legitimately return 404, so it cannot prove the task disappeared.
  const acceptance = page.waitForResponse(response => response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/assistant/creation/processes"
    && report.submissions.slice(count).some(task => task.id === response.request().postDataJSON()?.id));
  const [response] = await Promise.all([
    acceptance,
    window.getByRole("button", { name: "生成创作提案", exact: true }).click(),
  ]);
  const deadline = Date.now() + 10000; while (report.submissions.length === count && Date.now() < deadline) await sleep(50);
  assert.equal(report.submissions.length, count + 1);
  assert.equal(response.status(), 202, "The installed backend must acknowledge durable enqueue before polling");
  const task = report.submissions.at(-1), accepted = await response.json();
  assert.equal(accepted.id, task.id, "Enqueue acknowledgement belongs to a different task");
  assert.equal(accepted.projectId, task.projectId, "Enqueue acknowledgement belongs to a different project");
  task.enqueueAcceptance = { status: response.status(), id: accepted.id, projectId: accepted.projectId,
    taskStatus: accepted.status, observedAt: new Date().toISOString() };
  save();
  return task;
}
async function complete(task, window) {
  const process = await waitProcess(task.id, value => ["completed", "failed", "cancelled"].includes(value.status));
  assert.equal(process.status, "completed", JSON.stringify(process));
  assert.deepEqual(process.toolEvents.filter(event => event.status === "completed").map(event => event.tool), [
    "read_assistant_context", "build_assistant_draft", "validate_assistant_draft", "preview_assistant_draft", "read_assistant_draft", "submit_assistant_component_draft"]);
  await page.getByTestId("assistant-project-lock-dialog").waitFor({ state: "detached" });
  await window.getByTestId("assistant-creation-draft").getByRole("img", { name: "Agent徽章", exact: true }).waitFor();
  assert.deepEqual(task.request.authorized_assets, [{ id: "project-asset-1", filename: "中文 徽章.png", mime_type: "image/png" }]);
  for (const forbidden of ["private-project", "PRIVATE_UNSELECTED", "private-generation", "C:\\private", "data:image"]) assert(!JSON.stringify(task.request).includes(forbidden), `Disclosed ${forbidden}`);
  return process;
}
async function unchanged() {
  const snapshot = await A.projectSnapshot(state.backendPort); assert.deepEqual(snapshot.settings.runtimeUILayoutProfiles, original.settings.runtimeUILayoutProfiles);
  assert.deepEqual(snapshot.assetManifest, original.assetManifest);
}
async function main() {
  process.env.AGENTVN_CREATION_AGENT_TEST = "1"; process.env.AGENTVN_CREATION_AGENT_PAGE = "game_menu";
  const modelOut = path.join(out, "controlled-model"); fs.mkdirSync(modelOut); model = await startOwnedCreationApi(modelOut);
  owner = await startInstalledEditor(out); state = owner.state;
  let projectBytes;
  if (continuation) {
    assert(!state.source && !recoveryOnly);
    assert.equal(continuation.status, "FAILED"); assert([5, 6].includes(continuation.cases.length));
    const expectedPriorStages = ["installed-six-tools-project-consent-and-shared-Runtime-12-matrix",
      "installed-local-validation-interruption-reloads-original-task",
      "installed-reviewed-shared-component-merge-persistence",
      "installed-cartridge-real-download-preserves-authorized-bytes",
      "installed-external-player-consumes-new-shared-component",
      "actual-author-layout-change-rejects-old-proposal-without-overwrite"];
    assert.deepEqual(continuation.cases.map(item => item.name), expectedPriorStages.slice(0, continuation.cases.length));
    assert(continuation.cases.every(item => item.status === "PASS"));
    if (continuation.cases.length === 6) assert.equal(continuation.authorConflict?.rejected, true);
    assert.equal(continuation.matrix.length, 12); assert.equal(continuation.player.status, "PASS"); assert.equal(continuation.player.cases.length, 12);
    assert.equal(continuation.installed.exeSha256, A.readInstalledSession(out).exeSha256, "Continuation must use the exact verified installed build");
    projectBytes = fs.readFileSync(continuation.projectArtifact.path); assert.equal(A.sha256(projectBytes), continuation.projectArtifact.sha256);
    const zip = await JSZip.loadAsync(projectBytes); project = JSON.parse(await zip.file("project.json").async("string"));
    assert.equal(project.project_id, "installed_agent_shared_20261014"); assert.equal(project.nodes.length, 2);
    report.previousEvidence = { path: path.resolve(continuationPath), sha256: A.sha256(fs.readFileSync(continuationPath)),
      cases: continuation.cases, matrix: continuation.matrix.length, playerMatrix: continuation.player.cases.length,
      projectArtifact: continuation.projectArtifact,
      scope: `Explicit referenced prior ${continuation.cases.length} stages from the same installed bytes; not rerun or rewritten as new stages` };
    report.scope += `; continuation runs only remaining ${7 - continuation.cases.length} stage(s), prior results explicitly referenced`;
  } else {
  const compiled = buildSync({ stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "ts", contents: 'export {switchRuntimeUILayoutType} from "./shared/cartridge/uiLayoutProfiles"; export {useProjectStore} from "./editor/src/store/projectStore";' }, bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text;
  const module = { exports: {} }; new Function("module", "exports", compiled)(module, module.exports);
  project = fixture("installed_agent_shared_20261014"); project.title = "安装版共享菜单与授权验收";
  const defaults = structuredClone(module.exports.useProjectStore.getState().settings);
  project.editor_settings = { ...defaults, ...module.exports.switchRuntimeUILayoutType(defaults, "renpy") };
  project.asset_manifest = [
    { asset_id: "private-project-badge", asset_type: "ui", metadata: { display_name: "工程徽章", filename: "中文 徽章.png", mime_type: "image/png", data_url: `data:image/png;base64,${image.toString("base64")}`, prompt: "private-generation", filePath: "C:\\private\\badge.png" } },
    { asset_id: "private-project-unselected", asset_type: "ui", metadata: { display_name: "未授权工程图片", filename: "PRIVATE_UNSELECTED.png", mime_type: "image/png", data_url: `data:image/png;base64,${image.toString("base64")}` } } ];
  project.nodes[0].data.loadingAnimation = { kind: "default" }; project.nodes[0].data.openingAudio = [];
  projectBytes = Buffer.from(JSON.stringify(project, null, 2));
  }
  fs.writeFileSync(process.env.AGENTVN_TEST_PROJECT, projectBytes, { flag: "wx" });
  const imported = await fetch(`http://127.0.0.1:${state.backendPort}/api/project/projects/import`, { method: "POST", headers: { "content-type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent("隔离工程.vnproj") }, body: fs.readFileSync(process.env.AGENTVN_TEST_PROJECT) }); assert(imported.ok);
  const config = await fetch(`http://127.0.0.1:${state.backendPort}/api/project/state`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
    provider_connections: [{ connection_id: "controlled-agent", provider_type: "openai_compatible", display_name: "安装版受控模型", base_url: model.modelUrl, api_key_storage: "local", enabled: true }],
    provider_models: [{ provider_id: "controlled-agent-model", connection_id: "controlled-agent", model_id: "controlled-model", model_name: "controlled-model", enabled: true, display_name: "安装版受控模型", capabilities: ["text_generation"], default_parameters: { structured_mode: "tools", request_timeout_seconds: 120 } }],
    provider_selections: { text_generation: "controlled-agent-model" }, provider_secrets: { "controlled-agent": "test-only-secret" } }) }); assert(config.ok);
  await connect(); await page.reload(); await openProject(); original = await A.projectSnapshot(state.backendPort);
  if (continuation) {
    assert.deepEqual(original.settings.runtimeUILayoutProfiles, project.editor_settings.runtimeUILayoutProfiles);
    merged = original;
    // Reproduce the actual publishing-to-AI entry, including its required close.
    await page.locator('[data-workspace-surface="publish"]:visible').click(); await page.locator(".cartridge-export-panel").waitFor();
    await page.waitForFunction(() => !document.querySelector(".cartridge-export-panel")?.innerText.includes("正在检测当前构建环境")); await A.dismissEnvironmentCompletion(page);
  }
  let window = await workbench(), finalTask;
  await stage("installed-six-tools-project-consent-and-shared-Runtime-12-matrix", async () => {
    const selected = window.getByRole("checkbox", { name: "授权工程素材 工程徽章", exact: true });
    const unselected = window.getByRole("checkbox", { name: "授权工程素材 未授权工程图片", exact: true });
    assert(!await selected.isChecked() && !await unselected.isChecked());
    for (const [width, height] of recoveryOnly ? [[1920,1080]] : desktopViewports) for (const dpr of recoveryOnly ? [1] : [1, 2]) for (const reduced of recoveryOnly ? [false] : [false, true]) {
      // Keep Playwright's viewport owner aligned before applying the explicit DPR.
      // Element screenshots otherwise restore a null viewport and reset WebView metrics.
      await page.setViewportSize({ width, height }); await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
      await session.send("Emulation.clearDeviceMetricsOverride");
      await session.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
      await page.waitForFunction(({ width, height, dpr, reduced }) => innerWidth === width && innerHeight === height && Math.abs(devicePixelRatio - dpr) <= 1e-6 && matchMedia('(prefers-reduced-motion: reduce)').matches === reduced, { width, height, dpr, reduced });
      if (finalTask) { await window.getByTestId("assistant-new-conversation").click(); assert(!await selected.isChecked() && !await unselected.isChecked()); }
      await selected.check(); finalTask = await submit(window, "请读取授权工程图片，构建共享菜单徽章，经本机验证和真实Runtime预览后提交。");
      const process = await complete(finalTask, window); await unchanged();
      await window.getByLabel("选择目标页面", { exact: true }).selectOption("game_menu");
      await window.getByRole("button", { name: "预览完整 Runtime 页面", exact: true }).click();
      const iframe = window.locator('iframe[title="Ren\'Py（进阶）实际页面预览"]'); await iframe.waitFor();
      const frame = await (await iframe.elementHandle()).contentFrame(); assert(frame); await A.settleRuntime(frame);
      const shared = frame.locator('[data-ui-component-scope="game_menu"]'); assert.equal(await shared.count(), 1);
      assert.equal(await shared.getByRole("img", { name: "Agent徽章", exact: true }).evaluate(img => img.complete && img.naturalWidth > 0), true);
      const geometry = await window.evaluate(node => { const rect = node.getBoundingClientRect(); return { rect: rect.toJSON(), overflow: document.documentElement.scrollWidth - innerWidth, dpr: devicePixelRatio }; });
      assert(geometry.rect.left >= 0 && geometry.rect.top >= 0 && geometry.rect.right <= width + 1 && geometry.rect.bottom <= height + 1 && geometry.overflow <= 1);
      const capture = await captureInstalledWebview(page, session,
        path.join(out, `installed-shared-${width}-${dpr}-${reduced}.png`), { width, height, dpr, reduced });
      report.matrix.push({ width, height, dpr, reduced, processId: process.id, geometry, capture, status: "PASS" });
    }
    assert.equal(report.matrix.length, recoveryOnly ? 1 : 12); await session.send("Emulation.clearDeviceMetricsOverride"); await page.emulateMedia({ reducedMotion: "no-preference" });
  });
  await stage("installed-local-validation-interruption-reloads-original-task", async () => {
    await window.getByTestId("assistant-new-conversation").click();
    await window.getByRole("checkbox", { name: "授权工程素材 工程徽章", exact: true }).check();
    let blocked; const observed = new Promise(resolve => { blocked = resolve; });
    await page.route("**/api/assistant/creation/processes/*/local-result", async route => { await route.abort(); blocked(); });
    const task = await submit(window, "本机验证回执中断后，恢复原任务，不重发提交。"); await observed;
    const pending = await read(`/api/assistant/creation/processes/${task.id}`); assert.equal(pending.localToolRequest.action, "validate_assistant_draft");
    await page.unroute("**/api/assistant/creation/processes/*/local-result"); await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".recent-project-open:not(:disabled):visible").first().waitFor(); await openProject();
    const lock = page.getByTestId("assistant-project-lock-dialog");
    // The original task controller restores its own local request on load.
    await waitProcess(task.id, value => value.status === "completed"); await lock.waitFor({ state: "detached" });
    if (!await page.locator(".editor-toolbar").isVisible()) await openProject();
    window = await workbench(); const result = await complete(task, window);
    assert.equal(result.toolEvents.filter(event => event.tool === "read_assistant_context" && event.status === "started").length, 1);
    assert.equal(report.submissions.filter(item => item.id === task.id).length, 1); finalTask = task; await unchanged();
  });
  if (recoveryOnly) {
    await stage("public-other-project-task-without-local-consent-does-not-open-recovery-window", async () => {
      await window.getByRole("button", { name: "关闭工作台", exact: true }).click(); await window.waitFor({ state: "detached" });
      await page.locator('[data-workspace-surface="edit"]:visible').click(); await A.settleEditor(page); await page.getByRole("button", { name: "返回首页", exact: true }).click();
      const peer = fixture("source_peer_without_local_consent_20261014"); peer.title = "无本机会话的另一工程"; peer.editor_settings = project.editor_settings;
      const imported = await fetch(`http://127.0.0.1:${state.backendPort}/api/project/projects/import`, { method: "POST", headers: { "content-type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent("另一隔离工程.vnproj") }, body: JSON.stringify(peer) }); assert(imported.ok);
      const id = crypto.randomUUID(), body = { ...rawSubmission, id, project_id: peer.project_id, project_title: peer.title, conversation_id: crypto.randomUUID() };
      const response = await fetch(`http://127.0.0.1:${state.backendPort}/api/assistant/creation/processes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); assert.equal(response.status, 202);
      await waitProcess(id, value => Boolean(value.localToolRequest));
      await page.reload(); await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: peer.title }).first().click();
      const lock = page.getByTestId("assistant-project-lock-dialog"); await lock.waitFor(); await page.waitForFunction(() => !document.querySelector(".app-transition-stage.is-switching"));
      assert.equal(await page.getByTestId("assistant-creation-workbench-window").count(), 0, "A public task must not recover another profile's private consent");
      await lock.getByRole("button", { name: "返回工程列表", exact: true }).focus(); await page.keyboard.press("Tab"); assert(await lock.evaluate(node => node.contains(document.activeElement)));
      await lock.getByRole("button", { name: "取消此创造任务", exact: true }).click(); await waitProcess(id, value => value.status === "cancelled");
      report.unownedRecovery = { projectId: peer.project_id, processId: id, automaticWindow: false, status: "PASS" };
    });
    assert.equal(report.cases.length, 3); assert.deepEqual(report.errors, []); report.status = "PASS"; return;
  }
  await stage("installed-reviewed-shared-component-merge-persistence", async () => {
    await window.getByLabel("选择目标页面", { exact: true }).selectOption("game_menu");
    await window.getByTestId("assistant-creation-merge-button").click();
    await window.getByText(/已将.*应用到.*game_menu/).waitFor();
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) { merged = await A.projectSnapshot(state.backendPort); if (merged.settings.runtimeUILayout.screens.find(screen => screen.screen_id === "game_menu").components.some(c => c.component_type === "custom_component")) break; await sleep(150); }
    const component = merged.settings.runtimeUILayout.screens.find(screen => screen.screen_id === "game_menu").components.find(c => c.component_type === "custom_component"); assert(component);
    const asset = merged.assetManifest.find(asset => asset.asset_id === component.customComponent.root.children[0].assetId); assert(asset); assert.deepEqual(await A.assetBytes(state.backendPort, asset), image);
    assert.deepEqual(merged.settings.runtimeUILayoutProfiles.profiles.agentvn, original.settings.runtimeUILayoutProfiles.profiles.agentvn);
    const detail = (await read(`/api/project/projects/${project.project_id}`)).data; assert.deepEqual(detail.editor_settings.runtimeUILayoutProfiles, merged.settings.runtimeUILayoutProfiles);
    await window.getByRole("button", { name: "关闭工作台", exact: true }).click();
    await page.locator('[data-workspace-surface="options"]:visible').click(); await page.locator('[data-help-key="advanced.tab.settings"]:visible').click(); await A.settleEditor(page);
    const directory = path.join(out, "中文 工程保存目录"); fs.mkdirSync(directory);
    report.nativeSaveDirectory = await A.nativeInput({ page, trigger: page.locator('[data-help-key="settings.projectExportDirectory.choose"]:visible'), out, name: "project-save-directory", ownerPid: state.editorPid, selectedPath: directory });
    await page.waitForFunction(value => document.querySelector('[data-help-key="settings.projectExportDirectory.current"]')?.textContent?.trim() === value, directory);
    await page.locator('[data-workspace-surface="edit"]:visible').click(); await A.settleEditor(page);
    await page.getByRole("button", { name: "保存工程", exact: true }).click(); const savedDialog = page.getByTestId("project-save-confirmation"); await savedDialog.waitFor();
    const names = fs.readdirSync(directory).filter(name => name.endsWith(".vnproj")); assert.equal(names.length, 1);
    const savedFile = path.join(directory, names[0]), zip = await JSZip.loadAsync(fs.readFileSync(savedFile)), savedProject = JSON.parse(await zip.file("project.json").async("string"));
    assert.deepEqual(savedProject.editor_settings.runtimeUILayoutProfiles, merged.settings.runtimeUILayoutProfiles);
    const savedAsset = savedProject.asset_manifest.find(item => item.asset_id === asset.asset_id); assert(savedAsset); assert.deepEqual(await zip.file(savedAsset.metadata.project_path).async("nodebuffer"), image);
    assert(!JSON.stringify(savedProject).includes("authorizedProjectAssetIds")); report.projectArtifact = { path: savedFile, sha256: A.sha256(fs.readFileSync(savedFile)), generatedAt: fs.statSync(savedFile).mtime.toISOString() };
    await savedDialog.getByRole("button", { name: "OK", exact: true }).click(); await page.getByRole("button", { name: "返回首页", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector(".app-transition-stage.is-switching"));
    report.nativeProjectReopen = await A.nativeInput({ page, trigger: page.getByRole("button", { name: "导入项目", exact: true }), out, name: "project-open", ownerPid: state.editorPid, selectedPath: savedFile });
    await page.locator(".editor-toolbar").waitFor(); await A.settleEditor(page);
    assert.deepEqual((await A.projectSnapshot(state.backendPort)).settings.runtimeUILayoutProfiles, merged.settings.runtimeUILayoutProfiles);
    await browser.close(); browser = undefined; report.cleanup.push(await owner.stop());
    report.restartMethod = "Explicit owned QA process termination and restart; not a normal native window-close acceptance";
    owner = await startInstalledEditor(out, { restart: true });
    await connect(); await openProject(); assert.deepEqual((await A.projectSnapshot(state.backendPort)).settings.runtimeUILayoutProfiles, merged.settings.runtimeUILayoutProfiles);
  });
  await stage("installed-cartridge-real-download-preserves-authorized-bytes", async () => {
    await page.locator('[data-workspace-surface="publish"]:visible').click(); const publish = page.locator(".cartridge-export-panel"); await publish.waitFor();
    await page.waitForFunction(() => !document.querySelector(".cartridge-export-panel")?.innerText.includes("正在检测当前构建环境")); await A.dismissEnvironmentCompletion(page);
    await publish.locator('[data-help-key="package.mode"]').click(); await page.getByRole("option").filter({ hasText: "游戏卡带 .vncart" }).click();
    await publish.locator('.package-stage-navigation-item[data-package-stage="checks"]').click();
    const warnings = publish.getByRole("checkbox", { name: /我已检查全部警告/ }); if (await warnings.count()) await warnings.check();
    cartridge = await A.realDownload(page, session, out, publish.locator(".package-primary-action"));
    const zip = await JSZip.loadAsync(fs.readFileSync(cartridge.path)); const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    const layoutBytes = await zip.file("ui/layout.json").async("nodebuffer"); const layout = JSON.parse(layoutBytes.toString("utf8"));
    const component = layout.screens.find(screen => screen.screen_id === "game_menu").components.find(c => c.component_type === "custom_component"); assert(component);
    const asset = manifest.assets.find(asset => asset.asset_id === component.customComponent.root.children[0].assetId); assert(asset); assert.deepEqual(await zip.file(asset.path).async("nodebuffer"), image);
    assert.equal(manifest.runtime_version, "0.25.0",
      "Current default Ren'Py layout declares the actual Hide capability, in addition to shared components");
    report.cartridge = { ...cartridge, layoutSha256: A.sha256(layoutBytes), assetSha256: A.sha256(image) };
  });
  await stage("installed-external-player-consumes-new-shared-component", async () => {
    report.player = await verifyInstalledSharedMenu({ installRoot: state.installRoot, cartridge: cartridge.path, out: path.join(out, "installed-player") });
  });
  await stage("actual-author-layout-change-rejects-old-proposal-without-overwrite", async () => {
    window = await workbench(); await window.getByTestId("assistant-new-conversation").click();
    await window.getByRole("checkbox", { name: "授权工程素材 工程徽章", exact: true }).check();
    const task = await submit(window, "构建新的共享菜单草稿，用于验证作者后续修改的冲突保护。"); await complete(task, window);
    await window.getByLabel("选择目标页面", { exact: true }).selectOption("game_menu");
    await window.getByRole("button", { name: "关闭工作台", exact: true }).click(); await window.waitFor({ state: "detached" });
    await page.locator('[data-workspace-surface="options"]:visible').click(); await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await A.settleEditor(page);
    await page.getByTestId("renpy-player-layout-entry").click();
    await page.locator(".runtime-layout-screen-list").getByRole("button", { name: "游戏菜单", exact: true }).click();
    await page.getByRole("button", { name: "添加遮罩", exact: true }).click(); await page.getByRole("button", { name: "保存布局", exact: true }).click();
    const deadline = Date.now() + 15000; let authored;
    while (Date.now() < deadline) { authored = await A.projectSnapshot(state.backendPort); if (authored.settings.runtimeUILayout.screens.find(s => s.screen_id === "game_menu").components.length > merged.settings.runtimeUILayout.screens.find(s => s.screen_id === "game_menu").components.length) break; await sleep(100); }
    assert(authored.settings.runtimeUILayout.screens.find(s => s.screen_id === "game_menu").components.length > merged.settings.runtimeUILayout.screens.find(s => s.screen_id === "game_menu").components.length, "Actual author mask must be persisted before testing a conflict");
    window = await workbench(); await window.getByTestId("assistant-creation-draft").waitFor();
    await window.getByLabel("选择目标页面", { exact: true }).selectOption("game_menu");
    await window.getByTestId("assistant-creation-merge-readiness").filter({ hasText: /共享游戏菜单.*发生了变化/ }).waitFor();
    assert.equal(await window.getByTestId("assistant-creation-merge-button").isEnabled(), false);
    assert.deepEqual((await A.projectSnapshot(state.backendPort)).settings.runtimeUILayoutProfiles, authored.settings.runtimeUILayoutProfiles);
    await window.screenshot({ path: path.join(out, "installed-author-conflict.png") }); report.authorConflict = { processId: task.id, source: "actual Add mask and Save layout UI", rejected: true };
  });
  await stage("installed-all-active-queue-FIFO-cancel-and-refresh", async () => {
    queueModel = await controlledAssistantProvider(); queueModel.hold("QUEUE_A");
    const configured = await fetch(`http://127.0.0.1:${state.backendPort}/api/project/state`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider_connections: [{ connection_id: "controlled-agent", provider_type: "openai_compatible", display_name: "安装版队列受控模型", base_url: queueModel.url, api_key_storage: "local", enabled: true }] }) }); assert(configured.ok);
    // Read the new provider through a real editor reload; never patch its store.
    await window.getByRole("button", { name: "关闭工作台", exact: true }).click(); await page.reload();
    await page.locator(".recent-project-open:not(:disabled):visible").first().waitFor(); await openProject(); window = await workbench(); await window.getByTestId("assistant-new-conversation").click();
    const running = await submit(window, "QUEUE_A 暂停外部响应以验证真实全局排队"); await waitProcess(running.id, p => p.status === "running");
    await page.getByTestId("assistant-project-lock-dialog").getByRole("button", { name: "返回工程列表", exact: true }).click();
    const waiting = [];
    // Public import/enqueue APIs provide the volume fixture. Cancel/visibility/positions are tested through real installed UI.
    for (let index = 0; index < 9; index++) {
      const p = fixture(`installed_queue_${index}_20261014`); p.title = `安装版队列工程 ${index}`; p.editor_settings = structuredClone(project.editor_settings);
      // Queue fixtures have no resources, so do not copy the original custom image references.
      for (const layout of [p.editor_settings.runtimeUILayout, p.editor_settings.runtimeUILayoutProfiles?.profiles?.renpy])
        if (layout) for (const screen of layout.screens) screen.components = screen.components.filter(component => component.component_type !== "custom_component");
      const imported = await fetch(`http://127.0.0.1:${state.backendPort}/api/project/projects/import`, { method: "POST", headers: { "content-type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(`排队${index}.vnproj`) }, body: JSON.stringify(p) }); assert(imported.ok);
      if (index < 8) {
        const body = { ...rawSubmission, id: crypto.randomUUID(), project_id: p.project_id, project_title: p.title, conversation_id: crypto.randomUUID(), request: { ...rawSubmission.request, user_request: `QUEUE_${String.fromCharCode(66 + index)} 验证完整队列` } };
        const enqueue = await fetch(`http://127.0.0.1:${state.backendPort}/api/assistant/creation/processes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); assert.equal(enqueue.status, 202); waiting.push({ id: body.id, title: p.title });
      }
    }
    await page.reload(); await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: "安装版队列工程 8" }).first().click(); await A.settleEditor(page);
    await page.locator('[data-workspace-surface="assistant"]:visible').click(); await A.settleEditor(page);
    const panel = page.locator(".workspace-task-panel.is-open .assistant-chat-panel"); await panel.getByRole("button", { name: "创造模式", exact: true }).click();
    const monitor = panel.getByTestId("assistant-process-monitor"); await page.waitForFunction(() => document.querySelectorAll('.workspace-task-panel.is-open [data-testid="assistant-process-monitor"] > ol > li[data-status="queued"]').length === 8);
    assert.equal(await monitor.locator(':scope > ol > li[data-status="running"]').count(), 1);
    for (const [index, task] of waiting.entries()) { const row = monitor.locator(`:scope > ol > li[data-process-id="${task.id}"]`); assert((await row.innerText()).includes(`排队第 ${index + 1} 位`)); assert(await row.getByRole("button", { name: `取消 ${task.title} 的创作进程`, exact: true }).isEnabled()); }
    for (const [width, height] of desktopViewports) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      await page.setViewportSize({ width, height }); await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
      await session.send("Emulation.clearDeviceMetricsOverride");
      await session.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
      await page.waitForFunction(({ width, height, dpr, reduced }) => innerWidth === width && innerHeight === height && Math.abs(devicePixelRatio - dpr) <= 1e-6 && matchMedia('(prefers-reduced-motion: reduce)').matches === reduced, { width, height, dpr, reduced });
      for (const task of waiting) {
        const button = monitor.locator(`li[data-process-id="${task.id}"]`).getByRole("button", { name: `取消 ${task.title} 的创作进程`, exact: true }); await button.scrollIntoViewIfNeeded(); await button.focus();
        const geometry = await button.evaluate(node => { const rect = node.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2); return { rect: rect.toJSON(), hit: hit === node || node.contains(hit), focus: document.activeElement === node, overflow: document.documentElement.scrollWidth - innerWidth }; });
        assert(geometry.hit && geometry.focus && geometry.overflow <= 1 && geometry.rect.left >= 0 && geometry.rect.right <= width + 1 && geometry.rect.top >= 0 && geometry.rect.bottom <= height + 1);
      }
      const capture = await captureInstalledWebview(page, session,
        path.join(out, `installed-queue-${width}-${dpr}-${reduced}.png`), { width, height, dpr, reduced });
      report.queueMatrix.push({ width, height, dpr, reduced, reachableQueueRows: 8, capture, status: "PASS" });
    }
    assert.equal(report.queueMatrix.length, 12); await session.send("Emulation.clearDeviceMetricsOverride"); await page.emulateMedia({ reducedMotion: "no-preference" });
    await monitor.screenshot({ path: path.join(out, "installed-nine-active-processes.png") });
    await monitor.locator(`li[data-process-id="${waiting[0].id}"]`).getByRole("button", { name: "取消", exact: false }).click(); await waitProcess(waiting[0].id, p => p.status === "cancelled");
    await monitor.locator(`li[data-process-id="${waiting[1].id}"]`).getByText("排队第 1 位", { exact: true }).waitFor();
    for (const task of waiting.slice(1)) { await monitor.locator(`li[data-process-id="${task.id}"]`).getByRole("button", { name: "取消", exact: false }).click(); await waitProcess(task.id, p => p.status === "cancelled"); }
    await monitor.locator(`li[data-process-id="${running.id}"]`).getByRole("button", { name: "取消", exact: false }).click();
    const cancellation = await waitProcess(running.id, p => p.status === "cancelling" || p.status === "cancelled");
    report.runningCancellationBarrier = { processId: running.id, status: cancellation.status,
      observedAt: new Date().toISOString(), source: "actual installed backend; held model response not released until acknowledged" };
    queueModel.release("QUEUE_A"); await waitProcess(running.id, p => p.status === "cancelled");
    assert.equal(queueModel.requests.length, 1, "No queued task may call the model after cancellation");
    await page.reload(); await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: "安装版队列工程 8" }).first().click(); await A.settleEditor(page);
    await page.locator('[data-workspace-surface="assistant"]:visible').click(); await A.settleEditor(page); await panel.getByRole("button", { name: "创造模式", exact: true }).click();
    await monitor.locator(':scope > ol > li[data-status="cancelled"]').first().waitFor(); assert.equal(await monitor.locator(':scope > ol > li').count(), 6);
    assert.equal(await monitor.locator(':scope > ol > li[data-status="running"], :scope > ol > li[data-status="queued"]').count(), 0);
    await monitor.screenshot({ path: path.join(out, "installed-active-queue.png") }); report.queue = { active: 9, queued: 8, cancelled: 9, providerRequests: queueModel.requests.length, fixtureMethod: "public import/enqueue APIs; real UI FIFO visibility/cancel/reload" };
  });
  assert.deepEqual(report.errors, []); assert.equal(report.cases.length, continuation ? 7 - continuation.cases.length : 7); report.status = "PASS";
}
main().catch(async error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; if (page) { report.failureText = (await page.locator("body").innerText().catch(() => "")).slice(-6000); await page.screenshot({ path: path.join(out, "failure.png") }).catch(() => {}); } }).finally(async () => {
  if (state && owner) { try { const response = await fetch(`http://127.0.0.1:${state.backendPort}/api/project/state`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider_secrets: {} }), signal: AbortSignal.timeout(10000) }); assert(response.ok); report.credentials = "CLEARED"; } catch (error) { report.status = "FAILED"; process.exitCode = 1; report.credentialError = String(error); } }
  await browser?.close().catch(() => {}); if (owner) report.cleanup.push(await owner.stop()); if (model) report.modelCleanup = await model.stop(); if (queueModel) report.queueCleanup = await queueModel.stop();
  if (report.status === "PASS" && !recoveryOnly && !continuation) {
    try {
      const workflows = 14, requestsPerWorkflow = Math.ceil(6 / batchSize);
      assert.equal(report.modelCleanup.modelRequestCount, workflows * requestsPerWorkflow);
      assert.deepEqual(report.modelCleanup.requestToolCounts,
        Array.from({ length: workflows }, () => Array.from({ length: requestsPerWorkflow }, (_, i) => i * batchSize)).flat(),
        "Every controlled batch must complete in order before the next request, without replay");
      assert.equal(report.modelCleanup.apiStopped, true); assert.equal(report.modelCleanup.code, 0);
    } catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
  }
  if (report.cleanup.some(value => value.editor.exitCode !== 0 || value.backend.exitCode !== 0)) { report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: report.status, cases: report.cases.length, matrix: report.matrix.length, out, error: report.error }));
});
