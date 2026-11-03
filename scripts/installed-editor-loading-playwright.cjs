"use strict";
// Current installed Editor only. Faults are network module failures/holds,
// not store/module-loader/timer mocks. No product changes or model requests.
const fs = require("node:fs"), path = require("node:path"), zlib = require("node:zlib");
const assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { sha256, settleEditor } = require("./lib/installed-acceptance.cjs");
const preparationFile = process.env.AGENTVN_INSTALLED_LOADING_PREPARATION;
const { captureInstalledWebview, readInstalledViewport } = require(preparationFile
  ? "./lib/current-native-capture.cjs" : "./lib/installed-webview-capture.cjs");
const { beginEditorMotion, finishEditorMotion } = require("./lib/installed-editor-motion-sampler.cjs");
const { waitForSurfaceTransitionSettled } = require("./editor-workspace-surface-transition-playwright.cjs");
const root = "D:/AgentVN";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => sha256(fs.readFileSync(p));
const preparation = preparationFile ? read(preparationFile) : null;
const currentScope = "CURRENT_INSTALLED_RELEASE_EDITOR_CONTROLLED_MODULE_NETWORK_FAULTS";
if (preparation) {
  assert.equal(preparation.scope, currentScope);
  assert(path.resolve(preparation.run).startsWith(path.resolve("F:/AgentVN/QA/") + path.sep));
}
const run = preparation ? preparation.run : path.join(root, "output/installed-editor-loading-20261018-01");
const work = preparation ? run : "F:/AgentVN-QA-InstalledEditorLoading-20261018-01";
const fixture = preparation ? preparation.fixture
  : read(path.join(root, "output/installed-editor-motion-20261018-01/fixtures.json"));
const launch = preparation ? preparation.launch : read(path.join(run, "launch.json"));
const out = process.argv[2];
assert(out && path.dirname(path.resolve(out)) === path.resolve(run) && !fs.existsSync(out));
fs.mkdirSync(out);
const traces = preparation ? path.join(out, "traces") : path.join(work, path.basename(out));
assert(!fs.existsSync(traces)); fs.mkdirSync(traces);
const report = { status: "RUNNING", at: new Date().toISOString(), scope: preparation ? currentScope
  : "ACTUAL_FROZEN_NSIS_EDITOR_CONTROLLED_MODULE_NETWORK_FAULTS",
  sourceServer: false, timerMock: false, storeMutation: false, realModelRequests: 0, productChanges: 0,
  fixtureImport: "CONTROLLED_REAL_BACKEND_ENDPOINT_NOT_NATIVE_PICKER", matrix: [], timeoutCases: [],
  screenshots: [], transport: [], pageErrors: [], forbiddenRequests: [], error: null,
  environment: { AGENTVN_TEST_PROJECT: process.env.AGENTVN_TEST_PROJECT, AGENTVN_WORKSPACE_OUTPUT: process.env.AGENTVN_WORKSPACE_OUTPUT } };
