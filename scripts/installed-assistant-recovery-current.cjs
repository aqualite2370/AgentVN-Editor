"use strict";
// Two actual installed hosts. Shared packaged backend, distinct WebViews.
// Only controlled loopback model HTTP; all deaths are attributed fault injection.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), net = require("node:net");
const assert = require("node:assert/strict"), { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { controlledCreationGuard } = require("./lib/installed-controlled-provider-guard.cjs");
const { controlledAssistantProvider } = require("./lib/controlled-assistant-provider.cjs");
const { until, rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/current-native-capture.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { readDb } = require("./native-assistant-recovery.cjs");
const currentCandidate = process.argv.includes("--candidate=1.9.22"), expectedVersion = currentCandidate ? "1.9.22" : "1.9.14";
const root = path.resolve(__dirname, ".."), label = currentCandidate ?
  "Installed-Assistant-Recovery-1922-20261022-01" : "Installed-Assistant-Recovery-20261021-01";
const qa = `F:/AgentVN/QA/${label}`, checkpoint = `F:/AgentVN/Checkpoints/${label}`;
const installationFile = currentCandidate ?
  "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json" :
  "F:/AgentVN/QA/Runtime-Dialog-Release-20261021-01/installation.json";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const write = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2), { flag: "wx" });
const identity = p => `${p.ProcessId}:${p.Created}`;
const metric = { width: 1920, height: 1080, dpr: 1, reduced: false };
const tools = [__filename, "scripts/lib/installed-release-session.cjs", "scripts/lib/installed-controlled-provider-guard.cjs",
  "scripts/lib/controlled-assistant-provider.cjs", "scripts/lib/owned-process-tree.cjs",
  "scripts/lib/current-native-capture.cjs", "scripts/native-assistant-recovery.cjs"];
if (currentCandidate) tools.push("scripts/installed-layout-cache-session.ps1");
const sources = ["editor/src/components/assistant/AssistantChatPanel.tsx",
  "editor/src/components/assistant/AssistantProjectCreationLockGate.tsx", "editor/src/assistant/creationRecovery.ts",
  "editor/src/assistant/creationProcessQueue.ts", "backend/app/api/routes_assistant.py",
  "backend/app/services/assistant_creation_queue.py", "backend/app/services/process_presence.py",
  "editor/src-tauri/src/main.rs"];
