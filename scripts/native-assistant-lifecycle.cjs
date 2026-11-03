"use strict";
// Current Dev + automatically started Python/Vite, NOT installed Release.
// Controlled loopback model HTTP only; genuine backend/IDB and DOM controls.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { buildSync } = require("../editor/node_modules/esbuild");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/current-native-capture.cjs");
const { controlledAssistantProvider } = require("./lib/controlled-assistant-provider.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const root = path.resolve(__dirname, ".."), label = "Native-Assistant-Lifecycle-20261020-01";
const qa = `F:/AgentVN/QA/${label}`, checkpoint = `F:/AgentVN/Checkpoints/${label}`;
const summary = path.join(root, "output/native-assistant-lifecycle-20261020-01");
const readFile = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const describe = f => ({ path: path.resolve(root, f), sha256: sha(path.resolve(root, f)) });
const writeNew = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2), { flag: "wx" });
const products = ["AgentVN Dev.exe", "editor/src-tauri/target/debug/agentvn-editor.exe",
  "editor/src-tauri/binaries/creator-backend.exe", "editor/src-tauri/binaries/agentvn-player.exe"];
const sources = ["editor/src/components/assistant/AssistantChatPanel.tsx",
  "editor/src/components/assistant/AssistantProjectCreationLockGate.tsx",
  "editor/src/assistant/creationProcessQueue.ts", "editor/src/store/projectStore.ts",
  "shared/cartridge/uiLayoutProfiles.ts", "backend/app/services/assistant_creation_agent.py",
  "backend/app/api/routes_assistant.py", "editor/src-tauri/src/main.rs"];
const sleep = ms => new Promise(r => setTimeout(r, ms));
function ps(script) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);" + script],
  { encoding: "utf8", windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr); return r.stdout.replace(/^\uFEFF/, "").trim();
}
const processRows = () => JSON.parse(ps("ConvertTo-Json -Depth 4 -Compress -InputObject @(" +
  "Get-CimInstance Win32_Process|Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine," +
  "@{n='Created';e={$_.CreationDate.ToUniversalTime().ToString('o')}})"));
const identity = p => `${p.ProcessId}:${p.Created}`;
const listeners = ports => JSON.parse(ps("ConvertTo-Json -Compress -InputObject @(" +
  `Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object {$_.LocalPort -in @(${ports.join(",")})}` +
  "|Select-Object LocalPort,OwningProcess)"));
