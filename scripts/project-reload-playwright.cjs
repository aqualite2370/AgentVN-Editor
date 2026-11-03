"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { startEditorAcceptance, fixture } = require("./lib/editor-ui-acceptance.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
assert(process.env.AGENTVN_TEST_PROJECT && process.env.AGENTVN_WORKSPACE_OUTPUT);
const output = path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT);
const current = JSON.parse(fs.readFileSync(process.env.AGENTVN_TEST_PROJECT, "utf8"));
const old = fixture("qa-project-reload-old");
old.nodes[1].id = "old-foreign-scene";
old.nodes[1].data.scene.scene_id = "old-foreign-scene";
old.edges[0].target = old.nodes[1].id;
const report = { status: "RUNNING", scope: "source-browser-not-installed",
  fixture: process.env.AGENTVN_TEST_PROJECT, startedAt: new Date().toISOString(),
  testSha256: crypto.createHash("sha256").update(fs.readFileSync(__filename)).digest("hex"),
  modelSubmissions: 0, cases: [] };
let host, browser;
function processes() {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    "ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | Select-Object ProcessId," +
    "ParentProcessId,ExecutablePath,@{n='Created';e={$_.CreationDate.ToUniversalTime().ToString('o')}})"],
  { encoding: "utf8", windowsHide: true, timeout: 20000 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
}
async function reloadGeometry(page) {
  return page.locator('[data-help-key="preview.reload-project"]').evaluate(button => {
    const b = button.getBoundingClientRect();
    const panel = button.closest('[data-testid="preview-launch-panel"]').getBoundingClientRect();
    return { rect: { x: b.x, y: b.y, width: b.width, height: b.height },
      inside: b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight
        && b.left >= panel.left && b.right <= panel.right && b.top >= panel.top && b.bottom <= panel.bottom,
      hit: button.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)),
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth) };
  });
}
async function api(route, method = "GET", body) {
  const response = await fetch(`${host.backendUrl}/api/project/${route}`, {
    method, headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
  });
  assert(response.ok, `${method} ${route}: ${response.status}`);
  return (await response.json()).data;
}
async function snapshot(page) {
  return page.evaluate(async () => {
    const { useEditorStore } = await import("/src/store/editorStore.ts");
    const { useProjectStore } = await import("/src/store/projectStore.ts");
    const state = useEditorStore.getState();
    return { projectId: useProjectStore.getState().projectId,
      nodeIds: state.nodes.map(n => n.id).sort(), edgeIds: state.edges.map(e => e.id).sort(),
      renderedIds: [...document.querySelectorAll(".react-flow__node")]
        .filter(n => !n.closest("[data-editor-transition-snapshot], [data-transition-ghost]"))
        .map(n => n.getAttribute("data-id")).sort(),
      notice: state.notice, lastError: state.lastError,
      dirty: state.dirty,
      selectedNodeId: state.selectedNodeId, generation: state.projectLoadGeneration,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches } };
  });
}
async function openReload(page) {
  await page.route(/\/api\/.*(?:novel|assistant)/, route => {
    if (route.request().method() === "POST") {
      report.modelSubmissions++; return route.abort();
    }
    return route.continue();
  });
  await host.open(page);
  await settleEditor(page);
  await page.locator('[data-workspace-surface="preview"]').click();
  await page.getByTestId("preview-launch-panel").waitFor();
  await settleEditor(page);
  await page.locator(".preview-launch-maintenance summary").click();
}
async function seedDivergence() {
  await api("state", "POST", {
    project_metadata: { projectId: current.project_id, title: current.title,
      author: current.author, settings: current.editor_settings, assetManifest: [] },
    project_graph: { nodes: old.nodes, edges: old.edges, viewport: old.viewport, memoryMode: old.memory_mode },
  });
  // The explicit project remains correct. Only the legacy singleton is stale.
  await api(`projects/${encodeURIComponent(current.project_id)}`, "PUT", current);
  const shared = await api("state"), detail = await api(`projects/${encodeURIComponent(current.project_id)}`);
  assert.deepEqual(shared.project_graph.nodes.map(n => n.id).sort(), old.nodes.map(n => n.id).sort());
  assert.deepEqual(detail.nodes.map(n => n.id).sort(), current.nodes.map(n => n.id).sort());
  return { sharedIds: shared.project_graph.nodes.map(n => n.id),
    detailIds: detail.nodes.map(n => n.id), projectId: detail.project_id };
}
function changedProject() {
  const value = structuredClone(current);
  value.nodes[1].id = "newer-session-scene";
  value.nodes[1].data.scene.scene_id = "newer-session-scene";
  value.edges[0].target = value.nodes[1].id;
  return value;
}
async function controlledCase(name, outcome) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const item = { name, scope: "real-UI-trigger-controlled-HTTP-and-explicit-session-injection", status: "RUNNING" };
  report.cases.push(item);
  let held, requestCount = 0;
  const matcher = /\/api\/project\/(?:state(?:\?.*)?|projects\/[^/?]+)$/;
  try {
    await openReload(page);
    await seedDivergence();
    const before = await snapshot(page);
    const requests = [];
    await page.route(matcher, route => {
      if (route.request().method() !== "GET") return route.continue();
      requestCount++;
      requests.push(route.request().url());
      held = route;
    });
    await page.locator('[data-help-key="preview.reload-project"]').click();
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="preview-launch-panel"]')?.getAttribute("aria-busy") === "true");
    // The request is held at the real HTTP boundary; no arbitrary timing sleep.
    await expectEventually(() => held);
    item.before = before;
    item.busy = await page.locator('[data-help-key="preview.reload-project"]').isDisabled();
    assert.equal(item.busy, true);
    // Repeated DOM activation of a disabled native button must not submit again.
    await page.locator('[data-help-key="preview.reload-project"]').evaluate(button => button.click());
    if (name.startsWith("stale-")) {
      item.injected = await page.evaluate(async ({ name, old, current, newer }) => {
        const { hydrateEditorFromProject } = await import("/src/app/projectHydration.ts");
        const { useEditorStore } = await import("/src/store/editorStore.ts");
        if (name.includes("draft-edit")) {
          useEditorStore.getState().updateNodeData(current.nodes[1].id, { label: "新草稿，旧请求不可覆盖" });
        } else {
          if (name.includes("A-B-A")) hydrateEditorFromProject(old);
          hydrateEditorFromProject(newer);
        }
        useEditorStore.getState().setNotice("新会话提示，不得被旧请求覆盖", "info");
        return useEditorStore.getState().lastError;
      }, { name, old, current, newer: changedProject() });
      item.injectedState = await snapshot(page);
    }
    const responseProject = name === "foreign-project" ? old
      : name === "empty-graph" ? { ...current, nodes: [], edges: [] }
        : name === "malformed-graph" ? { ...current, edges: [{ id: "broken", source: "missing", target: "missing" }] }
          : name === "valid-saved-update" ? changedProject() : current;
    const failed = outcome === "error";
    const sharedBody = { project_metadata: {
      projectId: responseProject.project_id, title: responseProject.title,
      author: responseProject.author, settings: responseProject.editor_settings, assetManifest: [],
    }, project_graph: { nodes: responseProject.nodes, edges: responseProject.edges,
      viewport: responseProject.viewport, memoryMode: responseProject.memory_mode } };
    await held.fulfill(failed ? { status: name === "missing-project" ? 404 : 500,
      json: { detail: "CONTROLLED_RELOAD_FAILURE_DO_NOT_RETRY_MODEL" } }
      : { json: { ok: true, data: /\/state(?:\?|$)/.test(held.request().url()) ? sharedBody : responseProject } });
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="preview-launch-panel"]')?.getAttribute("aria-busy") === "false");
    item.after = await snapshot(page);
    item.panelText = await page.getByTestId("preview-launch-panel").innerText();
    item.requests = requests;
    assert.equal(requestCount, 1, "Repeated click must not start a second refresh or shared-state fallback");
    if (name.startsWith("stale-")) {
      assert.deepEqual(item.after.nodeIds, item.injectedState.nodeIds,
        "A stale request must not replace a newer project session");
      assert.equal(item.after.generation, item.injectedState.generation);
      assert.equal(item.after.dirty, item.injectedState.dirty);
      assert.equal(item.after.selectedNodeId, item.injectedState.selectedNodeId);
      assert.deepEqual(item.after.lastError, item.injected,
        "Stale success/failure must not replace the new session notice");
      assert(!/重载完成|重载失败/.test(item.panelText), "Stale response must not claim success/failure in the new session");
    } else if (name === "valid-saved-update") {
      assert.deepEqual(item.after.nodeIds, changedProject().nodes.map(n => n.id).sort());
      assert.match(item.panelText, /重载完成/);
      assert.equal(item.after.dirty, false);
    } else {
      assert.deepEqual(item.after.nodeIds, before.nodeIds, "Rejected response must preserve the draft graph");
      assert.deepEqual(item.after.edgeIds, before.edgeIds);
      assert.equal(item.after.projectId, before.projectId);
      assert.equal(item.after.generation, before.generation);
      assert.equal(item.after.dirty, before.dirty);
      assert.match(item.panelText, /重载失败/);
      assert.equal(item.after.lastError?.tone, "error");
      if (name === "failure-then-retry") {
        await page.unroute(matcher);
        await page.locator('[data-help-key="preview.reload-project"]').click();
        await page.locator(".gamecli-preview-progress.is-success").waitFor();
        item.retried = await snapshot(page);
        assert.deepEqual(item.retried.nodeIds, current.nodes.map(n => n.id).sort());
      }
    }
    item.status = "PASS";
  } catch (error) {
    item.status = "FAILED"; item.error = String(error.stack || error);
    if (held) await held.abort().catch(() => {});
  } finally { await context.close(); }
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ name, status: item.status, error: item.error?.split("\n")[0] }));
}
async function expectEventually(predicate) {
  const end = Date.now() + 20000;
  while (!predicate()) {
    assert(Date.now() < end, "Expected owned HTTP request did not arrive");
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
async function lifetimeCase(outcome) {
  const item = { name: `unmount-late-${outcome}`, status: "RUNNING",
    scope: "real-React-component-with-controlled-remount-and-HTTP-not-normal-user-navigation" };
  report.cases.push(item);
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 },
    // Enables the real diagnostic writer only. This is explicitly NOT a native
    // host test; preview launch/close are not exercised by this harness.
    userAgent: "AgentVN controlled component lifetime Tauri diagnostic harness" });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const held = [];
  try {
    await page.addInitScript(value => { window.reloadFixture = value; }, current);
    await page.route("**/__project_reload_lifetime__", route => route.fulfill({ contentType: "text/html", body: `<!doctype html>
<html><head><meta charset="utf-8"></head><body><div id="root"></div>
<script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>(type)=>type;
window.__vite_plugin_react_preamble_installed__=true;
</script><script type="module">
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import {PreviewWindowControls} from '/src/components/advanced/PreviewWindowControls.tsx';
import {hydrateEditorFromProject} from '/src/app/projectHydration.ts';
import {useEditorStore} from '/src/store/editorStore.ts';
import '/src/styles/variables.css'; import '/src/styles/layout.css';
import '/src/styles/editor-tokens.css'; import '/src/styles/editor-preview.css';
window.reloadDiag=[]; window.reloadBusy=[];
hydrateEditorFromProject(window.reloadFixture);
function Harness() {
  const [version,setVersion]=React.useState(1);
  return React.createElement(React.Fragment,null,
    React.createElement('button',{id:'replace-panel',onClick:()=>{
      setVersion(v=>v+1);useEditorStore.getState().setNotice('新面板提示，不得被旧响应覆盖','info');
    }},'Replace test panel'),
    React.createElement('main',{style:{height:'calc(100dvh - 60px)',padding:12},'data-version':version},
      React.createElement(PreviewWindowControls,{key:version,onBusyChange:busy=>window.reloadBusy.push({version,busy})})));
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Harness));
</script></body></html>` }));
    await page.route(/\/api\/project\/(?:state(?:\?.*)?|projects\/[^/?]+)$/, route => {
      if (route.request().method() !== "GET") return route.continue();
      held.push(route);
    });
    await page.goto(`${host.url}/__project_reload_lifetime__`);
    await page.getByTestId("preview-launch-panel").waitFor();
    await page.evaluate(async () => {
      const { installGlobalErrorLogging } = await import("/@fs/D:/AgentVN/shared/logging/frontendErrorLogger.ts");
      installGlobalErrorLogging("editor", async (source, text) =>
        window.reloadDiag.push({ source, ...JSON.parse(text) }));
    });
    const clickReload = async () => {
      await page.locator(".preview-launch-maintenance summary").click();
      await page.locator('[data-help-key="preview.reload-project"]').click();
    };
    await clickReload();
    await expectEventually(() => held.length === 1);
    await page.locator("#replace-panel").click();
    await page.locator('main[data-version="2"]').waitFor();
    await clickReload();
    await expectEventually(() => held.length === 2);
    const before = await snapshot(page);
    await held[0].fulfill(outcome === "error"
      ? { status: 500, json: { detail: "CONTROLLED_UNMOUNTED_ERROR" } }
      : { json: { ok: true, data: current } });
    await page.waitForFunction(() => window.reloadDiag.some(log =>
      log.context?.operation === "reload-project" && log.context?.stale === true));
    item.afterOldResponse = await snapshot(page);
    item.busyCallbacksAfterOld = await page.evaluate(() => window.reloadBusy);
    assert.deepEqual(item.afterOldResponse, before, "Unmounted response must not change the new panel's store");
    assert.equal(await page.getByTestId("preview-launch-panel").getAttribute("aria-busy"), "true",
      "Old completion must not release a new in-flight operation");
    assert.deepEqual(item.busyCallbacksAfterOld, [{ version: 1, busy: true }, { version: 2, busy: true }]);
    await held[1].fulfill({ json: { ok: true, data: current } });
    await page.locator(".gamecli-preview-progress.is-success").waitFor();
    assert.equal(await page.getByTestId("preview-launch-panel").getAttribute("aria-busy"), "false");
    item.busyCallbacks = await page.evaluate(() => window.reloadBusy);
    assert.deepEqual(item.busyCallbacks, [
      { version: 1, busy: true }, { version: 2, busy: true }, { version: 2, busy: false },
    ]);
    item.diagnostics = await page.evaluate(() => window.reloadDiag);
    item.status = "PASS";
  } catch (error) {
    item.status = "FAILED"; item.error = String(error.stack || error);
    item.failurePage = await page.evaluate(() => ({
      text: document.body.innerText, diagnostics: window.reloadDiag, busy: window.reloadBusy,
    })).catch(() => null);
  }
  finally { for (const route of held) await route.abort().catch(() => {}); await context.close(); }
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ name: item.name, status: item.status, error: item.error?.split("\n")[0] }));
}
(async () => {
  host = await startEditorAcceptance(output);
  report.service = { backendPid: host.backendPid, frontendPid: host.server.pid,
    backendUrl: host.backendUrl, frontendUrl: host.url, runId: host.server.runId };
  const rows = processes(), ownedIds = new Set([host.backendPid, host.server.pid]);
  for (let previous = -1; previous !== ownedIds.size;) {
    previous = ownedIds.size;
    rows.filter(row => ownedIds.has(row.ParentProcessId)).forEach(row => ownedIds.add(row.ProcessId));
  }
  report.service.processes = rows.filter(row => ownedIds.has(row.ProcessId));
  browser = await chromium.launch();
  if (process.env.AGENTVN_RELOAD_LIFETIME_ONLY === "1") {
    report.subset = "component-lifetime-only";
    await lifetimeCase("success"); await lifetimeCase("error");
    assert.equal(report.cases.length, 2);
    report.status = report.cases.every(item => item.status === "PASS") ? "PASS" : "FAILED";
    if (report.status !== "PASS") process.exitCode = 1;
    return;
  }
  const matrix = process.env.AGENTVN_RELOAD_SMOKE === "1" ? [desktopViewports[0]] : desktopViewports;
  for (const [width, height] of matrix) for (const dpr of process.env.AGENTVN_RELOAD_SMOKE === "1" ? [1] : [1, 2])
    for (const motion of process.env.AGENTVN_RELOAD_SMOKE === "1" ? ["no-preference"] : ["no-preference", "reduce"]) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, reducedMotion: motion });
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      const item = { name: "legacy-shared-divergence", width, height, dpr, motion, status: "RUNNING" };
      report.cases.push(item);
      const requests = [];
      page.on("request", req => {
        if (/\/api\/project\/(?:state|projects\/)/.test(req.url())) requests.push({ method: req.method(), url: req.url() });
      });
      await page.route(/\/api\/.*(?:novel|assistant)/, route => {
        if (route.request().method() === "POST") {
          report.modelSubmissions++; return route.abort();
        }
        return route.continue();
      });
      try {
        await openReload(page);
        // Maintenance is inside an intentionally scrollable body. Match
        // Playwright/native click preparation before checking its hit target.
        await page.locator('[data-help-key="preview.reload-project"]').scrollIntoViewIfNeeded();
        item.before = await snapshot(page);
        item.geometry = await reloadGeometry(page);
        assert(item.geometry.inside && item.geometry.hit && item.geometry.overflow <= 1,
          "Real reload control must be bounded and hittable without page overflow");
        item.divergence = await seedDivergence();
        requests.length = 0;
        await page.locator('[data-help-key="preview.reload-project"]').click();
        await page.locator(".gamecli-preview-progress.is-success, .gamecli-preview-progress.is-error").waitFor();
        item.after = await snapshot(page);
        item.reloadRequests = requests;
        item.panelText = await page.getByTestId("preview-launch-panel").innerText();
        const pngFile = path.join(output, `reload-${width}-dpr${dpr}-${motion}.png`);
        const png = await page.screenshot({ path: pngFile });
        item.screenshot = { path: pngFile, pixels: [png.readUInt32BE(16), png.readUInt32BE(20)],
          sha256: crypto.createHash("sha256").update(png).digest("hex") };
        assert.deepEqual(item.after.viewport, { width, height, dpr, reduced: motion === "reduce" });
        assert.equal(png.readUInt32BE(16), width * dpr);
        assert.equal(png.readUInt32BE(20), height * dpr);
        assert.equal(item.after.projectId, current.project_id);
        assert.deepEqual(item.after.nodeIds, current.nodes.map(n => n.id).sort(),
          "Reload must not install the old singleton graph into the current project");
        assert.deepEqual(item.after.renderedIds, item.after.nodeIds);
        assert.equal(item.after.generation, item.before.generation + 1);
        assert.match(item.panelText, /重载完成/);
        assert(requests.some(req => req.method === "GET" && req.url.endsWith(`/projects/${current.project_id}`)),
          "Reload must read the current project detail");
        assert(!requests.some(req => req.method === "GET" && /\/state(?:\?|$)/.test(req.url)),
          "Reload must not fall back to shared singleton state");
        item.status = "PASS";
      } catch (error) { item.status = "FAILED"; item.error = String(error.stack || error); }
      finally { await context.close(); }
      fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ width, dpr, motion, status: item.status, error: item.error?.split("\n")[0] }));
    }
  const matrixCases = process.env.AGENTVN_RELOAD_SMOKE === "1" ? 1 : 12;
  assert.equal(report.cases.length, matrixCases);
  for (const [name, outcome] of [
    ["foreign-project", "success"], ["empty-graph", "success"], ["malformed-graph", "success"],
    ["missing-project", "error"], ["failure-then-retry", "error"], ["valid-saved-update", "success"],
    ["stale-success-A-B-A", "success"], ["stale-error-same-project-reopen", "error"],
    ["stale-success-draft-edit", "success"],
  ]) await controlledCase(name, outcome);
  assert.equal(report.cases.length, matrixCases + 9, "No empty/partial scenario suite may pass");
  await lifetimeCase("success");
  await lifetimeCase("error");
  assert.equal(report.cases.length, matrixCases + 11);
  assert.equal(report.modelSubmissions, 0);
  report.status = report.cases.every(item => item.status === "PASS") ? "PASS" : "FAILED";
  if (report.status !== "PASS") process.exitCode = 1;
})().catch(error => { report.status = "TOOL_FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
  .finally(async () => {
    await browser?.close(); await host?.stop();
    if (report.service?.processes) {
      const running = processes();
      report.cleanupSurvivors = report.service.processes.filter(before =>
        running.some(now => now.ProcessId === before.ProcessId && now.Created === before.Created));
      if (report.cleanupSurvivors.length) { report.status = "FAILED"; process.exitCode = 1; }
    }
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length, output }));
  });