const stages = [
  "two-installed-hosts-share-owned-packaged-backend-with-distinct-webviews",
  "submitting-host-only-restart-preserves-worker-and-recovers-without-new-request",
  "another-native-project-observes-and-cancels-the-owner-task",
  "worker-death-recovers-running-and-queued-without-model-replay",
  "cancelling-worker-death-recovers-cancelled-not-completed",
  "terminal-errors-unlocked-projects-and-old-draft-survive-real-restart",
];
function prepare() {
  assert(fs.existsSync(checkpoint)); assert(!fs.existsSync(qa)); fs.mkdirSync(qa);
  const install = read(installationFile);
  assert.equal(currentCandidate ? install.version : install.executable.version, expectedVersion);
  const prev = read(currentCandidate ?
    "F:/AgentVN/QA/Installed-Assistant-Lifecycle-1922-20261022-01/preparation.json" :
    "F:/AgentVN/QA/Installed-Assistant-Lifecycle-20261021-01/preparation.json");
  for (const f of prev.products) assert.equal(sha(f.path), f.sha256);
  const projects = prev.projects.map((p, i) => ({ ...structuredClone(p),
    project_id: `qa-installed-recovery-${i ? "b" : "a"}-${currentCandidate ? "1922-20261022" : "20261021"}-01`,
    title: `安装恢复隔离 ${i ? "B" : "A"} ${currentCandidate ? "1.9.22 20261022" : "20261021"}` }));
  for (const p of projects) write(path.join(qa, p.project_id + ".vnproj"), p);
  const snapshots = [];
  for (const f of [...tools, ...sources]) {
    const source = path.resolve(root, f), target = path.join(checkpoint, "before-run", path.relative(root, source));
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    snapshots.push(desc(target));
  }
  const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }); assert.equal(git.status, 0);
  write(path.join(qa, "preparation.json"), { at: new Date().toISOString(), products: prev.products,
    installation: desc(installationFile), snapshots, sources: sources.map(f => desc(path.resolve(root, f))),
    projects, inputs: projects.map(p => desc(path.join(qa, p.project_id + ".vnproj"))),
    git: { head: git.stdout.trim(), index: desc(path.join(root, ".git/index")) } });
  console.log(`PREPARED ${qa}`);
}
async function run(attempt, resumeAttempt) {
  assert.match(attempt, /^\d{2}$/); const out = path.join(qa, `session-${attempt}`);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const prep = read(path.join(qa, "preparation.json")), projects = prep.projects;
  if (resumeAttempt) assert.match(resumeAttempt, /^\d{2}$/);
  const parentPath = resumeAttempt && path.join(qa, `session-${resumeAttempt}`, "report.json");
  const parent = parentPath && read(parentPath);
  if (parent) {
    assert.equal(parent.status, "FAILED"); assert.equal(parent.cases.length, 4);
    assert(parent.cases.slice(0, 3).every(c => c.status === "PASS"));
    assert.equal(parent.failedStage, stages[3]); assert.equal(parent.faults.length, 1);
    assert.equal(parent.modelBoundary.length, 3); assert.equal(parent.submissions.length, 4);
    assert.equal(parent.finalCleanup.survivors.length, 0); assert.equal(parent.finalCleanup.listeners.length, 0);
    assert.match(parent.error, /errorVisible/);
  }
  const report = { status: "RUNNING", version: expectedVersion, at: new Date().toISOString(),
    scope: "ACTUAL_NSIS_TWO_NATIVE_HOSTS_PACKAGED_BACKEND_CONTROLLED_MODEL_OWNED_DEATH_INJECTION",
    boundary: "API fixture/provider setup, actual WebView DOM input; not native picker, physical input or normal close.",
    products: prep.products, sources: prep.sources, inputs: prep.inputs, installation: prep.installation,
    tools: tools.map(f => desc(path.resolve(root, f))), cases: [], launches: [], cleanups: [], peerLaunches: [], peerCleanups: [],
    faults: [], dbSnapshots: [], screenshots: [], errorMatrix: [], submissions: [], errors: [], readTransportObservations: [],
    controlledWrites: [], blockedModelRequests: 0, realModelRequests: 0, productChanges: 0, devPublicationBuilds: 0,
    modelCheckpoints: [], requestBudget: { controlled: 4, paid: 0 },
    displayScope: "Lifecycle 1080p DPR1 normal; terminal error controls independently checked at 12 current display combinations.",
    notProven: ["Real DeepSeek", "Independent backends concurrently executing", "Native normal close/picker",
      "MSI/upgrade", "Windows standalone/setup", "Android", "Developer-workspace-independent environment"] };
  if (parent) {
    report.continuation = { path: parentPath, sha256: sha(parentPath), completedCaseIndices: [0, 1, 2],
      reason: "Preserve already verified UI/model work; verify actual per-task failure details, then execute only missing stages.",
      inheritedControlledRequests: 3, additionalControlledRequestBudget: 1, originalFailedStatusPreserved: true };
    for (const key of ["launches", "cleanups", "peerLaunches", "peerCleanups", "faults", "dbSnapshots",
      "screenshots", "submissions", "modelCheckpoints"]) report[key] = structuredClone(parent[key]);
    report.cases = parent.cases.slice(0, 3).map((c, i) => ({ ...structuredClone(c),
      inheritedFrom: { ...report.continuation, caseIndex: i } }));
    report.inheritedModelBoundary = structuredClone(parent.modelBoundary);
    report.inheritedProcesses = structuredClone([...parent.knownProcesses, ...parent.peerKnown]);
    report.clones = [];
    const previousRoot = path.dirname(parentPath);
    for (const n of ["data", "webview", "peer-webview"]) {
      const from = path.join(previousRoot, n), to = path.join(out, n);
      fs.cpSync(from, to, { recursive: true, force: false, errorOnExist: true }); report.clones.push({ from, to });
    }
    const db = path.join(previousRoot, "data/backend/vn_engine.db");
    report.originalDatabase = desc(db); assert.equal(sha(path.join(out, "data/backend/vn_engine.db")), report.originalDatabase.sha256);
  }
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  for (const f of tools) fs.copyFileSync(path.resolve(root, f), path.join(out, path.basename(f)), fs.constants.COPYFILE_EXCL);
  let primary, primaryPage, provider, guard, primaryLive = false, peer, browser, peerPage, peerCdp, currentPeer, before, failedStage,
    cachePrepared = false;
  function cache(action) {
    const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", action, "-RunDirectory", out, "-CodexCacheView"],
    { encoding: "utf8", windowsHide: true, timeout: 45000 });
    (report.cache ??= []).push({ action, exitCode: result.status, stdout: result.stdout, stderr: result.stderr }); save();
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  const peerKnown = new Map(), observed = new WeakSet();
  const api = (...args) => primary.rawApi(...args);
  const dbFile = () => path.join(primary.current.data, "backend/vn_engine.db");
  const assertFiles = () => { for (const f of [...prep.products, ...prep.sources, ...prep.inputs]) assert.equal(sha(f.path), f.sha256, f.path); };
  function snapshot(name) {
    const data = readDb(dbFile()), file = path.join(out, name + ".json"); write(file, data);
    report.dbSnapshots.push({ name, ...desc(file), at: Date.now() }); save(); return data;
  }
  async function unchanged() {
    const current = readDb(dbFile()).projects; assert.equal(current.length, 2);
    for (const actual of current) {
      const original = before[actual.project_id]; assert(original);
      for (const k of ["editor_settings", "edges", "asset_manifest"]) assert.deepEqual(actual[k], original[k]);
      const authored = nodes => nodes.map(({ measured, ...n }) => n); assert.deepEqual(authored(actual.nodes), authored(original.nodes));
    }
  }
  async function bind(page, hostLabel) {
    assert(!observed.has(page)); observed.add(page);
    // Latest route is authoritative on both WebViews; one exact default-deny
    // guard shares task identities across the two hosts. No allow-all override.
    await page.context().route(/\/api\/(?:assistant\/(?:chat|creation\/processes)|novel\/.*process)/, route => {
      const req = route.request(); if (req.method() !== "POST") return route.continue();
      let body; try { body = req.postDataJSON(); } catch { /* denied */ }
      const allowed = guard.allows({ method: "POST", url: req.url(), body }, `http://127.0.0.1:${primary.current.ports[0]}`);
      if (!allowed) { report.blockedModelRequests++; save(); return route.abort(); }
      report.controlledWrites.push({ at: Date.now(), hostLabel, path: new URL(req.url()).pathname, endpoint: provider.url });
      save(); return route.continue();
    });
    page.on("request", req => {
      if (req.method() === "POST" && req.url().endsWith("/api/assistant/creation/processes")) {
        const v = req.postDataJSON(); report.submissions.push({ id: v.id, projectId: v.project_id,
          conversationId: v.conversation_id, userRequest: v.request.user_request, hostLabel, at: Date.now() }); save();
      }
    });
  }
  async function startPrimary() {
    primaryLive = true; primaryPage = await primary.start(); await bind(primaryPage, `primary-${report.launches.length}`);
  }
  function verifyServices() {
    const current = primary.current, expected = current.listeners, actual = listeners(current.ports), live = rows();
    assert.equal(actual.length, 2);
    for (const l of expected) {
      assert(actual.some(a => a.LocalPort === l.LocalPort && a.OwningProcess === l.OwningProcess));
      assert(live.some(p => p.ProcessId === l.OwningProcess && report.knownProcesses.some(k => identity(k) === identity(p))));
    }
    return expected;
  }
  function rememberPeer() {
    if (!peer) return;
    const tree = ownedProcessTree(rows(), peer.pid, currentPeer.created);
    if (tree.length) currentPeer.created = tree[0].Created;
    for (const p of tree) peerKnown.set(identity(p), p);
    report.peerKnown = [...peerKnown.values()]; save();
  }
  async function freePort() {
    return new Promise((resolve, reject) => { const s = net.createServer(); s.once("error", reject);
      s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); }); });
  }
  async function launchPeer() {
    const services = verifyServices(), install = read(installationFile), env = { ...process.env };
    assert.equal(sha(install.executable.path), install.executable.sha256);
    for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$)/i.test(k)) delete env[k];
    const cdpPort = await freePort(); assert.equal(listeners([cdpPort]).length, 0);
    const webview = path.join(out, "peer-webview"), temp = path.join(out, "peer-temporary"); fs.mkdirSync(temp, { recursive: true });
    Object.assign(env, { AGENTVN_EDITOR_DATA_DIR: primary.current.data, AGENTVN_BACKEND_PORT: String(primary.current.ports[0]),
      AGENTVN_LEGACY_DATABASE_PATHS: "", WEBVIEW2_USER_DATA_FOLDER: webview,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}`, TEMP: temp, TMP: temp,
      AGENTVN_TEST_PROJECT: prep.inputs[0].path, AGENTVN_WORKSPACE_OUTPUT: out });
    const logfile = path.join(out, `peer-${report.peerLaunches.length + 1}.log`), fd = fs.openSync(logfile, "wx");
    peer = spawn(install.executable.path, [], { cwd: install.installRoot, env, windowsHide: true, stdio: ["ignore", fd, fd] }); fs.closeSync(fd);
    currentPeer = { pid: peer.pid, cdpPort, webview, temp, data: primary.current.data, at: new Date().toISOString(),
      logfile, executable: install.executable, reusedServices: services, backendPort: primary.current.ports[0] };
    report.peerLaunches.push(currentPeer); rememberPeer();
    await until(async () => {
      assert.equal(peer.exitCode, null); rememberPeer();
      try { return (await fetch(`http://127.0.0.1:${cdpPort}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; }
      catch { return false; }
    }, "real installed peer WebView", 60000);
    const tree = ownedProcessTree(rows(), peer.pid, currentPeer.created);
    assert.equal(listeners([cdpPort]).length, 1); assert(tree.some(p => p.ProcessId === listeners([cdpPort])[0].OwningProcess));
    assert(!tree.some(p => p.Name === "creator-backend.exe"), "Peer must not spawn another backend");
    assert.equal(path.resolve(tree[0].ExecutablePath), path.resolve(install.executable.path));
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    peerPage = await until(() => browser.contexts().flatMap(c => c.pages()).find(p => /tauri\.localhost|^tauri:/.test(p.url())), "installed peer page");
    peerPage.setDefaultTimeout(30000); peerPage.on("pageerror", e => { report.errors.push(String(e)); save(); });
    await bind(peerPage, `peer-${report.peerLaunches.length}`);
    // Subscribe before the explicit reload: initial hydration may predate CDP.
    const pendingState = peerPage.waitForResponse(r => {
      const u = new URL(r.url());
      return u.origin === `http://127.0.0.1:${primary.current.ports[0]}` && u.pathname === "/api/project/state" &&
        r.request().method() === "GET" && r.ok();
    }, { timeout: 30000 });
    await peerPage.reload();
    const observation = await pendingState.then(async r => ({ url: r.url(), ok: (await r.json()).ok }));
    assert(observation.ok);
    peerCdp = await peerPage.context().newCDPSession(peerPage);
    await peerCdp.send("Emulation.setDeviceMetricsOverride", { width: metric.width, height: metric.height, deviceScaleFactor: 1, mobile: false });
    await peerPage.emulateMedia({ reducedMotion: "no-preference" }); await readInstalledViewport(peerPage, metric);
    await peerPage.locator(".project-home").waitFor(); rememberPeer(); verifyServices();
    currentPeer.verified = { sameBackend: true, distinctProfile: webview !== primary.current.webview,
      realNativePid: peer.pid, packagedBackend: true, noPeerBackendChild: true, observation,
      releaseStderrAvailable: fs.statSync(logfile).size > 0 };
    save();
  }
  async function stopPeer(reason) {
    if (!peer) return; await browser?.close().catch(() => {}); browser = undefined; rememberPeer();
    const killed = [];
    for (const p of [...peerKnown.values()].reverse()) {
      if (!rows().some(a => identity(a) === identity(p))) continue;
      ps(`$owned=Get-CimInstance Win32_Process -Filter 'ProcessId=${p.ProcessId}';` +
        `if($owned -and $owned.CreationDate.ToUniversalTime().ToString('o') -eq '${p.Created}'){Stop-Process -Id ${p.ProcessId} -Force -ErrorAction Stop}`);
      killed.push(identity(p));
    }
    const live = rows(), cleanup = { reason, pid: currentPeer.pid, cdpPort: currentPeer.cdpPort, killed,
      normalExitClaimed: false, survivors: [...peerKnown.values()].filter(p => live.some(a => identity(a) === identity(p))),
      listeners: listeners([currentPeer.cdpPort]) };
    report.peerCleanups.push(cleanup); save(); assert.equal(cleanup.survivors.length, 0); assert.equal(cleanup.listeners.length, 0);
    peer = undefined; verifyServices();
  }
  async function openProject(page, p) {
    await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: p.title }).click();
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
    assert.equal(await page.evaluate(() => window.__AGENTVN_PROJECT_STORE__.getState().projectId), p.project_id);
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
    await until(() => report.submissions.length === n + 1, "one UI submission"); return report.submissions.at(-1);
  }
  const waitTask = (id, predicate, timeout = 55000) => until(async () => {
    let value; try { value = await api(`/api/assistant/creation/processes/${id}`); }
    catch (e) { report.readTransportObservations.push({ id, at: Date.now(), error: String(e), readOnlyNoSubmissionRetry: true }); save(); throw e; }
    return predicate(value) && value;
  }, `task ${id}`, timeout);
  const count = marker => [...(report.inheritedModelBoundary || []), ...provider.requests].filter(r => r.marker === marker).length;
  function counts(name, expected) {
    const actual = Object.fromEntries(Object.keys(expected).map(k => [k, count(k)])); assert.deepEqual(actual, expected);
    report.modelCheckpoints.push({ name, at: Date.now(), counts: actual }); save();
  }
  async function shotPeer(name) {
    report.screenshots.push(await captureInstalledWebview(peerPage, peerCdp, path.join(out, name + ".png"), metric)); save();
  }
  async function killAll(name) {
    const pre = snapshot(name + "-before-kill"), live = rows();
    const backendIdentities = report.knownProcesses.filter(p => p.Name === "creator-backend.exe" && live.some(a => identity(a) === identity(p)));
    assert(backendIdentities.length > 0);
    await stopPeer(name + ": injected submitting host death");
    await primary.stop(name + ": injected owned host/backend death, not natural crash"); primaryLive = false;
    const after = rows(); assert(!backendIdentities.some(p => after.some(a => identity(a) === identity(p))));
    report.faults.push({ name, at: Date.now(), backendIdentities, preTasks: pre.tasks, naturalCrashClaimed: false,
      missingIdentities: backendIdentities.map(identity) }); save();
  }
  async function errorVisible(page, task, status) {
    await page.getByTestId("assistant-project-lock-dialog").waitFor({ state: "detached" });
    const panel = await assistant(page), row = panel.getByTestId("assistant-process-monitor")
      .locator(`li[data-process-id="${task.id}"][data-status="${status}"]`); await row.waitFor();
    if (status === "failed") {
      const details = row.locator("details").filter({ hasText: "失败详情" });
      if (!await details.evaluate(n => n.open)) await details.locator("summary").click();
      const message = row.getByTestId("assistant-process-error"); await message.waitFor();
      const taskState = await api(`/api/assistant/creation/processes/${task.id}`);
      assert.equal(await message.locator("code").innerText(), taskState.errorCode);
      const actualMessage = await message.evaluate(n => {
        const copy = n.cloneNode(true); copy.querySelector("code")?.remove(); return copy.textContent.trim();
      });
      assert.equal(actualMessage, taskState.errorMessage); assert.match(actualMessage, /停止.*(重复模型调用|重复调用模型)/);
    }
    else await panel.getByText("创作进程已取消。", { exact: true }).first().waitFor();
    assert.equal(await panel.getByRole("heading", { name: `${task.userRequest.split(" ")[0]}组件`, exact: true }).count(), 0);
    assert.equal(await row.getByRole("button", { name: /^取消/ }).count(), 0);
    return { status, rowText: await row.innerText(), projectId: task.projectId };
  }
  async function stage(name, fn) {
    failedStage = name; const c = { name, status: "RUNNING", startedAt: Date.now() }; report.cases.push(c); save(); console.log(`START ${name}`);
    try { c.detail = await fn(); c.status = "PASS"; console.log(`PASS ${name}`); }
    catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; } finally { c.finishedAt = Date.now(); save(); }
  }
  let resume, cancelTask, running, queued, cancelling;
  try {
    if (currentCandidate) { cache("SelfTest"); cachePrepared = true; cache("Prepare"); }
    assertFiles(); provider = await controlledAssistantProvider(); report.modelEndpoint = provider.url;
    for (const marker of ["RESUME_A", "PEER_A", "INTERRUPTED_A", "INTERRUPTED_C"]) provider.hold(marker);
    const control = { endpoint: provider.url, projectIds: projects.map(p => p.project_id) };
    guard = controlledCreationGuard(control);
    primary = installedReleaseSession({ installationFile, out, input: prep.inputs[0].path, report, save, controlledCreation: control });
    await startPrimary(); before = parent ? structuredClone(parent.baseline) : {};
    for (const f of parent ? [] : prep.inputs) {
      const r = await fetch(`http://127.0.0.1:${primary.current.ports[0]}/api/project/projects/import`, { method: "POST",
        headers: { "content-type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(f.path)) },
        body: fs.readFileSync(f.path), signal: AbortSignal.timeout(30000) }); assert(r.ok); assert((await r.json()).ok);
    }
    if (!parent) for (const p of projects) before[p.project_id] = (await api(`/api/project/projects/${p.project_id}`)).data;
    report.baseline = before;
    await api("/api/project/state", {
      provider_connections: [{ connection_id: "qa-review", provider_type: "openai_compatible", display_name: "安装异常恢复本机受控",
        base_url: provider.url, api_key_storage: "local", enabled: true }],
      provider_models: [{ provider_id: "qa-model", connection_id: "qa-review", model_id: "controlled-model", model_name: "controlled-model",
        enabled: true, capabilities: ["text_generation"], default_parameters: { structured_mode: "tools", request_timeout_seconds: 300 } }],
      provider_selections: { text_generation: "qa-model" }, provider_secrets: { "qa-review": "test-only-secret" },
    });
    await primaryPage.reload(); await primaryPage.locator(".recent-project-open:not(:disabled):visible").first().waitFor();
    await openProject(primaryPage, projects[1]);
    if (!parent) await stage(stages[0], async () => {
      await launchPeer(); await openProject(peerPage, projects[0]);
      assert.notEqual(currentPeer.pid, primary.current.pid); assert.equal(currentPeer.data, primary.current.data);
      return { primaryPid: primary.current.pid, peerPid: currentPeer.pid, ...currentPeer.verified };
    });
    if (!parent) await stage(stages[1], async () => {
      resume = await submit(peerPage, "RESUME_A 构建标题关于按钮"); await waitTask(resume.id, p => p.status === "running");
      await until(() => count("RESUME_A") === 1, "held loopback request");
      await peerPage.getByTestId("assistant-project-lock-dialog").waitFor(); await shotPeer("running-before-frontend-death");
      snapshot("frontend-before-restart"); const oldPid = currentPeer.pid;
      await stopPeer("injected frontend-only death; primary and packaged worker preserved"); await waitTask(resume.id, p => p.status === "running");
      await launchPeer(); await openProject(peerPage, projects[0]); await peerPage.getByTestId("assistant-project-lock-dialog").waitFor();
      assert.notEqual(currentPeer.pid, oldPid); verifyServices(); counts("frontend-restart-held", { RESUME_A: 1 });
      provider.release("RESUME_A"); const final = await waitTask(resume.id, p => ["completed", "failed"].includes(p.status));
      assert.equal(final.status, "completed", JSON.stringify(final));
      await peerPage.getByTestId("assistant-project-lock-dialog").waitFor({ state: "detached" });
      await (await assistant(peerPage)).getByTestId("assistant-creation-draft").getByRole("heading", { name: "RESUME_A组件", exact: true }).waitFor();
      counts("frontend-recovered", { RESUME_A: 1 }); await unchanged(); snapshot("frontend-recovered"); await shotPeer("frontend-recovered-draft");
      return { task: resume.id, oldPid, newPid: currentPeer.pid, finalStatus: final.status, requests: 1 };
    });
    if (!parent) await stage(stages[2], async () => {
      cancelTask = await submit(peerPage, "PEER_A 构建标题帮助按钮");
      await waitTask(cancelTask.id, p => p.status === "running"); await until(() => count("PEER_A") === 1, "held cross-host task");
      const panel = await assistant(primaryPage), row = panel.getByTestId("assistant-process-monitor")
        .locator(`li[data-process-id="${cancelTask.id}"][data-status="running"]`); await row.waitFor();
      assert.equal(await primaryPage.getByTestId("assistant-project-lock-dialog").count(), 0);
      assert.equal(await panel.getByRole("heading", { name: "PEER_A组件", exact: true }).count(), 0);
      const button = row.getByRole("button", { name: `取消 ${projects[0].title} 的创作进程`, exact: true });
      await button.scrollIntoViewIfNeeded(); await button.focus();
      const geometry = await button.evaluate(n => {
        const r = n.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { rect: r.toJSON(), hit: hit === n || n.contains(hit), focus: document.activeElement === n,
          overflow: document.documentElement.scrollWidth - innerWidth };
      }); assert(geometry.hit && geometry.focus && geometry.overflow <= 1 && geometry.rect.left >= 0 &&
        geometry.rect.top >= 0 && geometry.rect.right <= 1921 && geometry.rect.bottom <= 1081);
      await button.click(); await waitTask(cancelTask.id, p => p.status === "cancelling"); provider.release("PEER_A");
      await waitTask(cancelTask.id, p => p.status === "cancelled"); await peerPage.getByTestId("assistant-project-lock-dialog").waitFor({ state: "detached" });
      await panel.getByTestId("assistant-process-monitor").locator(`li[data-process-id="${cancelTask.id}"][data-status="cancelled"]`).waitFor();
      counts("cross-host-cancel", { RESUME_A: 1, PEER_A: 1 }); await unchanged(); snapshot("cross-host-cancelled"); await primary.shot("cross-native-project-cancel");
      return { task: cancelTask.id, submittingPid: currentPeer.pid, cancellingPid: primary.current.pid, geometry };
    });
    await stage(stages[3], async () => {
      if (parent) [resume, cancelTask, running, queued] = report.submissions;
      else {
        running = await submit(peerPage, "INTERRUPTED_A 构建标题按钮"); await waitTask(running.id, p => p.status === "running");
        await until(() => count("INTERRUPTED_A") === 1, "held interrupted task");
        queued = await submit(primaryPage, "INTERRUPTED_B 构建另一工程标题按钮"); await waitTask(queued.id, p => p.status === "queued");
        await primaryPage.getByTestId("assistant-project-lock-dialog").waitFor();
        counts("before-worker-death", { RESUME_A: 1, PEER_A: 1, INTERRUPTED_A: 1, INTERRUPTED_B: 0 });
        await killAll("running-and-queued-worker-death"); provider.release("INTERRUPTED_A");
        await until(() => provider.requests.find(r => r.marker === "INTERRUPTED_A").finishedAt, "old boundary released");
        await startPrimary();
      }
      const finals = [];
      for (const task of [running, queued]) {
        const final = await waitTask(task.id, p => p.status === "failed", 70000); assert.equal(final.errorCode, "worker_lost");
        assert.match(final.errorMessage, /停止.*(重复模型调用|重复调用模型)/); finals.push(final);
      }
      if (!parent) await openProject(primaryPage, projects[1]);
      const b = await errorVisible(primaryPage, queued, "failed");
      await launchPeer(); await openProject(peerPage, projects[0]); const a = await errorVisible(peerPage, running, "failed");
      await unchanged(); snapshot("running-and-queued-recovered"); await shotPeer("worker-lost-running-error");
      counts("after-worker-recovery", { RESUME_A: 1, PEER_A: 1, INTERRUPTED_A: 1, INTERRUPTED_B: 0 });
      return { taskIds: [running.id, queued.id], finals, ui: [a, b], automaticResubmissions: 0 };
    });
    await stage(stages[4], async () => {
      cancelling = await submit(peerPage, "INTERRUPTED_C 构建标题按钮"); await waitTask(cancelling.id, p => p.status === "running");
      await until(() => count("INTERRUPTED_C") === 1, "held cancelling task");
      const panel = await assistant(primaryPage), row = panel.getByTestId("assistant-process-monitor")
        .locator(`li[data-process-id="${cancelling.id}"][data-status="running"]`);
      await row.getByRole("button", { name: `取消 ${projects[0].title} 的创作进程`, exact: true }).click();
      await waitTask(cancelling.id, p => p.status === "cancelling");
      await killAll("cancelling-worker-death"); provider.release("INTERRUPTED_C");
      await until(() => provider.requests.find(r => r.marker === "INTERRUPTED_C").finishedAt, "cancelled boundary released");
      await startPrimary(); const final = await waitTask(cancelling.id, p => p.status === "cancelled");
      assert.equal(final.errorCode, "worker_lost"); assert(!final.result);
      await openProject(primaryPage, projects[1]); await errorVisible(primaryPage, queued, "failed");
      await launchPeer(); await openProject(peerPage, projects[0]); const ui = await errorVisible(peerPage, cancelling, "cancelled");
      await unchanged(); snapshot("cancelling-recovered"); await shotPeer("worker-lost-cancelled");
      counts("cancelled-no-replay", { RESUME_A: 1, PEER_A: 1, INTERRUPTED_A: 1, INTERRUPTED_B: 0, INTERRUPTED_C: 1 });
      return { taskId: cancelling.id, final, ui };
    });
    await stage(stages[5], async () => {
      await stopPeer("terminal persistence frontend restart"); await primary.stop("terminal persistence host/backend restart"); primaryLive = false;
      await startPrimary(); await openProject(primaryPage, projects[1]); await errorVisible(primaryPage, queued, "failed");
      await launchPeer(); await openProject(peerPage, projects[0]); await errorVisible(peerPage, cancelling, "cancelled");
      const final = snapshot("final-terminal-durable"); await unchanged(); assert.equal(final.tasks.length, 5);
      assert(final.tasks.every(p => p.payloadEmpty)); assert.deepEqual(final.tasks.map(p => p.status), ["completed", "cancelled", "failed", "failed", "cancelled"]);
      assert.equal(final.tasks.filter(p => p.hasResult).length, 1);
      counts("final-no-auto-replay", { RESUME_A: 1, PEER_A: 1, INTERRUPTED_A: 1, INTERRUPTED_B: 0, INTERRUPTED_C: 1 });
      const panel = await assistant(peerPage), history = panel.locator(".assistant-history-popover");
      if (!await history.evaluate(n => n.open)) await history.locator("summary").click();
      await history.locator(".assistant-history-select").filter({ hasText: "RESUME_A" }).click();
      await panel.getByTestId("assistant-creation-draft").getByRole("heading", { name: "RESUME_A组件", exact: true }).waitFor(); await unchanged();
      await shotPeer("terminal-restart-original-draft-unmerged");
      for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        const m = { width, height: width * 9 / 16, dpr, reduced }, viewport = await primary.metrics(m);
        const input = primaryPage.getByLabel("向大模型助手提问", { exact: true }); await input.scrollIntoViewIfNeeded(); await input.focus();
        const geometry = await input.evaluate(n => {
          const r = n.getBoundingClientRect(), h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return { rect: r.toJSON(), hit: h === n || n.contains(h), focus: n === document.activeElement,
            enabled: !n.disabled, overflow: document.documentElement.scrollWidth - innerWidth };
        }); assert(geometry.hit && geometry.focus && geometry.enabled && geometry.overflow <= 1 && geometry.rect.left >= 0 &&
          geometry.rect.top >= 0 && geometry.rect.right <= m.width + 1 && geometry.rect.bottom <= m.height + 1);
        const failure = primaryPage.getByTestId("assistant-process-monitor")
          .locator(`li[data-process-id="${queued.id}"]`).getByTestId("assistant-process-error");
        await failure.waitFor(); assert.match(await failure.innerText(), /worker_lost/);
        assert.equal(await primaryPage.getByTestId("assistant-project-lock-dialog").count(), 0);
        report.errorMatrix.push({ ...m, viewport, geometry }); save();
      }
      return { statuses: final.tasks.map(p => ({ id: p.id, status: p.status, errorCode: p.error_code })),
        actualPrimaryStarts: report.launches.length, actualPeerStarts: report.peerLaunches.length, oldDraftRetained: true };
    });
    assert.deepEqual(report.errors, []); assert.equal(report.cases.length, 6); assert.equal(report.errorMatrix.length, 12);
    assert.equal(provider.requests.length, parent ? 1 : 4); assert.equal(report.blockedModelRequests, 0); report.status = "PASS";
  } catch (e) {
    report.status = "FAILED"; report.error = String(e.stack || e); report.failedStage = failedStage; process.exitCode = 1;
    const active = peerPage && !peerPage.isClosed() ? peerPage : primaryPage;
    if (active && !active.isClosed()) report.failureText = (await active.locator("body").innerText().catch(() => "")).slice(-8000);
  } finally {
    if (primaryLive) try { await api("/api/project/state", { provider_secrets: {} }); report.credentialCleanup = "CLEARED_TEST_ONLY_SECRET"; }
    catch (e) { report.credentialCleanupError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    try { await stopPeer("final exact owned cleanup, not normal close"); }
    catch (e) { report.peerCleanupError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    if (primaryLive) try { await primary.stop("final exact owned cleanup, not normal close"); primaryLive = false; }
    catch (e) { report.cleanupError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    if (provider) {
      report.localModelBoundary = provider.requests;
      report.modelBoundary = [...(report.inheritedModelBoundary || []), ...provider.requests];
      report.providerCleanup = await provider.stop();
    }
    if (cachePrepared && fs.existsSync(path.join(out, "native-cache-protection.json")))
      try { cache("Restore"); report.cacheRestoration = "PASS"; }
      catch (e) { report.cacheError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
    try { assertFiles(); } catch (e) { report.immutabilityError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    if (parent) {
      assert.equal(sha(parentPath), report.continuation.sha256);
      assert.equal(sha(report.originalDatabase.path), report.originalDatabase.sha256);
    }
    const live = rows(), ports = [...new Set([...(parent?.finalCleanup.ports || []), ...report.launches.flatMap(l => l.ports),
      ...report.peerLaunches.map(p => p.cdpPort), ...(provider ? [+new URL(provider.url).port] : [])])];
    report.finalCleanup = { survivors: [...(report.inheritedProcesses || []), ...(report.knownProcesses || []), ...peerKnown.values()]
      .filter(p => live.some(a => identity(a) === identity(p))),
      listeners: ports.length ? listeners(ports) : [], ports, normalExitClaimed: false };
    if (report.finalCleanup.survivors.length || report.finalCleanup.listeners.length) { report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length, requests: report.modelBoundary?.length, out, error: report.error }));
  }
}
const cli = process.argv.slice(2).filter(arg => !arg.startsWith("--"));
if (require.main === module) (cli[0] === "prepare" ? Promise.resolve().then(prepare) : run(cli[0], cli[1]))
  .catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { qa, stages, readDb };
