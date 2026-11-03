"use strict";
// Actual installed Release, host-started packaged backend, physical default
// database/WebView paths. CDP input, not Computer Use or clean-machine evidence.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), net = require("node:net");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { inspectPersistentWorkspace } = require("./editor-workspace-surface-transition-playwright.cjs");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Installed-Candidate-20261021-01";
const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
const out = path.join(qa, `ui-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const desc = file => ({ path: path.resolve(file), sha256: hash(file), bytes: fs.statSync(file).size });
const install = read(path.join(qa, "installation.json"));
assert.equal(install.status, "PASS"); assert.equal(install.metadataRestoration, "PASS");
const protection = read(path.join(qa, "profile-protection.json"));
assert.equal(protection.status, "PASS"); assert(protection.profiles.every(p => fs.existsSync(p.held)));
const expectedExe = path.join(install.installRoot, "agentvn-editor.exe");
assert.equal(hash(expectedExe), install.executable.sha256);
const input = path.join(qa, "安装版隔离临时工程.vnproj");
assert(!fs.existsSync(input));
// A valid isolated input is declared, but the test creates its real project via
// the homepage and does not import this fixture or inject editor state.
fs.writeFileSync(input, JSON.stringify(fixture("installed-candidate-declared-fixture-20261021-01")), { flag: "wx" });
const report = {
  status: "RUNNING", startedAt: new Date().toISOString(), cases: [], launches: [], modelRequests: 0,
  scope: "HOST_NSIS_1_9_13_ACTUAL_INSTALLED_UI_NOT_CLEAN_MACHINE_OR_FULL_REGRESSION",
  dataDirectoryOverride: false, webviewDirectoryOverride: false, manualBackendSpawn: false,
  testProject: input, workspaceOutput: out, knownProcesses: [], screenshots: [], errors: [],
  nativePicker: "NOT_RUN", normalWindowClose: "NOT_RUN", sourceServer: false,
};
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$)/i.test(key)) delete env[key];
Object.assign(env, { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out });
const ps = (script, extra = {}) => {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024, env: { ...env, ...extra } });
  assert.equal(r.status, 0, `${r.stderr || r.error}`); return r.stdout.replace(/^\uFEFF/, "").trim();
};
const processes = () => JSON.parse(ps(`$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';
ConvertTo-Json -Depth 4 -Compress -InputObject @(Get-CimInstance Win32_Process |
Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,@{n='created';e={$_.CreationDate.ToUniversalTime().ToString('o')}})`));
const key = p => `${p.ProcessId}:${p.created}`;
const known = new Map();
let browser, current;
async function until(fn, label, ms = 60000) {
  const deadline = Date.now() + ms; let last;
  while (Date.now() < deadline) {
    try { const result = await fn(); if (result) return result; } catch (error) { last = String(error); }
    await pause(150);
  }
  throw Error(`${label}: ${last || "readiness deadline"}`);
}
async function json(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(2000) }); assert(r.ok, `${r.status} ${url}`); return r.json();
}
function remember() {
  const rows = processes(), ids = new Set([current.pid]); let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) if (!ids.has(row.ProcessId) && ids.has(row.ParentProcessId)) { ids.add(row.ProcessId); changed = true; }
  }
  const tree = rows.filter(r => ids.has(r.ProcessId));
  for (const row of tree) known.set(key(row), row);
  report.knownProcesses = [...known.values()]; current.tree = tree; save(); return tree;
}
async function stopOwned() {
  if (current) remember();
  await browser?.close().catch(() => {}); browser = null;
  const killed = [];
  for (const row of [...known.values()].reverse()) {
    if (!processes().some(p => key(p) === key(row))) continue;
    ps(`$ErrorActionPreference='Stop';$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${row.ProcessId}';
if($p -and $p.CreationDate.ToUniversalTime().ToString('o') -eq '${row.created}'){
Stop-Process -Id ${row.ProcessId} -Force -ErrorAction Stop}`);
    killed.push(key(row));
  }
  await until(() => !processes().some(p => known.has(key(p))), "owned processes exit", 15000);
  current = null; return { killed, method: "IDENTITY_CHECKED_TERMINATION_NOT_NORMAL_CLOSE" };
}
async function launch() {
  assert(!processes().some(p => /^(agentvn-editor|AgentVN Dev|creator-backend)\.exe$/i.test(p.Name)));
  assert.equal(ps("(@(Get-NetTCPConnection -State Listen -LocalPort 8278 -ErrorAction SilentlyContinue)).Count"), "0");
  const port = await new Promise(resolve => {
    const server = net.createServer(); server.listen(0, "127.0.0.1", () => {
      const value = server.address().port; server.close(() => resolve(value));
    });
  });
  const shortcut = install.generatedShortcuts[0]; assert.equal(hash(shortcut.copy), shortcut.sha256);
  const started = ps(`$ErrorActionPreference='Stop';$p=Start-Process -FilePath '${shortcut.copy.replace(/'/g, "''")}' -WindowStyle Hidden -PassThru;$p.Id`,
    { WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` });
  assert.match(started, /^\d+$/);
  current = { pid: Number(started), cdpPort: port, startedAt: new Date().toISOString(),
    shortcut: desc(shortcut.copy), shortcutOriginal: shortcut.path };
  report.launches.push(current); save();
  await until(() => json("http://127.0.0.1:8278/api/health"), "host-started actual backend");
  await until(() => json(`http://127.0.0.1:${port}/json/version`), "actual installed WebView");
  const tree = remember();
  assert.equal(path.resolve(tree.find(p => p.ProcessId === current.pid).ExecutablePath), path.resolve(expectedExe));
  const backend = tree.find(p => p.Name === "creator-backend.exe"); assert(backend);
  assert.equal(path.resolve(backend.ExecutablePath), path.resolve(install.installRoot, "creator-backend.exe"));
  const owners = JSON.parse(ps(`ConvertTo-Json -Compress -InputObject @(Get-NetTCPConnection -State Listen |
Where-Object {$_.LocalPort -in @(8278,${port})}|Select-Object LocalPort,OwningProcess)`));
  assert.equal(owners.length, 2); assert(owners.every(o => tree.some(p => p.ProcessId === o.OwningProcess)));
  current.owners = owners;
  assert(fs.existsSync("C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db"));
  const profile = JSON.parse(ps(`ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process |
Where-Object {$_.ProcessId -in @(${tree.map(p => p.ProcessId).join(",")}) -and $_.Name -eq 'msedgewebview2.exe'} |
Select-Object ProcessId,CommandLine)`));
  assert(profile.some(p => /C:\\Users\\1\\AppData\\Local\\com\.agentvn\.editor\\EBWebView/i.test(p.CommandLine || "")));
  current.defaultProfileCommandLines = profile;
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = await until(() => browser.contexts()[0].pages().find(p => /tauri\.localhost|^tauri:/.test(p.url())), "actual installed document");
  page.setDefaultTimeout(30000);
  await page.context().route(/\/api\/(?:assistant\/(?:chat|creation\/processes)|novel\/.*process)/, route => {
    if (route.request().method() !== "POST") return route.continue();
    report.modelRequests++; return route.abort();
  });
  page.on("pageerror", error => { report.errors.push(String(error)); save(); });
  await page.locator(".project-home").waitFor({ timeout: 60000 }); await settleEditor(page);
  current.capabilities = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("get_native_capabilities"));
  assert(current.capabilities.includes("backend-base-url=http://127.0.0.1:8278"));
  save(); return page;
}
async function state() {
  const payload = await json("http://127.0.0.1:8278/api/project/state");
  assert(payload.ok);
  return { metadata: payload.data.project_metadata, graph: payload.data.project_graph };
}
async function click(locator) {
  await locator.scrollIntoViewIfNeeded(); await locator.click({ trial: true });
  const geometry = await locator.evaluate(el => {
    const r = el.getBoundingClientRect();
    return { rect: r.toJSON(), visible: r.width > 0 && r.height > 0 && r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
      hit: el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) };
  });
  assert(geometry.visible && geometry.hit); await locator.click(); return geometry;
}
async function screenshot(page, cdp, file, expected) {
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
      .map(a => a.finished.catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const sample = () => page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
  const before = await sample(); assert.deepEqual(before, expected);
  const png = Buffer.from((await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })).data, "base64");
  const after = await sample(); assert.deepEqual(after, before);
  assert.equal(png.readUInt32BE(16), expected.width * expected.dpr); assert.equal(png.readUInt32BE(20), expected.height * expected.dpr);
  fs.writeFileSync(file, png, { flag: "wx" }); return { ...desc(file), before, after };
}
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  let page = await launch();
  assert.match(await page.locator(".home-action-qq small").innerText(), /1\.9\.13/);
  assert.equal(await page.locator('[data-help-key="home.recentProject"]').count(), 0, "Fresh default profile must not expose user projects");
  await click(page.locator('[data-help-key="home.createProject"]:visible').first());
  await page.locator('[data-workspace-surface="edit"]:visible').waitFor(); await settleEditor(page);
  await page.locator(".project-entry-loading-overlay").waitFor({ state: "detached" });
  const initial = await state(); assert(initial.metadata.projectId);
  assert(initial.graph.nodes.some(n => n.id === "node_scene_opening"));
  report.createdProject = initial;
  const actualProject = (await json(`http://127.0.0.1:8278/api/project/projects/${initial.metadata.projectId}`)).data;
  assert.equal(actualProject.project_id, initial.metadata.projectId);
  fs.writeFileSync(input, JSON.stringify(actualProject, null, 2));
  const cdp = await page.context().newCDPSession(page);
  const tabs = ["settings", "layout", "theme", "assets", "library", "animation", "providers", "history"];
  for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
    const m = { width, height: width * 9 / 16, dpr, reduced };
    const row = { ...m, key: `${width}-dpr${dpr}-${reduced ? "reduce" : "normal"}`, status: "RUNNING", tabs: [] };
    report.cases.push(row); save();
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: m.height, deviceScaleFactor: dpr, mobile: false });
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    await click(page.locator('[data-workspace-surface="edit"]:visible')); await settleEditor(page);
    await click(page.locator('.react-flow__node[data-id="node_scene_opening"]'));
    const title = page.locator('input[data-help-key="field.title"]:visible').first();
    await title.fill(`安装版持久化 ${row.key}`); await title.press("Tab");
    const baseline = await inspectPersistentWorkspace(page);
    await click(page.locator('[data-workspace-surface="options"]:visible')); await settleEditor(page);
    for (const tab of tabs) {
      const geometry = await click(page.locator(`[data-help-key="advanced.tab.${tab}"]:visible`));
      await page.locator(`.advanced-tab-content[data-tab="${tab}"][data-advanced-tab-interactive="true"]`).waitFor();
      await settleEditor(page);
      const w = await inspectPersistentWorkspace(page);
      assert(w.paletteVisible && !w.paletteClipped && !w.paletteCoveredByPanel);
      assert(w.inspectorVisible && !w.inspectorCoveredByPanel && !w.horizontalOverflow);
      for (const k of ["paletteRect", "flowRect", "inspectorRect"])
        for (const p of ["left", "top", "width", "height"]) assert(Math.abs(w[k][p] - baseline[k][p]) <= 1.5, `${row.key}/${tab}/${k}.${p}`);
      row.tabs.push({ tab, geometry, workspace: w }); save();
    }
    await click(page.locator('[data-help-key="advanced.tab.layout"]:visible'));
    await page.locator('.advanced-tab-content[data-tab="layout"][data-advanced-tab-interactive="true"]').waitFor();
    await settleEditor(page);
    row.optionsScreenshot = await screenshot(page, cdp, path.join(out, `${row.key}-options.png`), m);
    await click(page.locator('[data-workspace-surface="assistant"]:visible')); await settleEditor(page);
    await page.getByRole("button", { name: "问询模式", exact: true }).waitFor();
    assert(await page.getByRole("button", { name: "创造模式", exact: true }).isVisible());
    await click(page.locator('[data-workspace-surface="options"]:visible')); await settleEditor(page);
    await click(page.locator('[data-workspace-surface="edit"]:visible')); await settleEditor(page);
    const saved = page.waitForResponse(r => r.request().method() === "PUT" && r.url().endsWith(`/api/project/projects/${initial.metadata.projectId}`));
    await click(page.locator('[data-help-key="toolbar.home"]:visible')); assert((await saved).ok());
    await page.locator(".project-home").waitFor(); await settleEditor(page);
    const stored = (await json(`http://127.0.0.1:8278/api/project/projects/${initial.metadata.projectId}`)).data;
    assert.equal(stored.nodes.find(n => n.id === "node_scene_opening").data.scene.title, `安装版持久化 ${row.key}`);
    row.screenshot = await screenshot(page, cdp, path.join(out, `${row.key}-home.png`), m);
    await click(page.locator('[data-help-key="home.recentProject"]')); await settleEditor(page);
    assert.equal((await state()).graph.nodes.find(n => n.id === "node_scene_opening").data.scene.title, `安装版持久化 ${row.key}`);
    row.status = "PASS"; save(); console.log(`PASS ${row.key}`);
  }
  await click(page.locator('[data-help-key="toolbar.home"]:visible')); await page.locator(".project-home").waitFor(); await settleEditor(page);
  report.firstStop = await stopOwned();
  page = await launch();
  assert.equal(await page.locator('[data-help-key="home.recentProject"]').count(), 1);
  await click(page.locator('[data-help-key="home.recentProject"]')); await settleEditor(page);
  report.afterRestart = await state();
  assert.equal(report.afterRestart.metadata.projectId, initial.metadata.projectId);
  assert.equal(report.afterRestart.graph.nodes.find(n => n.id === "node_scene_opening").data.scene.title,
    `安装版持久化 ${report.cases.at(-1).key}`);
  assert.equal(report.cases.length, 12); assert(report.cases.every(c => c.status === "PASS" && c.tabs.length === 8));
  assert.equal(report.modelRequests, 0); assert.deepEqual(report.errors, []);
  report.database = desc("C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db");
  report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(async () => {
  try { report.cleanup = await stopOwned(); }
  catch (error) { report.cleanupError = String(error.stack || error); report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