async function freePort() {
  return new Promise((resolve, reject) => { const s = net.createServer(); s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); }); });
}
async function until(fn, label, timeout = 45000) {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) {
    try { const value = await fn(); if (value) return value; } catch (e) { last = String(e); }
    await sleep(150);
  }
  throw Error(`Timeout ${label}: ${last || "not ready"}`);
}
async function prepare() {
  for (const dir of [qa, checkpoint, summary]) { assert(!fs.existsSync(dir)); fs.mkdirSync(dir, { recursive: true }); }
  const snapshots = [];
  for (const f of ["scripts/native-assistant-lifecycle.cjs", "scripts/lib/owned-process-tree.cjs",
    "scripts/lib/controlled-assistant-provider.cjs", "scripts/lib/current-native-capture.cjs",
    ...sources, "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md"]) {
    const dest = path.join(checkpoint, f); fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, f), dest, fs.constants.COPYFILE_EXCL);
    snapshots.push({ path: dest, sha256: sha(dest) });
  }
  const compiled = buildSync({ stdin: { resolveDir: root, loader: "ts",
    contents: 'export {switchRuntimeUILayoutType} from "./shared/cartridge/uiLayoutProfiles"; export {useProjectStore} from "./editor/src/store/projectStore";' },
  bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text;
  const module = { exports: {} }; new Function("module", "exports", compiled)(module, module.exports);
  const projects = ["a", "b"].map(letter => {
    const p = fixture(`native-assistant-${letter}-20261020-01`); p.title = `当前Dev 队列隔离工程 ${letter.toUpperCase()}`;
    const defaults = structuredClone(module.exports.useProjectStore.getState().settings);
    p.editor_settings = { ...defaults, ...module.exports.switchRuntimeUILayoutType(defaults, "renpy") };
    return p;
  });
  for (const p of projects) writeNew(path.join(qa, `${p.project_id}.vnproj`), p);
  writeNew(path.join(summary, "preparation.json"), { status: "PASS", at: new Date().toISOString(),
    products: products.map(describe), sources: sources.map(describe), snapshots, projects,
    inputs: projects.map(p => describe(path.join(qa, `${p.project_id}.vnproj`))) });
  console.log(`PREPARED ${qa}`);
}
async function run(iteration) {
  assert(/^\d{2}$/.test(iteration));
  const out = path.join(qa, `session-${iteration}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const baseline = readFile(path.join(summary, "preparation.json")), projects = structuredClone(baseline.projects);
  // editorStore's legitimate legacy-node normalization must not look like an
  // Agent mutation. Preserve the original failed fixture/preparation and make
  // explicit current-schema copies for this new run; keep strict graph equality.
  for (const p of projects) {
    p.nodes[0].data.loadingAnimation = { kind: "default" };
    p.nodes[0].data.openingAudio = [];
    writeNew(path.join(out, `${p.project_id}.vnproj`), p);
  }
  const input = path.join(out, `${projects[0].project_id}.vnproj`), known = new Map();
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  const report = { status: "RUNNING", at: new Date().toISOString(),
    scope: "CURRENT_NATIVE_DEV_AUTOSTART_SOURCE_BACKEND_CONTROLLED_LOOPBACK_MODEL_NOT_RELEASE_OR_REAL_DEEPSEEK",
    setup: "Two explicit small projects via actual public import API; not native file picker evidence.",
    products: baseline.products, sources: baseline.sources, input,
    fixtureRevision: "Explicit current start-node loadingAnimation/openingAudio defaults; original red fixture retained.",
    normalizedInputs: projects.map(p => describe(path.join(out, `${p.project_id}.vnproj`))),
    normalizationSource: describe("editor/src/store/editorStore.ts"),
    cases: [], launches: [], cleanups: [],
    lockMatrix: [], historyMatrix: [], screenshots: [], errors: [], submissions: [],
    realModelRequests: 0, productChanges: 0, devPublicationBuilds: 0,
    buildAccounting: "Each Dev host startup invokes GameCLI preview build, not a zero-build run." };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  let host, current, browser, page, cdp, provider, expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
  let before, stageName;
  const remember = () => {
    const now = processRows();
    if (host && current) {
      const tree = ownedProcessTree(now, host.pid, current.created);
      if (tree[0]) current.created = tree[0].Created;
      for (const p of tree) known.set(identity(p), p);
    }
    report.known = [...known.values()]; save(); return now;
  };
  async function launch() {
    const ports = [await freePort(), await freePort(), 6767];
    assert.equal(listeners(ports).length, 0, "Never reuse an unknown service");
    const data = path.join(out, "data"), webview = path.join(out, "webview"), temp = path.join(out, "temporary");
    fs.mkdirSync(path.join(data, "backend"), { recursive: true }); fs.mkdirSync(temp, { recursive: true });
    if (!fs.existsSync(path.join(data, "backend/database-migration-decision.json")))
      writeNew(path.join(data, "backend/database-migration-decision.json"), { approved: false, sources: [] });
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$)/.test(k)) delete env[k];
    Object.assign(env, { AGENTVN_EDITOR_DATA_DIR: data, AGENTVN_BACKEND_PORT: String(ports[0]), AGENTVN_LEGACY_DATABASE_PATHS: "",
      VITE_BACKEND_URL: `http://127.0.0.1:${ports[0]}`, WEBVIEW2_USER_DATA_FOLDER: webview,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${ports[1]}`, TEMP: temp, TMP: temp,
      AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out });
    const log = fs.openSync(path.join(out, `host-${report.launches.length + 1}.log`), "wx");
    host = spawn(baseline.products[0].path, [], { cwd: out, env, windowsHide: true, stdio: ["ignore", log, log] });
    fs.closeSync(log); current = { pid: host.pid, ports, data, webview, temp, at: new Date().toISOString() };
    report.launches.push(current); save(); remember();
    await until(() => { assert.equal(host.exitCode, null); remember(); return listeners(ports).length === 3; }, "owned services", 120000);
    current.listeners = listeners(ports);
    const liveTree = ownedProcessTree(processRows(), host.pid, current.created);
    assert(current.listeners.every(l => liveTree.some(p => p.ProcessId === l.OwningProcess)));
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${ports[1]}`);
    page = await until(() => browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith("http://127.0.0.1:6767")), "native document");
    page.setDefaultTimeout(25000); page.on("pageerror", e => report.errors.push(String(e)));
    page.on("request", req => {
      if (req.method() === "POST" && req.url().endsWith("/api/assistant/creation/processes")) {
        const v = req.postDataJSON(); report.submissions.push({ id: v.id, projectId: v.project_id,
          conversationId: v.conversation_id, userRequest: v.request.user_request }); save();
      }
    });
    cdp = await page.context().newCDPSession(page); await metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });
    await page.locator(".project-home").waitFor();
  }
  async function stop(reason) {
    await browser?.close().catch(() => {}); browser = undefined;
    remember();
    const killed = [];
    for (const p of [...known.values()].reverse()) {
      if (!processRows().some(a => identity(a) === identity(p))) continue;
      ps(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${p.ProcessId}';` +
        `if($p -and $p.CreationDate.ToUniversalTime().ToString('o') -eq '${p.Created}'){Stop-Process -Id ${p.ProcessId} -Force -ErrorAction Stop}`);
      killed.push(identity(p));
    }
    const now = processRows(), cleanup = { reason, killed, normalExitClaimed: false,
      survivors: [...known.values()].filter(p => now.some(a => identity(a) === identity(p))),
      ports: current.ports, listeners: listeners(current.ports) };
    report.cleanups.push(cleanup); save();
    assert.equal(cleanup.survivors.length, 0); assert.equal(cleanup.listeners.length, 0);
    host = undefined;
  }
  async function api(route, body) {
    const r = await fetch(`http://127.0.0.1:${current.ports[0]}${route}`, {
      ...(body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000) });
    assert(r.ok, `${route} ${r.status}`); return r.json();
  }
  async function metrics(value) {
    expected = value;
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: value.width, height: value.height, deviceScaleFactor: value.dpr, mobile: false });
    await page.emulateMedia({ reducedMotion: value.reduced ? "reduce" : "no-preference" }); await readInstalledViewport(page, value);
  }
  async function shot(name) { report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, `${name}.png`), expected)); save(); }
  async function stage(name, action) {
    stageName = name; const row = { name, status: "RUNNING" }; report.cases.push(row); save(); console.log(`START ${name}`);
    try { row.detail = await action(); row.status = "PASS"; } catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
    save(); console.log(`PASS ${name}`);
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
    const n = report.submissions.length;
    await panel.getByRole("button", { name: "生成创作提案", exact: true }).click();
    await until(() => report.submissions.length === n + 1, "one UI submission");
    return report.submissions.at(-1);
  }
  const waitProcess = (id, predicate) => until(async () => {
    const p = await api(`/api/assistant/creation/processes/${id}`); return predicate(p) && p;
  }, `process ${id}`);
  async function unchanged() {
    for (const p of projects) {
      const actual = (await api(`/api/project/projects/${p.project_id}`)).data, original = before[p.project_id];
      assert.deepEqual(actual.editor_settings, original.editor_settings);
      const authored = nodes => nodes.map(({ measured, ...node }) => node);
      assert.deepEqual(authored(actual.nodes), authored(original.nodes)); assert.deepEqual(actual.edges, original.edges);
    }
  }
  async function history(panel) {
    const h = panel.locator(".assistant-history-popover");
    if (!await h.evaluate(n => n.open)) await h.locator("summary").click(); return h;
  }
  try {
    for (const f of [...baseline.products, ...baseline.sources, ...baseline.inputs]) assert.equal(sha(f.path), f.sha256);
    assert(!processRows().some(p => /^(AgentVN Dev|agentvn-editor)\.exe$/i.test(p.Name)), "Another Editor is active");
    provider = await controlledAssistantProvider(); provider.hold("QUEUE_A");
    report.controlledModel = { url: provider.url, realCredentials: false }; save();
    await launch();
    before = {};
    for (const p of projects) {
      const file = path.join(out, `${p.project_id}.vnproj`);
      const r = await fetch(`http://127.0.0.1:${current.ports[0]}/api/project/projects/import`, { method: "POST",
        headers: { "content-type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(file)) },
        body: fs.readFileSync(file) }); assert(r.ok);
      before[p.project_id] = (await api(`/api/project/projects/${p.project_id}`)).data;
    }
    await api("/api/project/state", {
      provider_connections: [{ connection_id: "qa-loopback", provider_type: "openai_compatible", display_name: "本机受控验收",
        base_url: provider.url, api_key_storage: "local", enabled: true }],
      provider_models: [{ provider_id: "qa-model", connection_id: "qa-loopback", model_id: "controlled-model", model_name: "controlled-model",
        enabled: true, display_name: "本机受控验收", capabilities: ["text_generation"],
        default_parameters: { structured_mode: "tools", request_timeout_seconds: 120 } }],
      provider_selections: { text_generation: "qa-model" }, provider_secrets: { "qa-loopback": "test-only-secret" },
    });
    await page.reload(); await page.locator(".recent-project-open:not(:disabled):visible").first().waitFor();
    let a, b, c;
    await stage("inquiry-has-no-write-tools-and-does-not-mutate-project", async () => {
      await openProject(projects[0]); const panel = await assistant("inquiry");
      await panel.getByLabel("向大模型助手提问", { exact: true }).fill("HISTORY_A 说明会话如何保存");
      await panel.getByRole("button", { name: "发送", exact: true }).click();
      await panel.getByText("HISTORY_A 这是安装版历史验收回答。", { exact: true }).waitFor();
      const req = provider.requests.find(r => r.marker === "HISTORY_A");
      assert(req && !req.creation && req.tools.length === 0); assert.equal(report.submissions.length, 0); await unchanged();
      return { transport: req.stream ? "SSE" : "AgentVN SSE over nonstream provider", paid: false };
    });
    await stage("running-owner-lock-and-other-project-global-monitor", async () => {
      a = await submit(await assistant("creation"), "QUEUE_A 构建标题关于按钮");
      await waitProcess(a.id, p => p.status === "running");
      const lock = page.getByTestId("assistant-project-lock-dialog"); await lock.waitFor();
      for (const [width, height] of desktopViewports) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        await metrics({ width, height, dpr, reduced });
        await lock.getByRole("button", { name: "返回工程列表", exact: true }).focus();
        const geometry = await lock.evaluate(n => {
          const r = n.getBoundingClientRect(), button = n.querySelector('[aria-label="返回工程列表"]'), b = button.getBoundingClientRect();
          const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
          return { rect: r.toJSON(), hit: hit === button || button.contains(hit), focus: n.contains(document.activeElement),
            rootInert: document.querySelector("#root").inert, overflow: document.documentElement.scrollWidth - innerWidth };
        });
        assert(geometry.hit && geometry.focus && geometry.rootInert && geometry.overflow <= 1 &&
          geometry.rect.left >= 0 && geometry.rect.top >= 0 && geometry.rect.right <= width + 1 && geometry.rect.bottom <= height + 1);
        await page.keyboard.press("Tab"); assert(await lock.evaluate(n => n.contains(document.activeElement)));
        await page.keyboard.press("Shift+Tab"); assert(await lock.evaluate(n => n.contains(document.activeElement)));
        report.lockMatrix.push({ width, height, dpr, reduced, geometry }); save();
      }
      assert.equal(report.lockMatrix.length, 12); await shot("owner-lock");
      await metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });
      await goHome(); await openProject(projects[1]); assert.equal(await page.getByTestId("assistant-project-lock-dialog").count(), 0);
      const other = await assistant("creation");
      await other.getByTestId("assistant-process-monitor").locator(`li[data-process-id="${a.id}"][data-status="running"]`).waitFor();
      assert.equal(await other.getByRole("heading", { name: "QUEUE_A组件", exact: true }).count(), 0);
    });
    await stage("queued-cancel-does-not-call-model-or-edit-either-project", async () => {
      b = await submit(await assistant("creation"), "QUEUE_B 构建标题按钮");
      await waitProcess(b.id, p => p.status === "queued");
      const lock = page.getByTestId("assistant-project-lock-dialog"); await lock.waitFor();
      assert.equal(provider.requests.filter(r => r.marker === "QUEUE_B").length, 0);
      await lock.getByRole("button", { name: "取消此创造任务", exact: true }).click();
      await waitProcess(b.id, p => p.status === "cancelled"); await lock.waitFor({ state: "detached" });
      assert.equal(provider.requests.filter(r => r.marker === "QUEUE_B").length, 0); await unchanged();
    });
    await stage("fifo-single-worker-completion-retains-project-ownership-without-automerge", async () => {
      let panel = await assistant("creation"); await panel.getByTestId("assistant-new-conversation").click();
      c = await submit(panel, "QUEUE_C 构建标题按钮"); await waitProcess(c.id, p => p.status === "queued");
      assert.equal(provider.requests.filter(r => r.marker === "QUEUE_C").length, 0);
      provider.release("QUEUE_A"); await waitProcess(a.id, p => p.status === "completed"); await waitProcess(c.id, p => p.status === "completed");
      await page.getByTestId("assistant-project-lock-dialog").waitFor({ state: "detached" });
      panel = await assistant("creation");
      await panel.getByTestId("assistant-creation-draft").getByRole("heading", { name: "QUEUE_C组件", exact: true }).waitFor();
      assert.equal(provider.maxConcurrentCreation, 1);
      assert.deepEqual(provider.requests.filter(r => r.creation).map(r => r.marker), ["QUEUE_A", "QUEUE_C"]);
      await unchanged(); await goHome(); await openProject(projects[0]); panel = await assistant("creation");
      await panel.getByTestId("assistant-creation-draft").getByRole("heading", { name: "QUEUE_A组件", exact: true }).waitFor();
      assert.equal(await panel.getByRole("heading", { name: "QUEUE_C组件", exact: true }).count(), 0);
    });
    await stage("history-geometry-focus-archive-restore-and-delete-cancel", async () => {
      const panel = page.locator(".workspace-task-panel.is-open .assistant-chat-panel"), h = await history(panel);
      for (const [width, height] of desktopViewports) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        await metrics({ width, height, dpr, reduced });
        const b = h.getByRole("button", { name: /^归档 QUEUE_A/ }); await b.scrollIntoViewIfNeeded();
        const geometry = await b.evaluate(n => {
          const r = n.getBoundingClientRect(), menu = n.closest(".assistant-history-menu").getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return { rect: r.toJSON(), menu: menu.toJSON(), hit: hit === n || n.contains(hit), overflow: document.documentElement.scrollWidth - innerWidth };
        });
        assert(geometry.hit && geometry.overflow <= 1 && geometry.menu.left >= 0 && geometry.menu.top >= 0 &&
          geometry.menu.right <= width + 1 && geometry.menu.bottom <= height + 1);
        report.historyMatrix.push({ width, height, dpr, reduced, geometry }); save();
      }
      assert.equal(report.historyMatrix.length, 12); await shot("history");
      await h.getByRole("button", { name: /^归档 QUEUE_A/ }).click();
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
    });
    await stage("actual-native-process-restart-restores-project-mode-history-and-draft-without-request", async () => {
      const requestCount = provider.requests.length;
      await stop("planned real host/backend restart; force termination is not a normal-close test");
      await launch();
      await page.locator(".recent-project-open:not(:disabled):visible").first().waitFor();
      await openProject(projects[0]); let panel = await assistant("creation");
      await panel.getByTestId("assistant-creation-draft").getByRole("heading", { name: "QUEUE_A组件", exact: true }).waitFor();
      panel = await assistant("inquiry"); await panel.getByText("HISTORY_A 这是安装版历史验收回答。", { exact: true }).waitFor();
      assert.equal(await panel.getByRole("heading", { name: "QUEUE_A组件", exact: true }).count(), 0);
      await goHome(); await openProject(projects[1]); panel = await assistant("creation");
      await panel.getByTestId("assistant-creation-draft").getByRole("heading", { name: "QUEUE_C组件", exact: true }).waitFor();
      panel = await assistant("inquiry"); assert.equal(await panel.getByText("HISTORY_A 这是安装版历史验收回答。", { exact: true }).count(), 0);
      assert.equal(provider.requests.length, requestCount); await unchanged(); await shot("after-real-restart");
    });
    await stage("confirmed-history-deletion-survives-second-real-process-restart", async () => {
      await goHome(); await openProject(projects[0]); let panel = await assistant("inquiry");
      const h = await history(panel); await h.getByRole("button", { name: /^永久删除 HISTORY_A/ }).click();
      const confirm = page.getByTestId("editor-delete-confirmation"); await confirm.waitFor();
      await confirm.getByRole("button", { name: "确认删除", exact: true }).click(); await confirm.waitFor({ state: "detached" });
      await panel.getByText("已永久删除该对话", { exact: true }).waitFor();
      await stop("second planned real restart after user-flow deletion");
      await launch(); await page.locator(".recent-project-open:not(:disabled):visible").first().waitFor();
      await openProject(projects[0]); panel = await assistant("inquiry"); await history(panel);
      assert.equal(await panel.getByRole("button", { name: /^永久删除 HISTORY_A/ }).count(), 0); await unchanged();
      assert.equal(provider.requests.length, 3, "History/restart must not submit new model work");
    });
    assert.equal(report.cases.length, 7); assert(report.cases.every(r => r.status === "PASS"));
    assert.deepEqual(report.errors, []); report.status = "CURRENT_NATIVE_CONTROLLED_QUEUE_AND_HISTORY_PASS";
  } catch (e) {
    report.status = "FAILED"; report.error = String(e.stack || e); report.failedStage = stageName; process.exitCode = 1;
    if (page && !page.isClosed()) {
      report.failureText = (await page.locator("body").innerText().catch(() => "")).slice(-4500);
      await shot("failure").catch(e => { report.failureCaptureError = String(e); });
    }
  } finally {
    if (host) {
      try { await api("/api/project/state", { provider_secrets: {} }); report.credentialCleanup = "CLEARED_TEST_ONLY_SECRET"; }
      catch (e) { report.credentialCleanup = String(e); report.status = "FAILED"; process.exitCode = 1; }
      try { await stop("final ownership cleanup; no normal-close claim"); }
      catch (e) { report.cleanupError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    }
    if (provider) {
      report.modelBoundary = provider.requests; report.providerCleanup = await provider.stop();
    }
    try { for (const f of [...baseline.products, ...baseline.sources, ...baseline.inputs,
      ...report.normalizedInputs, report.normalizationSource]) assert.equal(sha(f.path), f.sha256); }
    catch (e) { report.immutabilityError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length, out, error: report.error, cleanupError: report.cleanupError }));
  }
}
(async () => {
  if (process.argv[2] === "prepare") await prepare();
  else await run(process.argv[2]);
})().catch(e => { console.error(e); process.exitCode = 1; });
