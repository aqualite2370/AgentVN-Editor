"use strict";
// Actual browser/store/backend persistence; WS response controlled. No provider calls.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const out = process.env.AGENTVN_WORKSPACE_OUTPUT;
const report = { status: "RUNNING", scope: "SOURCE_BROWSER_LEGACY_RESUME_GUARD_CONTROLLED_WS",
  modelRequests: 0, operations: [], cases: [], cleanup: {} };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let env, browser;
(async () => {
  try {
    env = await startEditorAcceptance(out);
    report.owner = { backendPid: env.backendPid, vitePid: env.server.pid, url: env.url };
    const config = await fetch(`${env.backendUrl}/api/project/state`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider_connections: [{ connection_id: "controlled", display_name: "受控验证",
          provider_type: "openai_compatible", base_url: "http://127.0.0.1:1/v1",
          api_key_storage: "local", enabled: true }],
        provider_models: [{ provider_id: "controlled", connection_id: "controlled",
          model_id: "controlled", model_name: "controlled", enabled: true,
          capabilities: ["text_generation"], default_parameters: { max_tokens: 3000, context_budget_tokens: 24000 } }],
        provider_selections: { text_generation: "controlled" },
        provider_secrets: { controlled: "synthetic" },
      }),
    }); assert(config.ok);
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.routeWebSocket("**/api/ws/novel", socket => {
      socket.onMessage(raw => {
        const c = JSON.parse(String(raw));
        if (c.command !== "start_novel_job") return;
        report.operations.push(c.operation); save();
        for (const e of [
          { type: "lifecycle", seq: 1, payload: { message: "controlled start" } },
          { type: "error", seq: 2, payload: { message: "QA controlled stop; no provider called" } },
        ]) socket.send(JSON.stringify({ ...e, requestId: c.requestId, jobId: c.jobId }));
      });
    });
    await env.open(page);
    await page.locator('[data-help-key="toolbar.novelImport"]').click();
    await page.getByTestId("novel-import-workbench").waitFor();
    const count = await page.evaluate(async () => {
      const store = window.__AGENTVN_NOVEL_IMPORT_STORE__, n = store.getState();
      const { chunkText } = await import("/src/novel-import/textChunker.ts");
      const text = Array.from({ length: 40 }, (_, i) =>
        `章节${i}\n${"甲乙丙丁。".repeat(36 + i % 5)}\n\n\n${"结尾段落。".repeat(27)}`).join("\n\n");
      const doc = { document_id: "legacy", file_name: "受控旧任务.txt", title: "受控",
        normalized_text: text, original_text: text, total_chars: text.length, metadata: {} };
      const chunks = chunkText(doc.document_id, text, 4032, 322);
      const analyses = chunks.map(c => ({ chunk_id: c.chunk_id, index: c.index,
        summary: "完成扫描", chapter_candidates: [], characters: [], locations: [],
        timeline: [], foreshadowing: [], warnings: [], confidence: 1 }));
      store.setState({ session: { ...n.session, document: doc, chunks, ai_chunk_analyses: analyses,
        ai_stage: "scan", status: "ai_scanning", import_record: undefined,
        outline_partials: { mainline: { document_id: doc.document_id, title: "受控",
          summary: "主线", main_plot: "剧情", needs_review: false, coverage_confidence: 1, warnings: [] } } } });
      return chunks.length;
    });
    await page.locator('[data-help-key="novel.aiStart"]').click();
    await page.waitForFunction(() => {
      const n = window.__AGENTVN_NOVEL_IMPORT_STORE__.getState(); return !n.isProcessing && n.errors.length;
    });
    assert.deepEqual(report.operations, ["build_outline"], "Resume must skip all completed scans");
    let n = await page.evaluate(() => {
      const n = window.__AGENTVN_NOVEL_IMPORT_STORE__.getState();
      return { scans: n.session.ai_chunk_analyses.length, mainline: !!n.session.outline_partials.mainline };
    });
    assert.equal(n.scans, count); assert(n.mainline);
    report.cases.push({ name: "producer chunks skip scans and preserve checkpoint after controlled error", status: "PASS", scans: count });
    await page.evaluate(() => {
      const s = window.__AGENTVN_NOVEL_IMPORT_STORE__, n = s.getState();
      s.setState({ session: { ...n.session, document: { ...n.session.document,
        normalized_text: n.session.document.normalized_text.replace("甲", "新") } } });
    });
    await page.locator('[data-help-key="novel.aiStart"]').click();
    n = await page.evaluate(() => {
      const n = window.__AGENTVN_NOVEL_IMPORT_STORE__.getState();
      return { scans: n.session.ai_chunk_analyses.length, errors: n.errors,
        processing: n.isProcessing, mainline: !!n.session.outline_partials.mainline };
    });
    assert(!n.processing); assert.equal(n.scans, count); assert(n.mainline);
    assert.match(n.errors.join(" "), /不匹配.*未自动重扫/);
    assert.equal(report.operations.length, 1);
    report.cases.push({ name: "changed source blocks before WS or paid request and retains old checkpoints", status: "PASS" });
    assert.equal(report.cases.length, 2); report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    await browser?.close(); await env?.stop();
    report.cleanup.ownedServicesStopped = !!env; save();
    console.log(JSON.stringify(report));
  }
})();
