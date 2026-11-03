"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFile } = require("node:child_process"), { promisify } = require("node:util");
const { chromium } = require("../editor/node_modules/playwright"), JSZip = require("../editor/node_modules/jszip");
const A = require("./lib/installed-acceptance.cjs");
const { controlledAssistantReviewProvider } = require("./lib/controlled-assistant-review-provider.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/installed-webview-capture.cjs");
const execute = promisify(execFile), run = "D:/AgentVN/output/installed-assistant-review-20261018-01";
const readFile = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const destination = process.argv[2]; assert(destination && !fs.existsSync(destination)); fs.mkdirSync(destination);
const continuationFile = process.env.AGENTVN_ASSISTANT_REVIEW_CONTINUATION;
const continuation = continuationFile ? readFile(continuationFile) : undefined;
const attempt = Number(process.argv[3] || 1);
const fixture = readFile(path.join(run, "fixtures.json")), launch = readFile(path.join(run, `launch${attempt === 1 ? "" : `-${String(attempt).padStart(2, "0")}`}.json`));
const work = path.dirname(fixture.input), project = fixture.projects[0], names = ["审核关于卡", "审核帮助卡", "排除候选"];
const report = { status: "RUNNING", at: new Date().toISOString(), cases: [], matrix: [], screenshots: [], commands: [],
  submissions: [], localReceipts: [], errors: [], realModelRequests: 0, productChanges: 0, error: null,
  scope: "FROZEN_ACTUAL_NSIS_EDITOR_AUTOMATIC_PACKAGED_BACKEND; controlled external model ONLY, no store writes or API tool mocks",
  boundaries: { nativePicker: "NOT_TESTED", physical4k: false, completeMotionAudit: false, realDeepSeek: false },
  environment: { AGENTVN_TEST_PROJECT: process.env.AGENTVN_TEST_PROJECT, AGENTVN_WORKSPACE_OUTPUT: process.env.AGENTVN_WORKSPACE_OUTPUT } };
