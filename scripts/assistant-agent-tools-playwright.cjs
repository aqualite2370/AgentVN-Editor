"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { startOwnedCreationApi, startOwnedCreationSidecar } = require("./lib/owned-creation-api.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const root = path.resolve(__dirname, "..");
assert(process.env.AGENTVN_WORKSPACE_OUTPUT && process.env.AGENTVN_TEST_PROJECT, "Explicit isolated project/output required");
const output = path.join(process.env.AGENTVN_WORKSPACE_OUTPUT, "agent-tools", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(output, { recursive: true });
const report = { status: "RUNNING", cases: [], scope: "product workbench, real backend/SQLite/tool HTTP/local parser/Runtime; only external model controlled; not installed/live-model" };
report.targetPage = process.env.AGENTVN_CREATION_AGENT_PAGE || "title";
const diagnostic = process.env.AGENTVN_AGENT_TOOLS_DIAGNOSTIC === "1";
const existingArtwork = process.env.AGENTVN_AGENT_EXISTING_ARTWORK === "1";
const batchSize = Number(process.env.AGENTVN_CREATION_AGENT_BATCH_SIZE || "1");
assert([1, 2].includes(batchSize),
  "This fixture must return validation and preview receipts before generating its final proposal");
report.controlledModelBatchSize = batchSize;
if (diagnostic) report.scope += "; targeted 1080p diagnostic, not the complete release matrix";
let server, host, browser;
async function main() {
  const previous = process.env.AGENTVN_CREATION_AGENT_TEST;
  try {
    process.env.AGENTVN_CREATION_AGENT_TEST = "1";
    host = process.env.ASSISTANT_AGENT_PACKAGED_SIDECAR === "1"
      ? await startOwnedCreationSidecar(output, path.join(root, "editor/src-tauri/binaries/creator-backend.exe"))
      : await startOwnedCreationApi(output);
    if (process.env.ASSISTANT_AGENT_PACKAGED_SIDECAR === "1") {
      report.scope = "product browser workbench and newly packaged sidecar/SQLite/tool HTTP/local parser/Runtime; external model controlled; NOT installed Editor/live-model";
      report.sidecarSha256 = host.exeSha256;
    }
    let existingImageSource;
    if (existingArtwork) {
      assert.equal(report.targetPage, "game_menu");
      assert.equal(path.dirname(host.database), path.resolve(output), "Managed image fixture must belong to this API run");
      const imageRoot = path.join(output, "project_assets"); fs.mkdirSync(imageRoot, { recursive: true });
      const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l8sAAAAASUVORK5CYII=", "base64");
      fs.writeFileSync(path.join(imageRoot, "existing-managed.png"), bytes, { flag: "wx" });
      const served = await fetch(`${host.apiUrl}/api/project/assets/existing-managed.png`, { signal: AbortSignal.timeout(5000) });
      assert(served.ok); assert.deepEqual(Buffer.from(await served.arrayBuffer()), bytes, "Use actual owned asset FileResponse, not an API mock");
      existingImageSource = "http://127.0.0.1:8278/api/project/assets/existing-managed.png";
      report.existingArtwork = { source: existingImageSource, assetId: "existing-managed-image", effectiveApi: host.apiUrl,
        fixture: path.join(imageRoot, "existing-managed.png"), realFileResponse: true };
    }
    const testUrl = () => `${server.url}/assistant-creation-authorization-harness.html?controlledApi=${encodeURIComponent(host.apiUrl)}&controlledModel=${encodeURIComponent(host.modelUrl)}${existingImageSource ? `&existingImageSource=${encodeURIComponent(existingImageSource)}` : ""}`;
    server = await startOwnedViteServer({ root: path.join(root, "editor"), port: 0, logFile: path.join(output, "vite.log") });
    report.service = { apiUrl: host.apiUrl, pid: host.pid, vitePid: server.pid };
    browser = await chromium.launch();
    await server.run(async () => {
      for (const dpr of diagnostic ? [1] : [1, 2]) for (const motion of diagnostic ? ["no-preference"] : ["no-preference", "reduce"]) for (const [width, height] of diagnostic ? [[1920,1080]] : desktopViewports) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, reducedMotion: motion });
      const page = await context.newPage();
      if (existingArtwork) await page.route("http://127.0.0.1:8278/api/project/assets/**", route => route.abort());
      await page.addInitScript(() => {
        window.__agentToolFrames = [];
        const sample = () => {
          const panel = document.querySelector('[data-testid="assistant-agent-runtime-tool-preview"]');
          const frame = panel?.querySelector("iframe");
          const image = frame?.contentDocument?.querySelector('[data-testid="runtime-custom-component"] img');
          if (panel) {
            const rect = panel.getBoundingClientRect();
            window.__agentToolFrames.push({ time: performance.now(), image: Boolean(image?.complete && image?.naturalWidth > 0), missing: image?.dataset.assetMissing,
              opacity: Number(getComputedStyle(panel).opacity), left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
            if (window.__agentToolFrames.length > 2000) window.__agentToolFrames.shift();
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      const errors = []; page.on("pageerror", error => errors.push(String(error)));
      const url = testUrl();
      await page.goto(url);
      await page.getByTestId("authorization-harness-ready").filter({ hasText: "ready" }).waitFor();
      await page.getByRole("button", { name: "打开创造工作台" }).click();
      const workbench = page.getByTestId("assistant-creation-workbench-window");
      await workbench.getByRole("checkbox", { name: "授权工程素材 工程徽章", exact: true }).check();
      await workbench.getByLabel("向大模型助手提问", { exact: true }).fill("读取授权素材，构建徽章，实际校验并预览后提交。");
      let id;
      page.on("request", request => {
        if (request.method() === "POST" && request.url().endsWith("/api/assistant/creation/processes")) {
          const payload = request.postDataJSON(); id = payload.id;
          report.submission = { keys: Object.keys(payload.request), projectId: payload.project_id,
            agentTools: payload.request.agent_tools, assets: payload.request.authorized_assets };
        }
      });
      await workbench.getByRole("button", { name: "生成创作提案", exact: true }).click();
      await page.getByTestId("assistant-agent-runtime-tool-preview").waitFor({ timeout: 30000 });
      const previewGeometry = await page.getByTestId("assistant-agent-runtime-tool-preview").evaluate(element => {
        const rect = element.getBoundingClientRect();
        const window = element.closest('[data-testid="assistant-creation-workbench-window"]').getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
          windowLeft: window.left, windowRight: window.right, windowTop: window.top, windowBottom: window.bottom,
          documentWidth: document.documentElement.scrollWidth, inert: element.inert, pointerEvents: getComputedStyle(element).pointerEvents };
      });
      assert(previewGeometry.left >= previewGeometry.windowLeft && previewGeometry.right <= previewGeometry.windowRight
        && previewGeometry.top >= previewGeometry.windowTop && previewGeometry.bottom <= previewGeometry.windowBottom,
        `Agent preview must remain inside the same workbench: ${JSON.stringify(previewGeometry)}`);
      assert(previewGeometry.documentWidth <= width + 1 && previewGeometry.inert && previewGeometry.pointerEvents === "none");
      try {
        await page.waitForFunction(() => window.__agentToolFrames?.some(frame => frame.image && frame.missing !== "true"
          && frame.opacity > 0.01), null, { timeout: 15000 });
      } catch (error) {
        report.previewFrame = await page.getByTestId("assistant-agent-runtime-tool-preview").locator("iframe").evaluate(frame => ({
          url: frame.src, text: frame.contentDocument?.body?.innerText,
          html: frame.contentDocument?.querySelector("#root")?.innerHTML?.slice(0, 2000) })).catch(() => null);
        report.currentProcess = id ? await (await fetch(`${host.apiUrl}/api/assistant/creation/processes/${id}`)).json() : null;
        report.errors = errors;
        await page.screenshot({ path: path.join(output, "preview-failure.png") });
        throw error;
      }
      await workbench.getByTestId("assistant-creation-draft").getByRole("img", { name: "Agent徽章", exact: true }).waitFor({ timeout: 45000 });
      assert(id);
      const result = await (await fetch(`${host.apiUrl}/api/assistant/creation/processes/${id}`)).json();
      report.process = result;
      assert.equal(result.status, "completed");
      assert.deepEqual(result.toolEvents.filter(event => event.status === "completed").map(event => event.tool), [
        "read_assistant_context", "build_assistant_draft", "validate_assistant_draft", "preview_assistant_draft", "read_assistant_draft", "submit_assistant_component_draft"]);
      assert.equal(await page.getByTestId("assistant-agent-runtime-tool-preview").count(), 0, "Runtime tool view must clean up after completion");
      assert.equal(report.submission.agentTools, true);
      assert(!JSON.stringify(result).includes("test-only-secret"));
      const timeline = workbench.getByTestId("assistant-agent-tool-timeline").first();
      await timeline.locator("summary").click();
      assert((await timeline.innerText()).includes("preview_assistant_draft"));
      await workbench.screenshot({ path: path.join(output, `tool-timeline-${width}-${dpr}-${motion}.png`) });
      assert.deepEqual(errors, []);
      const renderedFrames = await page.evaluate(() => window.__agentToolFrames);
      assert(renderedFrames.some(frame => frame.opacity > 0.001 && frame.opacity < 0.999),
        "Both normal and reduced-motion tool previews must retain real transition frames");
      report.cases.push({ case: "actual-six-tool-loop-with-local-parser-and-Runtime", width, height, dpr, motion,
        processId: id, previewGeometry, renderedFrames, status: "PASS" });
      await context.close();
      }
    });
    assert.equal(report.cases.length, diagnostic ? 1 : 12);
    await server.run(async () => {
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      const page = await context.newPage();
      const url = testUrl();
      if (existingArtwork) await page.route("http://127.0.0.1:8278/api/project/assets/**", route => route.abort());
      await page.goto(url);
      await page.getByTestId("authorization-harness-ready").filter({ hasText: "ready" }).waitFor();
      await page.getByRole("button", { name: "打开创造工作台" }).click();
      const workbench = page.getByTestId("assistant-creation-workbench-window");
      await workbench.getByRole("checkbox", { name: "授权工程素材 工程徽章", exact: true }).check();
      await workbench.getByLabel("向大模型助手提问", { exact: true }).fill("等待本机校验时重启编辑器页面，不能重发模型。");
      let interrupted;
      const blocked = new Promise(resolve => { interrupted = resolve; });
      await page.route("**/api/assistant/creation/processes/*/local-result", async route => {
        await route.abort(); interrupted();
      });
      let processId;
      page.on("request", request => { if (request.method() === "POST" && request.url().endsWith("/api/assistant/creation/processes")) processId = request.postDataJSON().id; });
      await workbench.getByRole("button", { name: "生成创作提案", exact: true }).click();
      await blocked;
      assert(processId);
      const waiting = await (await fetch(`${host.apiUrl}/api/assistant/creation/processes/${processId}`)).json();
      assert.equal(waiting.localToolRequest.action, "validate_assistant_draft");
      await page.unroute("**/api/assistant/creation/processes/*/local-result");
      await page.reload();
      await page.getByTestId("authorization-harness-ready").filter({ hasText: "ready" }).waitFor();
      await page.getByRole("button", { name: "打开创造工作台" }).click();
      await workbench.getByTestId("assistant-creation-draft").getByRole("img", { name: "Agent徽章", exact: true }).waitFor({ timeout: 30000 });
      const completed = await (await fetch(`${host.apiUrl}/api/assistant/creation/processes/${processId}`)).json();
      assert.equal(completed.status, "completed");
      assert.equal(completed.toolEvents.filter(event => event.tool === "read_assistant_context" && event.status === "started").length, 1);
      report.cases.push({ case: "reload-resumes-original-local-validation-and-preview-without-model-replay", processId, status: "PASS" });
      await context.close();
    });
    report.status = "PASS";
  } catch (error) { report.status = "FAILED"; report.error = error.stack || String(error); process.exitCode = 1; }
  finally {
    await browser?.close(); await server?.stop();
    if (host) {
      report.cleanup = await host.stop();
      if (report.status === "PASS") {
        try {
          const results = report.cleanup.localToolResults ?? [];
          assert(results.some(result => result.status === "validated" && result.ok));
          assert(results.some(result => result.status === "rendered" && result.ok && result.preview?.length), "Model must receive actual Runtime diagnostics");
          assert(results.filter(result => result.status === "rendered" && result.ok)
            .every(result => result.preview.some(page => page.screen === report.targetPage)), "Preview diagnostics must identify the authored scope");
          if (existingArtwork) assert(results.some(result => result.status === "rendered" && result.ok
            && result.preview.some(page => page.images === 2 && page.missing_images === 0)), "Existing and newly proposed images must both render without disclosing the existing asset");
          const workflows = diagnostic ? 2 : 13;
          const requestsPerWorkflow = Math.ceil(6 / batchSize);
          assert.equal(report.cleanup.modelRequestCount, workflows * requestsPerWorkflow);
          const expectedToolCounts = Array.from({ length: workflows },
            () => Array.from({ length: requestsPerWorkflow }, (_, index) => index * batchSize)).flat();
          assert.deepEqual(report.cleanup.requestToolCounts, expectedToolCounts,
            "Every batch must finish in sequence before the next request, without replay");
          assert.equal(report.cleanup.code, 0); assert.equal(report.cleanup.apiStopped, true);
        } catch (error) { report.status = "FAILED"; report.error = error.stack || String(error); process.exitCode = 1; }
      }
    }
    if (previous === undefined) delete process.env.AGENTVN_CREATION_AGENT_TEST; else process.env.AGENTVN_CREATION_AGENT_TEST = previous;
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, output, error: report.error,
      cleanup: report.cleanup && { code: report.cleanup.code, apiStopped: report.cleanup.apiStopped,
        modelRequestCount: report.cleanup.modelRequestCount } }));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
