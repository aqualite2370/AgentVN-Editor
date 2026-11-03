"use strict";
// Actual sealed NSIS Editor + packaged backend. Only external model HTTP is controlled.
// No frontend source imports, task API fixtures, store mutations or user credentials.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const JSZip = require("../editor/node_modules/jszip");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { controlledDefaultNovelProvider } = require("./lib/controlled-novel-default-provider.cjs");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const candidateArg = process.argv.find(value => value.startsWith("--candidate="));
const currentCandidate = Boolean(candidateArg);
const expectedVersion = candidateArg ? candidateArg.slice("--candidate=".length) : "1.9.22";
const argumentValue = name => {
  const prefix = `--${name}=`;
  const value = process.argv.find(candidate => candidate.startsWith(prefix));
  return value ? value.slice(prefix.length) : undefined;
};
const root = path.resolve(__dirname, "..");
const label = currentCandidate
  ? `Installed-Novel-Default-${expectedVersion.replace(/\./g, "")}-current`
  : "Installed-Novel-Default-1922-20261022-01";
const qa = path.resolve(argumentValue("qa-root") || `F:/AgentVN/QA/${label}`);
const checkpoint = path.resolve(argumentValue("checkpoint-root") || `F:/AgentVN/Checkpoints/${label}`);
const installationFile = path.resolve(argumentValue("installation-file") ||
  "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json");
const baselineFile = argumentValue("baseline-file") ? path.resolve(argumentValue("baseline-file")) : undefined;
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const modelStages = ["scan-summary", "scan-entities", "scan-timeline", "outline-mainline", "outline-structure",
  "outline-index", "scene-plan", "planning-conflicts", "planning-branches", "public-notes", "scene-beat",
  "adaptation-conflicts", "adaptation-branches"];
const stages = ["real-file-import-awaits-explicit-analysis-without-model-request",
  "packaged-backend-scan-outline-await-author-with-unchanged-graph",
  "author-confirmation-plans-adapts-validates-and-writes-real-project",
  "native-package-and-actual-host-restart-restore-without-model-replay"];
const defaultPort = process.argv.includes("--default-port");
const resumeArgument = process.argv.find(a => a.startsWith("--resume-default="));
const resumeId = resumeArgument?.split("=")[1];
if (resumeArgument) assert(defaultPort && /^\d{2}$/.test(resumeId));
const tools = [__filename, "scripts/lib/installed-release-session.cjs", "scripts/lib/controlled-novel-default-provider.cjs",
  "scripts/lib/current-native-capture.cjs", "scripts/installed-layout-cache-session.ps1"];
const sources = ["editor/src/store/novelImportStore.ts", "editor/src/novel-import/adaptationClient.ts",
  "editor/src/novel-import/persistence.ts", "editor/src/components/novel-import/NovelImportWizard.tsx",
  "backend/app/api/routes_novel_import.py", "backend/app/services/novel_import_service.py"];
