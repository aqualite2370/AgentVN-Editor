"use strict";
// Actual NSIS + packaged backend, standard QA profile. Only model responses and
// precompleted scans are controlled; no calls to the user's configured provider.
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const { defaultEditorSession } = require("./lib/qa-default-editor-session.cjs");
const { until } = require("./lib/current-native-editor-session.cjs");
const freePort = () => new Promise((resolve, reject) => {
  const s = require("node:net").createServer(); s.once("error", reject);
  s.listen(0, "127.0.0.1", () => { const port = s.address().port; s.close(e => e ? reject(e) : resolve(port)); });
});
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { jsonAfter } = require("./lib/controlled-novel-default-provider.cjs");
const base = path.resolve(process.argv[2]);
assert(["41", "42"].some(n => base === `F:\\AgentVN\\QA\\Windows-Isolated-1944-20261107-${n}`)
  || base === "F:\\AgentVN\\QA\\Windows-Isolated-1944-20261108-01");
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const rangeCase = base === "F:\\AgentVN\\QA\\Windows-Isolated-1944-20261108-01";
const owner = read(path.join(base, "account-controller.json"));
assert.equal(require("node:os").userInfo().username, owner.account.name);
const out = path.join(base, "recovery-01"); fs.mkdirSync(out);
const report = { status: "RUNNING", version: rangeCase ? "1.9.54" : "1.9.53",
  scope: "INSTALLED_STANDARD_QA_EXPLICIT_BACKEND_PORT_CONTROLLED_MODEL", rangeCase, rangeTraces: [],
  launches: [], cleanups: [], errors: [], screenshots: [], requests: [], stages: [], realModelRequests: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let session, server, failOnce = true, structureCalls = 0;
const sockets = new Set();
async function stage(name, fn) {
  const row = { name, status: "RUNNING" }; report.stages.push(row); save();
  try { row.detail = await fn(); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  finally { save(); }
}
async function api(route, value, type = "application/json") {
  const r = await fetch(`http://127.0.0.1:${report.backendPort}${route}`,
    value === undefined ? {} : { method: "POST", headers: { "content-type": type },
      body: type === "application/json" ? JSON.stringify(value) : value });
  assert(r.ok); const v = await r.json(); assert(v.ok); return v.data;
}
(async () => {
  try {
    await stage("actual-NSIS-and-payload", async () => {
      const op = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
        path.join(__dirname, "animation-install-1945.ps1"), "-SessionRoot", base],
      { encoding: "utf8", windowsHide: true, timeout: 240000 });
      report.install = { exitCode: op.status, stdout: op.stdout, stderr: op.stderr };
      assert.ifError(op.error); assert.equal(op.status, 0, op.stderr);
      const i = read(path.join(base, "installation.json")); assert.equal(i.status, "PASS");
      return i.executable;
    });
    server = http.createServer(async (req, res) => {
      try {
        assert.equal(req.url, "/v1/chat/completions");
        const chunks = []; for await (const b of req) chunks.push(b);
        const p = JSON.parse(Buffer.concat(chunks)), system = p.messages.find(m => m.role === "system").content;
        const user = p.messages.findLast(m => m.role === "user").content;
        const data = jsonAfter(user, "分块分析数据:");
        assert(data.analyses.length > 0 && data.analyses.length <= 4);
        const structure = system.includes("整理成章节结构");
        assert(structure || system.includes("合并人物和地点索引"), "No rescan/mainline replay");
        const fail = structure && ++structureCalls === 2 && failOnce;
        if (fail) failOnce = false;
        report.requests.push({ phase: structure ? "structure" : "index", truncated: fail,
          ids: data.analyses.map(a => a.chunk_id) }); assert(report.requests.length <= 9);
        if (rangeCase && structure) {
          assert(user.includes("chapters 必须逐项对应") && user.includes("本批必须完整覆盖以下区间"));
        }
        const result = structure ? { chapters: data.analyses.flatMap(a => a.chapter_candidates)
          .filter(c => !rangeCase || c.end_offset > c.start_offset),
          timeline: [], branch_or_foreshadowing: [], conflict_points: [], warnings: [] }
          : { characters: [], locations: [], warnings: [] };
        res.writeHead(200, { "content-type": "text/event-stream" });
        for (const [delta, reason] of [[{ content: fail ? '{"chapters":[' : JSON.stringify(result) }, null],
          [{}, fail ? "length" : "stop"]])
          res.write(`data: ${JSON.stringify({ id: "qa-installed", model: p.model,
            choices: [{ index: 0, delta, finish_reason: reason }] })}\n\n`);
        res.end("data: [DONE]\n\n"); save();
      } catch (e) { report.modelError = String(e.stack || e); save(); res.statusCode = 500; res.end(); }
    });
    server.on("connection", s => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    report.modelPort = server.address().port; report.backendPort = await freePort();
    const installation = read(path.join(base, "installation.json"));
    function newSession(label) {
      return defaultEditorSession({ installation, out, report, save, label,
        expectedQaUser: owner.account.name, isolatedBackendPort: report.backendPort });
    }
    function observeRanges(page) {
      page.on("websocket", s => s.on("framereceived", e => {
        const data = JSON.parse(String(e.payload));
        if (data.type === "tool_event" && data.payload.phase === "outline_ranges") {
          report.rangeTraces.push(data.payload.details); save();
        }
      }));
    }
    session = newSession("failure");
    let page = await session.start();
    observeRanges(page);
    // The shared helper normally blocks paid task submission; this run instead
    // permits only the locally configured synthetic provider via the packaged API.
    await page.context().unrouteAll({ behavior: "wait" });
    await api("/api/project/state", {
      provider_connections: [{ connection_id: "outline-qa", display_name: "安装版受控模型",
        provider_type: "openai_compatible", base_url: `http://127.0.0.1:${report.modelPort}/v1`,
        api_key_storage: "local", enabled: true }],
      provider_models: [{ provider_id: "outline-qa-model", connection_id: "outline-qa",
        model_id: "deepseek-flash", model_name: "deepseek-flash", enabled: true,
        capabilities: ["text_generation"], default_parameters: { structured_mode: "json_object",
          max_tokens: 3000, context_budget_tokens: 24000 } }],
      provider_selections: { text_generation: "outline-qa-model" },
      provider_secrets: { "outline-qa": "synthetic-only" },
    });
    const fixture = fs.readFileSync(path.join(base, "fixture.vnproj"));
    const project = JSON.parse(fixture); await api("/api/project/projects/import", fixture, "application/octet-stream");
    await page.reload();
    await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: project.title }).click();
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
    await page.locator('[data-help-key="toolbar.novelImport"]').click();
    let panel = page.getByTestId("novel-import-workbench");
    await panel.locator('[data-help-key="novel.importFile"] input').setInputFiles({
      name: "安装恢复.txt", mimeType: "text/plain", buffer: Buffer.from("甲".repeat(1300)) });
    await panel.locator('[data-help-key="novel.continueDirect"]').click();
    await page.evaluate(rangeCase => {
      const store = window.__AGENTVN_NOVEL_IMPORT_STORE__, n = store.getState(), doc = n.session.document;
      const chunks = Array.from({ length: 13 }, (_, i) => ({ chunk_id: `scan_${i}`, document_id: doc.document_id,
        index: i, start_offset: i * 100, end_offset: (i + 1) * 100,
        text: doc.normalized_text.slice(i * 100, (i + 1) * 100), estimated_tokens: 150 }));
      const analyses = chunks.map(c => ({ chunk_id: c.chunk_id, index: c.index, summary: `剧情${c.index}`,
        chapter_candidates: [{ chapter_id: `chapter_${c.index}`, index: c.index, title: `章节${c.index}`,
          start_offset: c.start_offset, end_offset: c.end_offset, summary: `剧情${c.index}`, confidence: 1 }],
        characters: [], locations: [], timeline: [], foreshadowing: [], warnings: [], confidence: 1 }));
      if (rangeCase) {
        for (const a of analyses)
          a.chapter_candidates[0].start_offset = a.index === 7 ? 720 : Math.max(0, a.index * 100 - 20);
        analyses[3].chapter_candidates.push({ ...analyses[3].chapter_candidates[0],
          chapter_id: "empty-placeholder", start_offset: 400, end_offset: 400 });
        analyses[12].chapter_candidates.push({ ...analyses[12].chapter_candidates[0],
          chapter_id: "nested-tail", start_offset: 1250, end_offset: 1280 });
      }
      store.setState({ session: { ...n.session, chunks, ai_chunk_analyses: analyses, outline_partials: {
        mainline: { document_id: doc.document_id, title: doc.title, summary: "完整主线",
          main_plot: "从开始到结尾", needs_review: false, coverage_confidence: 1, warnings: [] } } } });
    }, rangeCase);
    await stage("truncation-terminal-and-durable-checkpoint", async () => {
      await panel.locator('[data-help-key="novel.aiStart"]').click();
      await page.waitForFunction(() => {
        const n = window.__AGENTVN_NOVEL_IMPORT_STORE__.getState(); return !n.isProcessing && n.errors.length > 0;
      });
      assert.match(await panel.innerText(), /模型输出达到上限/);
      assert(!/流式输出中/.test(await panel.locator(".novel-model-stream-panel").innerText()));
      await until(async () => {
        const disk = await api(`/api/project/projects/${project.project_id}`);
        return disk.editor_settings?.novelPersistence?.sessionSnapshot?.outline_partials?.batches?.length === 1;
      }, "packaged backend disk checkpoint");
      await session.shot("installed-failure");
      return { completedScans: 13, successfulBatches: 1, requests: report.requests.length };
    });
    await stage("natural-host-and-backend-exit", () => session.naturalClose());
    session = newSession("resume"); page = await session.start();
    observeRanges(page);
    await page.context().unrouteAll({ behavior: "wait" });
    await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: project.title }).click();
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
    await page.locator('[data-help-key="toolbar.novelImport"]').click();
    panel = page.getByTestId("novel-import-workbench");
    await stage("restart-manual-resume-no-successful-replay", async () => {
      assert.equal(report.requests.length, 2);
      const before = await page.evaluate(() => window.__AGENTVN_NOVEL_IMPORT_STORE__.getState().session);
      assert.equal(before.ai_chunk_analyses.length, 13); assert.equal(before.outline_partials.batches.length, 1);
      await panel.locator('[data-help-key="novel.aiStart"]').click();
      await page.waitForFunction(() => {
        const n = window.__AGENTVN_NOVEL_IMPORT_STORE__.getState();
        return !n.isProcessing && n.session.ai_stage === "outline";
      }, undefined, { timeout: 60000 });
      const done = await page.evaluate(() => window.__AGENTVN_NOVEL_IMPORT_STORE__.getState().session);
      assert.deepEqual(done.ai_outline.chapters.map(c => c.chapter_id),
        Array.from({ length: 13 }, (_, i) => `chapter_${i}`));
      assert.equal(done.outline_partials.batches.length, 8); assert.equal(report.requests.length, 9);
      if (rangeCase) {
        assert.equal(done.ai_outline.chapters[6].end_offset, 700);
        assert.equal(done.ai_outline.chapters[7].start_offset, 720);
        assert.equal(done.ai_outline.chapters[12].end_offset, 1300);
        assert.equal(done.ai_outline.needs_review, true);
        assert(done.ai_outline.warnings.length > 0);
        assert(report.rangeTraces.some(t => t.returned.some(([a,b]) => a === 1250 && b === 1280)));
      }
      assert.equal(report.requests.filter(r => r.phase === "structure" && r.ids.includes("scan_0")).length, 1);
      assert(!report.modelError, report.modelError); await session.shot("installed-recovered");
      return { chapters: 13, checkpoints: 8, controlledRequests: 9 };
    });
    await stage("final-natural-close", () => session.naturalClose());
    assert.equal(report.stages.length, 5); assert(report.stages.every(s => s.status === "PASS"));
    report.status = "PASS_LIMITED_INSTALLED_RECOVERY";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    try {
      await session?.stop();
      if (server) { for (const s of sockets) s.destroy(); await new Promise(r => server.close(r)); }
      report.cleanup = "PASS";
    } catch (e) { report.cleanup = "FAILED"; report.cleanupError = String(e); process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    fs.writeFileSync(path.join(base, "stop.json"), JSON.stringify({ at: report.finishedAt }), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, cleanup: report.cleanup, out, error: report.error }));
  }
})();
