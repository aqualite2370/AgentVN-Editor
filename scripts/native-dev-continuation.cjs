"use strict";
// Actual current Dev/WebView; public API fixture setup, then real DOM clicks.
// Not installed Release, physical desktop input, or native file-picker acceptance.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { inspectPersistentWorkspace } = require("./editor-workspace-surface-transition-playwright.cjs");
const root = path.resolve(__dirname, ".."), label = "Native-Dev-Continuation-20261020-01";
const qa = `F:/AgentVN/QA/${label}`, checkpoint = `F:/AgentVN/Checkpoints/${label}`;
const summary = path.join(root, "output/native-dev-continuation-20261020-01");
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const describe = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  generatedAt: fs.statSync(f).mtime.toISOString() });
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const write = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 2), { flag: "wx" });
const files = ["AgentVN Dev.exe", "editor/src-tauri/target/debug/agentvn-editor.exe",
  "editor/src-tauri/binaries/creator-backend.exe", "editor/src-tauri/binaries/agentvn-player.exe"];
const declaredSources = ["editor/src/app/App.tsx", "editor/src/store/editorStore.ts",
  "editor/src/store/projectStore.ts", "editor/src/components/editor/EditorToolbar.tsx",
  "editor/src/components/advanced/AdvancedToolsPanel.tsx"];
const sources = () => declaredSources.map(f => describe(path.join(root, f)));
const input = path.join(qa, "原生Dev隔离临时工程.vnproj");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const ps = text => {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-Command", text],
    { encoding: "utf8", windowsHide: true, timeout: 20000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr); return r.stdout.replace(/^\uFEFF/, "").trim();
};
const processes = () => JSON.parse(ps("ConvertTo-Json -Depth 4 -Compress -InputObject @(" +
  "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine," +
  "@{n='Created';e={$_.CreationDate.ToUniversalTime().ToString('o')}})"));
