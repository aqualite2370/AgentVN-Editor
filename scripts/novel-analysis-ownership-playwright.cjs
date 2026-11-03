"use strict";
// State/race regression at the actual store + WebSocket client seam.
// Only remote WebSocket replies are controlled; no real provider is contacted.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), net = require("node:net");
const { chromium } = require("../editor/node_modules/playwright");
const { startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const output = path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT || "");
const controlsOnly = process.argv.includes("--controls-only");
const selectedCase = process.argv.find(a => a.startsWith("--case="))?.slice("--case=".length);
assert(process.env.AGENTVN_WORKSPACE_OUTPUT && process.env.AGENTVN_TEST_PROJECT);
const report = { status: "RUNNING", scope: "SOURCE_SCAN_OUTLINE_LATE_RESPONSE_OWNERSHIP",
  controlsOnly, selectedCase, realModelRequests: 0, cases: [], cleanup: {},
  productSources: ["editor/src/store/novelImportStore.ts", "editor/src/novel-import/adaptationClient.ts",
    "editor/src/novel-import/persistence.ts"].map(file => ({
    path: path.resolve(__dirname, "..", file),
    sha256: crypto.createHash("sha256").update(fs.readFileSync(path.resolve(__dirname, "..", file))).digest("hex"),
  })) };
