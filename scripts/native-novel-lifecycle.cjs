"use strict";
// Actual current Dev/WebView + backend executor/SQLite. Model HTTP only is controlled.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { nativeSession, until } = require("./lib/current-native-editor-session.cjs");
const { controlledNovelProvider } = require("./lib/controlled-novel-provider.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, ".."), label = "Native-Novel-Lifecycle-20261020-01";
const qa = `F:/AgentVN/QA/${label}`, checkpoint = `F:/AgentVN/Checkpoints/${label}`;
const summary = path.join(root, "output/native-novel-lifecycle-20261020-01");
const load = f => JSON.parse(fs.readFileSync(f, "utf8"));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(root, f), sha256: sha(path.resolve(root, f)) });
const writeNew = (f, value) => fs.writeFileSync(f, JSON.stringify(value, null, 2), { flag: "wx" });
const sources = ["editor/src/store/novelImportStore.ts",
  "editor/src/components/novel-import/NovelImportWizard.tsx",
  "editor/src/components/novel-import/NovelProcessTaskWorkbench.tsx",
  "backend/app/services/novel_process_service.py", "backend/app/ai/provider.py",
  "scripts/lib/current-native-editor-session.cjs", "scripts/lib/controlled-novel-provider.cjs"];
const products = ["AgentVN Dev.exe", "editor/src-tauri/target/debug/agentvn-editor.exe"];
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
    const p = load(fixture); p.project_id = `native-novel-${letter}-20261020-01`;
    p.title = `小说生命周期隔离${letter.toUpperCase()}_20261020`;
    p.created_at = p.updated_at = new Date().toISOString();
    delete p.editor_settings.novelPersistence;
    const input = path.join(qa, `${p.project_id}.vnproj`); writeNew(input, p);
    return { ...desc(input), id: p.project_id, title: p.title };
  });
  writeNew(path.join(summary, "preparation.json"), { at: new Date().toISOString(), inputs,
    fixture: desc(fixture), copied, products: products.map(desc), sources: sources.map(desc) });
  console.log(`PREPARED ${qa}`);
}
async function run(iteration) {
  assert(/^\d{2}$/.test(iteration));
  const out = path.join(qa, `session-${iteration}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const prep = load(path.join(summary, "preparation.json")), [a, b] = prep.inputs;
  const report = { status: "RUNNING", at: new Date().toISOString(),
    scope: "CURRENT_NATIVE_DEV_CONTROLLED_MODEL_REAL_EXECUTOR_NOT_RELEASE_OR_DEEPSEEK",
    viewport: { width: 1920, height: 1080, dpr: 1, reduced: false },
    cases: [], launches: [], screenshots: [], cleanups: [], errors: [], http: [], reads: [],
    inputs: prep.inputs, sources: sources.map(desc), products: products.map(desc),
    modelRequests: 0, realModelRequests: 0, productChanges: 0, devPublicationBuilds: 0,
    boundaries: ["CDP user actions, not physical mouse/keyboard", "Loopback model, not real AI quality",
      "Dev starts source Python backend and Vite, not packaged Release backend",
      "Single 1080p lifecycle scope, not full geometry/motion matrix",
      "Explicit local save-directory fixture, not native folder-selector evidence",
      "Exact-owned forced cleanup, not normal native close",
      "Default scan/outline workflow, late error, retry/cancel and player consumption remain separate"] };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  const session = nativeSession({ out, input: a.path, report, save });
  let page, provider, started = false, jobId;
  const jobApi = suffix => `/api/novel/processing/execute/jobs/${jobId}${suffix || ""}`;
  function immutable() {
    for (const f of [...report.inputs, ...report.sources, ...report.products]) assert.equal(sha(f.path), f.sha256);
  }
  async function step(name, fn) {
    const c = { name, status: "RUNNING", startedAt: new Date().toISOString() };
    report.cases.push(c); save(); console.log(`START ${name}`);
    try { c.detail = await fn(); c.status = "PASS"; console.log(`PASS ${name}`); }
    catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
    finally { c.finishedAt = new Date().toISOString(); save(); }
  }
  async function state() {
    const s = await page.evaluate(async () => {
      const [{ useNovelImportStore }, { useProjectStore }, { useEditorStore }] = await Promise.all([
        import("/src/store/novelImportStore.ts"), import("/src/store/projectStore.ts"), import("/src/store/editorStore.ts")]);
      const n = useNovelImportStore.getState(), p = useProjectStore.getState(), e = useEditorStore.getState();
      return { projectId: p.projectId, generation: n.ownershipGeneration, sessionId: n.session.session_id,
        pending: Boolean(n.pendingImport), processing: n.processing, errors: n.errors, warnings: n.warnings,
        nodes: e.nodes, edges: e.edges, selectedNodeId: e.selectedNodeId, dirty: e.dirty,
        persistence: p.settings.novelPersistence,
        card: [...document.querySelectorAll('[data-testid="novel-task-mini-entry"]')].map(node => ({
          project: node.dataset.projectId, status: node.dataset.jobStatus, text: node.textContent,
          ready: node.dataset.ready, suppressed: node.dataset.suppressed })),
        workbench: document.querySelector('[data-testid="novel-task-workbench"]')?.textContent };
    });
    report.reads.push({ at: new Date().toISOString(), state: s }); save(); return s;
  }
  async function openProject(input) {
    await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: input.title }).click();
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
    await page.waitForFunction(id => window.__AGENTVN_NOVEL_IMPORT_STORE__ &&
      document.querySelector(".editor-toolbar") && document.querySelector(".flow-surface"), input.id);
    const actual = await state(); assert.equal(actual.projectId, input.id); return actual;
  }
  async function home() {
    const button = page.locator('[data-help-key="toolbar.home"]');
    await button.click(); await page.locator(".project-home").waitFor(); await settleEditor(page);
  }
  async function wizard() {
    await page.locator('[data-help-key="toolbar.novelImport"]').click();
    const w = page.getByTestId("novel-import-workbench"); await w.waitFor(); return w;
  }
  async function closeWizard() {
    await page.locator('[data-help-key="toolbar.novelImport.closeWorkbench"]').click();
    await page.getByTestId("novel-import-workbench").waitFor({ state: "detached" }); await settleEditor(page);
  }
  async function task() {
    await page.getByTestId("novel-task-mini-entry").getByRole("button", { name: /^打开小说任务面板/ }).click();
    const panel = page.getByTestId("novel-task-workbench"); await panel.waitFor(); return panel;
  }
  async function closeTask() {
    await page.locator('[data-help-key="novel.task.closePanel"]').click();
    await page.getByTestId("novel-task-workbench").waitFor({ state: "detached" });
  }
  async function saveUI() {
    await page.locator('[data-help-key="toolbar.saveProject"]').click();
    const dialog = page.getByTestId("project-save-confirmation");
    await dialog.waitFor(); const message = await dialog.innerText();
    assert(message.includes(out.replaceAll("/", "\\")) || message.includes(out), "Bundle must use isolated directory");
    await dialog.getByRole("button", { name: "OK", exact: true }).click();
    await dialog.waitFor({ state: "detached" }); return message;
  }
  try {
    immutable(); provider = await controlledNovelProvider(); report.endpoint = provider.url;
    started = true; await session.start(); page = session.page;
    const attach = () => {
      page.on("request", req => {
        if (req.url().includes("/api/novel/")) {
          const url = new URL(req.url());
          report.http.push({ event: "request", at: Date.now(), method: req.method(), path: url.pathname + url.search });
        }
      });
      page.on("response", res => {
        if (res.url().includes("/api/novel/")) {
          const url = new URL(res.url());
          report.http.push({ event: "response", at: Date.now(), method: res.request().method(),
            path: url.pathname + url.search, status: res.status() }); save();
        }
      });
    };
    attach();
    for (const input of prep.inputs) {
      const r = await fetch(`http://127.0.0.1:${session.current.ports[0]}/api/project/projects/import`, {
        method: "POST", headers: { "content-type": "application/octet-stream",
          "X-AgentVN-Filename": encodeURIComponent(path.basename(input.path)) }, body: fs.readFileSync(input.path) });
      assert(r.ok && (await r.json()).ok);
    }
    await session.api("/api/project/state", {
      provider_connections: [{ connection_id: "qa-novel", provider_type: "openai_compatible", display_name: "本机小说受控",
        base_url: provider.url, api_key_storage: "local", enabled: true }],
      provider_models: [{ provider_id: "qa-novel-model", connection_id: "qa-novel", model_id: "controlled-novel",
        model_name: "controlled-novel", enabled: true, capabilities: ["text_generation"],
        default_parameters: { structured_mode: "json_object", request_timeout_seconds: 300 } }],
      provider_selections: { text_generation: "qa-novel-model" }, provider_secrets: { "qa-novel": "test-only-secret" },
    });
    // Explicit test preference, before store initialization, isolates all native portable saves.
    await page.evaluate(({ a, b, out }) => localStorage.setItem("agentvn.projectExportDirectories.v1",
      JSON.stringify({ [a]: out, [b]: out })), { a: a.id, b: b.id, out });
    await page.reload(); const initial = await openProject(a); report.baseline = initial;
    await step("real-entry-preflight-cancel-without-fake-task", async () => {
      assert.equal(initial.processing.jobs.length, 0); assert.equal(initial.card.length, 0);
      const w = await wizard();
      await w.locator('[data-help-key="novel.importFile"] input').setInputFiles({
        name: "只预检不提交.txt", mimeType: "text/plain", buffer: Buffer.from("第一章 雨后\n雨后，窗外的树叶轻轻摇动。\n") });
      await w.getByRole("region", { name: "小说文件导入检测" }).waitFor();
      const pending = await state(); assert(pending.pending);
      await w.locator('[data-help-key="novel.cancelImport"]').click();
      await closeWizard(); const after = await state();
      assert(!after.pending); assert.equal(after.processing.jobs.length, 0); assert.equal(after.card.length, 0);
      assert.equal(provider.requests.length, 0);
      assert.equal(report.http.filter(r => r.event === "request" && r.method === "POST").length, 0);
      return { pending: pending.pending, after: after.pending, modelRequests: provider.requests.length };
    });
    await step("real-chapter-selection-submit-held-executor", async () => {
      const w = await wizard();
      await w.locator('[data-help-key="novel.importFile"] input').setInputFiles({
        name: "生命周期受控小说.txt", mimeType: "text/plain",
        buffer: Buffer.from("第一章 雨后窗边\n" + "雨停了，窗外的树叶轻轻摇动。房间中只有风声。\n".repeat(32)) });
      await w.getByRole("region", { name: "小说文件导入检测" }).waitFor();
      await w.locator('[data-help-key="novel.startChapterSplit"]').click();
      await w.getByRole("heading", { name: "选择要处理的章节" }).waitFor();
      const selectors = w.locator('.novel-chapter-table input[type="checkbox"]');
      assert.equal(await selectors.count(), 1, "Fixture must produce one complete chapter");
      await w.locator('[data-help-key="novel.selectAllChapters"]').click();
      await w.locator(".novel-processing-advanced summary").click();
      await w.locator('[data-help-key="novel.process.maxConcurrency"]').fill("1");
      await w.locator('[data-help-key="novel.process.maxRetryCount"]').fill("0");
      await w.getByTestId("novel-create-process-job").click();
      await until(() => provider.requests.length === 1 && provider.requests[0].input, "held real model request", 60000);
      const s = await until(async () => { const v = await state(); return v.processing.activeJobId && v; }, "published job");
      jobId = s.processing.activeJobId; report.jobId = jobId;
      const actual = await session.api(jobApi());
      assert.equal(actual.status, "running"); assert.equal(actual.maxRetries, 0);
      assert.equal(actual.chunks.length, 1); assert(!provider.requests[0].released);
      await closeWizard();
      await page.getByTestId("novel-task-mini-entry").waitFor();
      return { jobId, status: actual.status, model: provider.requests[0].requestedModel, chunks: actual.chunks.length };
    });
    await step("pause-resume-real-backend-without-duplicate-submission", async () => {
      const panel = await task();
      await panel.locator('[data-help-key="novel.task.pause"]').click();
      await until(async () => (await session.api(jobApi())).status === "paused", "real paused state");
      await panel.locator('[data-help-key="novel.task.resume"]').click();
      await until(async () => (await session.api(jobApi())).status === "running", "real resumed state");
      assert.equal(provider.requests.length, 1); assert(!provider.requests[0].released);
      const s = await state(); assert(s.workbench.includes("处理中"));
      await session.shot("held-real-executor");
      await closeTask(); return { modelRequests: provider.requests.length, state: "running" };
    });
    await step("a-b-a-late-success-keeps-graph-and-task-ownership", async () => {
      const before = await state(); await home(); const other = await openProject(b);
      assert.equal(other.processing.jobs.length, 0); assert.equal(other.card.length, 0);
      assert.deepEqual(other.nodes.map(n => n.id), load(b.path).nodes.map(n => n.id));
      provider.release(0);
      const completed = await until(async () => {
        const job = await session.api(jobApi()); return ["completed", "failed", "failed_partial"].includes(job.status) && job;
      }, "real executor terminal", 60000);
      report.completedJob = completed; assert.equal(completed.status, "completed", JSON.stringify(completed));
      const bAfter = await state(); assert.equal(bAfter.projectId, b.id);
      assert.equal(bAfter.processing.jobs.length, 0); assert.equal(bAfter.card.length, 0);
      assert.deepEqual(bAfter.nodes, other.nodes); assert.deepEqual(bAfter.edges, other.edges);
      assert(!JSON.stringify(bAfter.persistence || {}).includes(jobId));
      await home(); const returned = await openProject(a);
      assert(returned.generation > before.generation);
      await until(async () => { const s = await state(); return s.card.some(c => c.status === "completed"); }, "restored completed task");
      assert.equal(provider.requests.length, 1);
      const results = await session.api(jobApi("/results")); report.results = results;
      assert.equal(results.completedChapterResults.length, 1);
      assert(results.completedChapterResults[0].scene.commands.some(c => c.text?.includes("受控章节正文_0_0")));
      return { beforeGeneration: before.generation, afterGeneration: returned.generation,
        bUnchanged: true, completed: completed.status, results: results.completedChapterResults.length };
    });
    await step("view-results-from-options-real-edit-focus-and-idempotence", async () => {
      await page.locator('[data-workspace-surface="options"]:visible').click(); await settleEditor(page);
      const panel = await task(); await panel.locator('[data-help-key="novel.task.viewResult"]').click();
      await panel.waitFor({ state: "detached" });
      await page.locator('[data-workspace-surface="edit"][aria-current="page"]').waitFor(); await settleEditor(page);
      const imported = await state();
      const nodes = imported.nodes.filter(n => n.data.editorMeta?.sourceProcessJobId === jobId);
      assert.equal(nodes.length, 1); assert.equal(imported.selectedNodeId, nodes[0].id);
      for (const n of initial.nodes) assert(imported.nodes.some(v => v.id === n.id), `Original node ${n.id} lost`);
      for (const e of initial.edges) assert(imported.edges.some(v => v.id === e.id), `Original edge ${e.id} lost`);
      const located = await page.locator(`.react-flow__node[data-id="${nodes[0].id}"]`).evaluate(n => {
        const r = n.getBoundingClientRect(), flow = n.closest(".react-flow").getBoundingClientRect();
        return { r: r.toJSON(), flow: flow.toJSON(), selected: n.classList.contains("selected"),
          hit: n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(25, r.height / 2))) };
      });
      assert(located.selected && located.hit && located.r.right > located.flow.left &&
        located.r.left < located.flow.right && located.r.bottom > located.flow.top && located.r.top < located.flow.bottom);
      const again = await task(); await again.locator('[data-help-key="novel.task.viewResult"]').click();
      await again.waitFor({ state: "detached" }); const after = await state();
      assert.deepEqual(after.nodes.map(n => n.id), imported.nodes.map(n => n.id));
      assert.deepEqual(after.edges.map(e => e.id), imported.edges.map(e => e.id));
      assert.equal(provider.requests.length, 1);
      report.imported = imported; report.located = located; await session.shot("imported-result-focused");
      return { nodeId: nodes[0].id, unique: nodes.length, selected: after.selectedNodeId, located };
    });
    await step("native-portable-save-real-backend-and-host-restart", async () => {
      const message = await saveUI();
      const persisted = (await session.api(`/api/project/projects/${a.id}`)).data;
      assert(persisted.nodes.some(n => n.data.editorMeta?.sourceProcessJobId === jobId));
      assert(JSON.stringify(persisted.editor_settings.novelPersistence).includes(jobId));
      const bundles = fs.readdirSync(out).filter(n => n.endsWith(".vnproj")).map(n => desc(path.join(out, n)));
      assert.equal(bundles.length, 1); report.bundles = bundles; report.persisted = persisted;
      await session.stop("intentional host/backend restart for persistence; exact-owned forced stop");
      await session.start(); page = session.page; attach();
      await openProject(a);
      await until(async () => { const s = await state(); return s.card.some(c => c.status === "completed"); }, "restart restored task");
      const restored = await state(), job = await session.api(jobApi());
      assert.equal(job.status, "completed");
      assert.deepEqual(restored.nodes.map(n => n.id), report.imported.nodes.map(n => n.id));
      assert.deepEqual(restored.edges.map(e => e.id), report.imported.edges.map(e => e.id));
      const panel = await task(); await panel.locator('[data-help-key="novel.task.viewResult"]').click();
      await panel.waitFor({ state: "detached" });
      const after = await state(); assert.equal(after.nodes.filter(n => n.data.editorMeta?.sourceProcessJobId === jobId).length, 1);
      assert.equal(provider.requests.length, 1, "Restart/view must not re-run model task");
      await session.shot("restarted-task-and-graph"); report.restored = after;
      return { message, bundles, hostLaunches: report.launches.length, status: job.status, modelRequests: provider.requests.length };
    });
    assert.equal(report.cases.length, 6); assert(report.cases.every(c => c.status === "PASS"));
    assert.deepEqual(report.errors, []);
    report.status = "CURRENT_NATIVE_NOVEL_LIFECYCLE_PASS";
  } catch (e) {
    report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
    if (page) {
      report.failureState = await state().catch(error => ({ error: String(error) }));
      report.failureDOM = await page.locator("body").innerText().catch(String);
      await session.shot("failure").catch(error => { report.failureScreenshotError = String(error); });
    }
  } finally {
    if (started) {
      try { await session.api("/api/project/state", { provider_secrets: {} }); report.credentialCleanup = "CLEARED_TEST_ONLY_SECRET"; }
      catch (e) { report.credentialCleanupError = String(e); report.status = "FAILED"; process.exitCode = 1; }
      try { await session.stop("final exact-owned cleanup; not normal-close evidence"); }
      catch (e) { report.cleanupError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    }
    if (provider) {
      report.providerCleanup = await provider.stop(); report.modelBoundary = provider.requests;
      report.modelRequests = provider.requests.length;
    }
    try { immutable(); } catch (e) { report.immutabilityError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, cases: report.cases.map(c => ({ name: c.name, status: c.status })),
      modelRequests: report.modelRequests, out, error: report.error }));
  }
}
if (require.main === module) (process.argv[2] === "prepare" ? Promise.resolve().then(prepare) : run(process.argv[2]))
  .catch(e => { console.error(e.stack || e); process.exitCode = 1; });
module.exports = { qa, checkpoint, summary, sources };
