"use strict";
// Two genuine release binaries; checks only, no dependency installation and no cache-version injection.
const fs = require("node:fs"), path = require("node:path"), net = require("node:net"), assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { sha256, settleEditor } = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/installed-webview-capture.cjs");
const run = "D:/AgentVN/output/installed-environment-cache-20261018-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "")), sha = p => sha256(fs.readFileSync(p));
const prep = read(path.join(run, "preparation.json")), fixture = read(path.join(run, "fixtures-02.json"));
const cache = read(path.join(run, "cache-protection.json"));
const out = process.argv[2]; assert(out && path.dirname(path.resolve(out)) === path.resolve(run) && !fs.existsSync(out));
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT), path.resolve(fixture.input));
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), path.resolve(run));
assert.equal(fixture.status, "PASS"); assert(prep.profiles.every(p => fs.existsSync(p.held))); assert(fs.existsSync(cache.held));
fs.mkdirSync(out);
const report = { status: "RUNNING", at: new Date().toISOString(), checks: [], launches: [], screenshots: [], matrix: [],
  pageErrors: [], productChanges: 0, realModelRequests: 0, error: null,
  scope: "REAL_1.9.8_RELEASE_PAYLOAD_AND_NSIS_INSTALLED_1.9.9_WINDOWS_ENV_CACHE_NOT_UPGRADE_INSTALLATION_OR_ANDROID",
  controlledBoundary: "QA project import through real packaged backend; actual publish/recheck UI; original app profiles and external environment cache held",
  fixture: { path: fixture.input, sha256: sha(fixture.input) }, tools: [{ path: __filename, sha256: sha(__filename) }] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const pause = ms => new Promise(r => setTimeout(r, ms));
let child, browser, page, cdp, launch, identities = [], expected, current;
function processes() {
  const p = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
    $qaRows=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)creator-backend|agentvn.*\\.exe'}|
      ForEach-Object {@{pid=$_.ProcessId;parent=$_.ParentProcessId;name=$_.Name;path=$_.ExecutablePath;
      createdUtc=$_.CreationDate.ToUniversalTime().ToString('o')}})
    ConvertTo-Json -InputObject $qaRows -Depth 5 -Compress
  `], { encoding: "utf8", windowsHide: true, timeout: 20000 });
  assert.equal(p.status, 0, p.stderr); return JSON.parse(p.stdout.replace(/^\uFEFF/, ""));
}
async function start(which) {
  assert(!child); assert.equal(processes().length, 0); current = which;
  const product = fixture[which]; assert.equal(sha(product.exe), product.sha256);
  const port = await new Promise(resolve => {
    const server = net.createServer(); server.listen(0, "127.0.0.1", () => { const p = server.address().port; server.close(() => resolve(p)); });
  });
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^AGENTVN_|^WEBVIEW2_|^DATABASE_PATH$/i.test(k)) delete env[k];
  env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${port}`;
  const logFile = path.join(out, `${which}-${report.launches.length + 1}-desktop.log`);
  const fd = fs.openSync(logFile, "wx");
  child = spawn(product.exe, [], { cwd: product.root, env, windowsHide: true, stdio: ["ignore", fd, fd] });
  fs.closeSync(fd);
  launch = { version: product.version, which, pid: child.pid, port, root: product.root, exe: product.exe,
    sha256: product.sha256, logFile, defaultDataAndWebViewPaths: true, extractedNotInstalled: which === "old" };
  report.launches.push(launch); save();
  const until = Date.now() + 60000;
  let ready = false;
  while (Date.now() < until && child.exitCode === null) {
    try {
      ready = (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })).ok
        && (await fetch("http://127.0.0.1:8278/api/health", { signal: AbortSignal.timeout(500) })).ok;
    } catch {}
    if (ready) break; await pause(150);
  }
  identities = processes(); launch.identities = identities; save();
  assert(ready, "Real packaged Editor/backend not ready");
  assert(identities.some(p => p.pid === child.pid && path.resolve(p.path) === path.resolve(product.exe)));
  assert(identities.filter(p => p.name === "creator-backend.exe").length >= 1);
  for (const p of identities) {
    assert.equal(path.resolve(path.dirname(p.path)), path.resolve(product.root));
    if (p.name === "creator-backend.exe") assert(identities.some(q => q.pid === p.parent));
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  launch.initialPageUrls = browser.contexts().flatMap(c => c.pages().map(p => p.url())); save();
  const pageUntil = Date.now() + 45000;
  while (Date.now() < pageUntil) {
    page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes("tauri.localhost"));
    if (page) break; await pause(100);
  }
  assert(page, "Real tauri document did not navigate from its initial WebView page");
  page.setDefaultTimeout(30000); page.on("pageerror", e => report.pageErrors.push({ which, error: String(e) }));
  await page.locator('[data-help-key="home.recentProject"]').first().waitFor();
  cdp = await page.context().newCDPSession(page); await viewport({ width: 1920, height: 1080, dpr: 1, reduced: false });
}
async function stop() {
  if (!child) return;
  await browser?.close().catch(() => {}); browser = null; page = null; cdp = null;
  const live = processes();
  for (const p of live) assert(identities.some(q => q.pid === p.pid && q.path === p.path && q.parent === p.parent && q.createdUtc === p.createdUtc),
    "Refuse to stop unattributed process");
  for (const p of live.sort((a, b) => (a.name === "agentvn-editor.exe" ? 0 : 1) - (b.name === "agentvn-editor.exe" ? 0 : 1))) {
    const now = processes().find(q => q.pid === p.pid); if (!now) continue; assert.deepEqual(now, p);
    const stopped = spawnSync("powershell.exe", ["-NoProfile", "-Command", `Stop-Process -Id ${p.pid} -ErrorAction Stop`],
      { windowsHide: true, encoding: "utf8" });
    assert.equal(stopped.status, 0, stopped.stderr);
  }
  const until = Date.now() + 15000; let remaining;
  do { remaining = processes(); if (!remaining.length) break; await pause(100); } while (Date.now() < until);
  assert.equal(remaining.length, 0);
  launch.cleanup = { status: "PASS", method: "ATTRIBUTED_TERMINATION_NOT_NORMAL_WINDOW_CLOSE", stopped: live };
  child = null; identities = []; save();
}
async function viewport(v) {
  expected = v; await cdp.send("Emulation.setDeviceMetricsOverride", { width: v.width, height: v.height, deviceScaleFactor: v.dpr, mobile: false });
  await page.emulateMedia({ reducedMotion: v.reduced ? "reduce" : "no-preference" });
  await page.waitForFunction(v => innerWidth === v.width && innerHeight === v.height && devicePixelRatio === v.dpr
    && matchMedia("(prefers-reduced-motion: reduce)").matches === v.reduced, v);
  await readInstalledViewport(page, v);
}
async function shot(name) {
  report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, `${name}.png`), expected)); save();
}
async function step(name, fn) {
  const c = { name, which: current, status: "RUNNING" }; report.checks.push(c); save();
  try { c.detail = await fn(c); c.status = "PASS"; }
  catch (e) {
    c.status = "FAILED"; c.error = String(e.stack || e);
    if (page) { c.body = (await page.locator("body").innerText().catch(() => "")).slice(-7000); await shot(`failure-${report.checks.length}`).catch(() => {}); }
  } finally { save(); console.log(`${c.status} ${current} ${name}`); }
  return c.status === "PASS";
}
async function enter() {
  const response = await fetch("http://127.0.0.1:8278/api/project/projects/import", {
    method: "POST", headers: { "Content-Type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(fixture.input)) },
    body: fs.readFileSync(fixture.input), signal: AbortSignal.timeout(30000) });
  const result = await response.json(); assert(response.ok && result.ok && result.data.project_id === fixture.projectId);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: fixture.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
  await page.getByRole("button", { name: "发布", exact: true }).click(); await page.locator(".cartridge-export-panel").waitFor();
}
async function settled() {
  await page.waitForFunction(() => ["passed", "failed"].includes(document.querySelector(".windows-env-panel")?.getAttribute("data-environment-verification")),
    null, { timeout: 180000 });
  // Observe actual completion rather than waiting a fixed decorative timeout.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const dialog = page.locator(".android-env-import-backdrop:visible").filter({ hasText: "环境检测已完成" });
  if (await dialog.count()) {
    await dialog.getByRole("button", { name: "完成", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
  }
  await page.locator('[data-package-stage="settings"]').click();
  const text = await page.locator(".windows-env-panel").innerText();
  assert.equal(await page.locator(".windows-env-panel").getAttribute("data-environment-verification"), "passed", text);
  return text;
}
function retainedNative(name) {
  const source = "C:/Users/1/AppData/Local/com.agentvn.editor/cache/windows-env/windows-env-check.json";
  const candidates = [source, "C:/Users/1/AppData/Local/com.agentvn.editor/windows-env/windows-env-check.json"];
  const found = candidates.find(p => fs.existsSync(p)); assert(found, "Native result file must exist at default app cache");
  const cacheFile = path.join(cache.original, "windows-pass.json"); assert(fs.existsSync(cacheFile));
  const resultFile = path.join(out, `${name}-native-result.json`), cacheCopy = path.join(out, `${name}-pass-cache.json`);
  fs.copyFileSync(found, resultFile, fs.constants.COPYFILE_EXCL); fs.copyFileSync(cacheFile, cacheCopy, fs.constants.COPYFILE_EXCL);
  const value = read(resultFile), pass = read(cacheCopy);
  const logs = [];
  for (const key of ["logPath", "commandLogPath"]) if (value[key] && fs.existsSync(value[key])) {
    const retained = path.join(out, `${name}-${key}.log`); fs.copyFileSync(value[key], retained, fs.constants.COPYFILE_EXCL);
    logs.push({ source: value[key], retained, sha256: sha(retained) });
  }
  return { resultFile, resultSha256: sha(resultFile), cacheFile: cacheCopy, cacheSha256: sha(cacheCopy), value, pass, logs };
}
async function recheck(name) {
  await page.locator('[data-help-key="package.windowsEnvCheck"]').click();
  await page.waitForFunction(() => document.querySelector('[data-help-key="package.windowsEnvCheck"]')?.disabled === true);
  await page.waitForFunction(() => document.querySelector('[data-help-key="package.windowsEnvCheck"]')?.disabled === false,
    null, { timeout: 180000 });
  const text = await settled(); return { ...retainedNative(name), text };
}
(async () => {
  assert.equal(fs.readdirSync(cache.original).length, 0, "QA cache must initially be empty");
  await start("old");
  const oldFresh = await step("Real1.9.8 UI with empty cache performs full Windows check and creates native PASS cache", async c => {
    await enter(); c.observed = { text: await settled(), ...retainedNative("old-first") }; save();
    assert.equal(c.observed.value.status, "PASS"); assert.equal(c.observed.value.ok, true);
    assert.notEqual(c.observed.value.cacheHit, true); await shot("old-first-full-check"); return c.observed;
  });
  if (oldFresh) await step("Same real1.9.8 recheck button reuses its native cache without modifying the cache bytes", async c => {
    const previous = report.checks[0].detail;
    c.observed = await recheck("old-recheck"); save();
    assert.equal(c.observed.value.cacheHit, true); assert.equal(c.observed.cacheSha256, previous.cacheSha256);
    await shot("old-same-version-cache"); return c.observed;
  });
  await stop(); await start("current");
  const newFresh = await step("Actual installed1.9.9 sees genuine1.9.8 cache, automatically rechecks and writes current-version metadata", async c => {
    const priorFile = path.join(cache.original, "windows-pass.json");
    assert(fs.existsSync(priorFile), "Real old check must have created cache");
    c.observed = { priorCache: read(priorFile), priorCacheSha256: sha(priorFile) }; save();
    await enter(); c.observed = { ...c.observed, text: await settled(), ...retainedNative("new-first") }; save();
    assert.equal(c.observed.value.status, "PASS"); assert.notEqual(c.observed.value.cacheHit, true);
    assert.equal(c.observed.pass.cacheEditorVersion, "1.9.9"); assert.equal(c.observed.pass.cachePlatform, "windows");
    assert.equal(c.observed.pass.cacheSchemaVersion, 1); assert.notEqual(c.observed.cacheSha256, c.observed.priorCacheSha256);
    await shot("new-version-auto-recheck"); return c.observed;
  });
  if (newFresh) await step("Actual1.9.9 same-version recheck reuses PASS and preserves durable cache bytes", async c => {
    const previous = report.checks.find(c => c.name.startsWith("Actual installed")).detail;
    c.observed = await recheck("new-recheck"); save();
    assert.equal(c.observed.value.cacheHit, true); assert.equal(c.observed.value.cacheEditorVersion, "1.9.9");
    assert.equal(c.observed.cacheSha256, previous.cacheSha256); await shot("new-same-version-cache"); return c.observed;
  });
  if (newFresh) await step("Current installed environment controls/recheck support12 actual WebView combinations, focus, hit targets and no overflow", async c => {
    c.observed = [];
    for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      const row = { width, height, dpr, reduced, status: "RUNNING" }; report.matrix.push(row); c.observed.push(row); save();
      try {
        await viewport({ width, height, dpr, reduced }); await settleEditor(page);
        const button = page.locator('[data-help-key="package.windowsEnvCheck"]'); await button.focus(); assert(await button.evaluate(e => document.activeElement === e));
        row.geometry = await button.evaluate(e => {
          const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          const panel = e.closest(".cartridge-export-panel").getBoundingClientRect();
          return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, hit: Boolean(hit && e.contains(hit)),
            panel: { x: panel.x, y: panel.y, right: panel.right, bottom: panel.bottom },
            overflow: document.documentElement.scrollWidth - innerWidth };
        });
        const g = row.geometry; assert(g.hit && g.x >= 0 && g.y >= 0 && g.right <= width + 1 && g.bottom <= height + 1);
        assert(g.overflow <= 1); assert(g.x >= g.panel.x - 1 && g.right <= g.panel.right + 1 && g.y >= g.panel.y - 1 && g.bottom <= g.panel.bottom + 1);
        row.native = await recheck(`matrix-${width}-${dpr}-${reduced}`);
        assert.equal(row.native.value.cacheHit, true); assert.equal(row.native.pass.cacheEditorVersion, "1.9.9");
        await shot(`matrix-${width}-${dpr}-${reduced}`); row.status = "PASS";
      } catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); }
      save();
    }
    assert.equal(c.observed.length, 12); assert(c.observed.every(r => r.status === "PASS")); return { combinations: 12 };
  });
  await stop(); await start("current");
  await step("Different installed1.9.9 native process retains same-version environment cache through actual publish entry", async c => {
    const before = sha(path.join(cache.original, "windows-pass.json"));
    await enter(); c.observed = { text: await settled(), ...retainedNative("new-restart") }; save();
    assert.equal(c.observed.value.cacheHit, true); assert.equal(c.observed.cacheSha256, before);
    await shot("new-restart-cache"); return c.observed;
  });
  report.status = report.checks.length === 6 && report.checks.every(c => c.status === "PASS")
    && report.matrix.length === 12 && report.matrix.every(r => r.status === "PASS") && !report.pageErrors.length ? "PASS" : "FAILED";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  try { await stop(); } catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; }
  report.finishedAt = new Date().toISOString(); save(); if (report.status !== "PASS") process.exitCode = 1;
  console.log(JSON.stringify({ status: report.status, checks: report.checks.map(c => ({ name: c.name, status: c.status, error: c.error })),
    matrix: report.matrix.length, error: report.error, cleanupError: report.cleanupError, out }, null, 2));
});
