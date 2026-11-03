#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { root, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = process.env.AGENTVN_WORKSPACE_OUTPUT
  ? path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT)
  : path.join(root, "output/playwright/novel-task-local-ownership", runId);
const report = { runId, scope: "local-task-resume-response-ownership", status: "RUNNING", cases: [] };

(async () => {
  let env, browser;
  try {
    env = await startEditorAcceptance(output);
    browser = await chromium.launch();
    report.owner = { pid: env.server.pid, runId: env.server.runId, url: env.url };
    for (const operation of ["plan_chapter", "adapt_scene"]) {
      for (const responseType of ["final", "error"]) {
        const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
        let release;
        let received;
        const requestReady = new Promise(resolve => { received = resolve; });
        // Mock only the remote streaming transport, never a task/store method.
        // Do not connect to the backend WebSocket or send a real model request.
        await page.routeWebSocket("**/api/ws/novel", socket => {
          socket.onMessage(raw => {
            const command = JSON.parse(String(raw));
            if (command.command === "ping") return;
            assert.equal(command.command, "start_novel_job");
            assert.equal(command.operation, operation);
            release = () => socket.send(JSON.stringify({ type: responseType, seq: 1,
              jobId: command.jobId, requestId: command.requestId,
              payload: responseType === "error" ? { message: "controlled-obsolete-stream-error" }
                : operation === "plan_chapter" ? {
                  chapter_id: "owned_chapter", scenes: [{
                    scene_candidate_id: "owned_candidate", chapter_id: "owned_chapter", index: 0,
                    title: "旧任务结果", start_offset: 0, end_offset: command.payload.text.length,
                    characters: [], source_excerpt: command.payload.text, summary: "旧工程",
                    commands: [{ type: "narration", text: "旧工程内容。" }], confidence: 1,
                  }], conflict_points: [], branch_suggestions: [], warnings: [], needs_review: false,
                } : {
                  adapted_scene: {
                    adapted_scene_id: "owned_adapted", source_scene_candidate_id: "owned_candidate",
                    scene_beat: { scene_id: "obsolete_scene", title: "旧工程场景", summary: "",
                      chapter: 1, tags: [], is_ending: true, commands: [{ type: "narration", text: "旧工程内容。" }] },
                    source_mapping: { document_id: "owned_document", start_offset: 0,
                      end_offset: command.payload.scene_candidate.end_offset,
                      source_excerpt: command.payload.scene_candidate.source_excerpt, adapted_command_ids: [] },
                    warnings: [], needs_review: false,
                  }, character_updates: [], asset_suggestions: [], branch_suggestions: [], conflict_points: [], warnings: [],
                } }));
            received();
          });
        });
        await env.server.run(async () => {
          await env.open(page);
          await page.evaluate(async operation => {
            const provider = await import("/src/providers/providerRegistry.ts");
            const { saveApiKey } = await import("/src/providers/apiKeyStorage.ts");
            provider.saveProviderConnection({ connection_id: "local_owner_provider",
              provider_type: "openai_compatible", display_name: "受控归属验收", base_url: "http://127.0.0.1:1",
              api_key_storage: "session", enabled: true, supports_model_discovery: false });
            provider.createProviderModel("local_owner_provider", { provider_id: "local_owner_model",
              model_id: "acceptance-only", model_name: "acceptance-only", enabled: true, capabilities: ["text_generation"] });
            provider.setCapabilitySelection("text_generation", "local_owner_model");
            saveApiKey("local_owner_provider", "not-a-real-key", "session");
            const novel = (await import("/src/store/novelImportStore.ts")).useNovelImportStore;
            await novel.getState().importFile(new File(["只用于旧任务归属的原文。".repeat(50)],
              "旧任务归属.txt", { type: "text/plain" }));
            novel.getState().confirmDirectImport();
            const session = novel.getState().session;
            const text = session.document.normalized_text;
            const chapter = { chapter_id: "owned_chapter", title: "第一章", index: 0,
              start_offset: 0, end_offset: text.length, summary: "", confidence: 1 };
            const scene = { scene_candidate_id: "owned_candidate", chapter_id: chapter.chapter_id, index: 0,
              title: "受控场景", start_offset: 0, end_offset: text.length, characters: [],
              source_excerpt: text, summary: "", commands: [{ type: "narration", text: "受控剧情。" }], confidence: 1 };
            novel.setState({ session: { ...session, chapters: [chapter],
              scenes: operation === "adapt_scene" ? [scene] : [],
              ai_outline: { document_id: session.document.document_id, title: "归属验收",
                summary: "归属验收", main_plot: "归属验收", chapters: [chapter], characters: [],
                timeline: [], locations: [], branch_or_foreshadowing: [], conflict_points: [],
                warnings: [], needs_review: false, coverage_confidence: 1 },
              quality_risk_accepted: true } });
            window.__localOwnerPending = novel.getState().resumeBlueprintGeneration();
          }, operation);
          await Promise.race([requestReady, new Promise((_, reject) =>
            setTimeout(() => reject(Error("Controlled stream was not reached")), 10000))]);
          const before = await page.evaluate(async () => {
            const project = (await import("/src/store/projectStore.ts")).useProjectStore;
            project.setState({ projectId: "next-local-task-project",
              settings: { ...project.getState().settings, novelPersistence: undefined } });
            const novel = (await import("/src/store/novelImportStore.ts")).useNovelImportStore.getState();
            const editor = (await import("/src/store/editorStore.ts")).useEditorStore.getState();
            return JSON.stringify({ session: novel.session, errors: novel.errors, warnings: novel.warnings,
              modelStream: novel.modelStream, inspectableResults: novel.inspectableResults,
              importJob: novel.importJob, isProcessing: novel.isProcessing,
              graph: { nodes: editor.nodes, edges: editor.edges } });
          });
          release();
          const after = await page.evaluate(async () => {
            await window.__localOwnerPending;
            const novel = (await import("/src/store/novelImportStore.ts")).useNovelImportStore.getState();
            const editor = (await import("/src/store/editorStore.ts")).useEditorStore.getState();
            return JSON.stringify({ session: novel.session, errors: novel.errors, warnings: novel.warnings,
              modelStream: novel.modelStream, inspectableResults: novel.inspectableResults,
              importJob: novel.importJob, isProcessing: novel.isProcessing,
              graph: { nodes: editor.nodes, edges: editor.edges } });
          });
          assert.equal(after, before, `Obsolete local ${operation} ${responseType} must not mutate the next project`);
          report.cases.push({ name: `obsolete-${operation}-${responseType}-cannot-mutate-next-project`, status: "PASS" });
        });
        await page.close();
      }
    }
    assert.equal(report.cases.length, 4, "All local task ownership responses must execute");
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