async function run(attempt) {
  assert.match(attempt, /^\d{2}$/); const out = path.join(qa, `session-${attempt}`);
  assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
  const cp = path.join(checkpoint, `session-${attempt}`); assert(!fs.existsSync(cp)); fs.mkdirSync(cp, { recursive: true });
  const parentFile = resumeId && path.join(qa, `session-${resumeId}`, "report.json");
  const parent = parentFile && read(parentFile);
  if (parent) {
    assert.equal(parent.status, "FAILED"); assert.equal(parent.cases.length, 3);
    assert(parent.cases.slice(0, 2).every(c => c.status === "PASS"));
    assert.equal(parent.cases[2].name, stages[2]); assert.equal(parent.modelRequests, 13);
    assert.match(parent.error, /0 !== 1/);
    assert.equal(parent.failureState.session.ai_stage, "report");
    assert.equal(parent.failureState.job.status, "completed"); assert.equal(sha(parent.finalDatabase.path), parent.finalDatabase.sha256);
  }
  const project = parent ? read(parent.inputs[0].path)
    : fixture(`qa-installed-novel-default-${expectedVersion.replace(/\./g, "")}-${attempt}`);
  if (!parent) project.title = `真实默认小说链隔离 ${expectedVersion} ${attempt}`;
  const input = path.join(out, "隔离默认小说.vnproj"), novel = path.join(out, "雨后窗边.txt");
  fs.writeFileSync(input, JSON.stringify(project, null, 2), { flag: "wx" });
  fs.writeFileSync(novel, "第一章 雨后窗边\n雨停了，窗外的树叶轻轻摇动。\n远处的灯光逐渐明亮，屋内的时钟缓缓走动。", { flag: "wx" });
  process.env.AGENTVN_TEST_PROJECT = input; process.env.AGENTVN_WORKSPACE_OUTPUT = out;
  const install = read(installationFile); assert.equal(install.version, expectedVersion);
  const baseline = baselineFile ? read(baselineFile) : undefined;
  const report = { status: "RUNNING", version: expectedVersion, startedAt: new Date().toISOString(),
    scope: "ACTUAL_NSIS_PACKAGED_BACKEND_DEFAULT_NOVEL_WORKFLOW_LOOPBACK_MODEL",
    backendPortMode: defaultPort ? "EXPLICIT_8278_DIFFERENTIAL_NOT_PRODUCT_FIX" : "OWNED_DYNAMIC_PORT",
    cases: [], launches: [], cleanups: [], errors: [], screenshots: [], reads: [], http: [], allowedModelRequests: [],
    blockedNovelWrites: [], blockedModelRequests: 0, realModelRequests: 0, productChanges: 0, network: [], sockets: [], console: [],
    tools: tools.map(f => desc(path.resolve(root, f))), sources: sources.map(f => desc(path.resolve(root, f))),
    protectedFiles: baseline ? baseline.cases.find(c => c.name === "protected-file-baseline").detail : [],
    installation: desc(installationFile), inputs: [desc(input), desc(novel)],
    environment: { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out },
    modelBudget: 13, displayScope: "1080p DPR1 normal; separate existing floating matrix is not repeated",
    boundaries: ["Loopback model transport, not DeepSeek quality or charges", "CDP DOM input, not physical input",
      "Normal default scan/outline authoring, not executor-job controls", "API fixture and local save-directory setup",
      "Native package writes; forced owned host restart is not normal close", "No independent Windows/Android upgrade"] };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  if (parent) {
    report.continuation = { path: parentFile, sha256: sha(parentFile), originalFailurePreserved: true,
      reason: "Original13 model calls completed; wait for actual persisted node before inspecting and continue save/restart without new model calls.",
      additionalModelCalls: 0 };
    report.inheritedKnownProcesses = parent.knownProcesses;
    for (const key of ["initial", "outline", "launches", "cleanups", "reads", "http", "network", "sockets"])
      report[key] = structuredClone(parent[key]);
    report.cases = parent.cases.slice(0, 2).map(c => ({ ...structuredClone(c), inheritedFrom: report.continuation }));
    report.screenshots = parent.screenshots.filter(s => !s.path.endsWith("failure.png"));
    for (const n of ["data", "webview"]) fs.cpSync(path.join(path.dirname(parentFile), n), path.join(out, n),
      { recursive: true, force: false, errorOnExist: true });
    assert.equal(sha(path.join(out, "data/backend/vn_engine.db")), parent.finalDatabase.sha256);
  }
  for (const f of [...report.tools, ...report.sources, desc(path.join(root, "plans/ACTIVE_TASKS.md")),
    desc(path.join(root, "plans/FULL_REGRESSION_20261017.md"))]) {
    const target = path.join(cp, path.relative(root, f.path));
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(f.path, target, fs.constants.COPYFILE_EXCL);
    (report.checkpoint ??= []).push({ ...f, copy: target });
  }
  const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(git.status, 0); report.git = { head: git.stdout.trim(), index: desc(path.join(root, ".git/index")) }; save();
  const immutable = () => {
    for (const f of [...report.tools, ...report.sources, ...report.protectedFiles, ...report.inputs])
      assert.equal(sha(f.path), f.sha256, f.path);
    assert.equal(sha(report.git.index.path), report.git.index.sha256);
  };
  function cache(action) {
    const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", action,
      "-RunDirectory", out, "-AllowedRunRoot", qa, "-CodexCacheView"],
    { encoding: "utf8", windowsHide: true, timeout: 45000 });
    (report.cache ??= []).push({ action, exitCode: r.status, stdout: r.stdout, stderr: r.stderr }); save();
    assert.equal(r.status, 0, r.stdout + r.stderr);
  }
  async function step(name, fn) {
    const inherited = report.cases.find(c => c.name === name && c.inheritedFrom);
    if (inherited) { console.log(`REUSE verified ${name}`); return; }
    const c = { name, status: "RUNNING", startedAt: new Date().toISOString() }; report.cases.push(c); save();
    console.log(`START ${name}`);
    try { c.detail = await fn(); c.status = "PASS"; console.log(`PASS ${name}`); }
    catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
    finally { c.finishedAt = new Date().toISOString(); save(); }
  }
  const host = installedReleaseSession({ installationFile, out, input, report, save,
    preferredBackendPort: defaultPort ? 8278 : undefined });
  let page, provider, cachePrepared = false, started = false;
  async function state(record = false) {
    const p = await host.api(`/api/project/projects/${project.project_id}`), n = p.editor_settings.novelPersistence;
    const value = { projectId: p.project_id, session: n?.sessionSnapshot, job: n?.importJobSnapshot,
      processing: n?.processingSnapshot, errors: n?.errors || [], warnings: n?.warnings || [], project: p };
    if (record) { report.reads.push({ at: new Date().toISOString(), state: value }); save(); }
    return value;
  }
  async function waitState(predicate, label) {
    const until = Date.now() + 90000;
    while (Date.now() < until) {
      assert(!provider.requests.some(r => r.error), JSON.stringify(provider.requests.filter(r => r.error)));
      assert(provider.requests.length <= report.modelBudget, "Controlled request budget exceeded; no automatic retry");
      const s = await state();
      assert.equal(s.errors.length, 0, `${label}: ${JSON.stringify(s.errors)}`);
      if (predicate(s)) { report.reads.push({ at: new Date().toISOString(), state: s }); save(); return s; }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw Error(`Timeout ${label}`);
  }
  async function open() {
    await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: project.title }).click();
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
    assert.equal((await state()).projectId, project.project_id);
  }
  async function guardNovel() {
    const cdp = host.cdp, ids = new Set();
    const isNovel = url => /\/api\/(?:novel\/|ws\/novel)|\/openapi\.json(?:$|\?)/.test(url);
    cdp.on("Network.requestWillBeSent", e => {
      if (isNovel(e.request.url)) {
        ids.add(e.requestId);
        report.network.push({ kind: "request", url: e.request.url, requestId: e.requestId, method: e.request.method,
          at: new Date().toISOString() });
      }
    });
    cdp.on("Network.loadingFailed", e => {
      if (ids.has(e.requestId)) report.network.push({ kind: "failed", requestId: e.requestId,
        errorText: e.errorText, blockedReason: e.blockedReason, corsErrorStatus: e.corsErrorStatus, at: new Date().toISOString() });
    });
    cdp.on("Network.webSocketCreated", e => {
      if (isNovel(e.url)) { ids.add(e.requestId); report.sockets.push({ kind: "created", requestId: e.requestId, url: e.url }); }
    });
    cdp.on("Network.webSocketFrameError", e => {
      if (ids.has(e.requestId)) report.sockets.push({ kind: "error", requestId: e.requestId, error: e.errorMessage });
    });
    cdp.on("Network.webSocketFrameSent", e => {
      if (!ids.has(e.requestId)) return;
      let data; try { data = JSON.parse(e.response.payloadData); } catch { return; }
      const s = data.payload?.provider_selection;
      report.sockets.push({ kind: "sent", requestId: e.requestId, command: data.command, operation: data.operation,
        endpoint: s?.base_url, controlledSelection: s ? s.base_url === provider.url && s.api_key === "test-only-secret" : undefined });
    });
    await cdp.send("Network.enable");
    page.on("console", message => {
      if (message.type() === "error") report.console.push({ type: "error",
        text: message.text().replace(/test-only-secret/g, "[test-key-redacted]").slice(0, 2000), location: message.location() });
    });
    page.on("request", req => {
      const url = new URL(req.url());
      if (url.pathname.startsWith("/api/novel/")) report.http.push({ at: new Date().toISOString(),
        path: url.pathname, method: req.method() });
    });
    await page.context().route("**/api/novel/**", async route => {
      const req = route.request(), url = new URL(req.url()), method = req.method();
      if (method === "GET") return route.continue();
      const m = url.pathname.match(/^\/api\/novel\/import\/(ai_scan_chunk_stream|ai_build_outline_stream|ai_plan_chapter_stream|ai_adapt_scene_stream)$/);
      let body; try { body = req.postDataJSON(); } catch { /* deny malformed writes */ }
      const s = body?.provider_selection;
      if (method === "POST" && m && url.origin === `http://127.0.0.1:${host.current.ports[0]}` && !url.search &&
        s?.connection_id === "qa-default" && s.model_id === "qa-default" && s.base_url === provider.url && s.api_key === "test-only-secret") {
        report.allowedModelRequests.push({ path: url.pathname, method, endpoint: s.base_url }); save();
        return route.continue();
      }
      // Local book/chunk registration is allowed; no executor or AI endpoint.
      if (method === "POST" && /^\/api\/novel\/processing\/(?:import\/analyze|books|books\/[^/]+\/(?:chapters\/split|chunks))$/.test(url.pathname)
        && !s) return route.continue();
      report.blockedNovelWrites.push({ path: url.pathname, method }); save(); return route.abort("blockedbyclient");
    });
  }
  try {
    immutable(); cache("SelfTest"); cache("Prepare"); cachePrepared = true;
    provider = parent ? { url: parent.endpoint, requests: structuredClone(parent.modelBoundary),
      async stop() { return { stopped: true, requests: 13, inheritedClosedProvider: true, additionalModelCalls: 0 }; } }
      : await controlledDefaultNovelProvider();
    report.endpoint = provider.url;
    started = true; page = await host.start(); await guardNovel();
    if (!parent) {
      const imported = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
        method: "POST", headers: { "content-type": "application/octet-stream",
          "X-AgentVN-Filename": encodeURIComponent(path.basename(input)) }, body: fs.readFileSync(input) });
      assert(imported.ok && (await imported.json()).ok);
      await host.rawApi("/api/project/state", {
      provider_connections: [{ connection_id: "qa-default", provider_type: "openai_compatible",
        display_name: "默认链本机受控", base_url: provider.url, api_key_storage: "local", enabled: true }],
      provider_models: [{ provider_id: "qa-default-model", connection_id: "qa-default", model_id: "qa-default",
        model_name: "qa-default", enabled: true, capabilities: ["text_generation"],
        default_parameters: { structured_mode: "json_object", request_timeout_seconds: 60 } }],
      provider_selections: { text_generation: "qa-default-model" }, provider_secrets: { "qa-default": "test-only-secret" },
      });
    }
    await page.evaluate(({ id, out }) => localStorage.setItem("agentvn.projectExportDirectories.v1",
      JSON.stringify({ [id]: out })), { id: project.project_id, out });
    await page.reload(); await open(); if (!parent) report.initial = await state(true); save();
    let w;
    await step(stages[0], async () => {
      await page.locator('[data-help-key="toolbar.novelImport"]:visible').click();
      w = page.getByTestId("novel-import-workbench"); await w.waitFor();
      await w.locator('[data-help-key="novel.importFile"] input').setInputFiles(novel);
      await w.getByRole("region", { name: "小说文件导入检测" }).waitFor();
      await w.locator('[data-help-key="novel.continueDirect"]').click();
      const start = w.locator('[data-help-key="novel.aiStart"]'); await start.waitFor(); assert(await start.isEnabled());
      const s = await waitState(v => v.session?.document?.total_chars > 0, "actual input persisted");
      assert.equal(s.session.document.normalized_text.trim(), fs.readFileSync(novel, "utf8").trim());
      assert.equal(provider.requests.length, 0); assert.equal((s.processing?.jobs || []).length, 0);
      return { sessionId: s.session.session_id, chars: s.session.document.total_chars, modelRequests: 0 };
    });
    await step(stages[1], async () => {
      await w.locator('[data-help-key="novel.aiStart"]').click();
      const s = await waitState(v => v.session?.ai_stage === "outline" && v.session.ai_outline, "actual outline persisted");
      await w.locator('[data-help-key="novel.confirmOutline"]:not(:disabled)').waitFor();
      assert.equal(s.session.ai_chunk_analyses.length, 1); assert.equal(s.session.chapters.length, 1);
      assert.deepEqual(s.project.nodes, report.initial.project.nodes); assert.deepEqual(s.project.edges, report.initial.project.edges);
      assert.equal(provider.requests.length, 6);
      assert.deepEqual(provider.requests.map(r => r.stage).sort(), modelStages.slice(0, 6).sort());
      report.outline = s; await host.shot("outline-awaits-author");
      return { modelStages: provider.requests.map(r => r.stage), unchangedGraph: true };
    });
    await step(stages[2], async () => {
      if (parent) {
        await page.locator('[data-help-key="toolbar.novelImport"]').click();
        w = page.getByTestId("novel-import-workbench"); await w.waitFor();
      } else await w.locator('[data-help-key="novel.confirmOutline"]').click();
      await w.locator(".novel-import-report-panel").waitFor({ timeout: 90000 });
      const s = await waitState(v => v.session?.ai_stage === "report" && v.job?.status === "completed"
        && v.project.nodes.some(n => n.data.editorMeta?.importSessionId === v.session.session_id), "actual completed graph persisted");
      assert.equal(s.session.adapted_scenes.length, 1); assert.equal(s.session.scenes.length, 1);
      assert(s.session.quality_report.score >= s.session.quality_report.threshold);
      assert.equal(s.session.quality_report.blocking_issues.length, 0);
      assert(s.session.validation_reports.length > 0 && s.session.validation_reports.every(v => v.errors.length === 0));
      const added = s.project.nodes.filter(n => n.data.editorMeta?.importSessionId === s.session.session_id);
      assert.equal(added.length, 1); assert(added[0].data.scene.commands.some(c => c.type === "narration" && c.text.includes("屋内的时钟")));
      for (const n of report.initial.project.nodes) assert(s.project.nodes.some(v => v.id === n.id));
      for (const e of report.initial.project.edges) assert(s.project.edges.some(v => v.id === e.id));
      assert.equal(provider.requests.length, 13); assert.deepEqual(provider.requests.map(r => r.stage).sort(), [...modelStages].sort());
      report.completed = s; await host.shot("real-default-import-report");
      return { importedNode: added[0].id, sessionId: s.session.session_id, quality: s.session.quality_report,
        ...(parent ? { originalAuthorConfirmation: report.continuation } : {}) };
    });
    await step(stages[3], async () => {
      await page.locator('[data-help-key="toolbar.novelImport.closeWorkbench"]').click();
      await w.waitFor({ state: "detached" }); await settleEditor(page);
      await page.locator('[data-help-key="toolbar.saveProject"]:visible').click();
      const dialog = page.getByTestId("project-save-confirmation"); await dialog.waitFor();
      const message = await dialog.innerText(); assert(message.includes(out) || message.includes(out.replaceAll("/", "\\")));
      await dialog.getByRole("button", { name: "OK", exact: true }).click(); await dialog.waitFor({ state: "detached" });
      report.bundles = fs.readdirSync(out).filter(f => f.endsWith(".vnproj") && f !== path.basename(input)).map(f => desc(path.join(out, f)));
      assert.equal(report.bundles.length, 1);
      const zip = await JSZip.loadAsync(fs.readFileSync(report.bundles[0].path));
      const p = JSON.parse(await zip.file("project.json").async("string"));
      assert.deepEqual(p.nodes, report.completed.project.nodes); assert.deepEqual(p.edges, report.completed.project.edges);
      assert.equal(p.editor_settings.novelPersistence.sessionSnapshot.session_id, report.completed.session.session_id);
      await host.stop("intentional attributed host/backend restart; not native normal close");
      page = await host.start(); await guardNovel(); await open();
      const s = await state(true); assert.equal(provider.requests.length, 13);
      assert.equal(s.session.session_id, report.completed.session.session_id);
      assert.deepEqual(s.project.nodes, report.completed.project.nodes); assert.deepEqual(s.project.edges, report.completed.project.edges);
      await page.locator('[data-help-key="toolbar.novelImport"]').click();
      await page.locator(".novel-import-report-panel").waitFor(); await host.shot("real-default-restart-report");
      report.restored = s; return { message, package: report.bundles[0], requestsAfterRestart: provider.requests.length };
    });
    assert.deepEqual(report.blockedNovelWrites, []); assert.equal(report.blockedModelRequests, 0);
    if (parent) {
      assert.equal(report.sockets.filter(s => s.kind === "sent" && s.command === "start_novel_job").length,
        parent.sockets.filter(s => s.kind === "sent" && s.command === "start_novel_job").length,
        "Recovery must not start a new model job");
      report.additionalModelCalls = 0;
    }
    assert.deepEqual(report.errors, []); assert.equal(report.cases.length, 4); report.status = "PASS";
  } catch (e) {
    report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
    if (page && !page.isClosed()) {
      report.failureState = await state().catch(e => ({ error: String(e) }));
      report.failureText = (await page.locator("body").innerText().catch(String)).slice(-10000);
      const parsed = [];
      host.cdp.on("Debugger.scriptParsed", e => { if (/tauri\.localhost\/assets\/.*\.js/.test(e.url)) parsed.push(e); });
      try {
        await host.cdp.send("Debugger.enable");
        report.packagedScriptFindings = [];
        for (const script of parsed) {
          const { scriptSource } = await host.cdp.send("Debugger.getScriptSource", { scriptId: script.scriptId });
          for (const marker of ["http://127.0.0.1:8278", "/api/ws/novel", "backend-base-url="]) {
            let at = -1, count = 0;
            while ((at = scriptSource.indexOf(marker, at + 1)) >= 0 && count++ < 8)
              report.packagedScriptFindings.push({ url: script.url, marker,
                excerpt: scriptSource.slice(Math.max(0, at - 90), at + marker.length + 130) });
          }
        }
      } catch (error) { report.packagedScriptProbeError = String(error); }
      await host.shot("failure").catch(e => { report.captureError = String(e); });
    }
  } finally {
    if (started) {
      try { await host.rawApi("/api/project/state", { provider_secrets: {} }); report.credentialCleanup = "CLEARED_TEST_ONLY_SECRET"; }
      catch (e) { report.credentialCleanupError = String(e); report.status = "FAILED"; process.exitCode = 1; }
      try { await host.stop("final exact owned cleanup; not normal native close"); }
      catch (e) { report.cleanupError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    }
    if (provider) { report.providerCleanup = await provider.stop(); report.modelBoundary = provider.requests; report.modelRequests = provider.requests.length; }
    if (cachePrepared) try { cache("Restore"); } catch (e) { report.cacheError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    try {
      immutable();
      const dbFile = path.join(out, "data/backend/vn_engine.db");
      if (fs.existsSync(dbFile)) {
        const db = new DatabaseSync(dbFile);
        try { db.exec("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;"); }
        finally { db.close(); }
        assert(!fs.readFileSync(dbFile).includes(Buffer.from("test-only-secret")));
        report.finalDatabase = desc(dbFile);
      }
    } catch (e) { report.finalizationError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, modelRequests: report.modelRequests,
      cases: report.cases.map(c => ({ name: c.name, status: c.status })), error: report.error,
      cleanupError: report.cleanupError, finalizationError: report.finalizationError }));
  }
}
if (require.main === module) run(process.argv[2]).catch(e => { console.error(e.stack || e); process.exitCode = 1; });
module.exports = { qa, modelStages, stages };
