"use strict";
// Actual NSIS-installed EXE and packaged backend. UI authoring and UI exports;
// isolated fixture imports use the public backend API, never a native picker claim.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip"), { buildSync } = require("../editor/node_modules/esbuild");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { controlledAssistantProvider } = require("./lib/controlled-assistant-provider.cjs");
const { downloadUIArtifact } = require("./lib/installed-ui-completed-download.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { until } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, ".."), [installationFile, attempt = "01"] = process.argv.slice(2);
const qa = "F:/AgentVN/QA/Knowledge-Draft-Candidate-1937-20261102-01";
assert(installationFile); assert.match(attempt, /^\d{2}$/);
const out = path.join(qa, "session-" + attempt); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const desc = file => ({ path: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size });
const report = { status: "RUNNING", startedAt: new Date().toISOString(), version: "1.9.37",
  scope: "ACTUAL_INSTALLED_EDITOR_DRAFT_AND_CONTROLLED_KNOWLEDGE_NOT_REAL_MODEL_OR_PLAYER",
  installation: desc(installationFile), cases: [], screenshots: [], launches: [], cleanups: [], errors: [],
  requests: [], cartridges: [], modelRequests: 0, blockedModelRequests: 0,
  limitations: ["Explicit isolated DB/WebView, not default-account upgrade",
    "Fixture imports use the public backend API; no OS picker claim",
    "Controlled external model only; not real-model answer quality",
    "UI-exported cartridge bytes checked; external Player acceptance is separate",
    "WebView emulated sizes/DPR, not physical4K; attributed stop, not natural close"] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
const mod = { exports: {} };
new Function("module", "exports", buildSync({ stdin: { resolveDir: root, loader: "ts", contents:
  'export {createRenpyUILayout} from "./shared/cartridge/uiLayoutProfiles";export {getDefaultUISkinLayout} from "./shared/cartridge/uiSkin";' },
  bundle: true, format: "cjs", platform: "node", write: false }).outputFiles[0].text)(mod, mod.exports);
const project = fixture("qa-installed-knowledge-draft-1937-" + attempt);
project.title = "安装版草稿知识闭环 " + attempt;
project.nodes[1].data.scene.summary = "PRIVATE_STORY_SENTINEL_DO_NOT_SEND";
project.editor_settings.runtimeUILayout = mod.exports.createRenpyUILayout();
project.editor_settings.runtimeUILayoutProfiles = { version: 1, activeType: "renpy",
  profiles: { agentvn: mod.exports.getDefaultUISkinLayout(), renpy: structuredClone(project.editor_settings.runtimeUILayout) } };
const input = path.join(out, "隔离作者工程.vnproj");
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
const second = structuredClone(project); second.project_id += "-B"; second.title = "另一工程草稿隔离 B " + attempt;
const secondInput = path.join(out, "另一工程.vnproj"); fs.writeFileSync(secondInput, JSON.stringify(second), { flag: "wx" });
const validHTML = '<span class="root"><span class="body"><slot name="content"></slot></span></span>';
const validCSS = ".root { background-color: #315b72; border-radius: 6px; } .body { color: #f6f8ff; }";
const invalidHTML = '<script>window.__qaDraftExecuted = true</script><slot name="content"></slot>';
const invalidCSS = "body { color: red; --qa-invalid-draft: 20261102; }";
const displays = [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr =>
  [false, true].map(reduced => ({ width, height: width * 9 / 16, dpr, reduced }))));
const topics = [
  ["layout-background", "我想给Ren'Py样式按钮容器设置背景图片，应该在哪里操作？"],
  ["layout-code", "进阶HTML和CSS如何编辑，关闭勾选后代码是否保留？"],
  ["gui-pack", "GUI资源包如何入库，再仅应用到一个控件？"],
  ["game-aspect", "玩家如何在游戏里调整16比10画面比例，重启后还会保留吗？"],
];
const questions = displays.flatMap((m, i) => topics.map(([topic, text], j) =>
  ({ topic, i, j, question: `HISTORY_${String.fromCharCode(65 + j)} ${text}（验收组${i + 1}）` })));
let host, page, provider, protectedCache = false;
const html = () => page.getByRole("textbox", { name: "当前控件 HTML", exact: true });
const css = () => page.getByRole("textbox", { name: "当前控件 CSS", exact: true });
const click = async locator => { await locator.scrollIntoViewIfNeeded(); await locator.click(); };
const savedProfiles = async () => (await host.api("/api/project/state")).project_metadata.settings.runtimeUILayoutProfiles;
const control = value => value.profiles.renpy.screens.find(s => s.screen_id === "title")
  .components.find(c => c.component_id === "title_start_button");
const saveButton = () => page.locator('[data-help-key="layout.save"]:visible');
async function stage(name, fn) {
  const item = { name, status: "RUNNING", startedAt: new Date().toISOString() };
  report.cases.push(item); save();
  try { item.detail = await fn(); item.status = "PASS"; console.log("PASS " + name); }
  catch (error) { item.status = "FAILED"; item.error = String(error.stack || error); throw error; }
  finally { item.finishedAt = new Date().toISOString(); save(); }
}
function cache(action) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", action,
    "-RunDirectory", out, "-AllowedRunRoot", qa, "-CodexCacheView"],
  { encoding: "utf8", windowsHide: true, timeout: 60000 });
  fs.writeFileSync(path.join(out, "cache-" + action + ".log"),
    (result.stdout || "") + (result.stderr || ""), { flag: "wx" });
  assert.equal(result.status, 0, `Cache ${action}: ${result.stdout} ${result.stderr}`);
}
async function enterLayout() {
  const close = page.getByRole("button", { name: "关闭发布与打包", exact: true });
  if (await close.isVisible()) await close.click();
  await click(page.locator('[data-workspace-surface="options"]:visible'));
  await click(page.locator('[data-help-key="advanced.tab.layout"]:visible'));
  await page.getByTestId("renpy-title-editor").waitFor(); await settleEditor(page);
  await click(page.locator('.renpy-region-list button[data-component-id="title_start_button"]'));
}
async function openProject(title = project.title) {
  await page.locator(".project-home").waitFor(); await settleEditor(page);
  await page.locator('[data-help-key="home.recentProject"]:not(:disabled):visible')
    .filter({ has: page.getByText(title, { exact: true }) }).click();
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page); await enterLayout();
}
async function importProject(file, title) {
  const response = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
    method: "POST", headers: { "content-type": "application/octet-stream",
      "X-AgentVN-Filename": encodeURIComponent(path.basename(file)) }, body: fs.readFileSync(file),
    signal: AbortSignal.timeout(30000) });
  assert(response.ok && (await response.json()).ok);
  await page.reload(); await openProject(title);
}
async function authorValid(value = validCSS) {
  const advanced = page.getByRole("checkbox", { name: "Ren’Py进阶代码编辑", exact: true });
  if (!await advanced.isChecked()) await advanced.check();
  const enable = page.getByRole("button", { name: "为当前控件启用代码覆盖", exact: true });
  if (await enable.isVisible()) await click(enable);
  await html().fill(validHTML); await css().fill(value);
}
async function persistLayout() {
  await click(saveButton());
  await page.locator('[data-help-key="layout.save"][data-save-state="saved"]').waitFor();
}
async function exportCartridge(label) {
  await click(page.locator('[data-workspace-surface="publish"]:visible')); await settleEditor(page);
  const dialog = page.getByTestId("package-environment-operation-dialog");
  await until(async () => {
    if (await dialog.isVisible()) return ["completed", "failed"].includes(await dialog.getAttribute("data-environment-phase"));
    const settings = page.locator('[data-package-stage="settings"]');
    if (await settings.isVisible() && await settings.getAttribute("aria-current") !== "page") {
      await settings.click(); return false;
    }
    return await page.locator('[data-help-key="package.mode"]').isVisible();
  }, "publishing ready", 90000);
  if (await dialog.isVisible()) {
    const phase = await dialog.getAttribute("data-environment-phase");
    (report.incidentalEnvironment ??= []).push({ phase, text: await dialog.innerText() });
    await dialog.getByRole("button", { name: phase === "completed" ? "完成" : "关闭", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
  }
  await page.locator('[data-package-stage="settings"]').click();
  await page.locator('[data-help-key="package.mode"]').click();
  await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
  await page.locator('[data-package-stage="checks"]').click();
  const consent = page.locator('[data-help-key="package.confirmWarnings"]');
  if (await consent.isVisible()) await consent.check();
  const directory = path.join(out, "export-" + label); fs.mkdirSync(directory);
  const file = await downloadUIArtifact({ cdp: host.cdp, trigger: page.locator('[data-help-key="package.export"]'),
    directory, report, save, until });
  const zip = await JSZip.loadAsync(fs.readFileSync(file.path), { checkCRC32: true });
  const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
  for (const entry of Object.values(zip.files).filter(f => !f.dir && /\.(json|css|html)$/.test(f.name))) {
    const text = await entry.async("string");
    assert(!text.includes("__qaDraftExecuted") && !text.includes("--qa-invalid-draft"), entry.name);
  }
  assert.equal(layout.screens.find(s => s.screen_id === "title")
    .components.find(c => c.component_id === "title_start_button").presentation.css, validCSS);
  report.cartridges.push({ ...file, label }); save(); await enterLayout(); return file;
}
(async () => {
  save(); cache("SelfTest"); protectedCache = true; cache("Prepare");
  provider = await controlledAssistantProvider();
  host = installedReleaseSession({ installationFile, out, report, save, input,
    controlledCreation: { endpoint: provider.url, projectIds: [project.project_id],
      inquiryQuestions: questions.map(q => q.question) } });
  page = await host.start();
  page.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/assistant/chat_stream") {
      const body = request.postDataJSON();
      report.requests.push({ question: body.question, chunks: body.context_chunks,
        context: body.editor_context, keys: Object.keys(body) }); save();
    }
  });
  await importProject(secondInput, second.title);
  await importProject(input, project.title);
  await host.rawApi("/api/project/state", {
    provider_connections: [{ connection_id: "qa-review", provider_type: "openai_compatible", display_name: "本机受控",
      base_url: provider.url, api_key_storage: "local", enabled: true }],
    provider_models: [{ provider_id: "qa-model", connection_id: "qa-review", model_id: "controlled-model",
      model_name: "controlled-model", enabled: true, capabilities: ["text_generation"],
      default_parameters: { context_budget_tokens: 16000, request_timeout_seconds: 60 } }],
    provider_selections: { text_generation: "qa-model" }, provider_secrets: { "qa-review": "test-only-secret" },
  });
  await page.reload(); await openProject();
  for (const [i, display] of displays.entries()) {
    await host.metrics(display);
    await stage(`installed-draft-${display.width}-${display.dpr}-${display.reduced}`, async () => {
      await authorValid(); await persistLayout();
      const baseline = await savedProfiles();
      assert.deepEqual(baseline.profiles.agentvn, project.editor_settings.runtimeUILayoutProfiles.profiles.agentvn);
      await html().fill(invalidHTML); await css().fill(invalidCSS);
      await page.getByRole("alert").filter({ hasText: "代码未应用" }).waitFor();
      assert(await saveButton().isDisabled()); assert.equal(await page.evaluate(() => window.__qaDraftExecuted), undefined);
      const exported = await exportCartridge("display-" + i);
      assert.equal(await html().inputValue(), invalidHTML); assert.equal(await css().inputValue(), invalidCSS);
      assert.deepEqual(await savedProfiles(), baseline);
      await css().scrollIntoViewIfNeeded(); await css().focus();
      const geometry = await css().evaluate(el => {
        const r = el.getBoundingClientRect();
        return { rect: r.toJSON(), focused: document.activeElement === el,
          hit: el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
          inert: Boolean(el.closest("[inert]")), overflow: document.documentElement.scrollWidth - innerWidth };
      });
      assert(geometry.focused && geometry.hit && !geometry.inert && geometry.overflow <= 1);
      assert(geometry.rect.left >= 0 && geometry.rect.right <= display.width + 1
        && geometry.rect.top >= 0 && geometry.rect.bottom <= display.height + 1);
      await host.shot("draft-" + i); return { display, geometry, exported, invalidDraftRetained: true };
    });
    await stage(`installed-knowledge-${display.width}-${display.dpr}-${display.reduced}`, async () => {
      const baseline = await savedProfiles(), results = [];
      for (const q of questions.filter(q => q.i === i)) {
        await click(page.locator('[data-workspace-surface="assistant"]:visible')); await settleEditor(page);
        const panel = page.locator(".workspace-task-panel.is-open .assistant-chat-panel");
        await panel.getByRole("button", { name: "问询模式", exact: true }).click();
        await panel.getByTestId("assistant-new-conversation").click();
        await panel.getByLabel("向大模型助手提问", { exact: true }).fill(q.question);
        const pending = page.waitForResponse(r => r.request().method() === "POST"
          && new URL(r.url()).pathname === "/api/assistant/chat_stream");
        await panel.getByRole("button", { name: "发送", exact: true }).click();
        const response = await pending; assert.equal(response.status(), 200);
        assert(!/^event: error$/m.test(await response.text()));
        await panel.locator(".assistant-message.is-assistant").getByText(
          `HISTORY_${String.fromCharCode(65 + q.j)} 这是安装版历史验收回答。`, { exact: true }).waitFor();
        await panel.getByText("对话已保存到本机", { exact: true }).waitFor();
        const request = report.requests.at(-1); assert.equal(request.question, q.question);
        assert(request.chunks[0]?.id.startsWith(`guide-${q.topic}-`)); assert(request.chunks.length < 12);
        assert(!request.chunks.some(c => /^(guide-novel-|help-animation\.|help-settings\.editorAppearance\.)/.test(c.id)));
        assert(!request.keys.some(key => /tool|authorized|draft/.test(key)));
        assert(!JSON.stringify(request).includes("PRIVATE_STORY_SENTINEL_DO_NOT_SEND"));
        assert(!JSON.stringify(request).includes("test-only-secret"));
        const context = JSON.parse(request.context.split("\n[Context budget report]\n")[0]);
        assert.equal(context.access, "read-only"); assert.equal(context.layoutType, "renpy");
        const jump = panel.locator(".assistant-message-citations").last()
          .getByRole("button", { name: "打开：游戏客户端", exact: true }).first();
        await jump.scrollIntoViewIfNeeded(); await jump.focus();
        assert(await jump.evaluate(b => {
          const r = b.getBoundingClientRect();
          return document.activeElement === b && b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
        }));
        await jump.click(); await page.getByTestId("renpy-title-editor").waitFor(); await settleEditor(page);
        await enterLayout();
        assert.equal(await css().inputValue(), invalidCSS); assert.deepEqual(await savedProfiles(), baseline);
        results.push({ topic: q.topic, ids: request.chunks.map(c => c.id), status: "PASS" });
      }
      return { display, topics: results, authorLayoutUnchanged: true };
    });
  }
  await host.metrics(displays[0]);
  await stage("installed-write-failure-preserves-draft-and-retry-survives-process-restart", async () => {
    const retryCSS = ".root { background-color: #463859; border-radius: 7px; }";
    await authorValid(retryCSS);
    const baseline = await savedProfiles(), url = `http://127.0.0.1:${host.current.ports[0]}/api/project/state`;
    let rejected = 0;
    await page.route(url, route => {
      if (route.request().method() !== "POST") return route.continue();
      rejected++; return route.fulfill({ status: 500, contentType: "application/json",
        body: JSON.stringify({ detail: "QA controlled persistence failure" }) });
    });
    try {
      await click(saveButton());
      await page.locator('[data-help-key="layout.save"][data-save-state="error"]').waitFor();
      assert(rejected > 0); assert.deepEqual(await savedProfiles(), baseline);
      await click(page.locator('[data-workspace-surface="edit"]:visible')); await settleEditor(page); await enterLayout();
      assert.equal(await css().inputValue(), retryCSS);
    } finally { await page.unroute(url); }
    await persistLayout(); assert.equal(control(await savedProfiles()).presentation.css, retryCSS);
    await host.stop("Actual Editor/backend persistence restart, not natural close");
    page = await host.start(); await openProject();
    assert.equal(await css().inputValue(), retryCSS);
    return { controlledFailures: rejected, persistedAfterActualRestart: true };
  });
  await stage("installed-A-B-A-recent-project-navigation-isolates-unsaved-drafts", async () => {
    await html().fill(invalidHTML); await css().fill(invalidCSS);
    const navigate = async title => {
      await page.getByRole("button", { name: "返回首页", exact: true }).click();
      await page.locator(".editor-toolbar").waitFor({ state: "hidden" });
      await settleEditor(page); await openProject(title);
    };
    await navigate(second.title);
    await authorValid();
    assert.notEqual(await css().inputValue(), invalidCSS);
    const otherCSS = "body { color: blue; --qa-other-project-draft: 1; }";
    await css().fill(otherCSS);
    await navigate(project.title);
    assert.equal(await html().inputValue(), invalidHTML); assert.equal(await css().inputValue(), invalidCSS);
    await navigate(second.title);
    assert.equal(await css().inputValue(), otherCSS);
    await navigate(project.title);
    assert.equal(await css().inputValue(), invalidCSS);
    assert.equal(await page.evaluate(() => window.__qaDraftExecuted), undefined);
    return { actualRecentProjectClicks: 4, nativePickerClaimed: false, separateDrafts: true };
  });
  assert.equal(report.cases.length, 26); assert(report.cases.every(c => c.status === "PASS"));
  assert.equal(report.requests.length, 48); assert.equal(provider.requests.length, 48);
  assert(provider.requests.every(r => !r.creation && r.tools.length === 0));
  assert.equal(report.blockedModelRequests, 0); assert.deepEqual(report.errors, []);
  report.status = "PASS";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page && !page.isClosed()) {
    report.failureText = (await page.locator("body").innerText().catch(String)).slice(-10000);
    await host.shot("failure").catch(() => {});
  }
}).finally(async () => {
  const cleanupErrors = [];
  const clean = async (name, action) => {
    try { await action(); }
    catch (error) { cleanupErrors.push({ name, error: String(error.stack || error) }); }
  };
  await clean("clear-test-provider", async () => {
    if (host?.current) await host.rawApi("/api/project/state", {
      provider_secrets: {}, provider_connections: [], provider_models: [], provider_selections: {},
    });
  });
  await clean("stop-owned-editor", () => host?.stop("Final attributed cleanup"));
  await clean("stop-controlled-provider", async () => {
    if (provider) report.providerCleanup = await provider.stop();
  });
  await clean("restore-original-cache", () => {
    if (protectedCache && fs.existsSync(path.join(out, "native-cache-protection.json"))) {
      cache("Restore");
      const restoration = path.join(out, "native-cache-restoration.json");
      assert.equal(JSON.parse(fs.readFileSync(restoration, "utf8").replace(/^\uFEFF/, "")).status, "PASS");
      report.cacheRestoration = desc(restoration);
    }
  });
  report.cleanup = cleanupErrors.length ? "FAILED" : "PASS";
  if (cleanupErrors.length) { report.cleanupErrors = cleanupErrors; report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, cases: report.cases.length,
    requests: report.requests.length, cleanup: report.cleanup, error: report.error, cleanupError: report.cleanupError }));
});
