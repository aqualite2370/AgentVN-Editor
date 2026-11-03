"use strict";
// QA only. Two genuine Dev hosts, one automatically started source backend.
// The only mocked boundary is a loopback model; process deaths are injected.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { buildSync } = require("../editor/node_modules/esbuild");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { nativeSession, until, rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { controlledAssistantProvider } = require("./lib/controlled-assistant-provider.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { readInstalledViewport, captureInstalledWebview } = require("./lib/current-native-capture.cjs");
const root = path.resolve(__dirname, ".."), label = "Native-Assistant-Recovery-20261020-01";
const qa = `F:/AgentVN/QA/${label}`, checkpoint = `F:/AgentVN/Checkpoints/${label}`;
const summary = path.join(root, "output/native-assistant-recovery-20261020-01");
const load = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(root, f), sha256: sha(path.resolve(root, f)) });
const writeNew = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2), { flag: "wx" });
const identity = p => `${p.ProcessId}:${p.Created}`;
const products = ["AgentVN Dev.exe", "editor/src-tauri/target/debug/agentvn-editor.exe",
  "editor/src-tauri/binaries/creator-backend.exe", "editor/src-tauri/binaries/agentvn-player.exe"];
const sources = ["editor/src/components/assistant/AssistantChatPanel.tsx",
  "editor/src/components/assistant/AssistantProjectCreationLockGate.tsx",
  "editor/src/assistant/creationRecovery.ts", "editor/src/assistant/creationProcessQueue.ts",
  "backend/app/api/routes_assistant.py", "backend/app/services/assistant_creation_queue.py",
  "backend/app/services/process_presence.py", "editor/src-tauri/src/main.rs"];
