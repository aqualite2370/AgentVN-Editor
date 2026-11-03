"use strict";
// Current actual NSIS host + its auto-started packaged backend.
// Only the external model boundary is controlled. No frontend store writes.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const { buildSync } = require("../editor/node_modules/esbuild");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { controlledAssistantProvider } = require("./lib/controlled-assistant-provider.cjs");
const { until } = require("./lib/current-native-editor-session.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const options=process.env.AGENTVN_EXIT_CANDIDATE_CONFIG
  ?require("./lib/candidate-1924-quick-adapter.cjs").quickCandidate():null;
if(options)assert(process.argv.includes(`--candidate=${options.version}`),"Explicit bound lifecycle candidate required");
const candidate1930 = process.argv.includes("--candidate=1.9.30");
const currentCandidate=!!options || candidate1930 || process.argv.includes("--candidate=1.9.22");
const expectedVersion=options?.version||(candidate1930?"1.9.30":currentCandidate?"1.9.22":"1.9.14");
const root = path.resolve(__dirname, ".."), label = candidate1930?
  "Installed-Assistant-Lifecycle-1930-20261026-01":currentCandidate?
  "Installed-Assistant-Lifecycle-1922-20261022-01":"Installed-Assistant-Lifecycle-20261021-01";
const qa = options?path.join(options.base,"assistant-lifecycle-01"):`F:/AgentVN/QA/${label}`;
const checkpoint = options?`F:/AgentVN/Checkpoints/Assistant-Lifecycle-${options.stamp}-20261028-01`:`F:/AgentVN/Checkpoints/${label}`;
const installationFile = options?.installation||(candidate1930?
  "F:/AgentVN/QA/Editor-1.9.30-20261026-01/derived-components-installation-01.json":currentCandidate?
  "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json":
  "F:/AgentVN/QA/Runtime-Dialog-Release-20261021-01/installation.json");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const write = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2), { flag: "wx" });
const tools = [__filename, "scripts/lib/installed-release-session.cjs", "scripts/lib/installed-controlled-provider-guard.cjs",
  "scripts/installed-controlled-provider-guard-test.cjs", "scripts/installed-controlled-inquiry-guard-test.cjs",
  "scripts/lib/controlled-assistant-provider.cjs", "scripts/lib/current-native-capture.cjs", "scripts/lib/owned-process-tree.cjs"];
if(currentCandidate)tools.push("scripts/installed-layout-cache-session.ps1");
if(options)tools.push("scripts/lib/candidate-1924-quick-adapter.cjs","scripts/candidate-1930-exit.cjs");
const sources = ["editor/src/components/assistant/AssistantChatPanel.tsx",
  "editor/src/components/assistant/AssistantProjectCreationLockGate.tsx",
  "editor/src/assistant/creationProcessQueue.ts", "editor/src/store/projectStore.ts",
  "editor/src/store/editorStore.ts", "backend/app/api/routes_assistant.py",
  "backend/app/services/assistant_creation_agent.py"];
