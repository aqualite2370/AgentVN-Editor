"use strict";
// Actual Dev user flow; only external model HTTP is locally controlled.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { nativeSession } = require("./lib/current-native-editor-session.cjs");
const { controlledDefaultNovelProvider } = require("./lib/controlled-novel-default-provider.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, ".."), label = "Native-Novel-Default-20261020-01";
const qa = `F:/AgentVN/QA/${label}`, checkpoint = `F:/AgentVN/Checkpoints/${label}`;
const summary = path.join(root, "output/native-novel-default-20261020-01");
const load = f => JSON.parse(fs.readFileSync(f, "utf8"));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(root, f), sha256: sha(path.resolve(root, f)) });
const sources = ["editor/src/store/novelImportStore.ts", "editor/src/components/novel-import/NovelImportWizard.tsx",
  "editor/src/novel-import/importToGraph.ts", "editor/src/novel-import/novelProcessGraphProgress.ts",
  "editor/src/novel-import/structureValidator.ts", "editor/src/novel-import/normalizeNovelSceneForRuntime.ts",
  "backend/app/services/novel_import_service.py", "backend/app/api/routes_novel_import.py", "backend/app/ai/provider.py",
  "scripts/lib/current-native-editor-session.cjs", "scripts/lib/controlled-novel-default-provider.cjs"];
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
  const p = load(fixture); p.project_id = "native-novel-default-20261020-01"; p.title = "默认全文链隔离_20261020";
  p.created_at = p.updated_at = new Date().toISOString(); delete p.editor_settings.novelPersistence;
  const input = path.join(qa, `${p.project_id}.vnproj`);
  fs.writeFileSync(input, JSON.stringify(p, null, 2), { flag: "wx" });
  const text = "第一章 雨后窗边\n雨停了，窗外的树叶轻轻摇动。\n远处的灯光逐渐明亮，屋内的时钟缓缓走动。";
  const novel = path.join(qa, "默认链小说.txt"); fs.writeFileSync(novel, text, { flag: "wx" });
  fs.writeFileSync(path.join(summary, "preparation.json"), JSON.stringify({
    at: new Date().toISOString(), input: { ...desc(input), id: p.project_id, title: p.title },
    novel: desc(novel), fixture: desc(fixture), copied, sources: sources.map(desc), products: products.map(desc),
  }, null, 2), { flag: "wx" });
  console.log(`PREPARED ${qa}`);
}
async function run(iteration) {
  assert(/^\d{2}$/.test(iteration));
  const out = path.join(qa, `session-${iteration}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const prep = load(path.join(summary, "preparation.json")), input = prep.input;
  const report = { at: new Date().toISOString(), status: "RUNNING",
    scope: "CURRENT_NATIVE_DEV_REAL_DEFAULT_WORKFLOW_LOOPBACK_MODEL_NOT_RELEASE_OR_PHYSICAL_INPUT",
    viewport: { width: 1920, height: 1080, dpr: 1, reduced: false },
    inputs: [input, prep.novel], sources: sources.map(desc), products: products.map(desc),
    cases: [], reads: [], http: [], launches: [], cleanups: [], screenshots: [], errors: [],
    modelRequests: 0, realModelRequests: 0, productChanges: 0,
    boundaries: ["No real model quality/charges; only external model HTTP controlled",
      "Source Python backend, not packaged Release creator-backend.exe",
      "1080p lifecycle scope, not motion/full display matrix",
      "Explicit test save-directory preference, not native selector evidence",
      "Exact-owned forced stop/restart is not normal-close acceptance",
      "No external Player/export consumption proof in this run"] };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  const session = nativeSession({ out, input: input.path, report, save });
  let page, provider, started = false;
  const immutable = () => {
    for (const f of [...report.inputs, ...report.sources, ...report.products]) assert.equal(sha(f.path), f.sha256, f.path);
  };
  async function state(record = true) {
    const s = await page.evaluate(async () => {
      const [{ useNovelImportStore }, { useEditorStore }, { useProjectStore }] = await Promise.all([
        import("/src/store/novelImportStore.ts"), import("/src/store/editorStore.ts"), import("/src/store/projectStore.ts")]);
      const n = useNovelImportStore.getState(), e = useEditorStore.getState(), p = useProjectStore.getState();
      return { projectId: p.projectId, generation: n.ownershipGeneration, session: n.session,
        processing: n.processing, progress: n.progress, job: n.importJob, busy: n.isProcessing,
        errors: n.errors, warnings: n.warnings, nodes: e.nodes, edges: e.edges, settings: p.settings };
    });
    if (record) { report.reads.push({ at: new Date().toISOString(), state: s }); save(); }
    return s;
  }
  async function step(name, fn) {
    const c = { name, status: "RUNNING", startedAt: new Date().toISOString() }; report.cases.push(c); save();
    console.log(`START ${name}`);
    try { c.detail = await fn(); c.status = "PASS"; console.log(`PASS ${name}`); }
    catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
    finally { c.finishedAt = new Date().toISOString(); save(); }
  }
  async function open() {
    await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: input.title }).click();
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
    assert.equal((await state()).projectId, input.id);
  }
  async function waitForState(predicate, label) {
    const end = Date.now() + 90000;
    while (Date.now() < end) {
      const s = await state(false);
      assert.equal(s.errors.length, 0, `${label}: ${JSON.stringify(s.errors)}`);
      assert(!provider.requests.some(r => r.error), JSON.stringify(provider.requests.filter(r => r.error)));
      if (predicate(s)) {
        report.reads.push({ at: new Date().toISOString(), state: s }); save(); return s;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw Error(`Timeout ${label}`);
  }
  try {
    immutable(); provider = await controlledDefaultNovelProvider(); report.endpoint = provider.url;
    started = true; page = await session.start();
    const imported = await fetch(`http://127.0.0.1:${session.current.ports[0]}/api/project/projects/import`, {
      method: "POST", headers: { "content-type": "application/octet-stream",
        "X-AgentVN-Filename": encodeURIComponent(path.basename(input.path)) }, body: fs.readFileSync(input.path) });
    assert(imported.ok && (await imported.json()).ok);
    await session.api("/api/project/state", {
      provider_connections: [{ connection_id: "qa-default", provider_type: "openai_compatible",
        display_name: "默认链本机受控", base_url: provider.url, api_key_storage: "local", enabled: true }],
      provider_models: [{ provider_id: "qa-default-model", connection_id: "qa-default", model_id: "qa-default",
        model_name: "qa-default", enabled: true, capabilities: ["text_generation"],
        default_parameters: { structured_mode: "json_object", request_timeout_seconds: 60 } }],
      provider_selections: { text_generation: "qa-default-model" }, provider_secrets: { "qa-default": "test-only-secret" },
    });
    await page.evaluate(({ id, out }) => localStorage.setItem("agentvn.projectExportDirectories.v1",
      JSON.stringify({ [id]: out })), { id: input.id, out });
    await page.reload(); await open(); report.initial = await state();
    page.on("request", req => {
      if (req.url().includes("/api/novel/")) report.http.push({
        at: new Date().toISOString(), method: req.method(), path: new URL(req.url()).pathname });
    });
    let w;
    await step("top-entry-direct-import-no-implicit-executor-job", async () => {
      await page.locator('[data-help-key="toolbar.novelImport"]').click();
      w = page.getByTestId("novel-import-workbench"); await w.waitFor();
      await w.locator('[data-help-key="novel.importFile"] input').setInputFiles(prep.novel.path);
      await w.getByRole("region", { name: "小说文件导入检测" }).waitFor();
      await w.locator('[data-help-key="novel.continueDirect"]').click();
      const start = w.locator('[data-help-key="novel.aiStart"]'); await start.waitFor();
      assert(await start.isEnabled()); const before = await state();
      assert.equal(before.processing.jobs.length, 0); assert.equal(provider.requests.length, 0);
      assert.equal(before.session.document.normalized_text.trim(), fs.readFileSync(prep.novel.path, "utf8").trim());
      return { chars: before.session.document.total_chars, session: before.session.session_id, modelRequests: 0 };
    });
    await step("real-scan-and-outline-stop-before-author-confirmation", async () => {
      await w.locator('[data-help-key="novel.aiStart"]').click();
      await waitForState(s => s.session.ai_stage === "outline" && !s.busy, "scan and outline actual completion");
      const confirm = w.locator('[data-help-key="novel.confirmOutline"]'); await confirm.waitFor();
      const s = await state(); assert(s.session.ai_outline);
      assert.equal(s.session.ai_chunk_analyses.length, 1); assert.equal(s.session.chapters.length, 1);
      assert.deepEqual(s.nodes, report.initial.nodes); assert.deepEqual(s.edges, report.initial.edges);
      const stages = provider.requests.map(r => r.stage);
      for (const stage of ["scan-summary", "scan-entities", "scan-timeline", "outline-mainline", "outline-structure", "outline-index"])
        assert.equal(stages.filter(v => v === stage).length, 1, stage);
      assert.equal(stages.length, 6); await session.shot("outline-awaits-author");
      report.outline = s;
      return { stages, unchangedGraph: true, outline: s.session.ai_outline };
    });
    await step("author-confirms-plan-adapt-validate-and-write-current-graph", async () => {
      await w.locator('[data-help-key="novel.confirmOutline"]').click();
      const s = await waitForState(v => v.session.ai_stage === "report" && !v.busy, "actual default blueprint write");
      assert.equal(s.job.status, "completed"); assert.equal(s.session.adapted_scenes.length, 1);
      assert.equal(s.session.scenes.length, 1); assert(s.session.quality_report.score >= s.session.quality_report.threshold);
      assert.equal(s.session.quality_report.blocking_issues.length, 0);
      const nodes = s.nodes.filter(n => n.data.editorMeta?.importSessionId === s.session.session_id);
      assert.equal(nodes.length, 1); assert(nodes[0].data.scene.commands.some(c => c.type === "narration" && c.text.includes("屋内的时钟")));
      for (const n of report.initial.nodes) assert(s.nodes.some(v => v.id === n.id), n.id);
      for (const e of report.initial.edges) assert(s.edges.some(v => v.id === e.id), e.id);
      assert(s.session.validation_reports.length > 0);
      assert(s.session.validation_reports.every(r => r.errors.length === 0), JSON.stringify(s.session.validation_reports));
      const stages = provider.requests.map(r => r.stage);
      for (const stage of ["scene-plan", "planning-conflicts", "planning-branches",
        "public-notes", "scene-beat", "adaptation-conflicts", "adaptation-branches"])
        assert.equal(stages.filter(v => v === stage).length, 1, stage);
      assert.equal(stages.length, 13); report.completed = s; await session.shot("default-blueprint-report");
      return { node: nodes[0].id, generated: s.job.generatedCount, quality: s.session.quality_report, stages };
    });
    await step("native-save-restart-restores-default-chain-without-model-replay", async () => {
      await page.locator('[data-help-key="toolbar.novelImport.closeWorkbench"]').click();
      await w.waitFor({ state: "detached" }); await settleEditor(page);
      await page.locator('[data-help-key="toolbar.saveProject"]').click();
      const dialog = page.getByTestId("project-save-confirmation"); await dialog.waitFor();
      const message = await dialog.innerText(); assert(message.includes(out.replaceAll("/", "\\")) || message.includes(out));
      await dialog.getByRole("button", { name: "OK", exact: true }).click(); await dialog.waitFor({ state: "detached" });
      report.bundles = fs.readdirSync(out).filter(f => f.endsWith(".vnproj")).map(f => desc(path.join(out, f)));
      assert.equal(report.bundles.length, 1); report.persisted = (await session.api(`/api/project/projects/${input.id}`)).data;
      const count = provider.requests.length;
      await session.stop("intentional exact-owned host/backend restart, not normal close");
      page = await session.start(); await open();
      const s = await state(); assert.equal(provider.requests.length, count);
      assert.equal(s.session.session_id, report.completed.session.session_id);
      assert.equal(s.session.adapted_scenes.length, 1);
      assert.deepEqual(s.nodes.map(n => n.id), report.completed.nodes.map(n => n.id));
      assert.deepEqual(s.edges.map(e => e.id), report.completed.edges.map(e => e.id));
      assert.deepEqual(s.nodes.map(n => n.data.scene), report.completed.nodes.map(n => n.data.scene));
      await page.locator('[data-help-key="toolbar.novelImport"]').click();
      await page.locator(".novel-import-report-panel").waitFor(); await session.shot("default-restarted-report");
      report.restored = s; return { message, bundles: report.bundles, modelRequests: count, hostLaunches: report.launches.length };
    });
    assert.equal(report.cases.length, 4); assert(report.cases.every(c => c.status === "PASS"));
    assert.deepEqual(report.errors, []); report.status = "CURRENT_NATIVE_NOVEL_DEFAULT_PASS";
  } catch (e) {
    report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
    if (page) {
      report.failureState = await state().catch(e => ({ error: String(e) }));
      report.failureDOM = await page.locator("body").innerText().catch(String);
      await session.shot("failure").catch(e => { report.failureShotError = String(e); });
    }
  } finally {
    if (started) {
      try { await session.api("/api/project/state", { provider_secrets: {} }); report.credentialCleanup = "CLEARED_TEST_ONLY_SECRET"; }
      catch (e) { report.credentialCleanupError = String(e); report.status = "FAILED"; process.exitCode = 1; }
      try { await session.stop("final exact-owned cleanup, not normal-close evidence"); }
      catch (e) { report.cleanupError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    }
    if (provider) { report.providerCleanup = await provider.stop(); report.modelBoundary = provider.requests; report.modelRequests = provider.requests.length; }
    try { immutable(); } catch (e) { report.immutabilityError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, cases: report.cases.map(c => ({ name: c.name, status: c.status })),
      modelRequests: report.modelRequests, error: report.error, out }));
  }
}
if (require.main === module) (process.argv[2] === "prepare" ? Promise.resolve().then(prepare) : run(process.argv[2]))
  .catch(e => { console.error(e.stack || e); process.exitCode = 1; });
module.exports = { qa, checkpoint, summary, sources };
