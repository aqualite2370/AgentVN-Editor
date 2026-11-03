"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const { buildSync } = require("../editor/node_modules/esbuild");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const root = path.resolve(__dirname, ".."), attempt = process.argv[2];
assert.match(attempt, /^(red|green|matrix)-\d{2}$/);
const out = process.env.AGENTVN_KNOWLEDGE_OUTPUT
  || `F:/AgentVN/QA/Renpy-Redesign-20261021-01/knowledge-ui-${attempt}`;
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const mod = { exports: {} };
new Function("module", "exports", buildSync({ stdin: { resolveDir: root, loader: "ts",
  contents: 'export {createRenpyUILayout} from "./shared/cartridge/uiLayoutProfiles"; export {getDefaultUISkinLayout} from "./shared/cartridge/uiSkin";' },
  bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text)(mod, mod.exports);
const project = fixture(`knowledge-${attempt}`);
project.nodes[1].data.scene.summary = "PRIVATE_STORY_SENTINEL_DO_NOT_SEND";
project.editor_settings.runtimeUILayout = mod.exports.createRenpyUILayout();
project.editor_settings.runtimeUILayoutProfiles = { version: 1, activeType: "renpy",
  profiles: { agentvn: mod.exports.getDefaultUISkinLayout(), renpy: project.editor_settings.runtimeUILayout } };
const input = path.join(out, "知识回归隔离工程.vnproj");
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
process.env.AGENTVN_TEST_PROJECT = input;
process.env.AGENTVN_WORKSPACE_OUTPUT = path.join(out, "services");
const report = { status: "RUNNING", scope: "SOURCE_REAL_BROWSER_CONTROLLED_MODEL_RESPONSES",
  modelRequests: 0, controlledRequests: 0, cases: [] };
function sourceHash() {
  const hash = createHash("sha256");
  for (const folder of ["editor/src", "shared", "backend/app"])
    for (const name of fs.readdirSync(path.join(root, folder), { recursive: true }).sort())
      if (/\.(ts|tsx|css|py)$/.test(name))
        hash.update(folder + "/" + name).update(fs.readFileSync(path.join(root, folder, name)));
  return hash.digest("hex");
}
let env, browser, currentPage;
const persist = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
function rememberServices() {
  if (!report.serviceOwners) return;
  const live = rows();
  for (const owner of report.serviceOwners) for (const process of ownedProcessTree(live, owner.ProcessId, owner.Created))
    if (!report.knownServices.some(p => p.ProcessId === process.ProcessId && p.Created === process.Created))
      report.knownServices.push(process);
  persist();
}
(async () => {
  report.sourceSHA256 = sourceHash();
  env = await startEditorAcceptance(process.env.AGENTVN_WORKSPACE_OUTPUT, { isolateBackendWorkingDirectory: true });
  report.services = { frontend: env.url, backend: env.backendUrl, pid: env.server.pid, backendPid: env.backendPid };
  const live = rows();
  report.serviceOwners = [env.server.pid, env.backendPid].map(pid => {
    const owner = live.find(process => process.ProcessId === pid);
    assert(owner, "This run's service process must still exist");
    return owner;
  });
  report.knownServices = []; rememberServices();
  report.ports = [Number(new URL(env.url).port), Number(new URL(env.backendUrl).port)];
  report.serviceListeners = listeners(report.ports);
  assert(report.ports.every(port => report.serviceListeners.some(l => l.LocalPort === port)));
  assert(report.serviceListeners.every(l => report.knownServices.some(p => p.ProcessId === l.OwningProcess)),
    "Never attach knowledge acceptance to another session's service");
  browser = await chromium.launch({ args: ["--use-angle=d3d11"] });
  const matrix = process.argv.includes("--matrix")
    ? [[1920, 1080], [2560, 1440], [3840, 2160]].flatMap(([width, height]) =>
      [1, 2].flatMap(dpr => [false, true].map(reduced => ({ width, height, dpr, reduced }))))
    : [{ width: 1920, height: 1080, dpr: 1, reduced: false }];
  for (const m of matrix) {
    const context = await browser.newContext({ viewport: { width: m.width, height: m.height },
      deviceScaleFactor: m.dpr, reducedMotion: m.reduced ? "reduce" : "no-preference" });
    const page = currentPage = await context.newPage();
    page.setDefaultTimeout(20000);
    const received = [], errors = [];
    page.on("pageerror", error => errors.push(String(error)));
    await page.route("**/api/assistant/chat_stream", async route => {
      const request = route.request().postDataJSON();
      // Never write provider selections/keys into evidence.
      received.push({ question: request.question, context: request.editor_context,
        chunks: request.context_chunks, keys: Object.keys(request).sort() });
      report.controlledRequests++;
      const answer = "受控知识检索回归回答，不是真实模型输出。";
      const citations = request.context_chunks.slice(0, 4).map(({ id, source, title }) => ({ id, source, title }));
      await route.fulfill({ contentType: "text/event-stream", body:
        `event: delta\ndata: ${JSON.stringify(answer)}\n\nevent: final\ndata: ${JSON.stringify({ answer, citations })}\n\n` });
    });
    await env.server.run(async () => {
      await env.open(page); await settleEditor(page);
      await page.evaluate(async () => {
        const { hydrateProviderState } = await import("/src/providers/providerRegistry.ts");
        const { hydrateApiKeys } = await import("/src/providers/apiKeyStorage.ts");
        const now = new Date().toISOString();
        hydrateProviderState({ provider_connections: [{ connection_id: "qa-knowledge", provider_type: "openai_compatible",
          display_name: "受控回归", base_url: "http://127.0.0.1:1/never-call", enabled: true,
          api_key_storage: "local", supports_model_discovery: false, created_at: now, updated_at: now }],
          provider_models: [{ provider_id: "qa-model", connection_id: "qa-knowledge", model_id: "controlled",
            model_name: "controlled", display_name: "受控回归", enabled: true, capabilities: ["text_generation"],
            default_parameters: { context_budget_tokens: 16000 }, created_at: now, updated_at: now }],
          provider_selections: { text_generation: "qa-model" } });
        hydrateApiKeys({ "qa-knowledge": "browser-test-only-key" });
      });
      await page.locator('[data-workspace-surface="options"]:visible').click();
      await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
      await page.getByTestId("renpy-title-editor").waitFor(); await settleEditor(page);
      await page.locator('.renpy-region-list button[data-component-id="title_start_button"]').click();
      const baseline = await page.evaluate(async () => {
        const p = (await import("/src/store/projectStore.ts")).useProjectStore.getState();
        return JSON.stringify({ settings: p.settings, assets: p.assetManifest });
      });
      const prompts = [
        ["layout-background", "我想给Ren'Py样式按钮容器设置背景图片，应该在哪里操作？"],
        ["layout-code", "进阶HTML和CSS如何编辑，关闭勾选后代码是否保留？"],
        ["gui-pack", "GUI资源包如何入库，再仅应用到一个控件？"],
        ["game-aspect", "玩家如何在游戏里调整16比10画面比例，重启后还会保留吗？"],
      ];
      for (const [topic, question] of prompts) {
        const selectedControl = await page.locator('.renpy-region-list button[aria-pressed="true"]')
          .getAttribute("data-component-id");
        assert(selectedControl, "Read the actual current selection before inquiry");
        await page.locator('[data-workspace-surface="assistant"]:visible').click();
        await page.getByLabel("向大模型助手提问", { exact: true }).fill(question);
        const expectedCount = received.length + 1;
        await page.locator('[data-help-key="assistant.send"]:visible').click();
        await page.waitForFunction(count => document.querySelectorAll(".assistant-message.is-assistant").length === count
          && !document.querySelector(".assistant-message.is-streaming"), expectedCount);
        const request = received.at(-1);
        assert(request?.chunks[0]?.id.startsWith(`guide-${topic}-`), "Primary source must answer the actual question");
        if (topic === "gui-pack") {
          const guide = request.chunks.filter(chunk => chunk.id.startsWith("guide-gui-pack-"))
            .map(chunk => chunk.text).join("");
          for (const name of ["资源包应用范围", "目标页面", "目标控件", "目标控件状态",
            "当前控件背景", "确认应用到当前工程"])
            assert(guide.includes(`“${name}”`), `Actual inquiry request must describe ${name}`);
          assert(guide.includes("应用对话框"));
        }
        assert(request.chunks.length < 12, "Do not pad the model context with weak unrelated matches");
        for (const prefix of ["guide-novel-", "help-animation.", "help-settings.editorAppearance."])
          assert(!request.chunks.some(chunk => chunk.id.startsWith(prefix)), `Unrelated citation: ${prefix}`);
        assert(!request.keys.some(key => /tool|authorized|draft/.test(key)), "Inquiry cannot gain creation tools");
        assert(!JSON.stringify(request).includes("PRIVATE_STORY_SENTINEL"));
        const [layoutContext, budgetContext] = request.context.split("\n[Context budget report]\n");
        const safe = JSON.parse(layoutContext);
        assert(budgetContext && JSON.parse(budgetContext), "Keep the real context budget report");
        assert.equal(safe.layoutType, "renpy"); assert.equal(safe.screenId, "title");
        assert.equal(safe.componentId, selectedControl);
        assert(!JSON.stringify(request.context).includes("browser-test-only-key"));
        const jump = page.locator(".assistant-message-citations").last().getByRole("button", { name: "打开：游戏客户端", exact: true }).first();
        await jump.waitFor();
        await jump.focus();
        assert(await jump.evaluate(button => document.activeElement === button), "Citation must be keyboard reachable");
        const hit = await jump.evaluate(button => {
          const r = button.getBoundingClientRect();
          return { box: r.toJSON(), hit: button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
            overflow: document.documentElement.scrollWidth - innerWidth };
        });
        assert(hit.hit && hit.overflow <= 1, "Citation destination must actually be clickable without overflow");
        await jump.click();
        await page.getByTestId("renpy-title-editor").waitFor(); await settleEditor(page);
        assert.equal(await page.locator('[data-workspace-surface="options"]').getAttribute("aria-current"), "page",
          "Citation opens the real options workspace and hands off navigation ownership");
        const unchanged = await page.evaluate(async () => {
          const p = (await import("/src/store/projectStore.ts")).useProjectStore.getState();
          return JSON.stringify({ settings: p.settings, assets: p.assetManifest });
        });
        assert.equal(unchanged, baseline, "Knowledge navigation is read-only");
        report.cases.push({ ...m, topic, status: "PASS", hit, chunks: request.chunks.map(c => c.id), context: safe });
        persist();
      }
      assert.deepEqual(errors, []);
      const actual = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
        dpr: devicePixelRatio, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
      assert.deepEqual(actual, m);
      const screenshot = await page.screenshot({ path: path.join(out, `${m.width}-${m.dpr}-${m.reduced}.png`) });
      assert.equal(screenshot.readUInt32BE(16), m.width * m.dpr);
      assert.equal(screenshot.readUInt32BE(20), m.height * m.dpr);
    });
    await context.close(); currentPage = undefined;
  }
  assert.equal(report.cases.length, matrix.length * 4);
  assert.equal(report.controlledRequests, matrix.length * 4);
  assert.equal(sourceHash(), report.sourceSHA256, "Source must remain fixed across the matrix");
  report.status = "PASS";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  await currentPage?.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
}).finally(async () => {
  const cleanupErrors = [];
  try { rememberServices(); } catch (error) { cleanupErrors.push(String(error.stack || error)); }
  try { await browser?.close(); } catch (error) { cleanupErrors.push(String(error.stack || error)); }
  try { await env?.stop(); } catch (error) { cleanupErrors.push(String(error.stack || error)); }
  try {
    const live = rows();
    report.survivingServices = (report.knownServices || [])
      .filter(p => live.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created));
    report.remainingListeners = report.ports?.length ? listeners(report.ports) : [];
    assert.equal(report.survivingServices.length, 0);
    assert.equal(report.remainingListeners.length, 0);
  } catch (error) {
    cleanupErrors.push(String(error.stack || error));
  }
  report.cleanup = cleanupErrors.length ? "FAILED" : "PASS";
  if (cleanupErrors.length) report.cleanupErrors = cleanupErrors;
  if (report.cleanup !== "PASS") { report.status = "FAILED"; process.exitCode = 1; }
  persist(); console.log(JSON.stringify({ status: report.status, cases: report.cases.length, error: report.error, out }));
});