let browser, page, cdp, model, window, baseline, merged;
let expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
const sleep = ms => new Promise(r => setTimeout(r, ms)), save = () => fs.writeFileSync(path.join(destination, "report.json"), JSON.stringify(report, null, 2));
async function read(route) {
  const r = await fetch(`http://127.0.0.1:8278${route}`, { signal: AbortSignal.timeout(10000) }); assert(r.ok, `${route} HTTP ${r.status}`); return r.json();
}
async function waitForValue(fn, test, timeout = 30000) {
  const end = Date.now() + timeout; let v;
  while (Date.now() < end) { v = await fn(); if (test(v)) return v; await sleep(100); }
  report.lastWait = v; throw new Error("Observed application state did not settle");
}
async function snapshot() {
  return page.evaluate(() => {
    const p = window.__AGENTVN_PROJECT_STORE__.getState(), g = window.__AGENTVN_EDITOR_STORE__.getState();
    return JSON.parse(JSON.stringify({ id: p.projectId, settings: p.settings, assets: p.assetManifest, nodes: g.nodes, edges: g.edges }));
  });
}
async function persisted() { return (await read(`/api/project/projects/${project.projectId}`)).data; }
async function metrics(v) {
  expected = v; await cdp.send("Emulation.setDeviceMetricsOverride", { width: v.width, height: v.height, deviceScaleFactor: v.dpr, mobile: false });
  await page.emulateMedia({ reducedMotion: v.reduced ? "reduce" : "no-preference" }); await readInstalledViewport(page, v);
}
async function shot(name) { report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(destination, `${name}.png`), expected)); save(); }
async function command(args) {
  const cmd = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/installed-assistant-recovery-session.ps1", "-Suite", "review", ...args];
  const row = { command: ["powershell.exe", ...cmd], status: "RUNNING" }; report.commands.push(row); save();
  try { const r = await execute("powershell.exe", cmd, { cwd: "D:/AgentVN", windowsHide: true, timeout: 85000, maxBuffer: 2e6 });
    Object.assign(row, { status: "PASS", exitCode: 0, stdout: r.stdout, stderr: r.stderr });
  } catch (e) { Object.assign(row, { status: "FAILED", exitCode: e.code, stdout: e.stdout, stderr: e.stderr }); throw e; } finally { save(); }
}
async function connect(port) {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = await waitForValue(async () => browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes("tauri.localhost")), Boolean);
  page.setDefaultTimeout(25000); cdp = await page.context().newCDPSession(page);
  page.on("pageerror", e => report.errors.push(String(e)));
  page.on("request", r => {
    if (r.method() === "POST" && r.url().endsWith("/api/assistant/creation/processes")) {
      const v = r.postDataJSON();
      // The local backend legitimately needs provider credentials; NEVER put
      // that selection in evidence or pretend it was sent into model context.
      const raw = JSON.stringify({ ...v.request, provider_selection: undefined });
      for (const forbidden of ["private-project", "PRIVATE_UNSELECTED", "private-generation", "data:image"])
        if (raw.includes(forbidden)) report.errors.push(`Private data disclosed in creation submission: ${forbidden}`);
      report.submissions.push({ id: v.id, projectId: v.project_id, request: { ...v.request, provider_selection: "[test-provider]" } }); save();
    } else if (r.method() === "POST" && /\/local-result$/.test(r.url())) {
      report.localReceipts.push({ url: r.url(), payload: r.postDataJSON() }); save();
    }
  });
  await metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });
  // A previous failed harness may leave a real editing surface open. Follow a
  // genuine document reload rather than falsely assuming a new CDP connection
  // means the application is already at Home.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".recent-project-open:not(:disabled):visible").first().waitFor();
}
async function openProject() {
  await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: project.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await A.settleEditor(page);
  assert.equal((await snapshot()).id, project.projectId);
}
async function openWorkbench() {
  await page.locator('[data-workspace-surface="assistant"]:visible').click(); await A.settleEditor(page);
  const panel = page.locator(".workspace-task-panel.is-open .assistant-chat-panel");
  await panel.getByRole("button", { name: "创造模式", exact: true }).click();
  await panel.getByRole("button", { name: "在独立窗口打开创造工作台", exact: true }).click();
  window = page.getByTestId("assistant-creation-workbench-window"); await window.waitFor(); return window;
}
async function submit(marker) {
  await window.getByLabel("向大模型助手提问", { exact: true }).fill(`${marker} 使用授权工程徽章完成组件，经本机验证、Runtime预览后提交候选，不自动合并。`);
  const n = report.submissions.length; await window.getByRole("button", { name: "生成创作提案", exact: true }).click();
  await waitForValue(async () => report.submissions.length, count => count === n + 1);
  const task = report.submissions.at(-1);
  const result = await waitForValue(() => read(`/api/assistant/creation/processes/${task.id}`), p => ["completed", "failed", "cancelled"].includes(p.status), 70000);
  assert.equal(result.status, "completed", JSON.stringify(result)); report.tasks ??= []; report.tasks.push(result);
  assert.deepEqual(result.toolEvents.filter(e => e.status === "completed").map(e => e.tool), model.names);
  await page.getByTestId("assistant-project-lock-dialog").waitFor({ state: "detached" });
  await window.getByTestId("assistant-creation-draft").waitFor();
  assert.deepEqual(task.request.authorized_assets, [{ id: "project-asset-1", filename: "中文 徽章.png", mime_type: "image/png" }]);
  return task;
}
async function stage(name, fn) {
  if (continuation?.cases.some(c => c.name === name && c.status === "PASS")) return;
  const row = { name, status: "RUNNING" }; report.cases.push(row); save(); console.log(`START ${name}`);
  try { row.detail = await fn(); row.status = "PASS"; console.log(`PASS ${name}`); }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; } finally { save(); }
}
function custom(s) { return s.settings.runtimeUILayout.screens.find(p => p.screen_id === "title").components.filter(c => c.component_type === "custom_component"); }
async function unchanged(before) {
  const now = await snapshot(); assert.deepEqual(now.settings, before.settings); assert.deepEqual(now.assets, before.assets);
  assert.deepEqual(now.nodes, before.nodes); assert.deepEqual(now.edges, before.edges);
}
(async () => {
  assert.equal(path.resolve(report.environment.AGENTVN_TEST_PROJECT), path.resolve(fixture.input));
  assert.equal(path.resolve(report.environment.AGENTVN_WORKSPACE_OUTPUT), path.resolve(run));
  assert.equal(A.sha256(fs.readFileSync(path.join(launch.installRoot, "agentvn-editor.exe"))), launch.executableSha256);
  model = await controlledAssistantReviewProvider(); report.modelEndpoint = model.url;
  for (const p of continuation ? [] : fixture.projects) {
    assert.equal(A.sha256(fs.readFileSync(p.input)), p.sha256);
    const r = await fetch("http://127.0.0.1:8278/api/project/projects/import", { method: "POST",
      headers: { "content-type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(p.input)) },
      body: fs.readFileSync(p.input), signal: AbortSignal.timeout(30000) }); const v = await r.json(); assert(r.ok && v.ok);
  }
  report.fixtureSeed = continuation ? "CONTINUATION_EXISTING_MERGED_PROJECT_NO_REIMPORT" : "PUBLIC_ACTUAL_BACKEND_IMPORT_NOT_NATIVE_PICKER";
  const configured = await fetch("http://127.0.0.1:8278/api/project/state", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider_connections: [{ connection_id: "controlled-review", provider_type: "openai_compatible", display_name: "审核链受控模型",
      base_url: model.url, api_key_storage: "local", enabled: true }],
    provider_models: [{ provider_id: "controlled-review-model", connection_id: "controlled-review", model_id: "controlled-model", model_name: "controlled-model",
      enabled: true, capabilities: ["text_generation"], default_parameters: { structured_mode: "tools", request_timeout_seconds: 120 } }],
    provider_selections: { text_generation: "controlled-review-model" }, provider_secrets: { "controlled-review": "test-only-secret" } }) }); assert(configured.ok);
  const port = continuation ? readFile(path.join(run, "review-frontend-restart.json")).cdpPort : launch.cdpPort;
  await connect(port); await openProject();
  if (continuation) {
    assert.equal(continuation.status, "FAILED"); assert.equal(continuation.matrix.length, 12);
    assert.equal(continuation.cases.filter(c => c.status === "PASS").length, 4);
    baseline = continuation.baseline; merged = continuation.merged;
    assert.deepEqual((await snapshot()).settings.runtimeUILayoutProfiles, merged.settings.runtimeUILayoutProfiles);
    report.priorEvidence = { path: continuationFile, sha256: A.sha256(fs.readFileSync(continuationFile)),
      passedStages: continuation.cases.filter(c => c.status === "PASS").map(c => c.name), notRerun: true };
    report.merged = merged; report.projectArtifact = continuation.projectArtifact;
  } else baseline = await snapshot();
  report.baseline = baseline;
  await stage("Explicit one-image consent, six actual tools, genuine local validation and Runtime receipts without project mutation", async () => {
    await openWorkbench(); await window.getByTestId("assistant-new-conversation").click();
    const selected = window.getByRole("checkbox", { name: "授权工程素材 工程徽章", exact: true });
    const unselected = window.getByRole("checkbox", { name: "授权工程素材 未授权工程图片", exact: true });
    assert(!await selected.isChecked() && !await unselected.isChecked()); await selected.check();
    const task = await submit("REVIEW_A"); await unchanged(baseline);
    assert.equal(model.requests.length, 6); assert.equal(report.localReceipts.length, 2);
    assert(report.localReceipts.every(r => r.payload.project_id === project.projectId && r.payload.result.ok));
    assert.equal(model.requests[3].receipts.at(-1).result.status, "validated");
    assert.equal(model.requests[4].receipts.at(-1).result.status, "rendered");
    assert.equal(await window.getByTestId("assistant-creation-review-batch").locator("ol > li").count(), 3);
    await shot("actual-six-tools-three-candidates");
    return { task: task.id, modelRequests: 6, localReceipts: 2, paidRequests: 0, noAutoMerge: true };
  });
  await stage("Exclude one candidate, genuine selected-combination Runtime preview, twelve bounded interactive review combinations", async () => {
    await window.getByRole("checkbox", { name: `应用候选 ${names[2]}`, exact: true }).uncheck();
    for (const [i, name] of names.slice(0, 2).entries()) {
      await window.getByLabel(`${name} 目标页面`, { exact: true }).selectOption("title");
      for (const [key, value] of Object.entries({ x: 62, y: 10 + i * 24, width: 30, height: 21 }))
        await window.getByLabel(`${name} ${key}`, { exact: true }).fill(String(value));
    }
    await window.getByRole("button", { name: "预览所选候选组合", exact: true }).click();
    const preview = window.getByTestId("assistant-creation-batch-runtime");
    await preview.locator('[data-preview-phase="ready"]').waitFor({ timeout: 45000 });
    const iframe = preview.locator("iframe"); assert.equal(await iframe.count(), 1);
    const frame = await (await iframe.elementHandle()).contentFrame(); assert(frame); await A.settleRuntime(frame);
    assert.equal(await frame.getByTestId("runtime-custom-component").count(), 2);
    assert.equal(await frame.getByRole("button", { name: "排除候选操作", exact: true }).count(), 0);
    await frame.getByRole("img", { name: "审核关于卡徽章", exact: true }).evaluate(img => img.decode());
    await unchanged(baseline);
    const merge = window.getByTestId("assistant-creation-merge-batch");
    for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      const v = { width, height, dpr, reduced }; await metrics(v); await merge.scrollIntoViewIfNeeded(); await merge.focus();
      const g = await merge.evaluate(n => {
        const r = n.getBoundingClientRect(), w = n.closest('[data-testid="assistant-creation-workbench-window"]').getBoundingClientRect();
        const h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { rect: r.toJSON(), window: w.toJSON(), hit: n === h || n.contains(h), focus: document.activeElement === n,
          overflow: document.documentElement.scrollWidth - innerWidth };
      });
      assert(g.hit && g.focus && g.overflow <= 1 && g.rect.left >= 0 && g.rect.top >= 0 && g.rect.right <= width + 1 && g.rect.bottom <= height + 1);
      assert(g.window.left >= 0 && g.window.top >= 0 && g.window.right <= width + 1 && g.window.bottom <= height + 1);
      assert(await merge.isEnabled()); report.matrix.push({ ...v, geometry: g, status: "PASS" }); await shot(`review-${width}-${dpr}-${reduced}`);
    }
    assert.equal(report.matrix.length, 12); await metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });
    return { candidates: 3, selected: 2, excluded: 1, realRuntimePreview: true, combinations: 12 };
  });
  await stage("Actual batch click merges only selected candidates atomically, preserving other layout and exact authorized bytes", async () => {
    await page.evaluate(() => {
      const store = window.__AGENTVN_PROJECT_STORE__;
      window.__QA_REVIEW_OBSERVATIONS__ = [];
      window.__QA_REVIEW_UNSUBSCRIBE__ = store.subscribe(s => {
        window.__QA_REVIEW_OBSERVATIONS__.push(s.settings.runtimeUILayout.screens.find(p => p.screen_id === "title").components.filter(c => c.component_type === "custom_component").length);
      });
    });
    // Observer is read-only. Only this actual user action mutates project state.
    await window.getByTestId("assistant-creation-merge-batch").click();
    await window.getByRole("status").filter({ hasText: "已将 2 个候选一次性应用到工程" }).waitFor();
    merged = await snapshot(); assert.equal(custom(merged).length, 2);
    const observations = await page.evaluate(() => { window.__QA_REVIEW_UNSUBSCRIBE__(); return window.__QA_REVIEW_OBSERVATIONS__; });
    assert(observations.includes(2) && !observations.includes(1), "Batch project subscription must never expose a one-component partial merge");
    assert(custom(merged).every(c => !JSON.stringify(c).includes("排除候选")));
    assert.deepEqual(merged.settings.runtimeUILayoutProfiles.profiles.agentvn, baseline.settings.runtimeUILayoutProfiles.profiles.agentvn);
    assert.deepEqual(merged.nodes, baseline.nodes); assert.deepEqual(merged.edges, baseline.edges);
    const detail = await waitForValue(persisted, p => p.editor_settings.runtimeUILayout.screens.find(s => s.screen_id === "title").components.filter(c => c.component_type === "custom_component").length === 2);
    assert.deepEqual(detail.editor_settings.runtimeUILayoutProfiles, merged.settings.runtimeUILayoutProfiles);
    const imageAssets = merged.assets.filter(a => !baseline.assets.some(b => b.asset_id === a.asset_id));
    assert.equal(imageAssets.length, 2);
    for (const a of imageAssets) assert.equal(A.sha256(await A.assetBytes(8278, a)), fixture.image.sha256);
    report.merged = merged; report.atomicObservation = observations; await shot("actual-merged-two-selected");
    return { atomicCountObservation: observations, newComponents: 2, newCopiedAssets: 2, unselectedNotApplied: true };
  });
  await stage("Native default-download vnproj save then actual frontend restart and homepage reopen preserve merged data", async () => {
    await window.getByRole("button", { name: "关闭工作台", exact: true }).click(); await window.waitFor({ state: "detached" });
    await page.locator('[data-workspace-surface="edit"]:visible').click(); await A.settleEditor(page);
    const downloads = "C:/Users/1/Downloads", prior = new Set(fs.readdirSync(downloads));
    await page.locator('[data-help-key="toolbar.saveProject"]:visible').click();
    const dialog = page.getByTestId("project-save-confirmation"); await dialog.waitFor();
    const candidates = fs.readdirSync(downloads).filter(n => !prior.has(n) && n.startsWith(project.title) && n.endsWith(".vnproj")); assert.equal(candidates.length, 1);
    const savedFile = path.join(downloads, candidates[0]), copied = path.join(work, candidates[0]);
    fs.copyFileSync(savedFile, copied, fs.constants.COPYFILE_EXCL);
    const bytes = fs.readFileSync(copied), zip = await JSZip.loadAsync(bytes), p = JSON.parse(await zip.file("project.json").async("string"));
    assert.deepEqual(p.editor_settings.runtimeUILayoutProfiles, merged.settings.runtimeUILayoutProfiles);
    for (const asset of p.asset_manifest.filter(a => merged.assets.some(x => x.asset_id === a.asset_id) && !baseline.assets.some(x => x.asset_id === a.asset_id)))
      assert.equal(A.sha256(await zip.file(asset.metadata.project_path).async("nodebuffer")), fixture.image.sha256);
    assert(!JSON.stringify(p).includes("authorizedProjectAssetIds"), "Local authorization must not enter portable project");
    report.projectArtifact = { path: copied, source: savedFile, sha256: A.sha256(bytes), generatedAt: fs.statSync(copied).mtime.toISOString() };
    await dialog.getByRole("button", { name: "OK", exact: true }).click(); await browser.close(); browser = undefined;
    await command(["-Action", "FrontendRestart", "-Evidence", "review-frontend-restart", "-Attempt", String(attempt)]);
    const restarted = readFile(path.join(run, "review-frontend-restart.json")); assert.equal(restarted.status, "PASS");
    await connect(restarted.cdpPort); await openProject();
    const reopened = await snapshot(); assert.deepEqual(reopened.settings.runtimeUILayoutProfiles, merged.settings.runtimeUILayoutProfiles);
    assert.deepEqual(reopened.nodes, merged.nodes); assert.deepEqual(reopened.edges, merged.edges);
    for (const a of reopened.assets.filter(a => !baseline.assets.some(b => b.asset_id === a.asset_id))) assert.equal(A.sha256(await A.assetBytes(8278, a)), fixture.image.sha256);
    report.reopened = reopened; await shot("actual-native-restart-reopen"); return report.projectArtifact;
  });
  await stage("Actual installed publish vncart contains precisely merged definitions and byte-exact authorized dependencies", async () => {
    await page.locator('[data-workspace-surface="publish"]:visible').click(); await A.settleEditor(page);
    await page.waitForFunction(() => !document.querySelector(".cartridge-export-panel")?.innerText.includes("正在检测当前构建环境"));
    // Opening Publish starts a real asynchronous check, even when cached.
    // Do not take one early isVisible sample and race its late completion.
    await page.getByRole("dialog").filter({ hasText: "环境检测已完成" }).waitFor({ timeout: 60000 });
    await A.dismissEnvironmentCompletion(page);
    await page.locator('[data-help-key="package.mode"]').click(); await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
    const warnings = page.getByRole("button", { name: "查看并确认警告", exact: true }); if (await warnings.isVisible()) await warnings.click();
    const confirm = page.locator('[data-help-key="package.confirmWarnings"]'); if (await confirm.isVisible()) await confirm.check();
    const exportRoot = path.join(work, "cartridge-export"); assert(!fs.existsSync(exportRoot)); fs.mkdirSync(exportRoot);
    report.cartridge = await A.realDownload(page, cdp, exportRoot, page.locator('[data-help-key="package.export"]'));
    const zip = await JSZip.loadAsync(fs.readFileSync(report.cartridge.path)), layoutBytes = await zip.file("ui/layout.json").async("nodebuffer");
    const layout = JSON.parse(layoutBytes.toString("utf8")), manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    assert.deepEqual(layout.screens.find(s => s.screen_id === "title").components.filter(c => c.component_type === "custom_component"), custom(merged));
    assert.equal(manifest.game_id, project.projectId); report.cartridge.layoutSha256 = A.sha256(layoutBytes); report.cartridge.assets = [];
    for (const a of manifest.assets) {
      const hash = A.sha256(await zip.file(a.path).async("nodebuffer")); assert.equal(hash, fixture.image.sha256);
      report.cartridge.assets.push({ id: a.asset_id, path: a.path, sha256: hash });
    }
    assert(report.cartridge.assets.length >= 2); await shot("actual-UI-cartridge-export"); return report.cartridge;
  });
  await stage("New conversation clears consent; real author layout edit causes stale proposal rejection without overwrite", async () => {
    const closePublish = page.getByRole("button", { name: "关闭发布与打包", exact: true }); if (await closePublish.isVisible()) await closePublish.click();
    await openWorkbench(); await window.getByTestId("assistant-new-conversation").click();
    const selected = window.getByRole("checkbox", { name: "授权工程素材 工程徽章", exact: true }); assert(!await selected.isChecked());
    assert(!await window.getByRole("checkbox", { name: "授权工程素材 未授权工程图片", exact: true }).isChecked());
    await selected.check(); const task = await submit("CONFLICT_A");
    await window.getByLabel("选择目标页面", { exact: true }).selectOption("game_menu");
    await window.getByRole("button", { name: "关闭工作台", exact: true }).click(); await window.waitFor({ state: "detached" });
    await page.locator('[data-workspace-surface="options"]:visible').click(); await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await A.settleEditor(page);
    await page.getByTestId("renpy-player-layout-entry").click();
    await page.locator(".runtime-layout-screen-list").getByRole("button", { name: "游戏菜单", exact: true }).click();
    const prior = await snapshot(), count = prior.settings.runtimeUILayout.screens.find(s => s.screen_id === "game_menu").components.length;
    await page.getByRole("button", { name: "添加遮罩", exact: true }).click(); await page.getByRole("button", { name: "保存布局", exact: true }).click();
    const authored = await waitForValue(persisted, p => p.editor_settings.runtimeUILayout.screens.find(s => s.screen_id === "game_menu").components.length > count);
    await openWorkbench(); await window.getByLabel("选择目标页面", { exact: true }).selectOption("game_menu");
    const readiness = window.getByTestId("assistant-creation-merge-readiness"); await readiness.filter({ hasText: /共享游戏菜单.*发生了变化/ }).waitFor();
    assert(!await window.getByTestId("assistant-creation-merge-button").isEnabled());
    assert.deepEqual((await persisted()).editor_settings.runtimeUILayoutProfiles, authored.editor_settings.runtimeUILayoutProfiles);
    report.authorConflict = { task: task.id, realAuthorUI: "Add mask + Save layout", rejected: true }; await shot("actual-author-conflict-rejected");
    return report.authorConflict;
  });
  assert.deepEqual(report.errors, []); assert.deepEqual(model.errors, []); assert.equal(report.cases.length, continuation ? 2 : 6);
  assert.equal(model.requests.length, continuation ? 6 : 12); assert.equal(report.submissions.length, continuation ? 1 : 2); report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page) { report.failureText = (await page.locator("body").innerText().catch(() => "")).slice(-14000); await shot("failure").catch(() => {}); }
}).finally(async () => {
  if (model) { report.modelRequests = model.requests; report.modelErrors = model.errors; report.providerCleanup = await model.stop(); }
  try {
    const active = (await read("/api/assistant/creation/processes?include_terminal=false")).processes || [];
    for (const t of active.filter(t => fixture.projects.some(p => p.projectId === t.projectId))) {
      await fetch(`http://127.0.0.1:8278/api/assistant/creation/processes/${t.id}/cancel`, { method: "POST" });
    }
    const r = await fetch("http://127.0.0.1:8278/api/project/state", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider_secrets: {} }), signal: AbortSignal.timeout(10000) }); assert(r.ok);
    report.credentialCleanup = "CLEARED_TEST_ONLY_PROVIDER_SECRET";
  } catch (e) { report.cleanupError = String(e); report.status = "FAILED"; process.exitCode = 1; }
  await browser?.close().catch(() => {}); report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, matrix: report.matrix.length, screenshots: report.screenshots.length, error: report.error, destination }, null, 2));
});
