"use strict";
// Actual installed Release, real selected model, no API responses/UI/store mocks.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const JSZip = require("../editor/node_modules/jszip");
const { chromium } = require("../editor/node_modules/playwright");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const A = require("./lib/installed-acceptance.cjs");
const { readCurrentInstalledRealModelSession } = require("./lib/current-installed-real-model-session.cjs");
const { captureInstalledWebview } = require("./lib/installed-webview-capture.cjs");
const { startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { startOwnedCreationApi } = require("./lib/owned-creation-api.cjs");
const sourceRegression = process.env.ASSISTANT_CREATION_SOURCE_REGRESSION === "1";
const defaultProfileLive = process.env.AGENTVN_REAL_MODEL_DEFAULT_SESSION === "1";
assert(!(sourceRegression && defaultProfileLive));
assert(process.argv[2] && process.argv[3] && process.argv[4],
  "Pass exact installed session, isolated project.vnproj and fresh evidence directory");
const runRoot = path.resolve(process.argv[2]), projectFile = path.resolve(process.argv[3]), out = path.resolve(process.argv[4]);
assert(A.inside(runRoot, out) && !fs.existsSync(out), "Evidence must be fresh and inside this owned session");
assert(process.env.AGENTVN_TEST_PROJECT && path.resolve(process.env.AGENTVN_TEST_PROJECT) === projectFile);
assert(process.env.AGENTVN_WORKSPACE_OUTPUT && path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT) === out);
const fixture = JSON.parse(fs.readFileSync(projectFile, "utf8"));
assert.equal(fixture.project_id, defaultProfileLive ? "installed-real-model-20261019-01" : "installed_creation_smoke_20261014");
assert.equal(fixture.nodes.length, 2);
fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "actual installed Release + existing selected external model + isolated two-node project",
  fixtureSha256: A.sha256(fs.readFileSync(projectFile)), projectFile, cases: [], errors: [], requests: [], matrix: [] };
