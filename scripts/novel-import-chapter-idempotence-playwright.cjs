#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { root, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const output = process.env.AGENTVN_WORKSPACE_OUTPUT
  ? path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT)
  : path.join(root, "output/playwright/novel-import-chapter-idempotence",
    new Date().toISOString().replace(/[:.]/g, "-"));
const report = { scope: "real-store-chapter-import-not-floating-ui-acceptance", status: "RUNNING", cases: [] };

(async () => {
  let env, browser;
  try {
    env = await startEditorAcceptance(output);
    report.owner = { pid: env.server.pid, runId: env.server.runId, url: env.url };
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await env.server.run(async () => {
      await env.open(page);
      const outcome = await page.evaluate(async () => {
        const { useNovelImportStore: novel } = await import("/src/store/novelImportStore.ts");
        const { useEditorStore: editor } = await import("/src/store/editorStore.ts");
        const { backendClient } = await import("/src/api/backendClient.ts");
        const cases = [];
        const check = (condition, message) => { if (!condition) throw Error(message); };
        const initialNodeIds = editor.getState().nodes.map(node => node.id);
        const initialEdges = JSON.stringify(editor.getState().edges);
        const graph = () => JSON.stringify({ nodes: editor.getState().nodes, edges: editor.getState().edges });
        const imported = job => editor.getState().nodes.filter(node => node.data.editorMeta?.sourceProcessJobId === job);
        const chapter = chapterIndex => ({
          chapterIndex, sourceChunkIds: [`chunk_${chapterIndex}`], summary: "章节验收", qualityWarnings: [],
          scene: { scene_id: `import_chapter_${chapterIndex}`, title: `章节 ${chapterIndex}`, summary: "",
            chapter: chapterIndex + 1, tags: [], is_ending: true,
            commands: [{ type: "narration", text: `章节 ${chapterIndex} 的完整对白。` }] },
        });
        let response = { completedResults: [], completedChapterResults: [chapter(0)], warnings: [] };
        let fetches = 0, modelRequests = 0, failRead = false;
        // Stub only transport. Exercise the real importer, metadata, graph and
        // persistent stores without sending any additional model requests.
        backendClient.getNovelProcessJobResults = async () => {
          fetches++;
          if (failRead) throw Error("expected result-read failure");
          return structuredClone(response);
        };
        backendClient.polishNovelProcessLinks = async () => {
          modelRequests++;
          throw Error("No model requests are permitted in this regression");
        };
        const first = await novel.getState().importNovelProcessJobResults("chapter_job");
        check(first && first.mode === "append_isolated" && !first.reusedExistingImport, "first import must append an isolated line");
        check(imported("chapter_job").length === 1, "first import must create one chapter");
        check(JSON.stringify(editor.getState().edges) === initialEdges, "first isolated chapter must not link into the existing graph");
        cases.push("first-chapter-isolated-append");
        let before = graph();
        const repeated = await novel.getState().importNovelProcessJobResults("chapter_job");
        check(repeated?.reusedExistingImport && graph() === before, "same results must not duplicate or change the graph");
        cases.push("same-results-are-noop");
        response.completedChapterResults.push(chapter(1));
        const recovered = await novel.getState().importNovelProcessJobResults("chapter_job");
        check(recovered && !recovered.reusedExistingImport && recovered.importedNodeIds.length === 1,
          "a recovered chapter must append exactly once");
        const written = imported("chapter_job");
        check(written.length === 2 && written.map(node => node.data.editorMeta.sourceProcessChapterIndex).sort().join() === "0,1",
          "chapter identity must be preserved without reimporting chapter zero");
        check(written.every(node => node.data.editorMeta.importLineId === first.importLineId),
          "recovered chapter must remain in the original imported line");
        check(initialNodeIds.every(id => editor.getState().nodes.some(node => node.id === id)),
          "existing project nodes must remain");
        check(JSON.parse(initialEdges).every(edge => editor.getState().edges.some(current => JSON.stringify(current) === JSON.stringify(edge))),
          "existing project edges must remain unchanged");
        check(editor.getState().edges.some(edge => edge.source === written[0].id && edge.target === written[1].id),
          "recovered chapter must connect within its own imported line");
        cases.push("recovered-chapter-appends-once-and-preserves-original-graph");
        before = graph();
        const repeatedRecovery = await novel.getState().importNovelProcessJobResults("chapter_job");
        check(repeatedRecovery?.reusedExistingImport && graph() === before, "recovered results must also be idempotent");
        cases.push("recovered-results-are-noop");
        const legacy = structuredClone(written[0]);
        legacy.id = "legacy_import_node";
        legacy.data.editorMeta.sourceProcessJobId = "legacy_job";
        delete legacy.data.editorMeta.sourceProcessChapterIndex;
        editor.setState(state => ({ nodes: [...state.nodes, legacy] }));
        before = graph();
        const legacyResult = await novel.getState().importNovelProcessJobResults("legacy_job");
        check(legacyResult?.reusedExistingImport && graph() === before, "legacy job metadata must not be reimported");
        cases.push("legacy-import-is-preserved");
        before = graph();
        failRead = true;
        const failed = await novel.getState().importNovelProcessJobResults("new_failed_job");
        check(failed === undefined && graph() === before, "result-read failure must preserve the complete graph");
        cases.push("read-failure-does-not-mutate-graph");
        check(modelRequests === 0 && fetches === 6, "reuse must still discover new chapters, without issuing model requests");
        return { cases, fetches, modelRequests };
      });
      assert.equal(outcome.cases.length, 6, "All importer behavior cases must execute");
      report.cases = outcome.cases.map(name => ({ name, status: "PASS" }));
      report.transport = { fetches: outcome.fetches, modelRequests: outcome.modelRequests };
    });
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED";
    report.error = String(error.stack || error);
    console.error(report.error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    await env?.stop();
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Evidence: ${path.join(output, "report.json")}`);
  }
})();