const question = "HISTORY_A 说明会话如何保存";
const authored = nodes => nodes.map(({ measured, ...node }) => node);
function prepare() {
  assert(fs.existsSync(checkpoint)); assert(fs.existsSync(qa)); assert(!fs.existsSync(path.join(qa, "preparation.json")));
  const installation = read(installationFile);
  assert.equal(currentCandidate?installation.version:installation.executable.version, expectedVersion);
  if(options)require("./candidate-1930-exit.cjs").validateInstallation(installationFile);
  else if (candidate1930) {
    assert.equal(installation.executable.sha256, "a8bb43747d7775dc10ccdacdd20bb67e759ae3298653b77cfc531a44241d5577");
    assert.equal(sha(installation.actualInstallation.path), installation.actualInstallation.sha256);
    const actual = read(installation.actualInstallation.path);
    assert(actual.status === "PASS" && actual.exitCode === 0 && actual.registryRestored);
    assert.equal(actual.executable.sha256, installation.executable.sha256);
  }
  const previous=currentCandidate?{products:[
    ...(options||candidate1930 ? installation.protectedFiles
      : read("F:/AgentVN/QA/Editor-1.9.22-20261022-01/baseline-01.json").protectedFiles),
    installation.executable,...installation.resources
  ]}:read("F:/AgentVN/QA/Installed-Assistant-Review-20261021-01/preparation.json");
  for (const f of previous.products) assert.equal(sha(f.path), f.sha256);
  const snapshots = [];
  for (const f of [...tools, ...sources, "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md"]) {
    const source = path.resolve(root, f), target = path.join(checkpoint, "before-run", path.relative(root, source));
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    snapshots.push(desc(target));
  }
  const code = buildSync({ stdin: { resolveDir: root, loader: "ts", contents:
    'export {switchRuntimeUILayoutType} from "./shared/cartridge/uiLayoutProfiles"; export {useProjectStore} from "./editor/src/store/projectStore";' },
    bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text;
  const module = { exports: {} }; new Function("module", "exports", code)(module, module.exports);
  const projects = ["a", "b"].map(letter => {
    const p = fixture(`qa-installed-lifecycle-${letter}-${options?`${options.stamp}-20261028`:candidate1930?"1930-20261026":currentCandidate?"1922-20261022":"20261021"}-01`);
    p.title = `安装会话隔离 ${letter.toUpperCase()} ${options?`${options.version} 20261028`:candidate1930?"1.9.30 20261026":currentCandidate?"1.9.22 20261022":"20261021"}`;
    const defaults = structuredClone(module.exports.useProjectStore.getState().settings);
    p.editor_settings = { ...defaults, ...module.exports.switchRuntimeUILayoutType(defaults, "renpy") };
    p.nodes[0].data.loadingAnimation = { kind: "default" }; p.nodes[0].data.openingAudio = [];
    write(path.join(qa, p.project_id + ".vnproj"), p); return p;
  });
  const git = args => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
    assert.equal(r.status, 0); return r.stdout.trim();
  };
  const guards=currentCandidate?["scripts/installed-controlled-provider-guard-test.cjs",
    "scripts/installed-controlled-inquiry-guard-test.cjs"].map(file=>{
      const result=spawnSync(process.execPath,[file],{cwd:root,encoding:"utf8",windowsHide:true});
      assert.equal(result.status,0,result.stdout+result.stderr);
      return {command:[process.execPath,file],exitCode:result.status,stdout:result.stdout,stderr:result.stderr};
    }):undefined;
  write(path.join(qa, "preparation.json"), { at: new Date().toISOString(), snapshots,guards,
    ...(options?{candidateBindings:[options.bindingFile,...["candidateConfig","installation","predecessor","exported","fixture"]
      .map(k=>options.binding[k].path)].map(desc)}:{}),
    products: previous.products, sources: sources.map(f => desc(path.resolve(root, f))),
    installation: desc(installationFile), projects, inputs: projects.map(p => desc(path.join(qa, p.project_id + ".vnproj"))),
    git: { head: git(["rev-parse", "HEAD"]), index: desc(path.join(root, ".git/index")) } });
  console.log(`PREPARED ${qa}`);
}
async function run(attempt) {
  assert.match(attempt, /^\d{2}$/);
  const out = path.join(qa, `session-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const prep = read(path.join(qa, "preparation.json")), projects = prep.projects;
  if(options){
    require("./candidate-1930-exit.cjs").validateInstallation(installationFile);
    assert.deepEqual(prep.candidateBindings,[options.bindingFile,...["candidateConfig","installation","predecessor","exported","fixture"]
      .map(k=>options.binding[k].path)].map(desc));
    assert.equal(path.resolve(prep.installation.path),path.resolve(installationFile));
    assert.equal(sha(installationFile),prep.installation.sha256);
  }
  const report = { status: "RUNNING", at: new Date().toISOString(), version: expectedVersion,
    scope: "ACTUAL_NSIS_INSTALLED_CONTROLLED_INQUIRY_QUEUE_HISTORY_NOT_REAL_DEEPSEEK",
    boundary: "Public API fixture import/provider setup, actual installed WebView DOM input; not native picker or physical input.",
    products: prep.products, sources: prep.sources, inputs: prep.inputs, installation: prep.installation,
    tools: tools.map(f => desc(path.resolve(root, f))), cases: [], lockMatrix: [], historyMatrix: [], screenshots: [],
    launches: [], cleanups: [], errors: [], submissions: [], blockedModelRequests: 0, realModelRequests: 0,
    productChanges: 0, devPublicationBuilds: 0,
    notProven: ["Real DeepSeek", "Recovery of interrupted nonterminal task", "Concurrent native Editor processes",
      "Normal native close", "Windows standalone/setup", "Android", "Upgrade", "Developer-workspace-independent machine"] };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  for (const f of tools) fs.copyFileSync(path.resolve(root, f), path.join(out, path.basename(f)), fs.constants.COPYFILE_EXCL);
  let host, page, provider, before, stageName, a, b, c,cachePrepared=false;
  let expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
  const observed = new WeakSet();
  const api = (...args) => host.rawApi(...args);
  async function metrics(m) { const viewport = await host.metrics(m); expected = m; return viewport; }
  function observe() {
    if (observed.has(page)) return; observed.add(page);
    page.on("request", r => {
      if (r.method() === "POST" && r.url().endsWith("/api/assistant/creation/processes")) {
        const v = r.postDataJSON(); report.submissions.push({ id: v.id, projectId: v.project_id,
          conversationId: v.conversation_id, userRequest: v.request.user_request }); save();
      }
    });
  }
  async function launch() { page = await host.start(); expected = { width: 1920, height: 1080, dpr: 1, reduced: false }; observe(); }
  async function stage(name, fn) {
    stageName = name; const row = { name, status: "RUNNING" }; report.cases.push(row); save(); console.log(`START ${name}`);
    try { row.detail = await fn(); row.status = "PASS"; console.log(`PASS ${name}`); }
    catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; } finally { save(); }
  }
  async function openProject(p) {
    await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: p.title }).click();
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
    assert.equal((await api("/api/project/state")).data.project_metadata.projectId, p.project_id);
  }
  async function goHome() {
    const lock = page.getByTestId("assistant-project-lock-dialog");
    if (await lock.isVisible()) await lock.getByRole("button", { name: "返回工程列表", exact: true }).click();
    else {
      await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
      await page.getByRole("button", { name: "返回首页", exact: true }).click();
    }
    await page.locator(".recent-project-open:not(:disabled):visible").first().waitFor();
    await page.waitForFunction(() => !document.querySelector(".app-transition-stage.is-switching"));
  }
  async function assistant(mode) {
    await page.locator('[data-workspace-surface="assistant"]:visible').click(); await settleEditor(page);
    const panel = page.locator(".workspace-task-panel.is-open .assistant-chat-panel"); await panel.waitFor();
    await panel.getByRole("button", { name: mode === "creation" ? "创造模式" : "问询模式", exact: true }).click();
    await panel.locator('textarea[aria-label="向大模型助手提问"]:not(:disabled)').waitFor(); return panel;
  }
  async function submit(panel, text) {
    await panel.getByLabel("向大模型助手提问", { exact: true }).fill(text);
    const n = report.submissions.length; await panel.getByRole("button", { name: "生成创作提案", exact: true }).click();
    await until(() => report.submissions.length === n + 1, "one actual UI submission"); return report.submissions.at(-1);
  }
  const waitProcess = (id, predicate) => until(async () => {
    const p = await api(`/api/assistant/creation/processes/${id}`); return predicate(p) && p;
  }, `process ${id}`);
  async function unchanged() {
    for (const p of projects) {
      const actual = (await api(`/api/project/projects/${p.project_id}`)).data, original = before[p.project_id];
      for (const k of ["editor_settings", "edges", "asset_manifest"]) assert.deepEqual(actual[k], original[k]);
      assert.deepEqual(authored(actual.nodes), authored(original.nodes));
    }
  }
  async function history(panel) {
    const h = panel.locator(".assistant-history-popover");
    if (!await h.evaluate(n => n.open)) await h.locator("summary").click(); return h;
  }
  function cache(action){
    const result=spawnSync("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",
      path.join(root,"scripts/installed-layout-cache-session.ps1"),"-Action",action,"-RunDirectory",out,"-CodexCacheView",
      ...(options||candidate1930 ? ["-AllowedRunRoot", path.resolve(qa)] : [])],
    {windowsHide:true,encoding:"utf8",timeout:45000});
    (report.cache??=[]).push({action,code:result.status,stdout:result.stdout,stderr:result.stderr});save();
    assert.equal(result.status,0,result.stdout+result.stderr);
  }
  try {
    save(); for (const f of [...prep.products, ...prep.sources, ...prep.inputs]) assert.equal(sha(f.path), f.sha256);
    if(currentCandidate){cache("SelfTest");cachePrepared=true;cache("Prepare");}
    provider = await controlledAssistantProvider(); provider.hold("QUEUE_A"); report.modelEndpoint = provider.url;
    host = installedReleaseSession({ installationFile, out, input: prep.inputs[0].path, report, save,
      controlledCreation: { endpoint: provider.url, projectIds: projects.map(p => p.project_id), inquiryQuestions: [question] } });
    await launch(); before = {};
    for (const f of prep.inputs) {
      const r = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, { method: "POST",
        headers: { "content-type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(f.path)) },
        body: fs.readFileSync(f.path), signal: AbortSignal.timeout(20000) });
      assert(r.ok); assert((await r.json()).ok);
    }
    for (const p of projects) before[p.project_id] = (await api(`/api/project/projects/${p.project_id}`)).data;
    report.baselineProjects = before;
    await api("/api/project/state", {
      provider_connections: [{ connection_id: "qa-review", provider_type: "openai_compatible", display_name: "安装会话本机受控",
        base_url: provider.url, api_key_storage: "local", enabled: true }],
      provider_models: [{ provider_id: "qa-model", connection_id: "qa-review", model_id: "controlled-model", model_name: "controlled-model",
        enabled: true, capabilities: ["text_generation"], default_parameters: { structured_mode: "tools", request_timeout_seconds: 120 } }],
      provider_selections: { text_generation: "qa-model" }, provider_secrets: { "qa-review": "test-only-secret" },
    });
    await page.reload(); await page.locator(".recent-project-open:not(:disabled):visible").first().waitFor();
    await stage("inquiry-has-no-write-tools-and-does-not-mutate-project", async () => {
      await openProject(projects[0]); const panel = await assistant("inquiry");
      await panel.getByLabel("向大模型助手提问", { exact: true }).fill(question);
      await panel.getByRole("button", { name: "发送", exact: true }).click();
      await panel.getByText("HISTORY_A 这是安装版历史验收回答。", { exact: true }).waitFor();
      const req = provider.requests.find(r => r.marker === "HISTORY_A");
      assert(req && !req.creation && req.tools.length === 0); assert.equal(report.submissions.length, 0); await unchanged();
      return { paid: false, modelTools: 0, actualTransport: req.stream ? "SSE" : "AgentVN SSE over nonstream provider" };
    });
    await stage("running-owner-lock-and-other-project-global-monitor", async () => {
      a = await submit(await assistant("creation"), "QUEUE_A 构建标题关于按钮");
      await waitProcess(a.id, p => p.status === "running");
      const lock = page.getByTestId("assistant-project-lock-dialog"); await lock.waitFor();
      for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        const m = { width, height: width * 9 / 16, dpr, reduced }, viewport = await metrics(m);
        await lock.getByRole("button", { name: "返回工程列表", exact: true }).focus();
        const geometry = await lock.evaluate(n => {
          const r = n.getBoundingClientRect(), button = n.querySelector('[aria-label="返回工程列表"]'), b = button.getBoundingClientRect();
          const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
          return { rect: r.toJSON(), button: b.toJSON(), hit: hit === button || button.contains(hit),
            focus: n.contains(document.activeElement), rootInert: document.querySelector("#root").inert,
            overflow: document.documentElement.scrollWidth - innerWidth };
        });
        assert(geometry.hit && geometry.focus && geometry.rootInert && geometry.overflow <= 1 &&
          geometry.rect.left >= 0 && geometry.rect.top >= 0 && geometry.rect.right <= width + 1 && geometry.rect.bottom <= m.height + 1);
        await page.keyboard.press("Tab"); assert(await lock.evaluate(n => n.contains(document.activeElement)));
        await page.keyboard.press("Shift+Tab"); assert(await lock.evaluate(n => n.contains(document.activeElement)));
        report.lockMatrix.push({ ...m, viewport, geometry }); save();
      }
      await host.shot("owner-lock"); await metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });
      await goHome(); await openProject(projects[1]); assert.equal(await page.getByTestId("assistant-project-lock-dialog").count(), 0);
      const other = await assistant("creation");
      await other.getByTestId("assistant-process-monitor").locator(`li[data-process-id="${a.id}"][data-status="running"]`).waitFor();
      assert.equal(await other.getByRole("heading", { name: "QUEUE_A组件", exact: true }).count(), 0);
      return { ownerTask: a.id, secondProjectReadOnlyMonitor: true };
    });
    await stage("queued-cancel-does-not-call-model-or-edit-either-project", async () => {
      b = await submit(await assistant("creation"), "QUEUE_B 构建标题按钮");
      await waitProcess(b.id, p => p.status === "queued");
      const lock = page.getByTestId("assistant-project-lock-dialog"); await lock.waitFor();
      assert.equal(provider.requests.filter(r => r.marker === "QUEUE_B").length, 0);
      await lock.getByRole("button", { name: "取消此创造任务", exact: true }).click();
      await waitProcess(b.id, p => p.status === "cancelled"); await lock.waitFor({ state: "detached" });
      assert.equal(provider.requests.filter(r => r.marker === "QUEUE_B").length, 0); await unchanged();
      return { cancelledTask: b.id, modelRequests: 0 };
    });
    await stage("fifo-single-worker-completion-retains-project-ownership-without-automerge", async () => {
      let panel = await assistant("creation"); await panel.getByTestId("assistant-new-conversation").click();
      c = await submit(panel, "QUEUE_C 构建标题按钮"); await waitProcess(c.id, p => p.status === "queued");
      assert.equal(provider.requests.filter(r => r.marker === "QUEUE_C").length, 0);
      provider.release("QUEUE_A"); await waitProcess(a.id, p => p.status === "completed"); await waitProcess(c.id, p => p.status === "completed");
      await page.getByTestId("assistant-project-lock-dialog").waitFor({ state: "detached" }); panel = await assistant("creation");
      await panel.getByTestId("assistant-creation-draft").getByRole("heading", { name: "QUEUE_C组件", exact: true }).waitFor();
      assert.equal(provider.maxConcurrentCreation, 1);
      assert.deepEqual(provider.requests.filter(r => r.creation).map(r => r.marker), ["QUEUE_A", "QUEUE_C"]);
      await unchanged(); await goHome(); await openProject(projects[0]); panel = await assistant("creation");
      await panel.getByTestId("assistant-creation-draft").getByRole("heading", { name: "QUEUE_A组件", exact: true }).waitFor();
      assert.equal(await panel.getByRole("heading", { name: "QUEUE_C组件", exact: true }).count(), 0);
      return { fifo: [a.id, c.id], noAutomaticMerge: true };
    });
    await stage("history-geometry-focus-archive-restore-and-delete-cancel", async () => {
      const panel = page.locator(".workspace-task-panel.is-open .assistant-chat-panel"), h = await history(panel);
      for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        const m = { width, height: width * 9 / 16, dpr, reduced }, viewport = await metrics(m);
        const button = h.getByRole("button", { name: /^归档 QUEUE_A/ }); await button.scrollIntoViewIfNeeded(); await button.focus();
        const geometry = await button.evaluate(n => {
          const r = n.getBoundingClientRect(), menu = n.closest(".assistant-history-menu").getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return { rect: r.toJSON(), menu: menu.toJSON(), hit: hit === n || n.contains(hit),
            focus: n === document.activeElement, overflow: document.documentElement.scrollWidth - innerWidth };
        });
        assert(geometry.hit && geometry.focus && geometry.overflow <= 1 && geometry.menu.left >= 0 && geometry.menu.top >= 0 &&
          geometry.menu.right <= width + 1 && geometry.menu.bottom <= m.height + 1);
        report.historyMatrix.push({ ...m, viewport, geometry }); save();
      }
      await host.shot("history"); await h.getByRole("button", { name: /^归档 QUEUE_A/ }).click();
      await h.locator(".assistant-history-item.is-archived").waitFor();
      await h.locator(".assistant-history-item.is-archived .assistant-history-select").click();
      await panel.getByText("已归档 · 只读历史", { exact: true }).waitFor();
      assert.equal(await panel.locator('[data-help-key="assistant.send"]').isEnabled(), false);
      await history(panel); await h.getByRole("button", { name: /^恢复 QUEUE_A/ }).click();
      await panel.getByText("已载入本机历史", { exact: true }).waitFor();
      await history(panel); await h.getByRole("button", { name: /^永久删除 QUEUE_A/ }).click();
      const confirm = page.getByTestId("editor-delete-confirmation"); await confirm.waitFor();
      await confirm.getByRole("button", { name: "取消", exact: true }).click(); await confirm.waitFor({ state: "detached" });
      await history(panel); assert.equal(await h.getByRole("button", { name: /^永久删除 QUEUE_A/ }).count(), 1);
      return { archivedReadOnly: true, restored: true, deleteCancelled: true };
    });
    await stage("actual-native-process-restart-restores-project-mode-history-and-draft-without-request", async () => {
      const count = provider.requests.length;
      await host.stop("planned actual host/backend restart; forced stop is not normal-close evidence"); await launch();
      await openProject(projects[0]); let panel = await assistant("creation");
      await panel.getByTestId("assistant-creation-draft").getByRole("heading", { name: "QUEUE_A组件", exact: true }).waitFor();
      panel = await assistant("inquiry"); await panel.getByText("HISTORY_A 这是安装版历史验收回答。", { exact: true }).waitFor();
      assert.equal(await panel.getByRole("heading", { name: "QUEUE_A组件", exact: true }).count(), 0);
      await goHome(); await openProject(projects[1]); panel = await assistant("creation");
      await panel.getByTestId("assistant-creation-draft").getByRole("heading", { name: "QUEUE_C组件", exact: true }).waitFor();
      panel = await assistant("inquiry"); assert.equal(await panel.getByText("HISTORY_A 这是安装版历史验收回答。", { exact: true }).count(), 0);
      assert.equal(provider.requests.length, count); await unchanged(); await host.shot("after-real-restart");
      return { modelRequestCountUnchanged: count, crossProjectAndModeLeak: false };
    });
    await stage("confirmed-history-deletion-survives-second-real-process-restart", async () => {
      await goHome(); await openProject(projects[0]); let panel = await assistant("inquiry");
      const h = await history(panel); await h.getByRole("button", { name: /^永久删除 HISTORY_A/ }).click();
      const confirm = page.getByTestId("editor-delete-confirmation"); await confirm.waitFor();
      await confirm.getByRole("button", { name: "确认删除", exact: true }).click(); await confirm.waitFor({ state: "detached" });
      await panel.getByText("已永久删除该对话", { exact: true }).waitFor();
      await host.stop("second actual restart after user-flow deletion"); await launch();
      await openProject(projects[0]); panel = await assistant("inquiry"); await history(panel);
      assert.equal(await panel.getByRole("button", { name: /^永久删除 HISTORY_A/ }).count(), 0); await unchanged();
      assert.equal(provider.requests.length, 3);
      return { deletionNotResurrected: true, totalControlledRequests: 3 };
    });
    assert.equal(report.cases.length, 7); assert.equal(report.lockMatrix.length, 12); assert.equal(report.historyMatrix.length, 12);
    assert.deepEqual(report.errors, []); assert.equal(report.blockedModelRequests, 0); report.status = "PASS";
  } catch (e) {
    report.status = "FAILED"; report.error = String(e.stack || e); report.failedStage = stageName; process.exitCode = 1;
    if (page && !page.isClosed()) {
      report.failureText = (await page.locator("body").innerText().catch(() => "")).slice(-7000);
      await host.shot("failure").catch(e => { report.failureCaptureError = String(e); });
    }
  } finally {
    try {
      if (host?.current) {
        const active = (await api("/api/assistant/creation/processes?include_terminal=false")).processes || [];
        for (const p of active.filter(p => projects.some(f => f.project_id === p.projectId)))
          await api(`/api/assistant/creation/processes/${p.id}/cancel`, {});
        await api("/api/project/state", { provider_secrets: {} }); report.credentialCleanup = "CLEARED_TEST_ONLY_SECRET";
      }
    } catch (e) { report.credentialCleanup = String(e); report.status = "FAILED"; process.exitCode = 1; }
    try { await host?.stop("final exact owned-process cleanup; not normal close"); }
    catch (e) { report.cleanupError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    if(currentCandidate&&cachePrepared)try{
      cache("Restore");report.cacheRestoration=read(path.join(out,"native-cache-restoration.json")).status;
      assert.equal(report.cacheRestoration,"PASS");
    }catch(e){report.cacheError=String(e.stack||e);report.status="FAILED";process.exitCode=1;}
    if (provider) { report.modelBoundary = provider.requests; report.providerCleanup = await provider.stop(); }
    try { for (const f of [...prep.products, ...prep.sources, ...prep.inputs]) assert.equal(sha(f.path), f.sha256); }
    catch (e) { report.immutabilityError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length, out, error: report.error }));
  }
}
(async () => { if (process.argv[2] === "prepare") prepare(); else await run(process.argv[2]); })()
  .catch(e => { console.error(e); process.exitCode = 1; });
