"use strict";
// Frozen installed UI/backend; only the external model response is controlled.
// No paid provider, product edits, builds, store writes, or native input claims.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { buildSync } = require("../editor/node_modules/esbuild");
const { build } = require("./build-agent-doc-index.cjs");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const { receipt } = require("./current-novel-task-closure.cjs");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { controlledAssistantProvider } = require("./lib/controlled-assistant-provider.cjs");
const A = require("./lib/installed-acceptance.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const root = path.resolve(__dirname, "..");
const qa = "F:/AgentVN/QA/Knowledge-1.9.35-20261102-01";
const checkpoint = "F:/AgentVN/Checkpoints/Current-Knowledge-20261102-01";
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const desc = file => ({ path: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size });
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2), { flag: "wx" });
const topics = [
  ["layout-background", "我想给Ren'Py样式按钮容器设置背景图片，应该在哪里操作？"],
  ["layout-code", "进阶HTML和CSS如何编辑，关闭勾选后代码是否保留？"],
  ["gui-pack", "GUI资源包如何入库，再仅应用到一个控件？"],
];
const matrix = [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr =>
  [false, true].map(reduced => ({ width, height: width * 9 / 16, dpr, reduced }))));
function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr); return result.stdout;
}
function sourceAudit() {
  const out = path.join(qa, "source-01"); assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
  const index = build(), tracked = new Set(git(["ls-files", "-z"]).split("\0").filter(Boolean));
  const required = [...index.metadata.sources.map(s => s.path), "scripts/build-agent-doc-index.cjs",
    "scripts/fixtures/assistant-project-image-proposal.json"];
  const missing = required.filter(file => !tracked.has(file));
  const ignored = spawnSync("git", ["check-ignore", "-v", "--", ...missing],
    { cwd: root, encoding: "utf8", windowsHide: true });
  assert([0, 1].includes(ignored.status));
  const results = [];
  for (const [file, leaf] of [
    ["assistant-knowledge-index-test.cjs", "index"],
    ["assistant-knowledge-test.cjs", "retrieval"],
    ["assistant-knowledge-context-test.cjs", "context"],
  ]) {
    const result = spawnSync(process.execPath, [path.join(__dirname, file), path.join(out, leaf)],
      { cwd: root, encoding: "utf8", windowsHide: true, timeout: 90000 });
    fs.writeFileSync(path.join(out, leaf + ".stdout.txt"), result.stdout || "", { flag: "wx" });
    fs.writeFileSync(path.join(out, leaf + ".stderr.txt"), result.stderr || "", { flag: "wx" });
    const reportFile = path.join(out, leaf, "report.json");
    results.push({ command: [process.execPath, file, path.join(out, leaf)], exitCode: result.status,
      error: result.error?.message, report: fs.existsSync(reportFile) ? { ...desc(reportFile), data: read(reportFile) } : null });
  }
  const report = { status: missing.length || results.some(r => r.exitCode !== 0) ? "FAILED" : "PASS",
    at: new Date().toISOString(), scope: "CURRENT_SOURCE_INDEX_FRESHNESS_RETRIEVAL_AND_GIT_DELIVERY_NOT_INSTALLED",
    sources: index.metadata.sources, chunks: index.chunks.length, generator: desc(path.join(__dirname, "build-agent-doc-index.cjs")),
    generated: desc(path.join(root, "editor/src/assistant/agentvnDocIndex.generated.ts")),
    tracked: required.filter(file => tracked.has(file)), missingFromTrackedTree: missing,
    ignoredDetails: ignored.stdout, tests: results, productChanges: 0, builds: 0, paidRequests: 0 };
  write(path.join(out, "report.json"), report);
  console.log(JSON.stringify({ status: report.status, missing: missing.length, sources: report.sources.length,
    sourceCases: results.map(r => [path.basename(r.command[1]), r.report?.data?.status, r.report?.data?.cases?.length]), out }));
  return report;
}
function prepare() {
  const installed = descriptor(); assert.deepEqual(read(receipt).executable, installed.executable);
  assert(!fs.existsSync(checkpoint)); fs.mkdirSync(checkpoint, { recursive: true });
  assert(!fs.existsSync(qa)); fs.mkdirSync(qa, { recursive: true });
  const files = [__filename, "AGENTS.md", "plans/ACTIVE_TASKS.md",
    "scripts/build-agent-doc-index.cjs", "docs/ASSISTANT_USER_GUIDE.md",
    "editor/src/assistant/agentvnDocIndex.generated.ts", "editor/src/assistant/retrieval.ts",
    "editor/src/assistant/knowledgeNavigation.ts", "editor/src/assistant/layoutHelpContext.ts",
    "scripts/lib/installed-release-session.cjs", "scripts/lib/installed-controlled-provider-guard.cjs",
    "scripts/lib/controlled-assistant-provider.cjs", "scripts/installed-layout-cache-session.ps1"];
  const snapshots = [];
  for (const relative of files) {
    const source = path.resolve(root, relative), target = path.join(checkpoint, path.relative(root, source));
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    snapshots.push({ source: desc(source), snapshot: desc(target) });
  }
  fs.writeFileSync(path.join(checkpoint, "scoped-knowledge.diff"),
    git(["diff", "--binary", "--", "editor/src/assistant", "editor/src/components/assistant/AssistantChatPanel.tsx",
      "backend/app/api/routes_assistant.py"]), { flag: "wx" });
  write(path.join(checkpoint, "report.json"), { status: "PASS", at: new Date().toISOString(),
    scope: "SCOPED_RECOVERABLE_QA_AND_KNOWLEDGE_CHECKPOINT_NOT_PRODUCT_ACCEPTANCE",
    installation: desc(receipt), products: [installed.executable, ...installed.resources], snapshots,
    gitHead: git(["rev-parse", "HEAD"]).trim(), gitIndex: desc(path.resolve(root, git(["rev-parse", "--git-path", "index"]).trim())) });
  console.log("PREPARED " + checkpoint);
}
function plainProject(value) {
  return { settings: value.settings, assets: value.assets,
    nodes: value.nodes.map(({ measured, selected, dragging, ...node }) => node),
    edges: value.edges.map(({ selected, ...edge }) => edge) };
}
async function installedRun(attempt) {
  assert.match(attempt, /^\d{2}$/); const out = path.join(qa, "session-" + attempt);
  assert(fs.existsSync(path.join(checkpoint, "report.json"))); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const frozen = read(path.join(checkpoint, "report.json"));
  for (const f of frozen.products) assert.equal(sha(f.path), f.sha256);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(),
    scope: "EXACT_FROZEN_NSIS_KNOWLEDGE_RETRIEVAL_BACKEND_CITATION_NAVIGATION_READONLY_CONTROLLED_MODEL",
    cases: [], matrix: [], screenshots: [], launches: [], cleanups: [], errors: [], requests: [],
    modelRequests: 0, blockedModelRequests: 0, paidRequests: 0, productChanges: 0, builds: 0,
    checkpoint: desc(path.join(checkpoint, "report.json")), script: desc(__filename),
    boundaries: ["Actual installed Editor/backend, isolated data/WebView overrides",
      "Only external model HTTP controlled; response is not model quality evidence",
      "Questions include declared HISTORY markers for the existing QA-only allowlist",
      "WebView viewport/DPR emulation, not physical 4K", "No natural close, native picker, export, upgrade or Android claim"] };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  let host, page, provider, cachePrepared = false;
  function cache(action) {
    const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(__dirname, "installed-layout-cache-session.ps1"), "-Action", action, "-RunDirectory", out,
      "-AllowedRunRoot", qa, "-CodexCacheView"], { encoding: "utf8", windowsHide: true, timeout: 45000 });
    (report.cache ??= []).push({ action, exitCode: result.status, stdout: result.stdout, stderr: result.stderr }); save();
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  async function stage(name, body) {
    const row = { name, status: "RUNNING" }; report.cases.push(row); save(); console.log("START " + name);
    try { row.detail = await body(); row.status = "PASS"; console.log("PASS " + name); }
    catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); throw error; }
    finally { save(); }
  }
  const project = fixture("qa-knowledge-1935-20261102-" + attempt);
  project.title = "当前安装版知识检索隔离 " + attempt;
  project.nodes[1].data.scene.summary = "PRIVATE_STORY_DO_NOT_DISCLOSE_KNOWLEDGE";
  const mod = { exports: {} };
  new Function("module", "exports", "require", buildSync({ stdin: { resolveDir: root, loader: "ts",
    contents: 'export {createRenpyUILayout} from "./shared/cartridge/uiLayoutProfiles"; export {getDefaultUISkinLayout} from "./shared/cartridge/uiSkin";' },
    bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text)(mod, mod.exports, require);
  project.editor_settings.runtimeUILayout = mod.exports.createRenpyUILayout();
  project.editor_settings.runtimeUILayoutProfiles = { version: 1, activeType: "renpy",
    profiles: { agentvn: mod.exports.getDefaultUISkinLayout(), renpy: project.editor_settings.runtimeUILayout } };
  const input = path.join(out, "隔离知识工程.vnproj"); write(input, project);
  const questions = matrix.flatMap((m, i) => topics.map(([topic, question], j) =>
    ({ topic, question: `HISTORY_${String.fromCharCode(65 + j)} ${question}（验收组${i + 1}）`, i, j })));
  const sourceChunks = new Map(build().chunks.map(chunk => [chunk.id, chunk]));
  const snapshot = () => page.evaluate(() => {
    const p = window.__AGENTVN_PROJECT_STORE__.getState(), e = window.__AGENTVN_EDITOR_STORE__.getState();
    return JSON.parse(JSON.stringify({ settings: p.settings, assets: p.assetManifest, nodes: e.nodes, edges: e.edges }));
  });
  const panel = () => page.locator(".workspace-task-panel.is-open .assistant-chat-panel");
  try {
    save(); cache("SelfTest"); cachePrepared = true; cache("Prepare");
    provider = await controlledAssistantProvider();
    host = installedReleaseSession({ installationFile: receipt, out, report, save, input,
      controlledCreation: { endpoint: provider.url, projectIds: [project.project_id], inquiryQuestions: questions.map(q => q.question) } });
    report.installation = host.installation; page = await host.start();
    page.on("request", r => {
      if (r.method() === "POST" && new URL(r.url()).pathname === "/api/assistant/chat_stream") {
        const request = r.postDataJSON();
        report.requests.push({ question: request.question, context_chunks: request.context_chunks,
          editor_context: request.editor_context, keys: Object.keys(request).sort(),
          historyCount: request.messages?.length ?? 0 }); save();
      }
    });
    const imported = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`,
      { method: "POST", headers: { "content-type": "application/octet-stream",
        "X-AgentVN-Filename": encodeURIComponent(path.basename(input)) }, body: fs.readFileSync(input),
        signal: AbortSignal.timeout(20000) });
    assert(imported.ok && (await imported.json()).ok);
    await host.rawApi("/api/project/state", {
      provider_connections: [{ connection_id: "qa-review", provider_type: "openai_compatible", display_name: "本机知识验收",
        base_url: provider.url, api_key_storage: "local", enabled: true }],
      provider_models: [{ provider_id: "qa-model", connection_id: "qa-review", model_id: "controlled-model",
        model_name: "controlled-model", enabled: true, capabilities: ["text_generation"],
        default_parameters: { context_budget_tokens: 16000, request_timeout_seconds: 60 } }],
      provider_selections: { text_generation: "qa-model" }, provider_secrets: { "qa-review": "test-only-secret" },
    });
    await page.reload(); await page.locator('[data-help-key="home.recentProject"]:not(:disabled):visible')
      .filter({ hasText: project.title }).click();
    await page.locator(".editor-toolbar").waitFor(); await A.settleEditor(page);
    await page.locator('[data-workspace-surface="options"]:visible').click(); await A.settleEditor(page);
    await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
    await page.getByTestId("renpy-title-editor").waitFor(); await A.settleEditor(page);
    await page.locator('.renpy-region-list button[data-component-id="title_start_button"]').click();
    report.baseline = plainProject(await snapshot());
    await stage("installed-retrieval-three-topics-twelve-displays-backend-and-citation-navigation", async () => {
      for (const [i, m] of matrix.entries()) {
        await host.metrics(m);
        const cell = { ...m, status: "RUNNING", topics: [] }; report.matrix.push(cell); save();
        for (const { topic, question, j } of questions.filter(q => q.i === i)) {
          const selected = await page.locator('.renpy-region-list button[aria-pressed="true"]').getAttribute("data-component-id");
          assert(selected);
          await page.locator('[data-workspace-surface="assistant"]:visible').click(); await A.settleEditor(page);
          await panel().getByRole("button", { name: "问询模式", exact: true }).click();
          const fresh = panel().getByTestId("assistant-new-conversation");
          await fresh.click(); await panel().getByLabel("向大模型助手提问", { exact: true }).fill(question);
          const pending = page.waitForResponse(r => r.request().method() === "POST"
            && new URL(r.url()).pathname === "/api/assistant/chat_stream");
          await panel().getByRole("button", { name: "发送", exact: true }).click();
          const response = await pending; assert.equal(response.status(), 200);
          const events = await response.text(); assert(!/^event: error$/m.test(events), events);
          await panel().getByText(`HISTORY_${String.fromCharCode(65 + j)} 这是安装版历史验收回答。`, { exact: true }).waitFor();
          await panel().getByText("对话已保存到本机", { exact: true }).waitFor();
          const request = report.requests.at(-1); assert.equal(request.question, question);
          assert(request.context_chunks.some(chunk => chunk.id.startsWith("guide-" + topic + "-")));
          assert(!request.keys.some(key => /tool|authorized|draft/i.test(key)));
          assert(!JSON.stringify(request).includes("PRIVATE_STORY_DO_NOT_DISCLOSE_KNOWLEDGE"));
          assert(!JSON.stringify(request).includes("test-only-secret"));
          const [json, budget] = request.editor_context.split("\n[Context budget report]\n");
          const context = JSON.parse(json.trim()); assert(budget && JSON.parse(budget));
          assert.equal(context.layoutType, "renpy"); assert.equal(context.screenId, "title");
          assert.equal(context.componentId, selected); assert.equal(context.access, "read-only");
          const differences = request.context_chunks.filter(c => {
            const source = sourceChunks.get(c.id);
            // Context packing may clip tails: require every emitted character to
            // originate from the matching real source chunk, never vice versa.
            return !source || source.source !== c.source || source.title !== c.title
              || !source.text.startsWith(c.text);
          }).map(c => c.id);
          assert.deepEqual(differences, [], "Installed knowledge differs from current source");
          const citations = panel().locator(".assistant-message-citations").last();
          const jump = citations.getByRole("button", { name: "打开：游戏客户端", exact: true }).first();
          await jump.scrollIntoViewIfNeeded(); await jump.focus();
          const geometry = await jump.evaluate(button => {
            const r = button.getBoundingClientRect();
            return { rect: r.toJSON(), focus: document.activeElement === button,
              hit: button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
              overflow: document.documentElement.scrollWidth - innerWidth };
          });
          assert(geometry.focus && geometry.hit && geometry.overflow <= 1);
          await jump.click(); await page.getByTestId("renpy-title-editor").waitFor(); await A.settleEditor(page);
          assert.equal(await page.locator('[data-workspace-surface="options"]:visible').getAttribute("aria-current"), "page");
          assert.deepEqual(plainProject(await snapshot()), report.baseline, "Inquiry/navigation modified author content");
          cell.topics.push({ topic, question, status: "PASS", context, geometry,
            citations: request.context_chunks.map(c => ({ id: c.id, source: c.source, characters: c.text.length })),
            sourcePrefixVerified: true }); save();
        }
        cell.status = "PASS"; await host.shot("knowledge-" + m.width + "-dpr" + m.dpr + "-" + m.reduced);
        console.log("PASS installed knowledge " + m.width + "/" + m.dpr + "/" + m.reduced); save();
      }
      assert.equal(report.requests.length, 36); assert.equal(provider.requests.length, 36);
      assert(provider.requests.every(r => !r.creation && r.tools.length === 0));
      assert.equal(report.matrix.length, 12); assert.equal(report.matrix.flatMap(c => c.topics).length, 36);
      assert.equal(report.blockedModelRequests, 0); assert.deepEqual(report.errors, []);
      return { requests: 36, writeTools: 0, functionalCells: 12, externalResponsesControlled: true };
    });
    await stage("installed-restart-persists-answer-citations-without-requery", async () => {
      const last = questions.at(-1);
      await host.stop("Controlled owned restart, not natural close");
      page = await host.start();
      await page.locator('[data-help-key="home.recentProject"]:not(:disabled):visible').filter({ hasText: project.title }).click();
      await page.locator(".editor-toolbar").waitFor(); await A.settleEditor(page);
      await page.locator('[data-workspace-surface="assistant"]:visible').click(); await A.settleEditor(page);
      await panel().getByRole("button", { name: "问询模式", exact: true }).click();
      await panel().getByText(last.question, { exact: true }).waitFor();
      await panel().getByText("HISTORY_C 这是安装版历史验收回答。", { exact: true }).waitFor();
      assert(await panel().locator(".assistant-message-citations").last().getByRole("button", { name: "打开：游戏客户端", exact: true }).count());
      assert.equal(provider.requests.length, 36);
      assert.deepEqual(plainProject(await snapshot()), report.baseline);
      await host.shot("knowledge-restart-without-requery");
      return { answerAndCitationsRestored: true, additionalRequests: 0, projectUnchanged: true };
    });
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
    if (host && page && !page.isClosed()) {
      report.failureText = (await page.locator("body").innerText().catch(() => "")).slice(-8000);
      await host.shot("failure").catch(e => { report.captureError = String(e); });
    }
  } finally {
    if (host?.current) {
      try {
        await host.rawApi("/api/project/state", { provider_secrets: {}, provider_connections: [],
          provider_models: [], provider_selections: {} }); report.credentialCleanup = "CLEARED_TEST_ONLY_CONFIGURATION";
      } catch (e) { report.credentialCleanup = String(e); report.status = "FAILED"; process.exitCode = 1; }
    }
    try { await host?.stop("Final exact owned cleanup"); }
    catch (e) { report.cleanupError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    if (cachePrepared) {
      try { cache("Restore"); report.cacheRestoration = read(path.join(out, "native-cache-restoration.json")).status;
        assert.equal(report.cacheRestoration, "PASS"); }
      catch (e) { report.cacheError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    }
    if (provider) { report.providerRequests = provider.requests; report.providerCleanup = await provider.stop(); }
    for (const f of frozen.products) if (sha(f.path) !== f.sha256) { report.status = "FAILED"; report.immutabilityError = f.path; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length, cells: report.matrix.length,
      inquiries: report.requests.length, localModelRequests: report.providerRequests?.length, paidRequests: 0, out,
      error: report.error }));
  }
}
async function main() {
  const mode = process.argv[2];
  if (mode === "prepare") return prepare();
  if (mode === "source") return sourceAudit();
  if (mode === "run") return installedRun(process.argv[3]);
  if (mode === "self-test") {
    assert.equal(matrix.length, 12); assert.equal(new Set(matrix.map(m => JSON.stringify(m))).size, 12);
    assert.equal(topics.length, 3); assert.deepEqual(read(receipt).executable, descriptor().executable);
    const { controlledCreationGuard } = require("./lib/installed-controlled-provider-guard.cjs");
    const question = "HISTORY_A 背景图片在哪里设置（验收组1）";
    const options = { endpoint: "http://127.0.0.1:12345/v1", projectIds: ["qa-test"], inquiryQuestions: [question] };
    const guard = controlledCreationGuard(options), origin = "http://127.0.0.1:23456";
    const body = { question, provider_selection: { base_url: options.endpoint, connection_id: "qa-review",
      model_id: "controlled-model", api_key: "test-only-secret" } };
    const request = { method: "POST", url: origin + "/api/assistant/chat_stream", body };
    assert(!guard.allows({ ...request, body: { ...body, question: "other" } }, origin));
    assert(!guard.allows({ ...request, body: { ...body, provider_selection: { ...body.provider_selection, base_url: "https://example.com/v1" } } }, origin));
    assert(guard.allows(request, origin)); assert(!guard.allows(request, origin));
    assert.throws(() => controlledCreationGuard({ ...options, endpoint: "https://example.com/v1" }));
    console.log(JSON.stringify({ status: "PASS", functionalCells: 12, inquiryCases: 36,
      rejectsUnlistedRepeatedAndExternal: true, productStarts: 0, paidRequests: 0 })); return;
  }
  throw Error("prepare | source | self-test | run NN");
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { qa, checkpoint, matrix, topics };
