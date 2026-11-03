"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn, execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { createHash } = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const { resolveAcceptancePaths } = require("./lib/editor-ui-acceptance.cjs");
const { installPerformanceObservers, finishPerformanceObservation } = require("./lib/e2-performance-observers.cjs");
const { validateWebView2Renderer } = require("./lib/e2-webview2-renderer.cjs");
const { getCheckboxPaintDiagnostic, validateCheckboxPaintEvidence, captureCheckboxPaintState } =
  require("./lib/e2-webview2-checkbox-paint.cjs");
const { getLayoutShadowDiagnostic, validateLayoutShadowEvidence, captureLayoutShadowState } =
  require("./lib/e2-webview2-layout-shadow.cjs");
const { installWarmTopLayerDiagnostic, summarizeWarmTopLayerEvidence } =
  require("./lib/e2-warm-top-layer.cjs");
const { getStagedMaterialMode, groupMaterialSignatures, installStagedMaterialPlan, runStagedMaterialPlan } =
  require("./lib/e2-staged-material-preparation.cjs");

const root = path.resolve(__dirname, "..");
const paths = resolveAcceptancePaths();
const hostPath = path.join(root, "output", "diagnostic-builds", "e2-webview2-host-20261011-01",
  "debug", "agentvn-e2-webview2-diagnostic-host.exe");
const profilePath = process.env.AGENTVN_E2_WEBVIEW2_PROFILE;
const rendererMode = process.env.AGENTVN_E2_WEBVIEW2_RENDERER || "default";
assert(["default", "graphite"].includes(rendererMode), "renderer must be default or graphite");
const checkboxPaint = getCheckboxPaintDiagnostic(process.env.AGENTVN_E2_WEBVIEW2_CHECKBOX_PAINT || "default");
const layoutShadow = getLayoutShadowDiagnostic(process.env.AGENTVN_E2_WEBVIEW2_LAYOUT_SHADOW || "default");
const preparationMode = process.env.AGENTVN_E2_WEBVIEW2_PREPARATION || "default";
const stagedMaterial = getStagedMaterialMode(preparationMode);
assert([rendererMode !== "default", checkboxPaint.mode !== "default", layoutShadow.mode !== "default",
  preparationMode !== "default"]
  .filter(Boolean).length <= 1, "renderer and paint overrides must be separate single-variable trials");
assert(profilePath && path.isAbsolute(profilePath));
assert(!fs.existsSync(profilePath), "first presentation requires a new, isolated WebView2 profile");
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const report = {
  status: "RUNNING", kind: "standalone-webview2-first-presentation-diagnostic-not-editor-or-release-acceptance",
  productLayer: "Editor", performanceAcceptance: false, hostPath, hostHash: hash(hostPath),
  rendererMode,
  checkboxPaintDiagnostic: checkboxPaint,
  layoutShadowDiagnostic: layoutShadow,
  preparationMode,
  productionIndexHashBefore: hash(path.join(root, "editor", "dist", "index.html")),
  devHashBefore: hash(path.join(root, "AgentVN Dev.exe")),
  isolation: paths, profilePath, startedAt: new Date().toISOString(),
  viewport: { width: 3840, height: 2160 }, dpr: 1,
  viewportMode: "real WebView2 host with CDP CSS viewport simulation; not physical 4K or installed Editor acceptance",
  owner: { pid: process.pid }, errors: [],
};

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function nativeOwnership(hostPid, debugPort) {
  // Numeric PIDs/ports are owned values, not user-provided shell strings.
  assert(Number.isInteger(hostPid) && hostPid > 0 && Number.isInteger(debugPort));
  const script = `
    $all = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name)
    $ownedIds = @(${hostPid})
    do {
      $previousCount = $ownedIds.Count
      $ownedIds = @($ownedIds + @($all | Where-Object { $_.ParentProcessId -in $ownedIds } |
        Select-Object -ExpandProperty ProcessId) | Select-Object -Unique)
    } while ($ownedIds.Count -gt $previousCount)
    $listener = @(Get-NetTCPConnection -State Listen -LocalPort ${debugPort} -ErrorAction SilentlyContinue)
    [pscustomobject]@{
      hostProcessId = ${hostPid}
      listenerOwnerIds = @($listener | Select-Object -ExpandProperty OwningProcess -Unique)
      allListenersOwned = ($listener.Count -gt 0 -and @($listener |
        Where-Object { $_.OwningProcess -notin $ownedIds }).Count -eq 0)
      ownedProcesses = @($all | Where-Object { $_.ProcessId -in $ownedIds })
    } | ConvertTo-Json -Depth 5 -Compress
  `;
  return JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", script],
    { encoding: "utf8", windowsHide: true, timeout: 20_000 }));
}