let env, browser;
const save = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
function result(command) {
  const p = command.payload;
  const chapter = { chapter_id: "owned_chapter", title: "旧工程章节", index: 0,
    start_offset: 0, end_offset: p.text?.length ?? p.total_chars, confidence: 1, summary: "旧任务内容。" };
  return command.operation === "scan_chunk"
    ? { chunk_id: p.chunk_id, index: p.index, summary: "旧扫描结果。", chapter_candidates: [chapter],
      characters: [], locations: [], timeline: [], foreshadowing: [], warnings: [], confidence: 1 }
    : { document_id: p.document_id, title: p.title, summary: "旧大纲结果。", main_plot: "旧任务内容。",
      chapters: [chapter], characters: [], locations: [], timeline: [], branch_or_foreshadowing: [],
      conflict_points: [], warnings: [], needs_review: false, coverage_confidence: 1 };
}
async function snapshot(page) {
  return page.evaluate(async () => {
    const novel = (await import("/src/store/novelImportStore.ts")).useNovelImportStore;
    const project = (await import("/src/store/projectStore.ts")).useProjectStore;
    const editor = (await import("/src/store/editorStore.ts")).useEditorStore;
    const n = novel.getState(), p = project.getState(), e = editor.getState();
    return { projectId: p.projectId, generation: n.ownershipGeneration, session: n.session,
      errors: n.errors, warnings: n.warnings, progress: n.progress, modelStream: n.modelStream,
      inspectableResults: n.inspectableResults, importJob: n.importJob, processing: n.processing,
      isProcessing: n.isProcessing, graph: { nodes: e.nodes, edges: e.edges, selected: e.selectedNodeId } };
  });
}
async function persistence(page, id) {
  await page.waitForFunction(id => {
    const n = window.__AGENTVN_NOVEL_IMPORT_STORE__.getState(), p = n.persistence;
    if (JSON.stringify(p.errors) !== JSON.stringify(n.errors) || JSON.stringify(p.warnings) !== JSON.stringify(n.warnings))
      return false;
    if (JSON.stringify(p.inspectableResults) !== JSON.stringify(n.inspectableResults)
      || JSON.stringify(p.processingSnapshot) !== JSON.stringify(n.processing)) return false;
    if (n.session.document && JSON.stringify(p.sessionSnapshot) !== JSON.stringify(n.session)) return false;
    return localStorage.getItem(`agentvn.novelProcessing.persistence.${encodeURIComponent(id)}`) === JSON.stringify(p);
  }, id);
  return page.evaluate(id => JSON.parse(localStorage.getItem(
    `agentvn.novelProcessing.persistence.${encodeURIComponent(id)}`)), id);
}
function withoutTimes(v) {
  if (Array.isArray(v)) return v.map(withoutTimes);
  if (!v || typeof v !== "object") return v;
  return Object.fromEntries(Object.entries(v).filter(([k]) => k !== "updatedAt")
    .map(([k, child]) => [k, withoutTimes(child)]));
}
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
(async () => {
  try {
    env = await startEditorAcceptance(output);
    fs.copyFileSync(__filename, path.join(output, "executed.cjs"), fs.constants.COPYFILE_EXCL);
    browser = await chromium.launch();
    report.owner = { frontendPid: env.server.pid, runId: env.server.runId, backendPid: env.backendPid,
      url: env.url, backendUrl: env.backendUrl }; save();
    for (const operation of ["scan_chunk", "build_outline"])
      for (const responseType of ["final", "error", "checkpoint-error"])
        for (const switchType of controlsOnly ? ["same-owner"] : ["next-project", "project-roundtrip", "session-reset"]) {
          if (selectedCase && selectedCase !== `${operation}-${responseType}-${switchType}`) continue;
          const item = { name: `${operation}-${responseType}-${switchType}`, status: "RUNNING", operations: [] };
          report.cases.push(item); save();
          const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
          let release, received;
          const requestReady = new Promise(resolve => { received = resolve; });
          await page.routeWebSocket("**/api/ws/novel", socket => {
            socket.onMessage(raw => {
              const c = JSON.parse(String(raw));
              if (c.command !== "start_novel_job") return;
              item.operations.push(c.operation);
              const send = (type, seq, payload) => socket.send(JSON.stringify({
                type, seq, jobId: c.jobId, requestId: c.requestId, payload }));
              if (c.operation !== operation || release) {
                send("final", 1, result(c)); return;
              }
              release = () => {
                if (responseType === "checkpoint-error") {
                  send("checkpoint", 1, operation === "scan_chunk"
                    ? { stage: "summary", payload: { chunk_id: c.payload.chunk_id, index: c.payload.index,
                      summary: "迟到检查点。", confidence: 1, warnings: [] } }
                    : { stage: "mainline", payload: { document_id: c.payload.document_id,
                      title: c.payload.title, summary: "迟到大纲。", main_plot: "旧内容。",
                      warnings: [], needs_review: false, coverage_confidence: 1 } });
                }
                send(responseType === "final" ? "final" : "error", responseType === "checkpoint-error" ? 2 : 1,
                  responseType === "final" ? result(c) : { message: "controlled-obsolete-analysis-error" });
              };
              received();
            });
          });
          try {
            await env.server.run(async () => {
              await env.open(page);
              await page.evaluate(async () => {
                const provider = await import("/src/providers/providerRegistry.ts");
                const { saveApiKey } = await import("/src/providers/apiKeyStorage.ts");
                provider.saveProviderConnection({ connection_id: "analysis_owner_provider",
                  provider_type: "openai_compatible", display_name: "离线归属测试", base_url: "http://127.0.0.1:1",
                  api_key_storage: "session", enabled: true, supports_model_discovery: false });
                provider.createProviderModel("analysis_owner_provider", { provider_id: "analysis_owner_model",
                  model_id: "acceptance-only", model_name: "acceptance-only", enabled: true, capabilities: ["text_generation"] });
                provider.setCapabilitySelection("text_generation", "analysis_owner_model");
                saveApiKey("analysis_owner_provider", "synthetic-not-real-key", "session");
                const novel = (await import("/src/store/novelImportStore.ts")).useNovelImportStore;
                await novel.getState().importFile(new File(["第一章\n只属于原工程的小说原文。".repeat(20)],
                  "归属隔离.txt", { type: "text/plain" }));
                novel.getState().confirmDirectImport();
                window.__analysisPending = novel.getState().startAiAnalysis();
              });
              await Promise.race([requestReady, new Promise((_, reject) =>
                setTimeout(() => reject(Error("Controlled analysis stream not reached")), 15000))]);
              await page.evaluate(async switchType => {
                const novel = (await import("/src/store/novelImportStore.ts")).useNovelImportStore;
                const project = (await import("/src/store/projectStore.ts")).useProjectStore;
                if (switchType === "same-owner") return;
                if (switchType === "session-reset") { novel.getState().resetSession(); return; }
                const originalId = project.getState().projectId;
                project.setState({ projectId: "qa-analysis-other-project",
                  settings: { ...project.getState().settings, novelPersistence: undefined } });
                if (switchType === "project-roundtrip")
                  project.setState({ projectId: originalId,
                    settings: { ...project.getState().settings, novelPersistence: undefined } });
              }, switchType);
              item.before = await snapshot(page);
              item.persistedBefore = await persistence(page, item.before.projectId);
              const requestsBefore = item.operations.length;
              release();
              await page.evaluate(() => window.__analysisPending);
              item.after = await snapshot(page);
              item.persistedAfter = await persistence(page, item.before.projectId);
              if (switchType === "same-owner") {
                assert.equal(item.after.isProcessing, false);
                assert.equal(item.after.session.session_id, item.before.session.session_id);
                assert.deepEqual(item.after.graph, item.before.graph);
                if (responseType === "final") {
                  assert.equal(item.after.session.ai_stage, "outline");
                  assert.equal(item.after.session.ai_outline.summary, "旧大纲结果。");
                  assert.equal(item.after.errors.length, 0);
                  assert.equal(item.after.session.ai_chunk_analyses.length, 1);
                  assert.equal(item.after.session.ai_chunk_analyses[0].modelName, "analysis_owner_provider / acceptance-only");
                } else {
                  assert(item.after.errors.some(e => e.includes("controlled-obsolete-analysis-error")));
                  if (responseType === "checkpoint-error")
                    assert(operation === "scan_chunk"
                      ? Object.values(item.after.session.scan_partials).some(p => p.summary?.summary === "迟到检查点。")
                      : item.after.session.outline_partials.mainline?.summary === "迟到大纲。");
                }
              } else {
                assert.deepEqual(item.after, item.before, "Late response must not mutate the current task/session/UI/graph");
                assert.deepEqual(withoutTimes(item.persistedAfter), withoutTimes(item.persistedBefore),
                  "Late response must not pollute deferred project persistence");
                assert.equal(item.operations.length, requestsBefore, "An obsolete scan must not issue an outline request");
              }
              item.status = "PASS";
            });
          } catch (error) {
            item.status = "FAILED"; item.error = String(error.stack || error);
            if (!release) {
              item.classification = "SETUP_FAILED_NO_CONTROLLED_TASK_REACHED";
              item.failureUi = await page.locator("body").innerText().catch(String);
              throw error;
            }
          } finally { await page.close(); save(); }
        }
    assert.equal(report.cases.length, selectedCase ? 1 : controlsOnly ? 6 : 18);
    assert(report.cases.every(c => c.status === "PASS"), "Every scan/outline response and owner transition must pass");
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  } finally {
    try {
      await browser?.close(); await env?.stop();
      report.cleanup.browserClosed = true; report.cleanup.servicesStopReturned = true;
      if (env) {
        report.cleanup.frontendPortClosed = await closed(env.url);
        report.cleanup.backendPortClosed = await closed(env.backendUrl);
        assert(report.cleanup.frontendPortClosed && report.cleanup.backendPortClosed, "Owned test ports must close");
      }
    } catch (error) {
      report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1;
    }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length,
      passed: report.cases.filter(c => c.status === "PASS").length, realModelRequests: 0, output }));
  }
})();
