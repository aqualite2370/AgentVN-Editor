"use strict";
// Exercise the actual editor, WebSocket service, validation and graph. Only
// the external OpenAI-compatible HTTP responses are controlled; no paid calls.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const crypto = require("node:crypto"), net = require("node:net");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const { startEditorAcceptance, fixture } = require("./lib/editor-ui-acceptance.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { answer } = require("./lib/controlled-novel-default-provider.cjs");
const output = path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT || "");
const provenance = process.argv.includes("--provenance");
assert(process.env.AGENTVN_TEST_PROJECT && process.env.AGENTVN_WORKSPACE_OUTPUT);
const matrix = process.argv.includes("--single") ? [[1920, 1080, 1, false]]
  : desktopViewports.flatMap(([w, h]) => [1, 2].flatMap(dpr => [false, true].map(reduced => [w, h, dpr, reduced])));
assert(matrix.length === (process.argv.includes("--single") ? 1 : 12));
const report = { status: "RUNNING", scope: "SOURCE_BROWSER_REAL_BACKEND_CONTROLLED_EXTERNAL_MODEL",
  realModelRequests: 0, cases: [], requests: [], cleanup: {} };
const save = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const sources = ["backend/app/ai/provider.py", "backend/tests/test_provider_structured_modes.py",
  "editor/src/store/novelImportStore.ts", "editor/src/novel-import/types.ts",
  "editor/src/novel-import/persistence.ts", "editor/src/novel-import/novelProcessing.ts",
  "editor/src/novel-import/adaptationClient.ts",
  "editor/src/novel-import/novelProcessJobAdapter.ts", "editor/src/components/novel-import/NovelImportWizard.tsx",
  "scripts/novel-schema-failure-playwright.cjs", "scripts/novel-phase-facts-test.cjs"];
report.sources = sources.map(file => ({ path: path.resolve(__dirname, "..", file),
  sha256: sha(fs.readFileSync(path.resolve(__dirname, "..", file))) }));