async function seed(page) {
  const project = JSON.parse(fs.readFileSync(paths.input, "utf8"));
  assert.equal(project.project_id, paths.fixtureProjectId);
  const sharedState = {
    project_graph: { nodes: project.nodes, edges: project.edges, viewport: project.viewport, memoryMode: project.memory_mode },
    project_metadata: {
      projectId: project.project_id, title: project.title, author: project.author,
      createdAt: project.created_at, updatedAt: project.updated_at,
      assetManifest: project.asset_manifest, settings: project.editor_settings, schemaVersion: project.schema_version,
    },
    recent_projects: [], provider_connections: [], provider_models: [], provider_selections: {}, provider_secrets: {},
  };
  await page.addInitScript(project => {
    localStorage.setItem("agentvn.currentProjectDraft", JSON.stringify(project));
    localStorage.setItem("agentvn.recentProjects", JSON.stringify([{
      project_id: project.project_id, title: project.title, author: project.author,
      created_at: project.created_at, updated_at: project.updated_at,
      node_count: project.nodes.length, edge_count: project.edges.length,
      schema_version: project.schema_version, has_detail: true, project,
    }]));
  }, project);
  await page.route("http://127.0.0.1:8278/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    let data = {};
    if (url.pathname === "/api/project/state")
      data = request.method() === "GET" ? sharedState : { ...sharedState, ...(request.postDataJSON() ?? {}) };
    else if (url.pathname === "/api/project/catalog") data = [];
    else if (url.pathname.startsWith("/api/project/projects/"))
      data = request.method() === "GET" ? project : (request.postDataJSON() ?? project);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data }) });
  });
}

async function settle(page, tab) {
  await page.waitForFunction(tab => {
    const popover = document.querySelector(
      ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost)");
    const panel = popover?.querySelector(".advanced-tools-panel");
    const active = popover?.querySelector(".advanced-tab-content.is-active");
    if (!popover || !panel || active?.dataset.tab !== tab || !panel.classList.contains("is-tab-idle")
      || popover.querySelector(".advanced-tab-content.is-entering,.advanced-tab-content.is-leaving")
      || document.querySelector(".toolbar-popover-morph-ghost,[data-geometry-snapshot-owner]")) return false;
    return [
      ...popover.getAnimations(), ...active.getAnimations(),
      ...[...popover.querySelectorAll(".advanced-tab-content")].flatMap(node => node.getAnimations()),
    ].every(animation => !animation.pending && animation.playState !== "running");
  }, tab, { timeout: 30_000 });
}