const identity = p => `${p.ProcessId}:${p.Created}`;
async function port() {
  return new Promise((resolve, reject) => {
    const s = net.createServer(); s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const n = s.address().port; s.close(e => e ? reject(e) : resolve(n)); });
  });
}
async function until(fn, name, timeout = 60000) {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) {
    try { const value = await fn(); if (value) return value; } catch (e) { last = String(e); }
    await pause(200);
  }
  throw Error(`Readiness deadline ${name}: ${last || "condition false"}`);
}
async function json(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(2500) }); assert(r.ok, `${r.status} ${url}`); return r.json();
}
async function snapshot(page) {
  return page.evaluate(async () => {
    const p = (await import("/src/store/projectStore.ts")).useProjectStore.getState();
    const g = (await import("/src/store/editorStore.ts")).useEditorStore.getState();
    return JSON.parse(JSON.stringify({ id: p.projectId, title: p.title, settings: p.settings,
      nodes: g.nodes, edges: g.edges, selected: g.selectedNodeId }));
  });
}
async function hit(locator) {
  await locator.scrollIntoViewIfNeeded(); await locator.click({ trial: true });
  const o = await locator.evaluate(n => {
    const r = n.getBoundingClientRect(); return { rect: r.toJSON(),
      inside: r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
      hit: n.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) };
  });
  assert(o.inside && o.hit, JSON.stringify(o)); return o;
}
async function capture(page, cdp, file, expected) {
  const sample = () => page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
  const check = o => { assert.equal(o.width, expected.width); assert.equal(o.height, expected.height);
    assert.equal(o.reduced, expected.reduced); assert(Math.abs(o.dpr - expected.dpr) <= 1e-6); };
  const before = await sample(); check(before);
  const bytes = Buffer.from((await cdp.send("Page.captureScreenshot", {
    format: "png", captureBeyondViewport: false })).data, "base64");
  const after = await sample(); check(after); assert.deepEqual(after, before);
  assert.equal(bytes.readUInt32BE(16), expected.width * expected.dpr);
  assert.equal(bytes.readUInt32BE(20), expected.height * expected.dpr);
  fs.writeFileSync(file, bytes, { flag: "wx" });
  return { ...describe(file), before, after, png: [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] };
}
async function prepare() {
  for (const d of [qa, checkpoint, summary]) { assert(!fs.existsSync(d)); fs.mkdirSync(d, { recursive: true }); }
  const saved = [];
  for (const f of ["scripts/native-dev-continuation.cjs", "scripts/lib/installed-webview-capture.cjs",
    "scripts/editor-workspace-surface-transition-playwright.cjs", "plans/ACTIVE_TASKS.md",
    "plans/FULL_REGRESSION_20261017.md", ...declaredSources]) {
    const to = path.join(checkpoint, f); fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(root, f), to, fs.constants.COPYFILE_EXCL); saved.push(describe(to));
  }
  const project = fixture("native-dev-continuation-20261020-01");
  project.title = "当前Dev真实窗口 隔离回测"; write(input, project);
  write(path.join(summary, "preparation.json"), { status: "PASS", at: new Date().toISOString(),
    saved, products: files.map(f => describe(path.join(root, f))), input: describe(input), sources: sources(),
    recoverableProductCheckpoint: "F:/AgentVN/Checkpoints/Project-Import-Atomic-20261020-01",
    scope: "QA_AND_SOURCE_SNAPSHOTS_EXISTING_BINARY_RECOVERY_PLUS_HASHES_NO_BUILD" });
}
async function run() {
  const visualReview = process.argv.includes("--visual-review");
  const closeReview = process.argv.includes("--close-review");
  const out = path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT || "");
  assert(out.startsWith(path.resolve(qa) + path.sep) && !fs.existsSync(out), "Fresh isolated output required");
  assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT || ""), path.resolve(input));
  const prep = read(path.join(summary, "preparation.json"));
  fs.mkdirSync(out); fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  const report = { status: "RUNNING", at: new Date().toISOString(), cases: [], launches: [], known: [],
    sources: sources(), executable: describe(path.join(root, "AgentVN Dev.exe")), modelRequests: 0,
    scope: "CURRENT_NATIVE_DEV_WEBVIEW_UI_AND_PERSISTENCE_NOT_INSTALLED_OR_PHYSICAL_INPUT",
    setup: "Explicit small fixture via actual public backend import API, not a native file-picker test",
    viewportMethod: "Actual WebView2 CDP metrics/media override; not physical 4K",
    nativeAvailability: { at: "2026-10-20T04:27:54.943Z", method: "sky.list_apps", status: "BLOCKED",
      error: "Computer Use native pipe unavailable, os error 2", inputSent: false } };
  if (visualReview) {
    report.scope = "CURRENT_NATIVE_DEV_OPTIONS_STABLE_SCREENSHOTS_ONLY_NOT_FULL_FUNCTION_MATRIX";
    report.purpose = "Supplement previous native functional evidence; preserve earlier home-entry intermediate captures";
  }
  if (closeReview) {
    assert(!visualReview);
    report.scope = "CURRENT_NATIVE_DEV_BOUNDED_NORMAL_CLOSE_RESTART_ONLY_NO_DISPLAY_MATRIX";
    report.purpose = "Isolate asynchronous descendant exit observation; not a new functional or screenshot matrix";
  }
  const persist = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  let host, browser;
  const data = path.join(out, "data"), webview = path.join(out, "webview");
  const known = new Map(); let current;
  const remember = pid => {
    const rows = processes(), ids = new Set([pid]); let changed = true;
    while (changed) { changed = false; for (const p of rows) if (ids.has(p.ParentProcessId) && !ids.has(p.ProcessId)) {
      ids.add(p.ProcessId); changed = true; } }
    const tree = rows.filter(p => ids.has(p.ProcessId));
    for (const p of tree) known.set(identity(p), p);
    report.known = [...known.values()]; persist(); return tree;
  };
  const listeners = ports => JSON.parse(ps("ConvertTo-Json -Compress -InputObject @(" +
    `Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {$_.LocalPort -in @(${ports.join(",")})}` +
    " | Select-Object LocalPort,OwningProcess)"));
  async function launch() {
    const backend = await port(), cdp = await port(); assert.notEqual(backend, cdp);
    assert.equal(listeners([backend, cdp, 6767]).length, 0, "Do not reuse another process's service");
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$)/.test(k)) delete env[k];
    Object.assign(env, { AGENTVN_EDITOR_DATA_DIR: data, AGENTVN_BACKEND_PORT: String(backend),
      AGENTVN_LEGACY_DATABASE_PATHS: "", WEBVIEW2_USER_DATA_FOLDER: webview,
      VITE_BACKEND_URL: `http://127.0.0.1:${backend}`, AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdp}` });
    host = spawn(path.join(root, "AgentVN Dev.exe"), [], { cwd: out, env, windowsHide: true, stdio: "ignore" });
    host.on("error", e => { report.spawnError = String(e); });
    const row = { at: new Date().toISOString(), pid: host.pid, backend, cdp, data, webview };
    report.launches.push(row); current = row; persist();
    await until(async () => {
      assert.equal(host.exitCode, null, "Current Dev exited during readiness");
      return (await json(`http://127.0.0.1:${backend}/api/health`)).project_container_protocol >= 2;
    }, "actual auto-start backend");
    await until(() => json(`http://127.0.0.1:${cdp}/json/version`), "actual native WebView");
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdp}`);
    const page = await until(() => browser.contexts()[0].pages().find(p => p.url().includes("127.0.0.1:6767")), "Dev document");
    page.setDefaultTimeout(30000);
    await page.locator(".project-home").waitFor({ timeout: 60000 });
    row.tree = remember(host.pid); row.listeners = listeners([backend, cdp, 6767]);
    assert.equal(row.listeners.length, 3);
    assert(row.listeners.every(l => row.tree.some(p => p.ProcessId === l.OwningProcess)));
    const exe = row.tree.find(p => p.ProcessId === host.pid);
    assert.equal(exe.ExecutablePath.toLowerCase(), path.join(root, "AgentVN Dev.exe").toLowerCase());
    assert(row.tree.some(p => /msedgewebview2\.exe$/i.test(p.Name) && p.CommandLine.includes(webview)));
    row.capabilities = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("get_native_capabilities"));
    assert(row.capabilities.includes(`backend-base-url=http://127.0.0.1:${backend}`));
    await page.context().route(/\/api\/(?:assistant\/(?:chat|creation\/processes)|novel\/.*process)/, route => {
      if (route.request().method() !== "POST") return route.continue(); report.modelRequests++; return route.abort();
    });
    persist(); return page;
  }
  async function closeNormally(page) {
    remember(host.pid);
    const h = known.get(identity(processes().find(p => p.ProcessId === host.pid))); assert(h);
    report.closeMethod = "Process.CloseMainWindow WM_CLOSE, not physical input";
    assert.equal(ps(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${h.ProcessId}';` +
      `if($p.CreationDate.ToUniversalTime().ToString('o') -ne '${h.Created}'){throw 'PID identity changed'};` +
      `(Get-Process -Id ${h.ProcessId}).CloseMainWindow()`), "True");
    await until(() => host.exitCode !== null || host.signalCode !== null, "normal Dev shutdown", 30000);
    await browser.close().catch(() => {}); browser = null;
    await until(() => !listeners([current.backend, current.cdp, 6767]).length, "owned listeners release", 20000);
    current.exitObservations = [];
    await until(() => {
      const rows = processes();
      const survivors = current.tree.filter(p => rows.some(a => identity(a) === identity(p)));
      current.exitObservations.push({ at: new Date().toISOString(), survivors });
      persist();
      return survivors.length === 0;
    }, "recorded descendants naturally exit after actual WM_CLOSE", 10000);
    current.normalExit = { exitCode: host.exitCode,
      survivors: current.exitObservations.at(-1).survivors,
      observedForMs: Date.parse(current.exitObservations.at(-1).at) - Date.parse(current.exitObservations[0].at) };
    assert.equal(current.normalExit.survivors.length, 0, "Owned processes survive actual close");
    persist(); host = null;
  }
  try {
    for (const p of prep.products) assert.equal(sha(p.path), p.sha256);
    assert.equal(prep.products[0].sha256, prep.products[1].sha256);
    assert.equal(processes().filter(p => /^(AgentVN Dev|agentvn-editor)\.exe$/i.test(p.Name)).length, 0,
      "Refuse another active Editor session");
    fs.mkdirSync(path.join(data, "backend"), { recursive: true });
    write(path.join(data, "backend/database-migration-decision.json"), { approved: false, sources: [] });
    let page = await launch();
    const endpoint = () => `http://127.0.0.1:${current.backend}`;
    const imported = await fetch(`${endpoint()}/api/project/projects/import`, { method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(input)) },
      body: fs.readFileSync(input) });
    assert(imported.ok, await imported.text()); await page.reload();
    await page.locator('[data-help-key="home.recentProject"]').first().waitFor();
    assert.equal(await page.locator('[data-help-key="home.recentProject"]').count(), 1);
    await page.locator('[data-help-key="home.recentProject"]').click(); await settleEditor(page);
    const cdp = await page.context().newCDPSession(page);
    const matrix = [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr =>
      [false, true].map(reduced => ({ width, height: width * 9 / 16, dpr, reduced }))));
    const tabs = ["settings", "layout", "theme", "assets", "library", "animation", "providers", "history"];
    for (const m of closeReview ? [] : process.argv.includes("--smoke") ? matrix.slice(0, 1) : matrix) {
      const row = { ...m, key: `${m.width}-dpr${m.dpr}-${m.reduced ? "reduce" : "normal"}`, status: "RUNNING", tabs: [] };
      report.cases.push(row); persist();
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: m.width, height: m.height, deviceScaleFactor: m.dpr, mobile: false });
      await page.emulateMedia({ reducedMotion: m.reduced ? "reduce" : "no-preference" }); await settleEditor(page);
      await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
      const before = await snapshot(page); assert.equal(before.id, read(input).project_id);
      if (visualReview) {
        await page.locator('[data-workspace-surface="options"]:visible').click(); await settleEditor(page);
        await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
        await page.locator('.advanced-tab-content[data-tab="layout"][data-advanced-tab-interactive="true"]').waitFor();
        await settleEditor(page);
        await page.waitForFunction(() => {
          const panel = document.querySelector(".workspace-task-panel.is-open");
          return panel && panel.getAnimations({ subtree: true }).every(a =>
            !["running", "pending"].includes(a.playState) || a.effect?.getTiming().iterations === Infinity);
        });
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        row.workspace = await inspectPersistentWorkspace(page);
        assert(row.workspace.paletteVisible && row.workspace.inspectorVisible && !row.workspace.horizontalOverflow);
        row.screenshot = await capture(page, cdp, path.join(out, `${row.key}-options.png`), m);
        row.target = "Stable options > game client layout";
        await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
        row.status = "PASS"; persist(); console.log(`PASS visual ${row.key}`); continue;
      }
      await hit(page.locator('.react-flow__node[data-id="scene"]')); await page.locator('.react-flow__node[data-id="scene"]').click();
      const title = page.locator('input[data-help-key="field.title"]:visible').first();
      await title.fill(`原生持久化 ${row.key}`); await title.press("Tab");
      const baseline = await inspectPersistentWorkspace(page);
      await page.locator('[data-workspace-surface="options"]:visible').click(); await settleEditor(page);
      for (const tab of tabs) {
        const button = page.locator(`[data-help-key="advanced.tab.${tab}"]:visible`);
        const geometry = await hit(button); await button.click();
        await page.locator(`.advanced-tab-content[data-tab="${tab}"][data-advanced-tab-interactive="true"]`).waitFor();
        await settleEditor(page);
        const w = await inspectPersistentWorkspace(page);
        assert(w.paletteVisible && !w.paletteClipped && !w.paletteCoveredByPanel);
        assert(w.inspectorVisible && !w.inspectorCoveredByPanel);
        assert(!w.horizontalOverflow);
        for (const k of ["paletteRect", "flowRect", "inspectorRect"])
          for (const p of ["left", "top", "width", "height"]) assert(Math.abs(w[k][p] - baseline[k][p]) <= 1.5, `${tab} changed ${k}.${p}`);
        row.tabs.push({ tab, geometry, workspace: w }); persist();
      }
      await page.locator('[data-workspace-surface="assistant"]:visible').click(); await settleEditor(page);
      await page.getByRole("button", { name: "问询模式", exact: true }).waitFor();
      row.assistant = { inquiryVisible: true, creationVisible: await page.getByRole("button", { name: "创造模式", exact: true }).isVisible() };
      assert(row.assistant.creationVisible);
      await page.locator('[data-workspace-surface="options"]:visible').click(); await settleEditor(page);
      await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
      const saved = page.waitForResponse(r => r.request().method() === "PUT" && r.url().endsWith(`/api/project/projects/${before.id}`));
      await page.locator('[data-help-key="toolbar.home"]:visible').click(); assert((await saved).ok());
      await page.locator(".project-home").waitFor(); await settleEditor(page);
      const stored = (await json(`${endpoint()}/api/project/projects/${before.id}`)).data;
      assert.equal(stored.nodes.find(n => n.id === "scene").data.scene.title, `原生持久化 ${row.key}`);
      row.backendProject = stored; row.screenshot = await capture(page, cdp, path.join(out, `${row.key}.png`), m);
      await page.locator('[data-help-key="home.recentProject"]').click(); await settleEditor(page);
      assert.equal((await snapshot(page)).nodes.find(n => n.id === "scene").data.scene.title, `原生持久化 ${row.key}`);
      row.status = "PASS"; persist(); console.log(`PASS ${row.key}`);
    }
    assert.equal(report.cases.length, closeReview ? 0 : process.argv.includes("--smoke") ? 1 : 12);
    const finalTitle = visualReview || closeReview ? (await snapshot(page)).nodes.find(n => n.id === "scene").data.scene.title
      : `原生持久化 ${report.cases.at(-1).key}`;
    await page.locator('[data-help-key="toolbar.home"]:visible').click(); await page.locator(".project-home").waitFor(); await settleEditor(page);
    await closeNormally(page);
    report.databaseAfterClose = describe(path.join(data, "backend/vn_engine.db"));
    page = await launch();
    assert.equal(await page.locator('[data-help-key="home.recentProject"]').count(), 1);
    await page.locator('[data-help-key="home.recentProject"]').click(); await settleEditor(page);
    report.afterProcessRestart = await snapshot(page);
    assert.equal(report.afterProcessRestart.id, read(input).project_id);
    assert.equal(report.afterProcessRestart.nodes.find(n => n.id === "scene").data.scene.title, finalTitle);
    await page.locator('[data-help-key="toolbar.home"]:visible').click(); await page.locator(".project-home").waitFor(); await settleEditor(page);
    await closeNormally(page);
    if (closeReview) {
      assert.equal(report.launches.length, 2);
      assert(report.launches.every(l => l.normalExit.exitCode === 0 && l.normalExit.survivors.length === 0));
      report.normalCloseAssertions = [
        { name: "First WM_CLOSE and all recorded owned descendants naturally terminate", status: "PASS" },
        { name: "Same-profile process restart restores project and second WM_CLOSE naturally terminates", status: "PASS" },
      ];
    }
    assert.equal(report.modelRequests, 0);
    for (const p of [...prep.products, ...report.sources]) assert.equal(sha(p.path), p.sha256);
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    try {
      if (host) remember(host.pid);
      await browser?.close().catch(() => {});
      const killed = [];
      for (const p of [...known.values()].reverse()) {
        if (!processes().some(a => identity(a) === identity(p))) continue;
        ps(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${p.ProcessId}';` +
          `if($p -and $p.CreationDate.ToUniversalTime().ToString('o') -eq '${p.Created}'){Stop-Process -Id ${p.ProcessId} -Force -ErrorAction Stop}`);
        killed.push(identity(p));
      }
      const rows = processes(), survivors = [...known.values()].filter(p => rows.some(a => identity(a) === identity(p)));
      const ports = [...new Set(report.launches.flatMap(l => [l.backend, l.cdp, 6767]))];
      const left = listeners(ports);
      report.cleanup = { status: !survivors.length && !left.length ? "PASS" : "FAILED", killed, survivors, listeners: left, ports };
      assert.equal(report.cleanup.status, "PASS"); report.known = [...known.values()];
    } catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); persist();
    console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
  }
}
(async () => { if (process.argv[2] === "prepare") await prepare(); else { assert.equal(process.argv[2], "run"); await run(); } })()
  .catch(e => { console.error(e); process.exitCode = 1; });