let env, browser, model, failing = true, requestsThisCase = 0;
const sockets = new Set();
async function portClosed(url) {
  const parsed = new URL(url);
  return new Promise(resolve => {
    const socket = net.createConnection({ host: parsed.hostname, port: Number(parsed.port) });
    socket.setTimeout(1000);
    socket.once("connect", () => { socket.destroy(); resolve(false); });
    socket.once("error", error => { socket.destroy(); resolve(error.code === "ECONNREFUSED"); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
  });
}
async function state(page) {
  return page.evaluate(async () => {
    const { useNovelImportStore: novel } = await import("/src/store/novelImportStore.ts");
    const { useEditorStore: editor } = await import("/src/store/editorStore.ts");
    const n = novel.getState(), e = editor.getState();
    const { useProjectStore: project } = await import("/src/store/projectStore.ts");
    return { session: n.session, job: n.importJob, progress: n.progress, busy: n.isProcessing,
      errors: n.errors, nodes: e.nodes, edges: e.edges, persistence: n.persistence,
      projectId: project.getState().projectId };
  });
}
async function until(page, predicate) {
  await page.waitForFunction(expression => {
    const n = window.__AGENTVN_NOVEL_IMPORT_STORE__?.getState();
    if (!n) return false;
    return expression === "outline" ? n.session.ai_stage === "outline" && !n.isProcessing
      : expression === "paused" ? n.importJob?.status === "paused" && !n.isProcessing && n.errors.length > 0
        : n.session.ai_stage === "report" && !n.isProcessing;
  }, predicate, { timeout: 60000 });
}
async function shot(page, name, expected) {
  const sample = () => page.evaluate(() => ({ width: innerWidth, height: innerHeight,
    dpr: devicePixelRatio, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
  const before = await sample(), file = path.join(output, `${name}.png`);
  const png = await page.screenshot({ path: file });
  const after = await sample();
  assert.deepEqual(before, expected); assert.deepEqual(after, before);
  assert.equal(png.readUInt32BE(16), before.width * before.dpr);
  assert.equal(png.readUInt32BE(20), before.height * before.dpr);
  return { file, sha256: sha(png), before, after,
    png: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) } };
}
async function configure(url, mode = "default") {
  const alternate = mode === "alternate", modelId = alternate ? "unused-alternate" : "qa-default";
  const response = await fetch(`${env.backendUrl}/api/project/state`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      provider_connections: [{ connection_id: "qa-default", provider_type: "openai_compatible",
        display_name: "离线结构回归", base_url: url, api_key_storage: "local", enabled: true }],
      provider_models: [{ provider_id: "qa-default-model", connection_id: "qa-default",
        model_id: modelId, model_name: modelId, enabled: true, capabilities: ["text_generation"],
        default_parameters: { structured_mode: "json_object", request_timeout_seconds: 60 } }],
      provider_selections: mode === "none" ? {} : { text_generation: "qa-default-model" },
      provider_secrets: mode === "none" ? {} : { "qa-default": "synthetic-offline-key" },
    }),
  });
  assert(response.ok && (await response.json()).ok);
}
function sourceNames(persistence) {
  return Object.fromEntries(["jobs", "tasks", "chunkResults", "chapterResults"].map(key =>
    [key, Object.fromEntries(Object.entries(persistence[key]).map(([id, row]) => [id, row.modelName]))]));
}
async function stored(projectId) {
  const r = await fetch(`${env.backendUrl}/api/project/projects/${projectId}`, { signal: AbortSignal.timeout(5000) });
  const value = await r.json(); assert(r.ok && value.ok); return value.data;
}
async function verifyProvenance(page, item, url) {
  await page.waitForFunction(() => {
    const p = window.__AGENTVN_NOVEL_IMPORT_STORE__?.getState().persistence;
    return p && Object.values(p.jobs).some(j => j.status === "completed");
  });
  const original = await state(page), expected = sourceNames(original.persistence);
  for (const rows of Object.values(expected)) for (const name of Object.values(rows))
    assert.equal(name, "qa-default / qa-default");
  for (const row of original.session.ai_chunk_analyses) assert.equal(row.modelName, "qa-default / qa-default");
  for (const row of original.session.adapted_scenes) assert.equal(row.modelName, "qa-default / qa-default");
  const requestCount = report.requests.length;
  item.provenance = { expected, states: [], modelRequestsBefore: requestCount };
  const downloadReady = page.waitForEvent("download");
  await page.locator('[data-help-key="toolbar.saveProject"]:visible').click();
  const download = await downloadReady;
  const bundle = path.join(output, `saved-${item.width}-${item.dpr}-${item.reduced}.vnproj`);
  await download.saveAs(bundle);
  const zip = await JSZip.loadAsync(fs.readFileSync(bundle), { checkCRC32: true });
  const packed = JSON.parse(await zip.file("project.json").async("string"));
  assert.deepEqual(sourceNames(packed.editor_settings.novelPersistence), expected);
  assert.deepEqual(packed.nodes.map(n => n.id), original.nodes.map(n => n.id));
  assert.deepEqual(packed.edges, original.edges);
  item.provenance.bundle = { path: bundle, sha256: sha(fs.readFileSync(bundle)) };
  const confirmation = page.getByTestId("project-save-confirmation");
  await confirmation.waitFor();
  await confirmation.getByRole("button", { name: "OK", exact: true }).click();
  async function check(label) {
    const current = await state(page);
    assert.deepEqual(sourceNames(current.persistence), expected);
    assert.deepEqual(JSON.parse(JSON.stringify(current.session)), JSON.parse(JSON.stringify(original.session)),
      "Native JSON round trips omit undefined properties; every stored field, including modelName, remains exact");
    assert.deepEqual(current.edges, original.edges);
    assert.deepEqual(current.nodes.map(n => n.id), original.nodes.map(n => n.id));
    assert.equal(current.job.status, "completed");
    assert.equal(report.requests.length, requestCount, "Recovery must not request generation");
    await page.waitForFunction(async ({ backend, projectId, sources, nodeIds }) => {
      const r = await fetch(`${backend}/api/project/projects/${projectId}`), p = (await r.json()).data;
      const n = p?.editor_settings?.novelPersistence;
      if (!n) return false;
      return Object.entries(sources).every(([key, rows]) => Object.entries(rows)
        .every(([id, name]) => n[key]?.[id]?.modelName === name))
        && n.importJobSnapshot?.status === "completed"
        && JSON.stringify(p.nodes.map(n => n.id)) === JSON.stringify(nodeIds);
    }, { backend: env.backendUrl, projectId: current.projectId, sources: expected,
      nodeIds: original.nodes.map(n => n.id) }, { timeout: 15000 });
    const disk = await stored(current.projectId);
    assert.deepEqual(sourceNames(disk.editor_settings.novelPersistence), expected);
    item.provenance.states.push({ label, sources: sourceNames(disk.editor_settings.novelPersistence) });
  }
  await check("completed-and-persisted");
  for (const mode of ["none", "alternate"]) {
    await configure(url, mode);
    await page.reload();
    await page.locator(".project-home").waitFor();
    const project = await stored(original.projectId);
    await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: project.title }).click();
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
    const modelStatus = await page.evaluate(async () =>
      (await import("/src/store/novelImportStore.ts")).getNovelImportModelStatus());
    if (mode === "none") {
      assert.equal(modelStatus.configured, false);
      assert.equal(modelStatus.label, "未配置文本生成模型");
    } else {
      assert.equal(modelStatus.configured, true);
      assert.equal(modelStatus.label, "qa-default / unused-alternate");
    }
    (item.provenance.currentModels ??= []).push({ mode, status: modelStatus });
    await check(`reload-with-${mode}-provider`);
  }
  // A -> B -> A traverses the real project importer and home navigation.
  await page.locator('[data-help-key="toolbar.home"]').click(); await page.locator(".project-home").waitFor();
  await settleEditor(page);
  const other = fixture(`provenance-other-${item.width}-${item.dpr}-${item.reduced}`);
  other.title = "来源隔离 B";
  await page.locator(".project-import-button input").first().setInputFiles({
    name: "来源隔离B.vnproj", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(other)) });
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
  assert.equal((await state(page)).projectId, other.project_id);
  assert.equal((await state(page)).session.document, undefined);
  await page.locator('[data-help-key="toolbar.home"]').click(); await page.locator(".project-home").waitFor();
  await settleEditor(page);
  const project = await stored(original.projectId);
  await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: project.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
  await check("project-a-b-a-with-alternate-provider");
  item.provenance.modelRequestsAfter = report.requests.length;
  item.steps.push("execution-source-credential-clear-model-change-reload-a-b-a-disk-no-model-replay");
}
async function startModel() {
  model = http.createServer(async (req, res) => {
    let entry;
    try {
      assert.equal(req.method, "POST"); assert.equal(req.url, "/v1/chat/completions");
      assert(++requestsThisCase <= 24, "Unexpected request loop");
      const buffers = []; for await (const chunk of req) buffers.push(chunk);
      const payload = JSON.parse(Buffer.concat(buffers).toString("utf8"));
      assert.equal(payload.model, "qa-default");
      const system = payload.messages.find(m => m.role === "system").content;
      entry = { at: new Date().toISOString(), index: report.requests.length, fault: failing,
        stream: payload.stream === true, payloadSha256: sha(Buffer.concat(buffers)) };
      report.requests.push(entry);
      if (payload.response_format) {
        const marker = "Target JSON schema:\n", at = system.indexOf(marker);
        assert(at >= 0, "Every JSON request must disclose its complete schema");
        const schema = JSON.parse(system.slice(at + marker.length));
        entry.responseModel = schema.title; entry.schemaSha256 = sha(JSON.stringify(schema));
        if (schema.title === "SceneBeat")
          assert.deepEqual(new Set(schema.required), new Set(["scene_id", "title", "summary", "chapter"]));
      }
      let result;
      if (failing && system.includes("repairing a previous structured output")) {
        entry.stage = "invalid-repair";
        result = { scene_id: "qa_default_scene", title: "雨后窗边", chapter: "第一章 雨后窗边",
          summary: "雨后的窗边。", tags: [], commands: [{ type: "narration", text: "雨停了。" }] };
      } else {
        const response = answer({ ...payload, stream: true });
        entry.stage = response.stage; result = response.result;
        if (failing && response.stage === "scene-beat") {
          result = { summary: result.summary, commands: result.commands };
          entry.stage = "missing-required-scene-fields";
        }
      }
      const content = typeof result === "string" ? result : JSON.stringify(result);
      entry.responseSha256 = sha(content);
      if (!payload.stream) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: `qa-${entry.index}`, object: "chat.completion", created: 1,
          model: "qa-default", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] }));
      } else {
        res.writeHead(200, { "content-type": "text/event-stream" });
        for (let i = 0; i < content.length; i += 90) res.write(`data: ${JSON.stringify({
          id: `qa-${entry.index}`, object: "chat.completion.chunk", created: 1, model: "qa-default",
          choices: [{ index: 0, delta: { content: content.slice(i, i + 90) }, finish_reason: null }],
        })}\n\n`);
        res.end(`data: ${JSON.stringify({ id: `qa-${entry.index}`, object: "chat.completion.chunk", created: 1,
          model: "qa-default", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
      }
      entry.finishedAt = new Date().toISOString();
    } catch (error) {
      report.providerError = String(error.stack || error);
      if (entry) entry.error = report.providerError;
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: String(error) } }));
    }
  });
  model.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { model.once("error", reject); model.listen(0, "127.0.0.1", resolve); });
  return `http://127.0.0.1:${model.address().port}/v1`;
}
(async () => {
  try {
    env = await startEditorAcceptance(output);
    report.owner = { backendPid: env.backendPid, frontendPid: env.server.pid,
      backendUrl: env.backendUrl, frontendUrl: env.url };
    const modelUrl = await startModel();
    await configure(modelUrl);
    browser = await chromium.launch();
    for (const [width, height, dpr, reduced] of matrix) {
      failing = true; requestsThisCase = 0;
      const item = { width, height, dpr, reduced, status: "RUNNING", steps: [] };
      report.cases.push(item); save();
      const context = await browser.newContext({ viewport: { width, height },
        deviceScaleFactor: dpr, reducedMotion: reduced ? "reduce" : "no-preference" });
      let page;
      try {
        if (provenance) await configure(modelUrl);
        page = await context.newPage(); page.setDefaultTimeout(15000);
        page.on("pageerror", error => (item.pageErrors ??= []).push(String(error)));
        page.on("websocket", socket => socket.on("framesent", frame => {
          try {
            const message = JSON.parse(String(frame.payload));
            if (message.command === "start_novel_job" && message.operation === "build_outline") {
              item.outlineRequest = { analysisCount: message.payload.analyses.length,
                localMetadataLeaked: message.payload.analyses.some(a => Object.hasOwn(a, "modelName")) };
            }
          } catch { /* Non-JSON transport frames are not request payloads. */ }
        }));
        await page.route("**/*", route => {
          const host = new URL(route.request().url()).hostname;
          return ["127.0.0.1", "localhost", ""].includes(host) ? route.continue() : route.abort();
        });
        await env.server.run(async () => {
          await env.open(page); await settleEditor(page);
          const initial = await state(page);
          await page.locator('[data-help-key="toolbar.novelImport"]').click();
          const panel = page.getByTestId("novel-import-workbench"); await panel.waitFor();
          await panel.locator('[data-help-key="novel.importFile"] input').setInputFiles({
            name: "离线结构回归.txt", mimeType: "text/plain",
            buffer: Buffer.from("第一章 雨后窗边\n雨停了，窗外的树叶轻轻摇动。\n远处的灯光逐渐明亮，屋内的时钟缓缓走动。"),
          });
          await panel.locator('[data-help-key="novel.continueDirect"]').click();
          await panel.locator('[data-help-key="novel.aiStart"]').click(); await until(page, "outline");
          if (provenance) {
            assert(item.outlineRequest?.analysisCount > 0);
            assert.equal(item.outlineRequest.localMetadataLeaked, false);
          }
          item.steps.push("real-file-scan-outline");
          await panel.locator('[data-help-key="novel.confirmOutline"]').click(); await until(page, "paused");
          item.failed = await state(page);
          item.failedShot = await shot(page, `${width}-${height}-${dpr}-${reduced}-failed`, { width, height, dpr, reduced });
          assert.equal(item.failed.job.status, "paused", "Failure assertions require an actual paused task");
          assert.equal(item.failed.busy, false);
          assert(item.failed.errors.length > 0);
          assert.deepEqual(item.failed.nodes, initial.nodes);
          assert.deepEqual(item.failed.edges, initial.edges);
          assert.equal(item.failed.session.adapted_scenes.length, 0);
          assert.equal(item.failed.job.failedSceneIds.length, 1, "Record the actual failed scene");
          assert(Number.isFinite(item.failed.progress?.lastResponseMs), "Keep received error response timing after pause");
          const status = panel.locator(".novel-ai-status-panel");
          assert(!/等待首个响应/.test(await status.innerText()));
          assert.match(await status.innerText(), /失败\/重试[\s\S]*1\s*\/\s*0/);
          assert.equal(await panel.locator(".novel-operation-heartbeat").count(), 0,
            "A paused failure must not keep an active running heartbeat");
          await page.locator('[data-help-key="toolbar.novelImport.closeWorkbench"]').click();
          await panel.waitFor({ state: "detached" }); await settleEditor(page);
          const mini = page.getByTestId("novel-task-mini-entry"); await mini.waitFor();
          assert.equal(Number(await mini.getByRole("progressbar").getAttribute("aria-valuenow")), 0);
          assert.match(await mini.innerText(), /0\/1 · 0%/);
          item.steps.push("error-received-zero-generated-one-failure-graph-unchanged");
          // Same real session; the author explicitly continues once. This is
          // controlled regression, not authorization to retry a paid task.
          failing = false;
          await page.locator('[data-help-key="toolbar.novelImport"]').click(); await panel.waitFor();
          await panel.locator('[data-help-key="novel.resumeBlueprint"]').click();
          await until(page, "report");
          item.completed = await state(page);
          assert.equal(item.completed.job.status, "completed");
          assert.equal(item.completed.job.failedSceneIds.length, 0, "Successful retry clears only its resolved failure");
          assert.equal(item.completed.job.importLineId, item.failed.job.importLineId, "Resume must preserve import line identity");
          assert.equal(item.completed.job.retryCount, 1);
          assert.equal(item.completed.session.adapted_scenes.length, 1);
          const added = item.completed.nodes.filter(n => n.data.editorMeta?.importSessionId === item.completed.session.session_id);
          assert.equal(added.length, 1);
          for (const original of initial.nodes)
            assert.deepEqual(item.completed.nodes.find(n => n.id === original.id), original);
          for (const original of initial.edges)
            assert.deepEqual(item.completed.edges.find(e => e.id === original.id), original);
          await page.locator('[data-help-key="toolbar.novelImport.closeWorkbench"]').click();
          await panel.waitFor({ state: "detached" }); await settleEditor(page);
          assert.equal(Number(await mini.getByRole("progressbar").getAttribute("aria-valuenow")), 100);
          item.steps.push("author-resume-valid-write-no-duplicate-preserves-original-ids");
          item.geometry = await mini.evaluate(element => {
            const r = element.getBoundingClientRect(), button = element.querySelector(".novel-task-card-open");
            const b = button.getBoundingClientRect();
            return { left: r.left, top: r.top, right: r.right, bottom: r.bottom,
              hit: button.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)),
              scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth };
          });
          assert(item.geometry.left >= 0 && item.geometry.top >= 0 && item.geometry.right <= width
            && item.geometry.bottom <= height && item.geometry.hit);
          assert(item.geometry.scrollWidth <= width);
          item.completedShot = await shot(page, `${width}-${height}-${dpr}-${reduced}-completed`, { width, height, dpr, reduced });
          if (provenance) await verifyProvenance(page, item, modelUrl);
          assert(!report.providerError, report.providerError);
          item.requests = requestsThisCase; item.status = "PASS"; save();
        });
      } catch (error) {
        item.status = "FAILED"; item.error = String(error.stack || error);
        if (page) {
          item.failureUi = await page.locator("body").innerText().catch(String);
          item.failureState = await state(page).catch(error => ({ error: String(error) }));
        }
        throw error;
      } finally { await context.close(); }
    }
    assert.equal(report.cases.length, matrix.length);
    assert(report.cases.every(item => item.status === "PASS" && item.steps.length === (provenance ? 4 : 3)));
    for (const file of report.sources) assert.equal(sha(fs.readFileSync(file.path)), file.sha256);
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error);
    console.error(report.error); process.exitCode = 1;
  } finally {
    const cleanup = async (name, action) => {
      try { await action(); } catch (error) {
        report.cleanup[name] = String(error.stack || error); report.status = "FAILED"; process.exitCode = 1;
      }
    };
    await cleanup("browserError", async () => { await browser?.close(); });
    await cleanup("credentialError", async () => {
      if (!env) return;
      const response = await fetch(`${env.backendUrl}/api/project/state`, { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ provider_secrets: {} }),
        signal: AbortSignal.timeout(5000) });
      const payload = await response.json();
      assert(response.ok && payload.ok);
      report.cleanup.credentials = true;
    });
    await cleanup("serviceError", async () => {
      if (!env) return;
      await env.stop();
      assert(await portClosed(env.backendUrl)); assert(await portClosed(env.url));
      report.cleanup.servicesStopped = true;
    });
    await cleanup("modelError", async () => {
      if (!model) return;
      const url = `http://127.0.0.1:${model.address().port}`;
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => model.close(resolve)); assert(await portClosed(url));
      report.cleanup.modelStopped = true;
    });
    report.finishedAt = new Date().toISOString(); save();
    console.log(`Evidence: ${path.join(output, "report.json")}`);
  }
})();