async function main() {
  fs.mkdirSync(paths.output, { recursive: true });
  let preview, host, browser, page;
  let hostLog = "";
  try {
    const { preview: startPreview } = await import(pathToFileURL(
      path.join(root, "editor", "node_modules", "vite", "dist", "node", "index.js")).href);
    const port = await freePort();
    const debugPort = await freePort();
    assert.notEqual(port, debugPort);
    preview = await startPreview({
      root: path.join(root, "editor"), configFile: path.join(root, "editor", "vite.config.ts"),
      preview: { host: "127.0.0.1", port, strictPort: true, open: false },
    });
    assert.equal(preview.httpServer.address().port, port);
    report.sourceUrl = `http://127.0.0.1:${port}`;
    report.debugPort = debugPort;
    const env = { ...process.env };
    for (const key of ["WEBVIEW2_USER_DATA_FOLDER", "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
      "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER"]) delete env[key];
    host = spawn(hostPath, [report.sourceUrl, profilePath, String(debugPort), rendererMode], {
      env, cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    report.owner.hostPid = host.pid;
    host.on("error", error => { hostLog += error.stack; });
    for (const stream of [host.stdout, host.stderr]) stream.on("data", data => { hostLog += data; });
    const deadline = Date.now() + 30_000;
    let endpoint;
    while (Date.now() < deadline) {
      if (host.exitCode !== null || host.signalCode !== null) throw new Error(`Host exited: ${hostLog}`);
      try {
        const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`,
          { signal: AbortSignal.timeout(1000) });
        if (response.ok && hostLog.includes("E2_WEBVIEW2_HOST_READY")) {
          endpoint = await response.json();
          break;
        }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(endpoint, `WebView2 CDP readiness timed out: ${hostLog}`);
    report.nativeOwnership = nativeOwnership(host.pid, debugPort);
    assert.equal(report.nativeOwnership.allListenersOwned, true);
    report.cdpVersion = endpoint;
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
    const context = browser.contexts()[0];
    page = context.pages()[0];
    assert(page, "owned WebView2 must expose a page");
    page.on("pageerror", error => report.errors.push(String(error)));
    const session = await context.newCDPSession(page);
    await session.send("Emulation.setDeviceMetricsOverride", {
      width: 3840, height: 2160, deviceScaleFactor: 1, mobile: false,
    });
    await seed(page);
    assert((await fetch(report.sourceUrl)).ok && preview.httpServer.listening);
    await page.goto(report.sourceUrl, { waitUntil: "domcontentloaded" });
    const recent = page.locator('[data-help-key="home.recentProject"]:visible').first();
    await recent.waitFor({ state: "visible", timeout: 60_000 });
    await recent.click();
    await page.locator(".editor-toolbar").waitFor({ state: "visible", timeout: 60_000 });
    await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"));
    await page.locator('[data-workspace-surface="options"]:visible').click();
    await page.locator('[data-help-key="advanced.tab.settings"]:visible').click();
    await page.locator(".project-settings-panel").waitFor({ state: "visible" });
    await settle(page, "settings");
    report.beforeInteraction = await page.evaluate(() => {
      const designer = document.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]');
      return {
        width: innerWidth, height: innerHeight, dpr: devicePixelRatio, browser: navigator.userAgent,
        screen: { width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight },
        preMounted: !!designer, inert: designer?.hasAttribute("inert"), ariaHidden: designer?.getAttribute("aria-hidden"),
        moduleResources: performance.getEntriesByType("resource")
          .filter(entry => entry.name.includes("RuntimeLayoutDesigner-"))
          .map(entry => ({ name: entry.name.split("/").pop(), responseEnd: entry.responseEnd })),
      };
    });
    assert.equal(report.beforeInteraction.width, 3840);
    assert.equal(report.beforeInteraction.height, 2160);
    assert.equal(report.beforeInteraction.dpr, 1);
    const checkboxBefore = await page.evaluate(captureCheckboxPaintState);
    if (checkboxPaint.css) await page.addStyleTag({ content: checkboxPaint.css });
    const checkboxAfter = await page.evaluate(captureCheckboxPaintState);
    report.checkboxPaintEvidence = {
      before: checkboxBefore, after: checkboxAfter,
      validation: validateCheckboxPaintEvidence(checkboxPaint.mode, checkboxBefore, checkboxAfter),
    };
    assert.equal(report.checkboxPaintEvidence.validation.matched, true,
      "paint counterfactual must preserve checkbox geometry, transform and state");
    const { before: shadowBefore, after: shadowAfter, completedShadowTransitions } =
      await page.evaluate(captureLayoutShadowState, layoutShadow.css);
    report.layoutShadowEvidence = {
      before: shadowBefore, after: shadowAfter, completedShadowTransitions,
      validation: validateLayoutShadowEvidence(layoutShadow.mode, shadowBefore, shadowAfter),
    };
    assert.equal(report.layoutShadowEvidence.validation.matched, true,
      "shadow counterfactual must preserve geometry and all other measured materials");
    const target = page.locator('[data-help-key="advanced.tab.layout"]:visible');
    await target.hover();
    await page.evaluate(() => {
      const state = window.__advancedLayoutTransitionAudit = {
        start: performance.now(), running: true, longTasks: [], longAnimationFrames: [], frameGaps: [],
        lastFrame: performance.now(), interactionStart: null, interactionSource: null,
      };
      document.addEventListener("pointerdown", event => {
        if (event.isTrusted && event.target instanceof Element
          && event.target.closest('[data-help-key="advanced.tab.layout"]')) {
          state.interactionStart = performance.now();
          state.interactionSource = "trusted-pointerdown";
        }
      }, { capture: true, once: true });
      const frame = time => {
        if (!state.running) return;
        state.frameGaps.push({ startTime: state.lastFrame, duration: time - state.lastFrame });
        state.lastFrame = time;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    await page.evaluate(installPerformanceObservers);
    if (preparationMode !== "default") {
      if (stagedMaterial) report.stagedPreparation = await page.evaluate(installStagedMaterialPlan);
      report.preparation = await installWarmTopLayerDiagnostic(page, { opacity: 1 });
      report.preparation.validation = summarizeWarmTopLayerEvidence(report.preparation);
      assert.equal(report.preparation.validation.valid, true,
        "visible preparation must cover actual material without acquiring input");
      if (stagedMaterial) {
        const groups = groupMaterialSignatures(report.stagedPreparation.records.filter(item => item.drawable));
        report.stagedPreparation.execution = await page.evaluate(runStagedMaterialPlan, groups);
      }
      report.preparation.restoration = await page.evaluate(async () => {
        const warm = document.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]');
        window.__e2RestoreWarmTopLayer();
        window.__e2StagedMaterialPlan?.cleanup();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { endedAt: performance.now(), restored: window.__e2WarmTopLayerDiagnostic.restored,
          restoreCount: window.__e2WarmTopLayerDiagnostic.restoreCount,
          topLayer: warm.matches(":popover-open"), inert: warm.inert,
          opacity: getComputedStyle(warm).opacity,
          stagedAttributesRemaining: document.querySelectorAll("[data-e2-staged-material],[data-e2-material-ready]").length };
      });
      assert.equal(report.preparation.restoration.restored, true);
      assert.equal(report.preparation.restoration.restoreCount, 1);
      assert.equal(report.preparation.restoration.topLayer, false);
      assert.equal(report.preparation.restoration.inert, true);
      assert.equal(report.preparation.restoration.stagedAttributesRemaining, 0);
    }
    await target.click();
    await settle(page, "layout");
    const boundary = await page.evaluate(finishPerformanceObservation);
    report.measurement = await page.evaluate(boundary => {
      const state = window.__advancedLayoutTransitionAudit;
      state.observer?.disconnect();
      state.longAnimationFrameObserver?.disconnect();
      const start = state.interactionStart;
      const end = boundary.end;
      const overlap = entry => entry.startTime < end && entry.startTime + entry.duration > start;
      const frames = state.longAnimationFrames.filter(overlap);
      const gaps = state.frameGaps.filter(overlap);
      const wholeOverlap = entry => entry.startTime < end && entry.startTime + entry.duration > state.start;
      const wholeFrames = state.longAnimationFrames.filter(wholeOverlap);
      const wholeGaps = state.frameGaps.filter(wholeOverlap);
      const preparationFrames = state.longAnimationFrames.filter(entry =>
        entry.startTime < start && entry.startTime + entry.duration > state.start);
      return {
        boundary, interactionStart: start, interactionEnd: end, interactionSource: state.interactionSource,
        durationMs: end - start, longAnimationFrameSupported: state.longAnimationFrameSupported,
        longAnimationFrames: frames, maxLoafMs: Math.max(0, ...frames.map(frame => frame.duration)),
        maxFrameGapMs: Math.max(0, ...gaps.map(gap => gap.duration)), frameCount: gaps.length,
        longTasks: state.longTasks.filter(overlap),
        wholeSequence: { start: state.start, end, durationMs: end - state.start,
          longAnimationFrames: wholeFrames, maxLoafMs: Math.max(0, ...wholeFrames.map(frame => frame.duration)),
          maxFrameGapMs: Math.max(0, ...wholeGaps.map(gap => gap.duration)),
          frameCount: wholeGaps.length },
        preparationWindow: { start: state.start, end: start, durationMs: start - state.start,
          longAnimationFrames: preparationFrames,
          maxLoafMs: Math.max(0, ...preparationFrames.map(frame => frame.duration)) },
      };
    }, boundary);
    assert.equal(report.measurement.interactionSource, "trusted-pointerdown");
    assert.equal(report.measurement.longAnimationFrameSupported, true);
    assert(report.measurement.frameCount > 0);
    report.finalGeometry = await page.locator(".runtime-layout-stage:visible").boundingBox();
    assert(report.finalGeometry.width > 2000 && report.finalGeometry.height > 1000);
    report.finalCheckboxPaint = await page.evaluate(captureCheckboxPaintState);
    assert(report.finalCheckboxPaint.length > 0, "checkbox evidence must not be empty");
    if (checkboxPaint.mode !== "default")
      assert(report.finalCheckboxPaint.every(control => control.opacity === "0"),
        "omitted checkbox paint must remain omitted through actual presentation");
    if (layoutShadow.mode !== "default") {
      const finalShadowState = await page.evaluate(captureLayoutShadowState);
      report.finalLayoutShadow = { count: finalShadowState.length,
        remainingShadowCount: finalShadowState.filter(item => item.shadow !== "none").length };
      assert(finalShadowState.length > 0 && report.finalLayoutShadow.remainingShadowCount === 0,
        "layout shadows must remain omitted through actual presentation");
    }
    // Collect graphics provenance after the measured interval, so creating a
    // WebGL context cannot warm programs used in first presentation.
    report.graphics = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      const debug = gl?.getExtension("WEBGL_debug_renderer_info");
      return {
        vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
        renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
      };
    });
    assert(report.graphics.renderer?.includes("NVIDIA GeForce GTX 1050 Ti"));
    const browserSession = await browser.newBrowserCDPSession();
    try {
      const info = await browserSession.send("SystemInfo.getInfo");
      report.graphics.gpuFeatureStatus = info.gpu?.featureStatus;
      report.graphics.browserCommandLine = info.commandLine;
      report.graphics.gpuAuxAttributes = Object.fromEntries([
        "glRenderer", "displayType", "glImplementationParts", "skiaBackendType",
        "graphiteDawnBackend", "graphiteDawnAdapter",
      ].filter(key => Object.hasOwn(info.gpu?.auxAttributes ?? {}, key))
        .map(key => [key, info.gpu.auxAttributes[key]]));
    } catch (error) {
      report.graphics.systemInfoError = String(error);
    } finally {
      await browserSession.detach();
    }
    report.rendererAttribution = validateWebView2Renderer(rendererMode, report.graphics);
    assert.equal(report.rendererAttribution.matched, true, "requested renderer must be confirmed by actual GPU status and launch arguments");
    await page.screenshot({ path: path.join(paths.output, "webview2-layout.png") });
    const measuredMax = preparationMode === "default" ? report.measurement.maxLoafMs
      : report.measurement.wholeSequence.maxLoafMs;
    report.performanceStatus = measuredMax > 50 ? "FAILED" : "NO_LOAF_OBSERVED_DIAGNOSTIC_ONLY";
    report.status = "DIAGNOSTIC_COMPLETED";
    report.ownerExitHandle = "spawned native host; close only this host in finally";
  } catch (error) {
    report.status = "FAILED";
    report.error = error.stack || String(error);
    process.exitCode = 1;
  } finally {
    // Close the exact native window launched above, not unrelated WebView2s.
    try {
      if (host?.pid && host.exitCode === null && host.signalCode === null) {
        execFileSync("powershell.exe", ["-NoProfile", "-Command",
          `$diagnosticHost = Get-Process -Id ${host.pid} -ErrorAction SilentlyContinue
           if ($null -ne $diagnosticHost) { $diagnosticHost.CloseMainWindow() | Out-Null }`],
        { windowsHide: true, timeout: 10_000 });
        await Promise.race([
          new Promise(resolve => host.once("exit", resolve)),
          new Promise(resolve => setTimeout(resolve, 5000)),
        ]);
        if (host.exitCode === null && host.signalCode === null) {
          execFileSync("taskkill.exe", ["/PID", String(host.pid), "/T", "/F"], { windowsHide: true });
          report.hostCleanup = "owned-host-tree-force-terminated";
        } else report.hostCleanup = "owned-host-gracefully-closed";
      }
    } catch (error) {
      report.cleanupError = String(error);
      report.status = "FAILED";
      process.exitCode = 1;
    }
    await browser?.close().catch(() => {});
    if (preview) await preview.close();
    report.hostExited = !host || host.exitCode !== null || host.signalCode !== null;
    report.productionIndexHashAfter = hash(path.join(root, "editor", "dist", "index.html"));
    report.devHashAfter = hash(path.join(root, "AgentVN Dev.exe"));
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(paths.output, "host.log"), hostLog, "utf8");
    fs.writeFileSync(path.join(paths.output, "report.json"), JSON.stringify(report, null, 2), "utf8");
    console.log(JSON.stringify({ status: report.status, performanceStatus: report.performanceStatus,
      measurement: report.measurement && { maxLoafMs: report.measurement.maxLoafMs,
        maxFrameGapMs: report.measurement.maxFrameGapMs,
        ...(preparationMode !== "default" ? {
          preparationMaxLoafMs: report.measurement.preparationWindow.maxLoafMs,
          wholeSequenceMaxLoafMs: report.measurement.wholeSequence.maxLoafMs,
        } : {}) },
      error: report.error, reportPath: path.join(paths.output, "report.json") }, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