let browser, page, session;
let sourceApp, modelHost;
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function shot(name) {
  const actual = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
  (report.screenshots ||= []).push(await captureInstalledWebview(page, session, path.join(out, name), actual));
}
const snapshot = () => A.projectSnapshot(report.backendPort);
const requestText = "只把我勾选的标题页“开始游戏”按钮文案改为“开始创作”。只提交这一个已授权控件的 label 修改；不创建新组件，不修改坐标、样式或其他控件，不声明已经保存。";
async function stage(name, operation) {
  if (sourceRegression) name = `source-replay-regression:${name}`;
  console.log(JSON.stringify({ stage: name, status: "STARTED" }));
  await operation(); report.cases.push({ name, status: "PASS" }); save();
  console.log(JSON.stringify({ stage: name, status: "PASS" }));
}
async function main() {
  let state, exeSha256;
  if (sourceRegression) {
    assert(process.env.AGENTVN_CREATION_PROPOSAL_REPORT, "Source regression reuses the recorded real model result");
    sourceApp = await startEditorAcceptance(out);
    const hostRoot = path.join(out, "controlled-model-host"); fs.mkdirSync(hostRoot);
    modelHost = await startOwnedCreationApi(hostRoot);
    state = { backendPort: Number(new URL(sourceApp.backendUrl).port), installRoot: null,
      databasePath: path.join(out, "isolated-data/vn_engine.db") };
    report.scope = "source full Editor/real backend; replay of earlier real external proposal at model boundary; NOT installed or new live-model evidence";
    report.replayedProposalReport = path.resolve(process.env.AGENTVN_CREATION_PROPOSAL_REPORT);
    const response = await fetch(`${sourceApp.backendUrl}/api/project/state`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        provider_connections: [{ connection_id: "replay", provider_type: "openai_compatible", display_name: "保存回归受控连接",
          base_url: modelHost.modelUrl, api_key_storage: "local", enabled: true }],
        provider_models: [{ provider_id: "replay-model", connection_id: "replay", model_id: "replay-model", model_name: "controlled-model",
          enabled: true, display_name: "复用既有真实提案", capabilities: ["text_generation"], default_parameters: { structured_mode: "tools" } }],
        provider_selections: { text_generation: "replay-model" }, provider_secrets: { replay: "test-only-secret" },
      }), signal: AbortSignal.timeout(30000),
    });
    assert(response.ok);
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    page = await context.newPage(); await page.goto(sourceApp.url, { waitUntil: "domcontentloaded" });
  } else {
    ({ state, exeSha256 } = defaultProfileLive ? readCurrentInstalledRealModelSession(runRoot) : A.readInstalledSession(runRoot));
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${state.cdpPort}`);
    page = browser.contexts()[0].pages().find(candidate => /tauri\.localhost/.test(candidate.url()));
  }
  report.backendPort = state.backendPort; report.exeSha256 = exeSha256;
  report.installRoot = state.installRoot; report.databasePath = state.databasePath;
  assert(page); page.setDefaultTimeout(45000);
  session = await browser.contexts()[0].newCDPSession(page);
  page.on("pageerror", error => report.errors.push(String(error)));
  page.on("request", request => {
    if (request.method() !== "POST" || !request.url().endsWith("/api/assistant/creation/processes")) return;
    const payload = request.postDataJSON();
    // Keep authorized context only. provider_selection contains a credential.
    report.requests.push({ processId: payload.id, projectId: payload.project_id,
      conversationId: payload.conversation_id, keys: Object.keys(payload.request),
      userRequest: payload.request.user_request, authorizedTargets: payload.request.authorized_targets,
      authorizedComponentCount: payload.request.authorized_components?.length ?? 0 });
    save();
  });
  let before, original;
  await stage("installed-real-top-ai-entry-and-single-explicit-control-authorization", async () => {
    const imported = await fetch(`http://127.0.0.1:${state.backendPort}/api/project/projects/import`, {
      method: "POST", headers: { "content-type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(projectFile)) },
      body: fs.readFileSync(projectFile), signal: AbortSignal.timeout(30000),
    });
    assert(imported.ok, `Isolated project import HTTP ${imported.status}`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: fixture.title }).first().click();
    await page.locator(".editor-toolbar").waitFor(); await A.settleEditor(page);
    await page.locator('[data-workspace-surface="options"]:visible').click();
    await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await A.settleEditor(page);
    await page.locator('[data-layout-type-option="renpy"]:visible').click();
    await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
    await page.waitForFunction(() => document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false");
    await A.settleEditor(page);
    before = await snapshot(); assert.equal(before.projectId, fixture.project_id);
    assert.equal(before.settings.runtimeUILayoutProfiles.activeType, "renpy");
    original = before.settings.runtimeUILayout.screens.find(screen => screen.screen_id === "title")
      .components.find(item => item.label === "开始游戏");
    assert(original);
    await page.locator('[data-workspace-surface="assistant"]:visible').click();
    await page.getByRole("button", { name: "创造模式", exact: true }).click();
    await page.getByRole("button", { name: "在独立窗口打开创造工作台", exact: true }).click();
    const workbench = page.getByTestId("assistant-creation-workbench-window");
    await workbench.getByTestId("assistant-creation-authorized-element-targets").waitFor();
    const checkbox = workbench.getByRole("checkbox", { name: "授权修改 开始游戏", exact: true });
    assert.equal(await checkbox.isChecked(), false);
    await checkbox.check();
    assert.equal(await workbench.locator('[data-testid="assistant-creation-authorized-element-targets"] input:checked').count(), 1);
    await workbench.getByLabel("向大模型助手提问", { exact: true }).fill(requestText);
    await shot("installed-authorized-before-live-request.png");
  });
  const workbench = page.getByTestId("assistant-creation-workbench-window");
  await stage("live-model-native-tool-proposal-remains-isolated-and-minimally-authorized", async () => {
    const journal = path.join(out, "submission-intent.json");
    fs.writeFileSync(journal, JSON.stringify({ task: "existing-control-edit", projectId: fixture.project_id,
      createdAt: new Date().toISOString(), policy: "ONE_SUBMISSION_NO_AUTOMATIC_RETRY" }), { flag: "wx" });
    await workbench.getByRole("button", { name: "生成创作提案", exact: true }).click();
    const deadline = Date.now() + 360000;
    let result;
    while (Date.now() < deadline) {
      if (report.requests[0]?.processId) {
        const response = await fetch(`http://127.0.0.1:${state.backendPort}/api/assistant/creation/processes/${report.requests[0].processId}`,
          { signal: AbortSignal.timeout(5000) });
        if (response.ok) {
          result = await response.json();
          if (["completed", "failed", "cancelled"].includes(result.status)) break;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    report.process = result;
    assert(result && ["completed", "failed", "cancelled"].includes(result.status), "Live creation did not reach a terminal state");
    if (result.status !== "completed") {
      report.status = result.errorCode === "provider_error" ? "BLOCKED" : "FAILED";
      throw new Error(`Live creation ${result.status}: ${result.errorCode} ${result.errorMessage}`);
    }
    assert.equal(report.requests.length, 1, "Only one explicitly submitted creation process");
    const submitted = report.requests[0]; assert.equal(submitted.projectId, fixture.project_id);
    assert.equal(submitted.authorizedTargets.length, 1); assert.equal(submitted.authorizedComponentCount, 0);
    assert(!submitted.keys.includes("project_graph") && !submitted.keys.includes("editor_context"));
    assert(!JSON.stringify(submitted.authorizedTargets).includes(original.component_id));
    assert.deepEqual(result.result.edits, [{ target_id: "target-1", screen_id: "title", label: "开始创作" }]);
    assert.equal(result.result.components?.length ?? 0, 0);
    await workbench.getByTestId("assistant-creation-element-edit-review").waitFor();
    A.assertProjectContentUnchanged(await snapshot(), before, "Unreviewed model proposal must not write the project");
    await shot("installed-live-proposal-review.png");
  });
  const review = workbench.getByTestId("assistant-creation-element-edit-review");
  await stage("actual-installed-runtime-preview-and-review-hits-12-desktop-samples", async () => {
    await review.getByRole("button", { name: "预览修改后的 Runtime 页面" }).click();
    await review.locator('[data-preview-phase="ready"]').waitFor();
    const frame = await (await review.locator('iframe[title="Ren\'Py（进阶）实际页面预览"]').elementHandle()).contentFrame();
    assert(frame); await frame.getByTestId("game-state-title").waitFor(); await A.settleRuntime(frame);
    assert.match(await frame.locator("body").innerText(), /开始创作/);
    for (const [width, height] of desktopViewports) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      await session.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
      await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
      await review.getByRole("checkbox", { name: "审核修改 开始游戏" }).scrollIntoViewIfNeeded();
      const geometry = await workbench.evaluate(element => {
        const rect = element.getBoundingClientRect(), input = element.querySelector('[data-testid="assistant-creation-element-edit-review"] input');
        const hitBox = input.getBoundingClientRect(), hit = document.elementFromPoint(hitBox.x + hitBox.width/2,hitBox.y + hitBox.height/2);
        return { rect: rect.toJSON(), input: hitBox.toJSON(), documentWidth: document.documentElement.scrollWidth,
          width: innerWidth, height: innerHeight, dpr: devicePixelRatio, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
          hit: hit === input || hit?.closest('label') === input.closest('label') };
      });
      assert(geometry.rect.left >= 0 && geometry.rect.top >= 0 && geometry.rect.right <= width + 1 && geometry.rect.bottom <= height + 1);
      assert(geometry.documentWidth <= width + 1 && geometry.hit && geometry.input.width > 0);
      assert.equal(geometry.dpr, dpr); assert.equal(geometry.reduced, reduced);
      report.matrix.push({ width, height, dpr, reduced, geometry });
    }
    assert.equal(report.matrix.length, 12);
    report.viewportScope = sourceRegression ? "isolated Chromium logical viewport source regression"
      : "CDP logical viewport in actual Release WebView; not physical 4K screen";
  });
  await stage("user-review-merges-only-label-and-survives-installed-ui-reload", async () => {
    await review.getByTestId("assistant-creation-merge-element-edits").click();
    await review.locator(".assistant-creation-element-edit-actions [role='status']").filter({ hasText: /已将 1 项修改应用/ }).waitFor();
    const deadline = Date.now() + 15000;
    let merged;
    while (Date.now() < deadline) {
      merged = await snapshot();
      const target = merged.settings.runtimeUILayout.screens.find(screen => screen.screen_id === "title")
        .components.find(component => component.component_id === original.component_id);
      if (target?.label === "开始创作") break;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    const expected = structuredClone(before);
    const update = layout => { layout.screens.find(screen => screen.screen_id === "title")
      .components.find(component => component.component_id === original.component_id).label = "开始创作"; };
    update(expected.settings.runtimeUILayout); update(expected.settings.runtimeUILayoutProfiles.profiles.renpy);
    A.assertProjectContentUnchanged(merged, expected);
    report.mergedLayoutSha256 = A.sha256(Buffer.from(JSON.stringify(merged.settings.runtimeUILayout)));
    await page.reload({ waitUntil: "domcontentloaded" });
    if (!(await page.locator(".editor-toolbar").isVisible())) {
      await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: fixture.title }).first().click();
    }
    await page.locator(".editor-toolbar").waitFor(); await A.settleEditor(page);
    A.assertProjectContentUnchanged(await snapshot(), expected);
    await shot("installed-merged-reloaded.png");
  });
  await stage("actual-installed-cartridge-download-preserves-live-approved-edit", async () => {
    await page.locator('[data-workspace-surface="publish"]:visible').click();
    const publish = page.locator(".cartridge-export-panel"); await publish.waitFor();
    await page.waitForFunction(() => !document.querySelector(".cartridge-export-panel")?.innerText.includes("正在检测当前构建环境"));
    await A.dismissEnvironmentCompletion(page);
    await publish.locator('[data-help-key="package.mode"]').click();
    await page.getByRole("option").filter({ hasText: "游戏卡带 .vncart" }).click();
    await publish.locator('.package-stage-navigation-item[data-package-stage="checks"]').click();
    const warning = publish.getByRole("checkbox", { name: /我已检查全部警告/ }); if (await warning.count()) await warning.check();
    let artifact;
    if (sourceRegression) {
      const pending = page.waitForEvent("download");
      await publish.locator(".package-primary-action").click();
      const download = await pending, filename = download.suggestedFilename();
      assert.equal(path.basename(filename), filename);
      const file = path.join(out, filename); await download.saveAs(file);
      artifact = { path: file, sha256: A.sha256(fs.readFileSync(file)), bytes: fs.statSync(file).size,
        generatedAt: fs.statSync(file).mtime.toISOString(), source: "real Chromium download, source regression" };
    } else artifact = await A.realDownload(page, session, out, publish.locator(".package-primary-action"));
    const zip = await JSZip.loadAsync(fs.readFileSync(artifact.path));
    const layoutBytes = await zip.file("ui/layout.json").async("nodebuffer"), layout = JSON.parse(layoutBytes.toString("utf8"));
    assert.equal(layout.layout_type, "renpy");
    const target = layout.screens.find(screen => screen.screen_id === "title").components.find(item => item.component_id === original.component_id);
    assert.equal(target.label, "开始创作"); assert.deepEqual(target.rect, original.rect);
    report.cartridgeArtifact = { ...artifact, layoutSha256: A.sha256(layoutBytes), title: fixture.title, gameId: fixture.project_id };
    await shot("installed-live-cartridge-export.png");
  });
  assert.deepEqual(report.errors, []); assert.equal(report.cases.length, 5);
  report.status = "PASS";
}
main().catch(async error => {
  if (report.status !== "BLOCKED") report.status = "FAILED";
  report.error = String(error.stack || error); process.exitCode = 1;
  if (page) report.renderFailure = await page.locator('.app-fatal-error, .app-error-boundary, .app-error-boundary-card').allTextContents().catch(() => []);
  if (page && !report.renderFailure?.length) report.failureText = (await page.locator('body').textContent().catch(() => '')).slice(-5000);
  if (page) await page.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
}).finally(async () => {
  if (session) { await session.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
    await session.send("Browser.setDownloadBehavior", { behavior: "default" }).catch(() => {}); await session.detach().catch(() => {}); }
  await browser?.close(); report.finishedAt = new Date().toISOString(); save();
  if (modelHost) report.modelHostCleanup = await modelHost.stop();
  await sourceApp?.stop(); save();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, matrix: report.matrix.length, out, error: report.error }));
});
