"use strict";
// Real editor/store, backend, websocket and disk; only the external model is
// a loopback HTTP server. Seeded scans are explicitly controlled QA fixtures.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const http = require("node:http"), net = require("node:net"), crypto = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const { startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { jsonAfter } = require("./lib/controlled-novel-default-provider.cjs");
const output = process.env.AGENTVN_WORKSPACE_OUTPUT;
assert(output && process.env.AGENTVN_TEST_PROJECT);
const matrix = process.argv.includes("--single") ? [[1920, 1080, 1, false]]
  : process.argv.includes("--pair") ? [[1920,1080,1,false], [1920,1080,1,true]]
  : [[1920,1080],[2560,1440],[3840,2160]].flatMap(([w,h]) =>
    [1,2].flatMap(dpr => [false,true].map(reduced => [w,h,dpr,reduced])));
const report = { status: "RUNNING", scope: "SOURCE_REAL_BACKEND_CONTROLLED_HTTP_SEEDED_SCAN_CHECKPOINTS",
  realModelRequests: 0, requests: [], cases: [], cleanup: {} };
let env, browser, server, activeCase, failOnce, structureCalls;
const sockets = new Set();
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const save = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
async function closed(url) {
  const u = new URL(url);
  return new Promise(resolve => {
    const s = net.createConnection({ host: u.hostname, port: Number(u.port) });
    s.setTimeout(1000);
    s.once("connect", () => { s.destroy(); resolve(false); });
    s.once("error", e => { s.destroy(); resolve(e.code === "ECONNREFUSED"); });
    s.once("timeout", () => { s.destroy(); resolve(false); });
  });
}
async function state(page) {
  return page.evaluate(async () => {
    const n = (await import("/src/store/novelImportStore.ts")).useNovelImportStore.getState();
    const p = (await import("/src/store/projectStore.ts")).useProjectStore.getState();
    const e = (await import("/src/store/editorStore.ts")).useEditorStore.getState();
    return { projectId: p.projectId, session: n.session, errors: n.errors,
      isProcessing: n.isProcessing, progress: n.progress, stream: n.modelStream,
      projectPersistence: p.settings.novelPersistence,
      graph: { nodes: e.nodes, edges: e.edges } };
  });
}
async function stored(id) {
  const r = await fetch(`${env.backendUrl}/api/project/projects/${id}`);
  assert(r.ok); const v = await r.json(); assert(v.ok); return v.data;
}
async function sample(page, file, expected) {
  const read = () => page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
  const before = await read(); assert.deepEqual(before, expected);
  const png = await page.screenshot({ path: file });
  assert.deepEqual(await read(), before);
  assert.equal(png.readUInt32BE(16), before.width * before.dpr);
  assert.equal(png.readUInt32BE(20), before.height * before.dpr);
  return { file, before, sha256: sha(png) };
}
async function model() {
  server = http.createServer(async (req, res) => {
    try {
      assert.equal(req.url, "/v1/chat/completions");
      const buffers = []; for await (const b of req) buffers.push(b);
      const p = JSON.parse(Buffer.concat(buffers));
      assert.equal(p.stream, true); assert.equal(p.model, "deepseek-flash");
      const system = p.messages.find(m => m.role === "system").content;
      const user = p.messages.findLast(m => m.role === "user").content;
      const data = jsonAfter(user, "分块分析数据:");
      assert(data.analyses.length <= 4 && data.analyses.length > 0);
      const structure = system.includes("整理成章节结构");
      assert(structure || system.includes("合并人物和地点索引"), "Saved mainline and scans must not replay");
      const row = { case: activeCase, phase: structure ? "structure" : "index",
        ids: data.analyses.map(a => a.chunk_id), max_tokens: p.max_tokens };
      report.requests.push(row);
      assert(report.requests.length < 200, "Unexpected request loop");
      const fail = structure && ++structureCalls === 2 && failOnce;
      if (fail) failOnce = false;
      const result = structure
        ? { chapters: data.analyses.flatMap(a => a.chapter_candidates),
          timeline: ["先后顺序保持"], branch_or_foreshadowing: [], conflict_points: [], warnings: [] }
        : { characters: [], locations: ["测试地点"], warnings: [] };
      const text = fail ? '{"chapters":[' : JSON.stringify(result);
      row.truncated = fail;
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const send = (content, finish_reason) => res.write(`data: ${JSON.stringify({
        id: "qa-outline", object: "chat.completion.chunk", created: 1, model: p.model,
        choices: [{ index: 0, delta: content ? { content } : {}, finish_reason }],
      })}\n\n`);
      send(text, null); send(null, fail ? "length" : "stop");
      res.end("data: [DONE]\n\n");
    } catch (error) {
      report.modelError = String(error.stack || error);
      if (!res.headersSent) res.writeHead(500);
      res.end(JSON.stringify({ error: { message: String(error) } }));
    }
  });
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}/v1`;
}
(async () => {
  try {
    env = await startEditorAcceptance(output);
    fs.copyFileSync(__filename, path.join(output, "executed.cjs"), fs.constants.COPYFILE_EXCL);
    report.owner = { backendPid: env.backendPid, vitePid: env.server.pid, runId: env.server.runId,
      url: env.url, backendUrl: env.backendUrl };
    const url = await model(); report.modelUrl = url;
    const configuration = await fetch(`${env.backendUrl}/api/project/state`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider_connections: [{ connection_id: "outline-qa", display_name: "断点恢复离线测试",
          provider_type: "openai_compatible", base_url: url, api_key_storage: "local", enabled: true }],
        provider_models: [{ provider_id: "outline-qa-model", connection_id: "outline-qa",
          model_id: "deepseek-flash", model_name: "deepseek-flash", enabled: true,
          capabilities: ["text_generation"], default_parameters: { structured_mode: "json_object",
            max_tokens: 3000, context_budget_tokens: 24000 } }],
        provider_selections: { text_generation: "outline-qa-model" },
        provider_secrets: { "outline-qa": "synthetic-only-not-real" },
      }),
    });
    assert(configuration.ok && (await configuration.json()).ok);
    browser = await chromium.launch();
    for (const [width,height,dpr,reduced] of matrix) {
      const item = { width,height,dpr,reduced, status: "RUNNING", steps: [] };
      report.cases.push(item); activeCase = report.cases.length; structureCalls = 0; failOnce = true; save();
      // Each matrix cell is a different project. Re-importing the same project
      // while its previous page's autosave drains would test an unintended
      // multi-window overwrite race rather than independent recovery cells.
      const input = JSON.parse(fs.readFileSync(process.env.AGENTVN_TEST_PROJECT, "utf8"));
      input.project_id += `-case-${activeCase}`;
      input.title += ` ${activeCase}`;
      env.input = path.join(output, `fixture-${activeCase}.vnproj`);
      fs.writeFileSync(env.input, JSON.stringify(input), { flag: "wx" });
      const context = await browser.newContext({ viewport: { width,height }, deviceScaleFactor: dpr,
        reducedMotion: reduced ? "reduce" : "no-preference" });
      const page = await context.newPage(); page.setDefaultTimeout(20000);
      page.on("pageerror", e => (item.pageErrors ??= []).push(String(e)));
      page.on("console", m => { if (m.type() === "error") (item.consoleErrors ??= []).push(m.text().slice(0, 1500)); });
      page.on("requestfailed", r => (item.requestFailures ??= []).push({ url: r.url(), error: r.failure() }));
      page.on("request", r => {
        if (!["POST", "PUT"].includes(r.method()) || !r.url().includes("/api/project/")) return;
        if (!(r.headers()["content-type"] ?? "").includes("application/json")) return;
        const p = r.postDataJSON(), m = p?.project_metadata;
        if (!m) {
          (item.otherWrites ??= []).push({ at: Date.now(), url: r.url(), keys: Object.keys(p ?? {}),
            projectId: p?.project_id, batches: p?.editor_settings?.novelPersistence?.sessionSnapshot?.outline_partials?.batches?.length });
          return;
        }
        (item.metadataWrites ??= []).push({ at: Date.now(), projectId: m.projectId,
          keys: Object.keys(m.settings ?? {}), batches: m.settings?.novelPersistence
            ?.sessionSnapshot?.outline_partials?.batches?.length });
      });
      await page.route("**/*", route => ["127.0.0.1","localhost"].includes(new URL(route.request().url()).hostname)
        ? route.continue() : route.abort());
      try {
        await env.server.run(async () => {
          await page.goto(env.url, { waitUntil: "domcontentloaded", timeout: 60000 });
          await page.waitForFunction(() => [...document.querySelectorAll(".project-import-button input")]
            .some(input => input instanceof HTMLInputElement && !input.disabled),
          undefined, { timeout: 60000 });
          await page.locator(".project-import-button input").first().setInputFiles(env.input);
          await page.locator(".editor-toolbar").waitFor({ timeout: 60000 });
          await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"));
          await settleEditor(page);
          await page.locator('[data-help-key="toolbar.novelImport"]').click();
          const panel = page.getByTestId("novel-import-workbench"); await panel.waitFor();
          await panel.locator('[data-help-key="novel.importFile"] input').setInputFiles({
            name: `断点恢复-${activeCase}.txt`, mimeType: "text/plain", buffer: Buffer.from("甲".repeat(1300)) });
          await panel.locator('[data-help-key="novel.continueDirect"]').click();
          // Seed completed scans as an explicit controlled fixture, not claims of
          // real model scanning. All subsequent outline traffic uses the real API.
          await page.evaluate(async () => {
            const store = (await import("/src/store/novelImportStore.ts")).useNovelImportStore;
            const n = store.getState(), doc = n.session.document;
            const chunks = Array.from({ length: 13 }, (_, i) => ({ chunk_id: `scan_${i}`,
              document_id: doc.document_id, index: i, start_offset: i*100, end_offset: (i+1)*100,
              text: doc.normalized_text.slice(i*100,(i+1)*100), estimated_tokens: 150 }));
            const analyses = chunks.map(c => ({ chunk_id: c.chunk_id, index: c.index, summary: `剧情${c.index}`,
              chapter_candidates: [{ chapter_id: `chapter_${c.index}`, index: c.index, title: `章节${c.index}`,
                start_offset: c.start_offset, end_offset: c.end_offset, summary: `剧情${c.index}`, confidence: 1 }],
              characters: [], locations: [], timeline: [], foreshadowing: [], warnings: [], confidence: 1 }));
            store.setState({ session: { ...n.session, chunks, ai_chunk_analyses: analyses, outline_partials: {
              mainline: { document_id: doc.document_id, title: doc.title, summary: "完整主线摘要",
                main_plot: "从开始到结尾", needs_review: false, coverage_confidence: 1, warnings: [] } } } });
          });
          const before = await state(page);
          await panel.locator('[data-help-key="novel.aiStart"]').click();
          await page.waitForFunction(() => {
            const n = window.__AGENTVN_NOVEL_IMPORT_STORE__.getState();
            return !n.isProcessing && n.errors.length > 0;
          });
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const failed = await state(page);
          assert.equal(failed.session.ai_chunk_analyses.length, 13);
          assert.equal(failed.session.outline_partials.batches.length, 1);
          assert.equal(failed.stream.requestId, undefined);
          assert.match(failed.stream.status, /暂停/);
          assert.match(failed.errors.join(" "), /输出超限/);
          assert.deepEqual(failed.graph, before.graph);
          assert.equal(failed.progress, undefined);
          assert.equal(await panel.locator(".novel-operation-heartbeat").count(), 0);
          assert.match(await panel.locator(".novel-model-stream-panel").innerText(), /暂停/);
          assert(!/流式输出中/.test(await panel.locator(".novel-model-stream-panel").innerText()));
          assert.match(await panel.innerText(), /模型输出达到上限/);
          assert(await panel.locator('[data-help-key="novel.aiStart"]').isEnabled());
          const failedBatch = failed.session.outline_partials.batches[0].key;
          const failedRequestCount = report.requests.length;
          // Ensure no delayed or retry request follows a terminal error.
          await page.waitForTimeout(450);
          assert.equal(report.requests.length, failedRequestCount);
          await page.waitForFunction(async ({ backend, id, key }) => {
            const r = await fetch(`${backend}/api/project/projects/${id}`), v = await r.json();
            return v.data?.editor_settings?.novelPersistence?.sessionSnapshot?.outline_partials
              ?.batches?.some(b => b.key === key);
          }, { backend: env.backendUrl, id: failed.projectId, key: failedBatch });
          const disk = await stored(failed.projectId);
          item.localPersistenceCount = (await state(page)).projectPersistence?.sessionSnapshot?.outline_partials?.batches?.length;
          item.diskRead = { projectId: failed.projectId, keys: Object.keys(disk.editor_settings ?? {}),
            batches: disk.editor_settings?.novelPersistence?.sessionSnapshot?.outline_partials?.batches?.length };
          save();
          assert.equal(disk.editor_settings.novelPersistence.sessionSnapshot.ai_chunk_analyses.length, 13);
          await page.locator('[data-help-key="toolbar.novelImport.closeWorkbench"]').click();
          const mini = page.getByTestId("novel-task-mini-entry"); await mini.waitFor();
          assert.match(await mini.innerText(), /部分失败/);
          assert(!/处理中|重试中/.test(await mini.innerText()));
          item.steps.push("real-http-truncation-terminal-no-replay-checkpoint-on-disk-graph-unchanged");
          item.failed = { errors: failed.errors, streamStatus: failed.stream.status, failedBatch,
            completedScans: 13, checkpointCount: 1 };
          item.screenshot = await sample(page, path.join(output, `failure-${width}-${dpr}-${reduced}.png`),
            { width,height,dpr,reduced });
          await page.reload(); await page.locator(".project-home").waitFor();
          await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: disk.title }).click();
          await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
          await page.locator('[data-help-key="toolbar.novelImport"]').click(); await panel.waitFor();
          const reopened = await state(page);
          item.reopened = { stage: reopened.session.ai_stage, status: reopened.session.status }; save();
          assert.deepEqual(reopened.session.outline_partials, failed.session.outline_partials);
          assert.equal(reopened.session.ai_chunk_analyses.length, 13);
          assert.equal(report.requests.length, failedRequestCount);
          await panel.locator('[data-help-key="novel.aiStart"]').click();
          await page.waitForFunction(() => {
            const n = window.__AGENTVN_NOVEL_IMPORT_STORE__.getState();
            return !n.isProcessing && n.session.ai_stage === "outline";
          }, undefined, { timeout: 30000 });
          const done = await state(page);
          assert.deepEqual(done.graph, before.graph);
          assert.equal(done.errors.length, 0);
          assert.equal(done.session.ai_outline.chapters.length, 13);
          assert.deepEqual(done.session.ai_outline.chapters.map(c => c.chapter_id),
            Array.from({ length: 13 }, (_, i) => `chapter_${i}`));
          assert.deepEqual(done.session.ai_chunk_analyses, failed.session.ai_chunk_analyses);
          const requests = report.requests.filter(r => r.case === activeCase);
          assert.equal(requests.filter(r => r.phase === "structure" && r.ids.includes("scan_0")).length, 1);
          assert.equal(requests.filter(r => r.truncated).length, 1);
          assert.equal(requests.length, 9); // 4 structure + 1 failed + 4 index.
          assert.equal(done.session.outline_partials.batches.length, 8);
          item.requests = requests.length;
          item.steps.push("reload-manual-resume-eight-checkpoints-no-success-replay-all-thirteen-chapters");
          assert(!item.pageErrors?.length, item.pageErrors?.join("\n"));
          assert(!report.modelError, report.modelError);
          item.status = "PASS"; save();
        });
      } catch (error) {
        item.status = "FAILED";
        item.lastState = await state(page).then(s => ({ stage: s.session.ai_stage,
          status: s.session.status, busy: s.isProcessing })).catch(String);
        item.lastPanel = await page.getByTestId("novel-import-workbench").innerText().catch(String);
        await page.screenshot({ path: path.join(output, `error-${activeCase}.png`) }).catch(() => {});
        throw error;
      } finally { await context.close(); }
    }
    assert.equal(report.cases.length, matrix.length);
    assert(report.cases.every(c => c.status === "PASS" && c.steps.length === 2));
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
    console.error(report.error);
  } finally {
    try {
      await browser?.close(); await env?.stop();
      if (server) { for (const s of sockets) s.destroy(); await new Promise(resolve => server.close(resolve)); }
      if (env) {
        report.cleanup.frontendPortClosed = await closed(env.url);
        report.cleanup.backendPortClosed = await closed(env.backendUrl);
        report.cleanup.modelPortClosed = report.modelUrl ? await closed(report.modelUrl) : true;
        assert(Object.values(report.cleanup).every(Boolean));
      }
    } catch (error) { report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length,
      requests: report.requests.length, realModelRequests: 0, output }));
  }
})();
