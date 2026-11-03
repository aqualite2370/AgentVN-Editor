"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { nativeSession, until } = require("./lib/current-native-editor-session.cjs");
const { controlledNovelFailureProvider } = require("./lib/controlled-novel-failure-provider.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, ".."), label = "Native-Novel-Partial-20261020-01";
const qa = `F:/AgentVN/QA/${label}`, checkpoint = `F:/AgentVN/Checkpoints/${label}`;
const summary = path.join(root, "output/native-novel-partial-20261020-01");
const load = f => JSON.parse(fs.readFileSync(f, "utf8"));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(root, f), sha256: sha(path.resolve(root, f)) });
const sources = ["editor/src/store/novelImportStore.ts",
  "editor/src/components/novel-import/NovelImportWizard.tsx",
  "editor/src/components/novel-import/NovelProcessTaskWorkbench.tsx",
  "editor/src/novel-import/novelProcessGraphProgress.ts", "editor/src/novel-import/novelProcessJobAdapter.ts",
  "editor/src/novel-import/importToGraph.ts",
  "backend/app/api/routes_novel_process.py",
  "backend/app/services/novel_process_service.py", "backend/app/ai/provider.py",
  "scripts/lib/current-native-editor-session.cjs", "scripts/lib/controlled-novel-failure-provider.cjs"];
const products = ["AgentVN Dev.exe", "editor/src-tauri/target/debug/agentvn-editor.exe"];
const stages = ["real-two-chapter-failure-and-partial-import", "late-manual-retry-failure-isolated-across-a-b-a",
  "manual-retry-appends-only-recovered-chapter-with-stable-ids", "real-cancel-discards-late-output-and-never-dispatches-waiting-chapter",
  "native-save-and-restart-preserve-completed-and-cancelled-jobs"];