let browser, page, cdp, serial = 0, expected, current, routeMode = "allow", target = "GenerationHistoryPanel";
const held = new Set();
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function idle(tab) {
  await page.waitForFunction(tab => {
    const panel = document.querySelector(".workspace-task-panel.is-open:not(.toolbar-popover-morph-ghost)");
    const active = panel?.querySelector(".advanced-tab-content.is-active");
    return panel?.querySelector(".advanced-tools-panel.is-tab-idle")
      && active?.getAttribute("data-tab") === tab && !active.inert && !panel.classList.contains("is-morphing")
      && !panel.getAnimations().some(a => a.playState === "running");
  }, tab);
}
async function state() {
  return page.evaluate(() => {
    const panel = document.querySelector(".workspace-task-panel.is-open:not(.toolbar-popover-morph-ghost)");
    const active = panel?.querySelector(".advanced-tab-content.is-active");
    const rect = n => n?.getBoundingClientRect().toJSON();
    const button = panel?.querySelector(".advanced-tab-load-error button");
    const b = button?.getBoundingClientRect();
    const hit = b && document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    return { active: active?.getAttribute("data-tab"), inert: active?.inert,
      error: panel?.querySelector(".advanced-tab-load-error")?.textContent,
      pending: panel?.querySelector(".advanced-tab-pending")?.textContent,
      selected: panel?.querySelector('.advanced-tab-button.is-active')?.getAttribute("data-help-key"),
      palette: rect(document.querySelector(".node-palette")),
      flow: rect(document.querySelector(".react-flow")),
      inspector: rect(document.querySelector(".scene-editor-pane")),
      retryHit: !!hit && (hit === button || button.contains(hit)),
      errorRect: rect(panel?.querySelector(".advanced-tab-load-error")),
      activeRect: rect(active), overflow: document.documentElement.scrollWidth - innerWidth,
      focusInUnavailable: !!document.activeElement?.closest("[inert], [aria-hidden='true'], [hidden]") };
  });
}
function check(name, ok, detail) {
  current.checks.push({ name, status: ok ? "PASS" : "FAILED", detail }); save();
}
async function capture(name) {
  report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, `${++serial}-${name}.png`), expected)); save();
}
async function episode(name, fn) {
  const row = { name, checks: [], status: "RUNNING" }; current.episodes.push(row);
  const owner = current; current = row;
  await beginEditorMotion(page, name);
  try { await fn(); } catch (e) { row.error = String(e.stack || e); check("Actual test flow completes", false, row.error); }
  finally {
    const trace = await finishEditorMotion(page);
    const bytes = zlib.gzipSync(Buffer.from(JSON.stringify(trace)));
    const file = path.join(traces, `${++serial}-${expected.width}-${expected.dpr}-${expected.reduced}-${name}.json.gz`);
    fs.writeFileSync(file, bytes, { flag: "wx" });
    row.trace = { path: file, sha256: sha256(bytes), frames: trace.frames.length };
    check("Nonempty native visible frames and trusted input", trace.frames.length >= 3 && trace.inputs.some(i => i.trusted)
      && !trace.limitReached && trace.frames.every(f => !f.pageHidden && f.width === expected.width
        && f.height === expected.height && Math.abs(f.dpr - expected.dpr) <= 1e-6 && f.reduced === expected.reduced));
    row.status = row.checks.every(c => c.status === "PASS") ? "PASS" : "FAILED";
    current = owner; save(); console.log(`${row.status} ${expected.width}/${expected.dpr}/${expected.reduced} ${name}`);
  }
}
async function tab(name) { await page.locator(`[data-help-key="advanced.tab.${name}"]:visible`).click(); }
async function reloadForFault(module, mode) {
  target = module; routeMode = mode;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: fixture.title }).waitFor();
  await page.waitForFunction(() => !document.querySelector(".app-transition-stage.is-switching, .project-entry-loading-overlay"));
  await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: fixture.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await waitForSurfaceTransitionSettled(page, "options"); await idle("settings");
}
async function releaseHeld() {
  const routes = [...held]; held.clear(); routeMode = "allow";
  for (const item of routes) {
    item.row.releasedAt = new Date().toISOString();
    await item.route.continue().catch(e => { item.row.releaseError = String(e); });
  }
}
(async () => {
  assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT), path.resolve(fixture.input));
  assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), path.resolve(out));
  assert.equal(sha(fixture.input), fixture.sha256);
  let ready;
  if (preparation) {
    const receipt = read(preparation.installationFile);
    assert.equal(receipt.status, "PASS"); assert.equal(receipt.metadataRestoration, "PASS");
    assert.equal(receipt.executable.version, "1.9.16");
    assert.equal(path.resolve(receipt.executable.path), path.resolve(launch.installRoot, "agentvn-editor.exe"));
    assert.equal(sha(receipt.executable.path), receipt.executable.sha256);
    for (const f of receipt.resources) assert.equal(sha(f.path), f.sha256);
    const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
    const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
    const processes = ownedProcessTree(rows(), launch.pid, launch.created);
    const ownedListeners = listeners([launch.backendPort, launch.cdpPort]);
    assert.equal(ownedListeners.length, 2);
    assert(ownedListeners.every(l => processes.some(p => p.ProcessId === l.OwningProcess)));
    assert.equal(launch.sourceServer, false); assert.equal(launch.manualBackendSpawn, false);
    ready = { status: "PASS", processes, listeners: ownedListeners, receipt };
  } else {
    assert.equal(sha(path.join(launch.installRoot, "agentvn-editor.exe")), "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    ready = read(path.join(run, "backend-ready.json")); assert.equal(ready.status, "PASS");
  }
  report.identity = { launch, ready, input: fixture.input, inputSha256: fixture.sha256 };
  const response = await fetch(`http://127.0.0.1:${launch.backendPort}/api/project/projects/import`, { method: "POST",
    headers: { "Content-Type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(fixture.input)) },
    body: fs.readFileSync(fixture.input), signal: AbortSignal.timeout(30000) });
  const imported = await response.json();
  assert(response.ok && imported.ok && imported.data.project_id === fixture.projectId);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes("tauri.localhost")); assert(page);
  page.setDefaultTimeout(12000); cdp = await page.context().newCDPSession(page);
  page.on("pageerror", e => report.pageErrors.push(String(e)));
  page.on("request", request => {
    if (request.method() === "POST" && /\/api\/(?:assistant\/(?:chat|creation\/processes)|novel.*\/start)$/.test(new URL(request.url()).pathname))
      report.forbiddenRequests.push(request.url());
  });
  await page.route("**/assets/*.js*", async route => {
    const url = route.request().url();
    if (!new URL(url).pathname.split("/").pop().startsWith(`${target}-`) || routeMode === "allow") return route.continue();
    const row = { url, mode: routeMode, at: new Date().toISOString() }; report.transport.push(row); save();
    if (routeMode === "abort") { row.aborted = true; return route.abort("failed"); }
    held.add({ route, row }); // Remains a real pending module request; no accelerated timers.
  });
  for (const [width, height] of [[1920,1080],[2560,1440],[3840,2160]]) for (const dpr of [1,2]) for (const reduced of [false,true]) {
    expected = { width, height, dpr, reduced };
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    const row = { ...expected, status: "RUNNING", episodes: [], checks: [], actualBefore: await readInstalledViewport(page, expected) };
    report.matrix.push(row); current = row; save();
    await reloadForFault("GenerationHistoryPanel", "abort");
    await episode("module-error-original-page-and-real-retry", async () => {
      await tab("history"); await page.locator(".advanced-tab-load-error").waitFor();
      const failed = await state();
      check("Failure retains original interactive page and retry hit target", failed.active === "settings" && !failed.inert && failed.retryHit, failed);
      check("Long native module error does not overflow viewport", failed.overflow <= 1
        && failed.errorRect.left >= 0 && failed.errorRect.right <= width + 1, failed);
      await capture(`${width}-${dpr}-${reduced}-error`);
      routeMode = "allow";
      await page.getByRole("button", { name: "重试载入", exact: true }).click(); await idle("history");
      const done = await state();
      check("Retry loads actual history page and removes error/pending", done.active === "history" && !done.inert && !done.error && !done.pending, done);
      check("Actual retry requests a fresh production module URL", report.transport.some(t => t.url.includes("GenerationHistoryPanel-"))
        && await page.evaluate(() => performance.getEntriesByType("resource").some(r => r.name.includes("GenerationHistoryPanel-") && r.name.includes("agentvn-retry="))));
    });
    await reloadForFault("AnimationEditorPanel", "hold");
    await episode("rapid-retarget-and-late-module-result", async () => {
      await tab("animation");
      await page.locator(".advanced-tab-pending").waitFor();
      await page.waitForFunction(() => document.querySelector(".advanced-tab-pending")?.textContent?.includes("动画编辑"));
      check("Real held module request observed", held.size > 0, { held: held.size });
      await tab("library"); await tab("settings"); await idle("settings");
      await releaseHeld();
      // Actually consume the delayed module, then navigate away again; that
      // proves the old response has arrived, not merely that a timeout elapsed.
      await tab("animation"); await idle("animation");
      await tab("settings"); await idle("settings");
      const done = await state();
      check("Latest actual destination owns UI after late module resolves", done.active === "settings" && !done.error && !done.pending && !done.inert && done.overflow <= 1, done);
      check("No unavailable content retains keyboard focus", !done.focusInUnavailable, done);
    });
    await capture(`${width}-${dpr}-${reduced}-settled`);
    row.actualAfter = await readInstalledViewport(page, expected);
    row.status = row.episodes.length === 2 && row.episodes.every(e => e.status === "PASS") ? "PASS" : "FAILED"; save();
  }
  // Timeout is tested with the actual 30s production timer once per media mode.
  // This two-case scope is explicit, not falsely a timeout 12-matrix claim.
  for (const reduced of [false,true]) {
    expected = { width: 1920, height: 1080, dpr: 1, reduced };
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    await reloadForFault("AnimationEditorPanel", "hold");
    current = { ...expected, status: "RUNNING", episodes: [], checks: [] }; report.timeoutCases.push(current);
    const started = performance.now();
    await tab("animation"); await page.locator(".advanced-tab-pending").waitFor();
    await page.locator(".advanced-tab-load-error").waitFor({ timeout: 35000 });
    const failed = await state(), elapsedMs = performance.now() - started;
    check("Actual unaccelerated production timeout preserves original page", elapsedMs >= 29000 && failed.error?.includes("超时")
      && failed.active === "settings" && !failed.inert && failed.retryHit, { elapsedMs, failed });
    await capture(`timeout-${reduced}`);
    await episode("timeout-real-retry-and-pending-response", async () => {
      await page.getByRole("button", { name: "重试载入", exact: true }).click();
      await page.locator(".advanced-tab-pending").waitFor();
      await releaseHeld(); await idle("animation");
      const done = await state();
      check("Actual timeout retry consumes original outstanding module safely", done.active === "animation" && !done.inert && !done.error && !done.pending, done);
    });
    current.status = current.checks.every(c => c.status === "PASS") && current.episodes.every(e => e.status === "PASS") ? "PASS" : "FAILED"; save();
  }
  assert.equal(report.matrix.length, 12); assert.equal(report.timeoutCases.length, 2);
  assert.equal(report.forbiddenRequests.length, 0);
  report.status = report.matrix.every(m => m.status === "PASS") && report.timeoutCases.every(m => m.status === "PASS")
    && report.pageErrors.length === 0 ? "PASS" : "FAILED";
  if (report.status !== "PASS") process.exitCode = 1;
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
.finally(async () => {
  await releaseHeld().catch(() => {});
  await page?.evaluate(() => window.__qaInstalledEditorMotion?.stop?.()).catch(() => {});
  await browser?.close().catch(() => {});
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, matrix: report.matrix.length, timeouts: report.timeoutCases.length, error: report.error }));
});