const metric = { width: 1920, height: 1080, dpr: 1, reduced: false };
const stages = [
  "two-native-hosts-share-verified-backend-not-webview-profile",
  "submitting-frontend-restart-keeps-worker-and-recovers-without-resubmission",
  "other-native-project-observes-and-cancels-owner-task",
  "worker-death-recovers-running-and-queued-without-model-replay",
  "cancelling-worker-death-recovers-cancelled-not-completed",
  "terminal-errors-and-unlocked-projects-survive-another-real-restart",
];
function readDb(file) {
  // Read-only query, deliberately excludes provider/credential tables.
  const code = [
    "import json,sqlite3,sys,pathlib",
    "db=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row",
    "tasks=[]",
    "for row in db.execute('SELECT sequence,id,project_id,conversation_id,status,submitted_at,started_at,finished_at,lease_until,payload_json,result_json,error_code,error_message FROM assistant_creation_processes ORDER BY sequence'):",
    " r=dict(row);payload=json.loads(r.pop('payload_json'));r['ownerPid']=payload.get('_creation_owner_pid');r['payloadEmpty']=payload=={};r['hasResult']=r.pop('result_json') is not None;tasks.append(r)",
    "projects=[json.loads(row[0]) for row in db.execute('SELECT project_json FROM editor_project_details ORDER BY project_id')]",
    "print(json.dumps(dict(tasks=tasks,projects=projects),ensure_ascii=False));db.close()",
  ].join("\n");
  const r = spawnSync("python", ["-c", code, file], { encoding: "utf8", windowsHide: true,
    timeout: 20000, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout);
}
async function prepare() {
  for (const dir of [qa, checkpoint, summary]) { assert(!fs.existsSync(dir)); fs.mkdirSync(dir, { recursive: true }); }
  const snapshots = [];
  for (const f of ["scripts/native-assistant-recovery.cjs", "scripts/lib/current-native-editor-session.cjs",
    "scripts/lib/current-native-capture.cjs", "scripts/lib/controlled-assistant-provider.cjs",
    "scripts/lib/owned-process-tree.cjs", ...sources, "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md"]) {
    const dest = path.join(checkpoint, f); fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, f), dest, fs.constants.COPYFILE_EXCL); snapshots.push(desc(dest));
  }
  const compiled = buildSync({ stdin: { resolveDir: root, loader: "ts",
    contents: 'export {switchRuntimeUILayoutType} from "./shared/cartridge/uiLayoutProfiles";export {useProjectStore} from "./editor/src/store/projectStore";' },
    bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text;
  const module = { exports: {} }; new Function("module", "exports", compiled)(module, module.exports);
  const projects = ["a", "b"].map(letter => {
    const p = fixture(`native-recovery-${letter}-20261020-01`); p.title = `Dev异常恢复隔离_${letter.toUpperCase()}_20261020`;
    const defaults = structuredClone(module.exports.useProjectStore.getState().settings);
    p.editor_settings = { ...defaults, ...module.exports.switchRuntimeUILayoutType(defaults, "renpy") };
    p.nodes[0].data.loadingAnimation = { kind: "default" }; p.nodes[0].data.openingAudio = [];
    writeNew(path.join(qa, `${p.project_id}.vnproj`), p); return p;
  });
  writeNew(path.join(summary, "preparation.json"), { status: "PASS", at: new Date().toISOString(),
    products: products.map(desc), sources: sources.map(desc), snapshots, projects,
    inputs: projects.map(p => desc(path.join(qa, `${p.project_id}.vnproj`))) });
  console.log(`PREPARED ${qa}`);
}
async function run(iteration) {
  assert(/^\d{2}$/.test(iteration));
  const out = path.join(qa, `session-${iteration}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const prep = load(path.join(summary, "preparation.json")), projects = prep.projects;
  const input = prep.inputs[0].path, report = { status: "RUNNING", at: new Date().toISOString(),
    scope: "CURRENT_NATIVE_DEV_TWO_HOSTS_SOURCE_BACKEND_LOOPBACK_MODEL_AND_OWNED_KILL_FAULTS",
    setup: "Actual public project import API, not native picker; CDP input is not Computer Use or physical input.",
    products: prep.products, sources: prep.sources, inputs: prep.inputs, input, cases: [], launches: [],
    cleanups: [], screenshots: [], errors: [], submissions: [], peerLaunches: [], peerCleanups: [],
    faults: [], dbSnapshots: [], modelCheckpoints: [], readTransportObservations: [],
    requestBudget: { controlled: 4, paid: 0 },
    realModelRequests: 0, productChanges: 0, devPublicationBuilds: 0,
    buildAccounting: "Each genuine Dev startup may build GameCLI preview; not zero builds.",
    displayScope: "1920x1080 DPR1 normal only; lifecycle semantics, not a new full display-matrix claim." };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  const primary = nativeSession({ out, input, report, save }), peerKnown = new Map();
  let provider, peer, browser, peerPage, peerCdp, currentPeer, primaryLive = false, before, failedStage;
  const dbFile = () => path.join(primary.current.data, "backend/vn_engine.db");
  const assertProducts = () => { for (const f of [...prep.products, ...prep.sources, ...prep.inputs]) assert.equal(sha(f.path), f.sha256, f.path); };
  function snapshot(name) {
    const value = readDb(dbFile()), file = path.join(out, `${name}.json`);
    writeNew(file, value); const item = { name, ...desc(file), observedAt: new Date().toISOString() };
    report.dbSnapshots.push(item); save(); return value;
  }
  async function unchanged() {
    const current = readDb(dbFile()).projects;
    assert.equal(current.length, 2);
    const authored = nodes => nodes.map(({ measured, ...node }) => node);
    for (const p of projects) {
      const v = current.find(v => v.project_id === p.project_id), original = before[p.project_id]; assert(v);
      assert.deepEqual(v.editor_settings, original.editor_settings);
      assert.deepEqual(authored(v.nodes), authored(original.nodes)); assert.deepEqual(v.edges, original.edges);
      assert.deepEqual(v.asset_manifest, original.asset_manifest);
    }
  }
  function bind(page, hostLabel) {
    page.on("request", req => {
      if (req.method() === "POST" && req.url().endsWith("/api/assistant/creation/processes")) {
        const v = req.postDataJSON(); report.submissions.push({ id: v.id, projectId: v.project_id,
          conversationId: v.conversation_id, userRequest: v.request.user_request, hostLabel, at: Date.now() }); save();
      }
    });
  }
  async function startPrimary() { primaryLive = true; await primary.start(); bind(primary.page, `primary-${report.launches.length}`); }
  async function openProject(page, p) {
    await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: p.title }).click();
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
    assert.equal(await page.evaluate(() => window.__AGENTVN_PROJECT_STORE__.getState().projectId), p.project_id);
  }
  async function home(page) {
    const lock = page.getByTestId("assistant-project-lock-dialog");
    if (await lock.isVisible()) await lock.getByRole("button", { name: "返回工程列表", exact: true }).click();
    else {
      await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
      await page.getByRole("button", { name: "返回首页", exact: true }).click();
    }
    await page.locator(".recent-project-open:not(:disabled):visible").first().waitFor();
    await page.waitForFunction(() => !document.querySelector(".app-transition-stage.is-switching"));
  }
  async function assistant(page) {
    await page.locator('[data-workspace-surface="assistant"]:visible').click(); await settleEditor(page);
    const panel = page.locator(".workspace-task-panel.is-open .assistant-chat-panel"); await panel.waitFor();
    await panel.getByRole("button", { name: "创造模式", exact: true }).click();
    await panel.locator('textarea[aria-label="向大模型助手提问"]:not(:disabled)').waitFor(); return panel;
  }
  async function submit(page, text) {
    const panel = await assistant(page); await panel.getByTestId("assistant-new-conversation").click();
    await panel.getByLabel("向大模型助手提问", { exact: true }).fill(text);
    const n = report.submissions.length; await panel.getByRole("button", { name: "生成创作提案", exact: true }).click();
    await until(() => report.submissions.length === n + 1, "one actual UI submission");
    return report.submissions.at(-1);
  }
  const waitTask = (id, predicate, timeout = 55000) => until(async () => {
    let p;
    try { p = await primary.api(`/api/assistant/creation/processes/${id}`); }
    catch (e) {
      // A single read observation failure is not proof the worker exited.
      // Never use this for submission/retry or any billable operation.
      report.readTransportObservations.push({ taskId: id, at: Date.now(), error: String(e),
        cause: String(e.cause || ""), request: "GET_ONLY_NO_SUBMISSION_RETRY" }); save(); throw e;
    }
    return predicate(p) && p;
  }, `process ${id}`, timeout);
  const count = marker => provider.requests.filter(r => r.marker === marker).length;
  function counts(name, expected) {
    const actual = Object.fromEntries(Object.keys(expected).map(k => [k, count(k)]));
    assert.deepEqual(actual, expected); report.modelCheckpoints.push({ name, at: Date.now(), counts: actual }); save();
  }
  async function shotPeer(name) {
    report.screenshots.push(await captureInstalledWebview(peerPage, peerCdp, path.join(out, `${name}.png`), metric)); save();
  }
  function rememberPeer() {
    if (!peer || !currentPeer) return rows();
    const now = rows(), tree = ownedProcessTree(now, peer.pid, currentPeer.created);
    if (tree[0]) currentPeer.created = tree[0].Created;
    for (const p of tree) peerKnown.set(identity(p), p);
    report.peerKnown = [...peerKnown.values()]; save(); return now;
  }
  function verifyServices() {
    const live = rows(), expected = primary.current.listeners;
    assert(expected.every(l => live.some(p => report.known.some(k =>
      k.ProcessId === p.ProcessId && k.Created === p.Created) && p.ProcessId === l.OwningProcess)));
    const actual = listeners(primary.current.ports);
    assert.equal(actual.length, 3);
    for (const l of expected) assert(actual.some(a => a.LocalPort === l.LocalPort && a.OwningProcess === l.OwningProcess));
    return expected;
  }
  async function launchPeer() {
    const services = verifyServices(), env = { ...process.env };
    for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$)/.test(k)) delete env[k];
    const cdpPort = await new Promise((resolve, reject) => {
      const s = net.createServer(); s.once("error", reject);
      s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); });
    });
    assert.equal(listeners([cdpPort]).length, 0);
    const webview = path.join(out, "peer-webview"), temp = path.join(out, "peer-temporary");
    fs.mkdirSync(temp, { recursive: true });
    Object.assign(env, { AGENTVN_EDITOR_DATA_DIR: primary.current.data, AGENTVN_BACKEND_PORT: String(primary.current.ports[0]),
      AGENTVN_LEGACY_DATABASE_PATHS: "", VITE_BACKEND_URL: `http://127.0.0.1:${primary.current.ports[0]}`,
      WEBVIEW2_USER_DATA_FOLDER: webview, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}`,
      TEMP: temp, TMP: temp, AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out });
    const logfile = path.join(out, `peer-${report.peerLaunches.length + 1}.log`), fd = fs.openSync(logfile, "wx");
    peer = spawn(prep.products[0].path, [], { cwd: out, env, windowsHide: true, stdio: ["ignore", fd, fd] });
    fs.closeSync(fd); currentPeer = { pid: peer.pid, cdpPort, webview, temp, data: primary.current.data,
      at: new Date().toISOString(), logfile, reusedServices: services };
    report.peerLaunches.push(currentPeer); save(); rememberPeer();
    await until(() => { assert.equal(peer.exitCode, null); rememberPeer(); return listeners([cdpPort]).length === 1; }, "peer WebView", 120000);
    assert(ownedProcessTree(rows(), peer.pid, currentPeer.created)
      .some(p => p.ProcessId === listeners([cdpPort])[0].OwningProcess));
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    peerPage = await until(() => browser.contexts().flatMap(c => c.pages())
      .find(p => p.url().startsWith("http://127.0.0.1:6767")), "actual peer document");
    peerPage.setDefaultTimeout(25000); peerPage.on("pageerror", e => report.errors.push(String(e)));
    bind(peerPage, `peer-${report.peerLaunches.length}`);
    peerCdp = await peerPage.context().newCDPSession(peerPage);
    await peerCdp.send("Emulation.setDeviceMetricsOverride", { width: metric.width, height: metric.height, deviceScaleFactor: 1, mobile: false });
    await peerPage.emulateMedia({ reducedMotion: "no-preference" }); await readInstalledViewport(peerPage, metric);
    await peerPage.locator(".project-home").waitFor(); rememberPeer(); verifyServices();
    const text = fs.readFileSync(logfile, "utf8");
    assert.match(text, new RegExp(`Compatible backend detected on ${primary.current.ports[0]}; reusing`));
    assert.match(text, /Frontend port 6767 already in use; reusing/);
    assert(!text.includes("Starting Python backend"));
    currentPeer.verified = { sameBackend: true, sameVite: true, distinctProfile: webview !== primary.current.webview,
      realNativePid: peer.pid, sourceBackendNotPackaged: true };
    save();
  }
  async function stopPeer(reason) {
    if (!peer) return;
    await browser?.close().catch(() => {}); browser = undefined; rememberPeer();
    const killed = [];
    for (const p of [...peerKnown.values()].reverse()) {
      if (!rows().some(a => identity(a) === identity(p))) continue;
      ps(`$owned=Get-CimInstance Win32_Process -Filter 'ProcessId=${p.ProcessId}';` +
        `if($owned -and $owned.CreationDate.ToUniversalTime().ToString('o') -eq '${p.Created}'){Stop-Process -Id ${p.ProcessId} -Force -ErrorAction Stop}`);
      killed.push(identity(p));
    }
    const live = rows(), entry = { reason, pid: currentPeer.pid, cdpPort: currentPeer.cdpPort, killed,
      normalExitClaimed: false, survivors: [...peerKnown.values()].filter(p => live.some(a => identity(a) === identity(p))),
      listeners: listeners([currentPeer.cdpPort]) };
    report.peerCleanups.push(entry); save();
    assert.equal(entry.survivors.length, 0); assert.equal(entry.listeners.length, 0); peer = undefined;
    verifyServices();
  }
  async function killAll(name) {
    const pre = snapshot(`${name}-before-kill`), backendIdentities = report.known.filter(p =>
      primary.current.listeners.some(l => l.OwningProcess === p.ProcessId));
    await stopPeer(`${name}: injected submitting frontend death`);
    await primary.stop(`${name}: injected entire owned host/backend termination, not natural crash`);
    primaryLive = false;
    const live = rows(); assert(!backendIdentities.some(p => live.some(a => identity(a) === identity(p))));
    report.faults.push({ name, at: Date.now(), backendIdentities, preTasks: pre.tasks,
      naturalCrashClaimed: false, missingIdentities: backendIdentities.map(identity) }); save();
  }
  async function errorVisible(page, task, status) {
    await page.getByTestId("assistant-project-lock-dialog").waitFor({ state: "detached" });
    const panel = await assistant(page), row = panel.getByTestId("assistant-process-monitor")
      .locator(`li[data-process-id="${task.id}"][data-status="${status}"]`);
    await row.waitFor();
    if (status === "failed") await panel.getByText(/草稿生成失败：.*(停止|重复调用模型)/).first().waitFor();
    else await panel.getByText("创作进程已取消。", { exact: true }).first().waitFor();
    assert.equal(await panel.getByRole("heading", { name: `${task.userRequest.split(" ")[0]}组件`, exact: true }).count(), 0);
    const cancelButtons = row.getByRole("button", { name: /^取消/ });
    assert.equal(await cancelButtons.count(), 0, "Terminal process must not expose an active cancellation button");
    return { status, rowText: await row.innerText(), projectId: task.projectId };
  }
  async function stage(name, fn) {
    failedStage = name; const entry = { name, status: "RUNNING", startedAt: Date.now() }; report.cases.push(entry); save();
    console.log(`START ${name}`);
    try { entry.detail = await fn(); entry.status = "PASS"; console.log(`PASS ${name}`); }
    catch (e) { entry.status = "FAILED"; entry.error = String(e.stack || e); throw e; }
    finally { entry.finishedAt = Date.now(); save(); }
  }
  let resume, cancelTask, running, queued, cancelling;
  try {
    assertProducts(); provider = await controlledAssistantProvider();
    for (const marker of ["RESUME_A", "PEER_A", "INTERRUPTED_A", "INTERRUPTED_C"]) provider.hold(marker);
    report.modelEndpoint = provider.url; save();
    await startPrimary(); before = {};
    for (const p of projects) {
      const f = prep.inputs.find(f => load(f.path).project_id === p.project_id);
      const r = await fetch(`http://127.0.0.1:${primary.current.ports[0]}/api/project/projects/import`, {
        method: "POST", headers: { "content-type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(f.path)) },
        body: fs.readFileSync(f.path), signal: AbortSignal.timeout(30000) });
      const v = await r.json(); assert(r.ok && v.ok && v.data.project_id === p.project_id);
      before[p.project_id] = (await primary.api(`/api/project/projects/${p.project_id}`)).data;
    }
    report.baseline = before;
    await primary.api("/api/project/state", {
      provider_connections: [{ connection_id: "qa-recovery-loopback", provider_type: "openai_compatible", display_name: "本机异常恢复验收",
        base_url: provider.url, api_key_storage: "local", enabled: true }],
      provider_models: [{ provider_id: "qa-recovery-model", connection_id: "qa-recovery-loopback",
        model_id: "controlled-model", model_name: "controlled-model", enabled: true, capabilities: ["text_generation"],
        default_parameters: { structured_mode: "tools", request_timeout_seconds: 300 } }],
      provider_selections: { text_generation: "qa-recovery-model" }, provider_secrets: { "qa-recovery-loopback": "test-only-secret" },
    });
    await primary.page.reload(); await primary.page.locator(".recent-project-open:not(:disabled):visible").first().waitFor();
    await openProject(primary.page, projects[1]);
    await stage(stages[0], async () => {
      await launchPeer(); await openProject(peerPage, projects[0]);
      assert.notEqual(currentPeer.pid, primary.current.pid);
      assert.notEqual(currentPeer.webview, primary.current.webview);
      assert.equal(currentPeer.data, primary.current.data);
      return { primaryPid: primary.current.pid, peerPid: currentPeer.pid, ...currentPeer.verified };
    });
    await stage(stages[1], async () => {
      resume = await submit(peerPage, "RESUME_A 构建标题关于按钮");
      await waitTask(resume.id, p => p.status === "running");
      await until(() => count("RESUME_A") === 1, "held loopback request");
      await peerPage.getByTestId("assistant-project-lock-dialog").waitFor(); await shotPeer("running-before-frontend-death");
      snapshot("frontend-before-restart"); const oldPid = currentPeer.pid;
      await stopPeer("injected frontend-only termination; worker and primary host preserved");
      await waitTask(resume.id, p => p.status === "running");
      await launchPeer(); await openProject(peerPage, projects[0]);
      await peerPage.getByTestId("assistant-project-lock-dialog").waitFor();
      assert.notEqual(currentPeer.pid, oldPid); verifyServices(); counts("frontend-restart-held", { RESUME_A: 1 });
      provider.release("RESUME_A");
      const final = await waitTask(resume.id, p => ["completed", "failed"].includes(p.status));
      assert.equal(final.status, "completed", JSON.stringify(final));
      await peerPage.getByTestId("assistant-project-lock-dialog").waitFor({ state: "detached" });
      const panel = await assistant(peerPage);
      await panel.getByTestId("assistant-creation-draft").getByRole("heading", { name: "RESUME_A组件", exact: true }).waitFor();
      counts("frontend-recovered", { RESUME_A: 1 }); await unchanged(); snapshot("frontend-recovered");
      await shotPeer("frontend-recovered-draft");
      return { task: resume.id, oldPid, newPid: currentPeer.pid, finalStatus: final.status, requests: 1 };
    });
    await stage(stages[2], async () => {
      cancelTask = await submit(peerPage, "PEER_A 构建标题帮助按钮");
      await waitTask(cancelTask.id, p => p.status === "running"); await until(() => count("PEER_A") === 1, "held cross-host task");
      const panel = await assistant(primary.page), row = panel.getByTestId("assistant-process-monitor")
        .locator(`li[data-process-id="${cancelTask.id}"][data-status="running"]`); await row.waitFor();
      assert.equal(await primary.page.getByTestId("assistant-project-lock-dialog").count(), 0);
      assert.equal(await panel.getByRole("heading", { name: "PEER_A组件", exact: true }).count(), 0);
      const button = row.getByRole("button", { name: `取消 ${projects[0].title} 的创作进程`, exact: true });
      await button.scrollIntoViewIfNeeded(); await button.focus();
      const geometry = await button.evaluate(n => {
        const r = n.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { rect: r.toJSON(), hit: hit === n || n.contains(hit), focus: document.activeElement === n,
          overflow: document.documentElement.scrollWidth - innerWidth };
      });
      assert(geometry.hit && geometry.focus && geometry.overflow <= 1 && geometry.rect.left >= 0 &&
        geometry.rect.top >= 0 && geometry.rect.right <= 1921 && geometry.rect.bottom <= 1081);
      await button.click(); await waitTask(cancelTask.id, p => p.status === "cancelling"); provider.release("PEER_A");
      await waitTask(cancelTask.id, p => p.status === "cancelled");
      await peerPage.getByTestId("assistant-project-lock-dialog").waitFor({ state: "detached" });
      await panel.getByTestId("assistant-process-monitor").locator(`li[data-process-id="${cancelTask.id}"][data-status="cancelled"]`).waitFor();
      counts("cross-host-cancel", { RESUME_A: 1, PEER_A: 1 }); await unchanged(); snapshot("cross-host-cancelled");
      await primary.shot("cross-native-project-cancel");
      return { task: cancelTask.id, submittingPid: currentPeer.pid, cancellingPid: primary.current.pid, geometry };
    });
    await stage(stages[3], async () => {
      running = await submit(peerPage, "INTERRUPTED_A 构建标题按钮");
      await waitTask(running.id, p => p.status === "running"); await until(() => count("INTERRUPTED_A") === 1, "held interrupted running task");
      queued = await submit(primary.page, "INTERRUPTED_B 构建另一工程标题按钮");
      await waitTask(queued.id, p => p.status === "queued");
      await primary.page.getByTestId("assistant-project-lock-dialog").waitFor();
      counts("before-worker-death", { RESUME_A: 1, PEER_A: 1, INTERRUPTED_A: 1, INTERRUPTED_B: 0 });
      await killAll("running-and-queued-worker-death"); provider.release("INTERRUPTED_A");
      await until(() => provider.requests.find(r => r.marker === "INTERRUPTED_A").finishedAt, "old model boundary released");
      await startPrimary();
      const finals = [];
      for (const t of [running, queued]) {
        const final = await waitTask(t.id, p => p.status === "failed", 70000);
        assert.equal(final.errorCode, "worker_lost"); assert.match(final.errorMessage, /停止.*(重复模型调用|重复调用模型)/); finals.push(final);
      }
      await openProject(primary.page, projects[1]); const b = await errorVisible(primary.page, queued, "failed");
      await launchPeer(); await openProject(peerPage, projects[0]); const a = await errorVisible(peerPage, running, "failed");
      await unchanged(); snapshot("running-and-queued-recovered"); await shotPeer("worker-lost-running-error");
      counts("after-worker-recovery", { RESUME_A: 1, PEER_A: 1, INTERRUPTED_A: 1, INTERRUPTED_B: 0 });
      return { taskIds: [running.id, queued.id], finals, ui: [a, b], automaticResubmissions: 0 };
    });
    await stage(stages[4], async () => {
      cancelling = await submit(peerPage, "INTERRUPTED_C 构建标题按钮");
      await waitTask(cancelling.id, p => p.status === "running"); await until(() => count("INTERRUPTED_C") === 1, "held cancelling task");
      const panel = await assistant(primary.page);
      const row = panel.getByTestId("assistant-process-monitor").locator(`li[data-process-id="${cancelling.id}"][data-status="running"]`);
      await row.getByRole("button", { name: `取消 ${projects[0].title} 的创作进程`, exact: true }).click();
      await waitTask(cancelling.id, p => p.status === "cancelling");
      await killAll("cancelling-worker-death"); provider.release("INTERRUPTED_C");
      await until(() => provider.requests.find(r => r.marker === "INTERRUPTED_C").finishedAt, "cancelled model boundary released");
      await startPrimary();
      const final = await waitTask(cancelling.id, p => p.status === "cancelled");
      assert.equal(final.errorCode, "worker_lost"); assert(!final.result);
      await openProject(primary.page, projects[1]); await errorVisible(primary.page, queued, "failed");
      await launchPeer(); await openProject(peerPage, projects[0]);
      const ui = await errorVisible(peerPage, cancelling, "cancelled");
      await unchanged(); snapshot("cancelling-recovered"); await shotPeer("worker-lost-cancelled");
      counts("cancelled-no-replay", { RESUME_A: 1, PEER_A: 1, INTERRUPTED_A: 1, INTERRUPTED_B: 0, INTERRUPTED_C: 1 });
      return { taskId: cancelling.id, final, ui };
    });
    await stage(stages[5], async () => {
      await stopPeer("terminal-state persistence frontend restart");
      await primary.stop("terminal-state persistence full host/backend restart"); primaryLive = false;
      await startPrimary(); await openProject(primary.page, projects[1]); await errorVisible(primary.page, queued, "failed");
      await launchPeer(); await openProject(peerPage, projects[0]); await errorVisible(peerPage, cancelling, "cancelled");
      const final = snapshot("final-terminal-durable"); await unchanged();
      assert.equal(final.tasks.length, 5); assert(final.tasks.every(p => p.payloadEmpty));
      assert.deepEqual(final.tasks.map(p => p.status), ["completed", "cancelled", "failed", "failed", "cancelled"]);
      assert.equal(final.tasks.filter(p => p.hasResult).length, 1);
      counts("final-no-auto-replay", { RESUME_A: 1, PEER_A: 1, INTERRUPTED_A: 1, INTERRUPTED_B: 0, INTERRUPTED_C: 1 });
      const h = (await assistant(peerPage)).locator(".assistant-history-popover");
      if (!await h.evaluate(n => n.open)) await h.locator("summary").click();
      await h.locator(".assistant-history-select").filter({ hasText: "RESUME_A" }).click();
      const panel = peerPage.locator(".workspace-task-panel.is-open .assistant-chat-panel");
      await panel.getByTestId("assistant-creation-draft").getByRole("heading", { name: "RESUME_A组件", exact: true }).waitFor();
      await unchanged(); await shotPeer("terminal-restart-old-approved-draft-still-unmerged");
      return { statuses: final.tasks.map(p => ({ id: p.id, status: p.status, errorCode: p.error_code })),
        actualPrimaryStarts: report.launches.length, actualPeerStarts: report.peerLaunches.length, oldDraftRetained: true };
    });
    assert.deepEqual(report.errors, []); assert.equal(report.cases.length, stages.length);
    assert.equal(provider.requests.length, 4);
    report.status = "CURRENT_NATIVE_CONTROLLED_RECOVERY_PASS";
  } catch (e) {
    report.status = "FAILED"; report.error = String(e.stack || e); report.failedStage = failedStage; process.exitCode = 1;
    const active = peerPage && !peerPage.isClosed() ? peerPage : primary.page;
    if (active && !active.isClosed()) report.failureText = (await active.locator("body").innerText().catch(() => "")).slice(-6000);
  } finally {
    if (primaryLive) {
      try { await primary.api("/api/project/state", { provider_secrets: {} }); report.credentialCleanup = "CLEARED_TEST_ONLY_SECRET"; }
      catch (e) { report.credentialCleanupError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    }
    try { await stopPeer("final exact-owned cleanup, not normal close"); }
    catch (e) { report.peerCleanupError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    if (primaryLive) try { await primary.stop("final exact-owned cleanup, not normal close"); primaryLive = false; }
    catch (e) { report.cleanupError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    if (provider) { report.modelBoundary = provider.requests; report.providerCleanup = await provider.stop(); }
    try { assertProducts(); } catch (e) { report.immutabilityError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    const live = rows(), ports = [...new Set([...report.launches.flatMap(l => l.ports), ...report.peerLaunches.map(p => p.cdpPort)])];
    report.finalCleanup = { survivors: [...(report.known || []), ...peerKnown.values()].filter(p =>
      live.some(a => identity(a) === identity(p))), listeners: ports.length ? listeners(ports) : [], ports, normalExitClaimed: false };
    if (report.finalCleanup.survivors.length || report.finalCleanup.listeners.length) { report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, stages: report.cases.length, out,
      requests: report.modelBoundary?.length, error: report.error, cleanupError: report.cleanupError }));
  }
}
if (require.main === module) (process.argv[2] === "prepare" ? prepare() : run(process.argv[2]))
  .catch(e => { console.error(e.stack || e); process.exitCode = 1; });
module.exports = { stages, readDb, qa, summary };