function prepare() {
  for (const dir of [qa, checkpoint, summary]) { assert(!fs.existsSync(dir)); fs.mkdirSync(dir, { recursive: true }); }
  const copied = [];
  for (const f of [...sources, __filename, "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md"]) {
    const original = path.resolve(root, f), target = path.join(checkpoint, path.relative(root, original));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(original, target, fs.constants.COPYFILE_EXCL); copied.push(desc(target));
  }
  const fixture = "F:/AgentVN/QA/Native-Assistant-Interaction-20261020-01/native-interaction-20261020-01.vnproj";
  const inputs = ["a", "b"].map(letter => {
    const p = load(fixture); p.project_id = `native-novel-partial-${letter}-20261020-01`;
    p.title = `小说异常隔离${letter.toUpperCase()}_20261020`; p.created_at = p.updated_at = new Date().toISOString();
    delete p.editor_settings.novelPersistence;
    const file = path.join(qa, `${p.project_id}.vnproj`);
    fs.writeFileSync(file, JSON.stringify(p, null, 2), { flag: "wx" });
    return { ...desc(file), id: p.project_id, title: p.title };
  });
  fs.writeFileSync(path.join(summary, "preparation.json"), JSON.stringify({ at: new Date().toISOString(),
    inputs, fixture: desc(fixture), copied, sources: sources.map(desc), products: products.map(desc) }, null, 2), { flag: "wx" });
  console.log(`PREPARED ${qa}`);
}
async function run(iteration) {
  assert(/^\d{2}$/.test(iteration)); const out = path.join(qa, `session-${iteration}`);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const prep = load(path.join(summary, "preparation.json")), [a, b] = prep.inputs;
  const report = { status: "RUNNING", at: new Date().toISOString(),
    scope: "CURRENT_NATIVE_DEV_CONTROLLED_FAILURE_REAL_EXECUTOR_NOT_RELEASE_OR_DEEPSEEK",
    viewport: { width: 1920, height: 1080, dpr: 1, reduced: false },
    cases: [], launches: [], cleanups: [], screenshots: [], errors: [], reads: [], http: [],
    sources: sources.map(desc), products: products.map(desc), inputs: prep.inputs,
    productChanges: 0, devPublicationBuilds: 0, realModelRequests: 0,
    verifyGraphPhases: process.env.AGENTVN_VERIFY_NOVEL_PHASES === "1",
    boundaries: ["Controlled external model failures; actual job APIs/executor/SQLite",
      "CDP actions in real Dev WebView; source Python backend/Vite, not packaged Release",
      "Single 1080p lifecycle scope, not complete display matrix",
      "Explicit local directory preference, not folder-selector proof",
      "Exact-owned forced restart/cleanup, not normal native close",
      "No real model charges; no default scan/outline or player consumption proof"] };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  const session = nativeSession({ out, input: a.path, report, save });
  let page, provider, started = false, jobA, jobB, firstImport;
  const route = (job, suffix = "") => `/api/novel/processing/execute/jobs/${job}${suffix}`;
  const immutable = () => {
    for (const f of [...report.inputs, ...report.sources, ...report.products]) assert.equal(sha(f.path), f.sha256, f.path);
  };
  async function step(name, fn) {
    const c = { name, status: "RUNNING", startedAt: new Date().toISOString() }; report.cases.push(c); save();
    console.log(`START ${name}`);
    try { c.detail = await fn(); c.status = "PASS"; console.log(`PASS ${name}`); }
    catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
    finally { c.finishedAt = new Date().toISOString(); save(); }
  }
  async function state() {
    const s = await page.evaluate(async () => {
      const [{ useNovelImportStore }, { useProjectStore }, { useEditorStore }] = await Promise.all([
        import("/src/store/novelImportStore.ts"), import("/src/store/projectStore.ts"), import("/src/store/editorStore.ts")]);
      const n = useNovelImportStore.getState(), p = useProjectStore.getState(), e = useEditorStore.getState();
      return { id: p.projectId, generation: n.ownershipGeneration, session: n.session.session_id,
        nodes: e.nodes, edges: e.edges, selected: e.selectedNodeId, errors: n.errors, warnings: n.warnings,
        persistence: p.settings.novelPersistence, processing: n.processing,
        cards: [...document.querySelectorAll('[data-testid="novel-task-mini-entry"]')].map(n => ({
          id: n.dataset.projectId, status: n.dataset.jobStatus, text: n.textContent })),
        panel: document.querySelector('[data-testid="novel-task-workbench"]')?.textContent };
    });
    report.reads.push({ at: new Date().toISOString(), state: s }); save(); return s;
  }
  async function open(input) {
    await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: input.title }).click();
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
    const s = await state(); assert.equal(s.id, input.id); return s;
  }
  async function home() {
    await page.locator('[data-help-key="toolbar.home"]').click(); await page.locator(".project-home").waitFor();
    await settleEditor(page);
  }
  async function task() {
    await page.getByTestId("novel-task-mini-entry").getByRole("button", { name: /^打开小说任务面板/ }).click();
    const panel = page.getByTestId("novel-task-workbench"); await panel.waitFor(); return panel;
  }
  async function closeTask() {
    await page.locator('[data-help-key="novel.task.closePanel"]').click();
    await page.getByTestId("novel-task-workbench").waitFor({ state: "detached" });
  }
  async function request(index) {
    return until(() => provider.requests.length > index && provider.requests[index].input && provider.requests[index],
      `held model request ${index}`, 60000);
  }
  async function terminal(job, expected) {
    const final = await until(async () => {
      const s = await session.api(route(job));
      return ["completed", "failed", "failed_partial", "cancelled"].includes(s.status) && s;
    }, `job ${job} terminal`, 60000);
    assert.equal(final.status, expected, JSON.stringify(final)); return final;
  }
  async function visibleStatus(status) {
    await until(async () => (await state()).cards.some(c => c.status === status), `UI status ${status}`);
  }
  async function submit(name) {
    await page.locator('[data-help-key="toolbar.novelImport"]').click();
    const w = page.getByTestId("novel-import-workbench"); await w.waitFor();
    await w.locator('[data-help-key="novel.importFile"] input').setInputFiles({
      name: `${name}.txt`, mimeType: "text/plain",
      buffer: Buffer.from("第一章 雨后窗边\n" + "雨停了，窗边留下了雨水。房间中只有风声。\n".repeat(32) +
        "\n第二章 远处灯光\n" + "夜幕落下，远处的灯光逐渐明亮。窗边留下了一封信。\n".repeat(32)) });
    await w.getByRole("region", { name: "小说文件导入检测" }).waitFor();
    await w.locator('[data-help-key="novel.startChapterSplit"]').click();
    await w.getByRole("heading", { name: "选择要处理的章节" }).waitFor();
    assert.equal(await w.locator('.novel-chapter-table input[type="checkbox"]').count(), 2);
    await w.locator('[data-help-key="novel.selectAllChapters"]').click();
    await w.locator(".novel-processing-advanced summary").click();
    await w.locator('[data-help-key="novel.process.maxConcurrency"]').fill("1");
    await w.locator('[data-help-key="novel.process.maxRetryCount"]').fill("0");
    await w.getByTestId("novel-create-process-job").click();
    const s = await until(async () => { const s = await state(); return s.processing.activeJobId && s; }, "published job");
    const job = s.processing.activeJobId; assert.equal(s.processing.jobs.length, 1);
    await page.locator('[data-help-key="toolbar.novelImport.closeWorkbench"]').click();
    await w.waitFor({ state: "detached" }); return job;
  }
  async function view() {
    const panel = await task(); await panel.locator('[data-help-key="novel.task.viewResult"]').click();
    await panel.waitFor({ state: "detached" });
    await page.locator('[data-workspace-surface="edit"][aria-current="page"]').waitFor(); await settleEditor(page);
    return state();
  }
  const imported = s => s.nodes.filter(n => n.data.editorMeta?.sourceProcessJobId === jobA);
  async function phaseFact(label, percent, expectedStatus, validationPercent = percent, validationStatus = expectedStatus) {
    if (process.env.AGENTVN_VERIFY_NOVEL_PHASES !== "1") return;
    const alreadyOpen = await page.getByTestId("novel-task-workbench").count();
    const panel = alreadyOpen ? page.getByTestId("novel-task-workbench") : await task();
    const sample = { label, at: new Date().toISOString(),
      expected: { percent, status: expectedStatus, validationPercent, validationStatus } };
    const observed = () => panel.locator('.novel-phase-timeline article').evaluateAll(items => items.map(n => ({
      id: n.dataset.phase, status: n.dataset.phaseStatus, basis: n.dataset.progressBasis,
      percent: Number(n.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")), text: n.textContent,
    })));
    await until(async () => {
      sample.phases = await observed();
      return ["import_write", "validation"].every(id => {
        const row = sample.phases.find(p => p.id === id);
        return row && row.percent === (id === "validation" ? validationPercent : percent)
          && row.status === (id === "validation" ? validationStatus : expectedStatus);
      });
    }, `phase facts ${label}`);
    sample.phases = await observed();
    for (const id of ["import_write", "validation"]) {
      const row = sample.phases.find(p => p.id === id);
      assert.equal(row.basis, id === "import_write" ? "current_project_graph" : "current_project_structure_validation");
    }
    sample.state = await state();
    (report.phaseFacts ??= []).push(sample); save();
    if (!alreadyOpen) await closeTask();
  }
  async function saveUI() {
    await page.locator('[data-help-key="toolbar.saveProject"]').click();
    const dialog = page.getByTestId("project-save-confirmation"); await dialog.waitFor();
    const message = await dialog.innerText(); assert(message.includes(out.replaceAll("/", "\\")) || message.includes(out));
    await dialog.getByRole("button", { name: "OK", exact: true }).click();
    await dialog.waitFor({ state: "detached" }); return message;
  }
  function attach() {
    page.on("request", req => {
      if (req.url().includes("/api/novel/")) {
        const url = new URL(req.url());
        report.http.push({ event: "request", method: req.method(), path: url.pathname + url.search, at: Date.now() }); save();
      }
    });
    page.on("response", res => {
      if (res.url().includes("/api/novel/")) {
        const url = new URL(res.url());
        report.http.push({ event: "response", method: res.request().method(), path: url.pathname + url.search,
          status: res.status(), at: Date.now() }); save();
      }
    });
  }
  try {
    immutable(); provider = await controlledNovelFailureProvider(); report.endpoint = provider.url;
    started = true; await session.start(); page = session.page; attach();
    for (const input of prep.inputs) {
      const r = await fetch(`http://127.0.0.1:${session.current.ports[0]}/api/project/projects/import`, {
        method: "POST", headers: { "content-type": "application/octet-stream",
          "X-AgentVN-Filename": encodeURIComponent(path.basename(input.path)) }, body: fs.readFileSync(input.path) });
      assert(r.ok && (await r.json()).ok);
    }
    await session.api("/api/project/state", {
      provider_connections: [{ connection_id: "qa-novel-fault", provider_type: "openai_compatible",
        display_name: "本机小说异常受控", base_url: provider.url, api_key_storage: "local", enabled: true }],
      provider_models: [{ provider_id: "qa-novel-fault-model", connection_id: "qa-novel-fault",
        model_id: "controlled-novel-fault", model_name: "controlled-novel-fault", enabled: true,
        capabilities: ["text_generation"], default_parameters: { structured_mode: "json_object", request_timeout_seconds: 300 } }],
      provider_selections: { text_generation: "qa-novel-fault-model" }, provider_secrets: { "qa-novel-fault": "test-only-secret" },
    });
    await page.evaluate(({ a, b, out }) => localStorage.setItem("agentvn.projectExportDirectories.v1",
      JSON.stringify({ [a]: out, [b]: out })), { a: a.id, b: b.id, out });
    await page.reload(); report.initialA = await open(a);
    await step(stages[0], async () => {
      jobA = await submit("部分失败受控小说"); report.jobA = jobA;
      assert.equal((await request(0)).input.chapterIndex, 0); provider.release(0);
      assert.equal((await request(1)).input.chapterIndex, 1); provider.release(1, "failed");
      report.partial = await terminal(jobA, "failed_partial");
      assert.equal(report.partial.completedChunks, 1); assert.equal(report.partial.failedChunks, 1);
      assert.equal(report.partial.maxRetries, 0); assert.equal(provider.requests.length, 2);
      await visibleStatus("failed_partial");
      await phaseFact("failed-partial-before-any-import", 0, "blocked");
      await page.locator('[data-workspace-surface="options"]:visible').click(); await settleEditor(page);
      firstImport = await view(); report.firstImport = firstImport;
      assert.equal(imported(firstImport).length, 1);
      assert.equal(imported(firstImport)[0].data.editorMeta.sourceProcessChapterIndex, 0);
      assert.equal(firstImport.selected, imported(firstImport)[0].id);
      await phaseFact("first-of-two-chapters-written-and-validated", 50, "blocked");
      await session.shot("partial-result-imported");
      return { job: jobA, status: report.partial.status, chapter: 0, nodeId: imported(firstImport)[0].id, modelRequests: 2 };
    });
    await step(stages[1], async () => {
      const panel = await task(); await panel.locator('[data-help-key="novel.task.retry"]').click();
      assert.equal((await request(2)).input.chapterIndex, 1);
      await closeTask(); const before = await state(); await home(); const other = await open(b);
      assert.equal(other.processing.jobs.length, 0); assert.equal(other.cards.length, 0);
      provider.release(2, "failed"); report.lateFailure = await terminal(jobA, "failed_partial");
      const afterB = await state(); assert.deepEqual(afterB.nodes, other.nodes); assert.deepEqual(afterB.edges, other.edges);
      assert.deepEqual(afterB.errors, other.errors); assert.equal(afterB.cards.length, 0);
      assert(!JSON.stringify(afterB.persistence || {}).includes(jobA));
      await home(); const restored = await open(a); assert(restored.generation > before.generation);
      await visibleStatus("failed_partial");
      assert.deepEqual(imported(restored).map(n => n.id), imported(firstImport).map(n => n.id));
      const job = await session.api(route(jobA));
      assert(JSON.stringify(job).includes("CONTROLLED_CHAPTER_FAILURE_2"));
      assert.equal(provider.requests.length, 3); report.lateFailureB = afterB;
      return { retryChapter: 1, originalNode: imported(restored)[0].id, bUnchanged: true,
        generation: [before.generation, restored.generation], modelRequests: 3 };
    });
    await step(stages[2], async () => {
      const panel = await task(); await panel.locator('[data-help-key="novel.task.retry"]').click();
      assert.equal((await request(3)).input.chapterIndex, 1); provider.release(3);
      report.completed = await terminal(jobA, "completed"); await visibleStatus("completed"); await closeTask();
      await phaseFact("completed-generation-before-recovered-chapter-import", 50, "waiting");
      const appended = await view(), nodes = imported(appended);
      assert.equal(nodes.length, 2); assert.deepEqual(nodes.map(n => n.data.editorMeta.sourceProcessChapterIndex), [0, 1]);
      assert.equal(nodes[0].id, imported(firstImport)[0].id);
      assert.deepEqual(nodes[0].data.scene, imported(firstImport)[0].data.scene);
      assert.equal(nodes[0].data.editorMeta.importLineId, nodes[1].data.editorMeta.importLineId);
      for (const e of firstImport.edges) assert(appended.edges.some(v => v.id === e.id));
      assert(appended.edges.some(e => e.source === nodes[0].id && e.target === nodes[1].id), "Recovered chapter must join original import line");
      assert.equal(appended.selected, nodes[1].id);
      const again = await view(); assert.deepEqual(again.nodes.map(n => n.id), appended.nodes.map(n => n.id));
      assert.deepEqual(again.edges.map(e => e.id), appended.edges.map(e => e.id));
      assert.equal(provider.requests.length, 4); report.appended = again;
      await phaseFact("both-chapters-really-written-and-validated", 100, "completed");
      await session.shot("recovered-chapter-appended");
      return { nodes: nodes.map(n => n.id), line: nodes[0].data.editorMeta.importLineId, modelRequests: 4 };
    });
    await step(stages[3], async () => {
      await home(); report.initialB = await open(b);
      jobB = await submit("取消受控小说"); report.jobB = jobB;
      assert.equal((await request(4)).input.chapterIndex, 0);
      const panel = await task(); await panel.locator('[data-help-key="novel.task.cancel"]').click();
      const cancelled = await terminal(jobB, "cancelled"); assert.equal(cancelled.completedChunks, 0);
      assert.equal(cancelled.chunks.filter(c => c.status === "cancelled").length, 1, "Queued chapter must be cancelled immediately");
      await closeTask(); await home(); const beforeA = await open(a);
      provider.release(4);
      report.cancelled = await until(async () => {
        const j = await session.api(route(jobB)); return j.runningTasks === 0 && j;
      }, "cancelled in-flight task settles");
      assert.equal(report.cancelled.status, "cancelled"); assert.equal(report.cancelled.completedChunks, 0);
      assert.equal(report.cancelled.cancelledChunks, 2); assert.equal(provider.requests.length, 5);
      const results = await session.api(route(jobB, "/results")); assert.equal(results.completedResults.length, 0);
      const afterA = await state(); assert.deepEqual(afterA.nodes, beforeA.nodes); assert.deepEqual(afterA.edges, beforeA.edges);
      assert(!JSON.stringify(afterA.processing).includes(jobB)); report.cancelledResults = results;
      await home(); const bAfter = await open(b); await visibleStatus("cancelled");
      await phaseFact("cancelled-with-no-current-graph-nodes", 0, "cancelled");
      assert.deepEqual(bAfter.nodes.map(n => n.id), report.initialB.nodes.map(n => n.id));
      // Cancelled tasks deliberately retain "view completed results", including
      // when empty. The contract is truthful feedback + no graph mutation,
      // not hiding the action (which could prevent viewing partial results).
      const beforeEmptyView = await state(), p = await task();
      await p.locator('[data-help-key="novel.task.viewResult"]').click();
      await p.locator(".novel-task-action-message").filter({ hasText: "暂无可定位的本任务已完成节点" }).waitFor();
      const afterEmptyView = await state();
      assert.deepEqual(afterEmptyView.nodes, beforeEmptyView.nodes); assert.deepEqual(afterEmptyView.edges, beforeEmptyView.edges);
      assert.equal(await p.count(), 1, "Empty result must not pretend successful navigation");
      report.emptyView = { message: await p.locator(".novel-task-action-message").innerText(), graphUnchanged: true };
      await session.shot("cancelled-no-importable-results"); await closeTask();
      return { job: jobB, cancelledChunks: report.cancelled.cancelledChunks, results: results.completedResults.length,
        modelRequests: provider.requests.length, waitingChapterDispatched: false };
    });
    await step(stages[4], async () => {
      report.savedB = await saveUI(); await home(); await open(a); report.savedA = await saveUI();
      report.bundles = fs.readdirSync(out).filter(n => n.endsWith(".vnproj")).map(n => desc(path.join(out, n)));
      assert.equal(report.bundles.length, 2);
      await session.stop("intentional host/backend restart; exact-owned forced stop, not normal exit");
      await session.start(); page = session.page; attach();
      report.restartedA = await open(a); await visibleStatus("completed");
      await phaseFact("restarted-completed-project-recomputes-actual-graph", 100, "completed");
      assert.deepEqual(imported(report.restartedA).map(n => n.id), imported(report.appended).map(n => n.id));
      await home(); report.restartedB = await open(b); await visibleStatus("cancelled");
      await phaseFact("restarted-cancelled-project-does-not-inherit-a", 0, "cancelled");
      assert.equal(report.restartedB.nodes.filter(n => n.data.editorMeta?.sourceProcessJobId === jobB).length, 0);
      const finalA = await session.api(route(jobA)), finalB = await session.api(route(jobB));
      assert.equal(finalA.status, "completed"); assert.equal(finalB.status, "cancelled");
      assert.equal(provider.requests.length, 5);
      return { hostLaunches: report.launches.length, statuses: [finalA.status, finalB.status], modelRequests: 5 };
    });
    assert.equal(report.cases.length, stages.length); assert(report.cases.every(c => c.status === "PASS"));
    if (report.verifyGraphPhases) assert.equal(report.phaseFacts?.length, 7);
    assert.deepEqual(report.errors, []); report.status = "CURRENT_NATIVE_NOVEL_PARTIAL_PASS";
  } catch (e) {
    report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
    if (page) {
      report.failureState = await state().catch(e => ({ error: String(e) }));
      report.failureDOM = await page.locator("body").innerText().catch(String);
      await session.shot("failure").catch(e => { report.failureScreenshotError = String(e); });
    }
  } finally {
    if (started) {
      try { await session.api("/api/project/state", { provider_secrets: {} }); report.credentialCleanup = "CLEARED_TEST_ONLY_SECRET"; }
      catch (e) { report.credentialCleanupError = String(e); report.status = "FAILED"; process.exitCode = 1; }
      try { await session.stop("final exact-owned cleanup; not normal-close evidence"); }
      catch (e) { report.cleanupError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    }
    if (provider) {
      report.providerCleanup = await provider.stop(); report.modelBoundary = provider.requests; report.modelRequests = provider.requests.length;
    }
    try { immutable(); } catch (e) { report.immutabilityError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, cases: report.cases.map(c => ({ name: c.name, status: c.status })),
      requests: report.modelRequests, out, error: report.error }));
  }
}
if (require.main === module) (process.argv[2] === "prepare" ? Promise.resolve().then(prepare) : run(process.argv[2]))
  .catch(e => { console.error(e.stack || e); process.exitCode = 1; });
module.exports = { qa, checkpoint, summary, sources, stages };
