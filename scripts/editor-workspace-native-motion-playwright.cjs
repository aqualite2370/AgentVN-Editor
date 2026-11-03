#!/usr/bin/env node
"use strict";

// Editor only. Never exercises GameCLI or treats native Dev as installed Release.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const { spawn, spawnSync, execFileSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { root, resolveAcceptancePaths } = require("./lib/editor-ui-acceptance.cjs");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { resolveNativeReviewTimeout } = require("./lib/native-review-timeout.cjs");
const { geometry: inspectRenpyPreview, verify: assertRenpyPreview, waitForRuntimePreview } = require("./editor-renpy-preview-geometry-playwright.cjs");
const { begin: startDeviceMotion, finish: finishDeviceMotion, verify: assertDeviceMotion,
  verifyTitleScale: assertTitleLogicalScale } = require("./editor-renpy-preview-motion-playwright.cjs");
const { startFrames: startGuiFrames, stopFrames: stopGuiFrames, assertMotion: assertGuiMotion } = require("./editor-gui-import-dialog-playwright.cjs");
const { inspectGuiDialogPaint, assertGuiDialogPaint } = require("./lib/gui-dialog-paint.cjs");
const {
  captureHandoff, captureWorkspacePanelClose, inspectPersistentWorkspace,
  captureInterruptedWorkspacePanelEntry, captureInterruptedWorkspacePanelExit,
  waitForSurfaceTransitionSettled,
  inspectCloseBackgroundContinuity,
  captureClosingWorkspaceInput,
} = require("./editor-workspace-surface-transition-playwright.cjs");

const isolation = resolveAcceptancePaths();
const output = isolation.output;
const exe = path.join(root, "AgentVN Dev.exe");
const debugExe = path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe");
const interactiveReviewTimeoutMs = process.argv.includes("--interactive-review")
  ? resolveNativeReviewTimeout(process.env.AGENTVN_NATIVE_UI_REVIEW_TIMEOUT_MS)
  : null;
const requestedViewports = process.argv.find(argument => argument.startsWith("--viewport="))
  ?.slice("--viewport=".length)
  .split(",")
  .map(viewport => viewport.trim())
  .filter(Boolean) ?? null;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const report = {
  runId: crypto.randomUUID(), status: "RUNNING",
  scope: "Editor native Dev WebView2; not installed Release or GameCLI acceptance",
  isolation, cases: [], results: [], cleanup: {},
  interactiveReviewTimeoutMs,
};
function windowsProcesses() {
  const raw = execFileSync("powershell.exe", ["-NoProfile", "-Command",
    "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath | ConvertTo-Json -Compress"],
  { windowsHide: true, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const parsed = raw.trim() ? JSON.parse(raw) : [];
  return Array.isArray(parsed) ? parsed : [parsed];
}
function portOwner(port) {
  const raw = execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `Get-NetTCPConnection -State Listen -LocalPort ${Number(port)} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | ConvertTo-Json -Compress`],
  { windowsHide: true, encoding: "utf8" });
  const parsed = raw.trim() ? JSON.parse(raw) : [];
  return [...new Set(Array.isArray(parsed) ? parsed : [parsed])];
}
async function portFree(port = 0) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", () => {
      const selected = probe.address().port;
      probe.close(error => error ? reject(error) : resolve(selected));
    });
  });
}
function childAlive(child, label) {
  assert(child && child.exitCode === null && child.signalCode === null, `${label} exited`);
}
async function applyViewport(page, session, viewport) {
  if (!viewport.actual) await session.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.dpr,
    mobile: false,
  });
  await page.emulateMedia({ reducedMotion: viewport.reduced ? "reduce" : "no-preference" });
  await page.evaluate(() => new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    visualViewport: window.visualViewport ? {
      width: visualViewport.width,
      height: visualViewport.height,
      scale: visualViewport.scale,
      offsetLeft: visualViewport.offsetLeft,
      offsetTop: visualViewport.offsetTop,
    } : null,
  }));
}
async function captureNativeScreenshot(session, filePath) {
  const screenshot = await session.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const png = Buffer.from(screenshot.data, "base64");
  fs.writeFileSync(filePath, png);
  return png;
}
async function poll(check, timeout = 60000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { const result = await check(); if (result) return result; } catch (error) { lastError = error; }
    await pause(250);
  }
  throw new Error(`Owned readiness timeout: ${lastError?.message || "condition not reached"}`);
}
async function stopOwned(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  // Only captured handles spawned by this runner are accepted.
  const exited = new Promise(resolve => child.once("exit", resolve));
  const stopped = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"],
    { windowsHide: true, encoding: "utf8" });
  if (stopped.status !== 0 && child.exitCode === null && child.signalCode === null)
    throw new Error(`Owned process ${child.pid} cleanup failed: ${stopped.stdout} ${stopped.stderr}`);
  let timeout;
  await Promise.race([exited, new Promise((_, reject) => {
    timeout = setTimeout(() => reject(Error(`Owned process ${child.pid} did not exit`)), 5000);
  })]).finally(() => clearTimeout(timeout));
}
function delta(a, b) {
  assert(a && b, "Missing workspace rectangle");
  return Math.max(...["left", "top", "width", "height"].map(key => Math.abs(a[key] - b[key])));
}
function assertWorkspace(workspace, baseline) {
  assert(workspace.paletteVisible && !workspace.paletteClipped && !workspace.paletteCoveredByPanel,
    "Native node controls hidden, clipped or covered");
  assert(workspace.inspectorVisible && !workspace.inspectorCoveredByPanel,
    "Native Inspector hidden or covered by the right-side workbench");
  assert(workspace.bodyVisible && workspace.bodyFilter === "none"
    && workspace.paletteFilterAncestors.length === 0, "Native blur must not hide/soften node controls");
  assert(workspace.flowFilter.includes("blur(2.5px)"), "Native canvas background not blurred");
  assert(!workspace.horizontalOverflow, "Native viewport horizontally overflows");
  for (const [key, baselineKey] of [["paletteRect", "paletteRect"], ["flowRect", "flowRect"], ["inspectorRect", "inspectorRect"]])
    assert(delta(workspace[key], baseline[baselineKey]) <= 1.5, `Native ${key} changed tracks`);
}
function measureHandoff(handoff, target) {
  const identity = transform => ["none", "matrix(1, 0, 0, 1, 0, 0)"].includes(transform);
  const first = handoff.frames.findIndex(frame => frame.task === target && frame.selectedSurface === target);
  const settled = frame => frame.task === target && frame.selectedSurface === target
    && frame.opacity >= 0.999 && frame.contentOpacity >= 0.999
    && identity(frame.transform) && (frame.ghostOpacity === null || frame.ghostOpacity <= 0.001)
    && delta(frame.rect, handoff.final.rect) <= 1.5;
  const end = handoff.frames.findIndex((frame, index) => index > first
    && settled(frame) && settled(handoff.frames[index - 1]));
  assert(first >= 0 && end > first, "Native visible handoff lacks two final presentation frames");
  const times = handoff.frames.slice(first, end + 1).map(frame => frame.at);
  const gaps = times.slice(1).map((at, index) => at - times[index]).sort((a, b) => a - b);
  return {
    firstTargetRenderedAt: times[0], finalPresentationPairAt: times.at(-1),
    effectiveVisibleHandoffMs: times.at(-1) - times[0],
    stateSettledAt: handoff.final.settledAt,
    invisibleCleanupTailMs: Math.max(0, handoff.final.settledAt - times.at(-1)),
    nominalAnimationDurations: [...new Set(handoff.frames.flatMap(frame =>
      [...frame.popoverAnimations, ...frame.contentAnimations, ...frame.ghostAnimations]
        .map(animation => animation.duration).filter(duration => duration > 0)))],
    visibleFrameCount: times.length, p95FrameGapMs: gaps[Math.ceil(gaps.length * 0.95) - 1],
    comparisonStatus: "HISTORICAL_REFERENCE_ONLY; no pre-fix run of this exact native build",
  };
}
function measureClose(close) {
  const clear = filter => filter === "none"
    || /^blur\(0(?:px)?\)(?: saturate\(1\))?$/.test(filter);
  const first = close.frames.findIndex(frame => frame.selectedSurface === "edit"
    && (frame.opacity < 0.999 || !clear(frame.workspaceFilter)));
  const settled = frame => frame.selectedSurface === "edit"
    && (!frame.panelPresent || frame.opacity <= 0.001)
    && frame.ghostCount === 0 && clear(frame.workspaceFilter);
  const end = close.frames.findIndex((frame, index) => index > first
    && settled(frame) && settled(close.frames[index - 1]));
  assert(first >= 0 && end > first, "Native close lacks two visually settled frames");
  return {
    effectiveVisibleHandoffMs: close.frames[end].at - close.frames[first].at,
    finalPresentationPairAt: close.frames[end].at,
    stateSettledAt: close.settledAt, panelUnmountAt: close.panelUnmountAt,
    invisibleCleanupTailMs: Math.max(0, close.settledAt - close.frames[end].at),
    animationStart: close.animationStart, animationEnd: close.animationEnd,
    comparisonStatus: "HISTORICAL_REFERENCE_ONLY; no pre-fix run of this exact native build",
  };
}
function assertHandoff(handoff, target) {
  assert.equal(handoff.captureStopReason, "two-consecutive-settled-frames");
  assert.equal(handoff.final.selectedSurface, target);
  assert.equal(handoff.final.task, target);
  assert.equal(handoff.final.inert, false);
  assert.equal(handoff.final.ghostCount, 0);
  assert.equal(handoff.final.runningAnimationCount, 0);
  const live = handoff.frames.filter(frame => frame.workspacePresentation?.paletteRect);
  assert(live.length >= 4, "Native handoff lacks rendered intermediate frames");
  const baseline = handoff.workspaceBaseline;
  for (const frame of live) {
    const workspace = frame.workspacePresentation;
    assert(workspace.paletteDisplay !== "none" && workspace.paletteVisibility !== "hidden"
      && workspace.paletteOpacity > 0.01 && !workspace.palettePanelOverlap,
    "Native frame hides/occludes the node rail");
    assert(workspace.inspectorVisible && !workspace.inspectorPanelOverlap,
      "Native frame hides/occludes the Inspector");
    assert.equal(workspace.paletteFilteredAncestors.length, 0);
    for (const key of ["palette", "flow", "inspector"])
      assert(delta(workspace[`${key}Rect`], baseline[key]) <= 1.5, `Native ${key} frame reflow`);
  }
  const changes = handoff.frames.filter(frame => frame.task === target
    && frame.opacity > 0.001 && frame.opacity < 0.999);
  const presentedContent = handoff.frames.filter(frame => frame.contentOpacity > 0.001 && frame.contentOpacity < 0.999);
  assert(changes.length >= 2 || presentedContent.length >= 2, "Native handoff hard-cut without visual handoff");
}
async function captureColdEntry(page, card) {
  await page.evaluate(() => {
    const capture = { frames: [], longFrames: [], events: [], done: false };
    window.__nativeColdEntry = capture;
    if (PerformanceObserver.supportedEntryTypes.includes("long-animation-frame")) {
      capture.observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) capture.longFrames.push({
          startTime: entry.startTime, duration: entry.duration, blockingDuration: entry.blockingDuration,
          renderStart: entry.renderStart, styleAndLayoutStart: entry.styleAndLayoutStart,
          scripts: Array.from(entry.scripts || [], script => ({
            sourceURL: script.sourceURL, sourceFunctionName: script.sourceFunctionName,
            invoker: script.invoker, invokerType: script.invokerType,
            startTime: script.startTime, duration: script.duration,
            forcedStyleAndLayoutDuration: script.forcedStyleAndLayoutDuration,
          })),
        });
      });
      capture.observer.observe({ type: "long-animation-frame", buffered: false });
    }
    capture.onAnimation = event => {
      if (event.animationName !== "container-boot") return;
      capture.events.push({ type: event.type, at: performance.now(),
        elapsedTime: event.elapsedTime, name: event.animationName });
    };
    for (const type of ["animationstart", "animationend", "animationcancel"])
      document.addEventListener(type, capture.onAnimation, true);
    const frame = at => {
      const container = document.querySelector(".app-view-editor.is-entering");
      const animation = container?.getAnimations().find(a => a.playState === "running");
      capture.frames.push({
        at, entering: Boolean(container), iframeCount: document.querySelectorAll("iframe").length,
        animation: animation && { name: animation.animationName,
          currentTime: animation.currentTime, duration: animation.effect?.getTiming().duration },
      });
      if (!capture.done) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await card.click();
  await page.locator(".editor-toolbar").waitFor({ timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay")
    && !document.querySelector(".app-view-editor.is-entering"), undefined, { timeout: 60000 });
  const result = await page.evaluate(() => {
    const capture = window.__nativeColdEntry;
    capture.done = true;
    capture.observer?.disconnect();
    for (const type of ["animationstart", "animationend", "animationcancel"])
      document.removeEventListener(type, capture.onAnimation, true);
    return { frames: capture.frames, longFrames: capture.longFrames, events: capture.events };
  });
  // Preserve the observed failure, not only the thrown assertion. All original
  // cadence/overlap gates below remain authoritative.
  report.coldEntry = result;
  const animated = result.frames.filter(frame => frame.animation);
  assert(animated.length >= 4, "Actual native cold entry lacks container morph frames");
  assert(animated.every(frame => frame.iframeCount === 0), "Native preview iframe overlapped container morph");
  const gaps = animated.slice(1).map((frame, index) => frame.at - animated[index].at).sort((a, b) => a - b);
  result.metrics = {
    morphFrames: animated.length, declaredDurations: [...new Set(animated.map(frame => frame.animation.duration))],
    firstAt: animated[0].at, lastAt: animated.at(-1).at,
    medianGapMs: gaps[Math.floor(gaps.length / 2)], p95GapMs: gaps[Math.floor(gaps.length * 0.95)],
    maxGapMs: gaps.at(-1),
  };
  assert(result.metrics.declaredDurations.includes(1120), "Native entry changed GitHub container timing");
  assert(result.metrics.p95GapMs <= 100, "Native entry cadence exceeds original rendered-cadence gate");
  result.overlappingLongFrames = result.longFrames.filter(frame =>
    frame.duration >= 50 && frame.startTime < result.metrics.lastAt
      && frame.startTime + frame.duration > result.metrics.firstAt);
  assert.equal(result.overlappingLongFrames.length, 0, "Native cold-entry startup long frame overlaps morph");
  await page.locator(".embedded-runtime-preview-status.is-ready")
    .waitFor({ state: "visible", timeout: 60000 });
  return result;
}
async function main() {
  fs.mkdirSync(output, { recursive: true });
  let backend, vite, host, browser, page, session;
  const logStreams = [];
  try {
    assert.equal(process.platform, "win32", "Native Editor test requires Windows");
    assert(fs.existsSync(exe) && fs.existsSync(debugExe), "Native Dev executables missing");
    assert.equal(sha256(exe), sha256(debugExe), "Root Dev has not actually been replaced");
    const existing = windowsProcesses().filter(proc => /^(AgentVN Dev|agentvn-editor)\.exe$/i.test(proc.Name));
    assert.equal(existing.length, 0, "Refuse existing Editor session, including unknown projects");
    await portFree(6767); // Fixed Debug devUrl. Refuse reuse, do not kill whoever owns it.
    const backendPort = await portFree();
    const cdpPort = await portFree();
    assert(backendPort !== cdpPort && backendPort !== 6767 && cdpPort !== 6767);
    const data = path.join(output, "isolated-data");
    const webview = path.join(output, "isolated-webview");
    const backendUrl = `http://127.0.0.1:${backendPort}`;
    report.executable = { path: exe, sha256: sha256(exe), modifiedAt: fs.statSync(exe).mtime.toISOString() };
    report.frontend = {
      mode: "owned Vite source server in actual native Dev host; not production/Release",
      sourceFiles: ["editor/src/styles/editor-shell.css", "editor/src/styles/editor-topbar.css",
        "editor/src/components/editor/EditorToolbar.tsx",
        "editor/src/components/advanced/RenpyPreviewStage.tsx",
        "editor/src/components/advanced/RenpyTitleEditor.tsx",
        "editor/src/components/advanced/RenpyRuntimePreview.tsx",
        "GameCli_framework/src/components/shell/RenpyTitleView.tsx"].map(relative => ({
        path: path.join(root, relative), sha256: sha256(path.join(root, relative)),
      })),
      fixtureSha256: sha256(isolation.input),
    };
    report.backendUrl = backendUrl;
    report.cdpPort = cdpPort;
    backend = spawn(process.env.PYTHON || "python", ["backend_launcher.py"], {
      cwd: path.join(root, "backend"), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, AGENTVN_EDITOR_DATA_DIR: data, AGENTVN_BACKEND_DATA_DIR: path.join(data, "backend"),
        DATABASE_PATH: path.join(data, "backend/vn_engine.db"), AGENTVN_BACKEND_PORT: String(backendPort),
        AGENTVN_LEGACY_DATABASE_PATHS: "" },
    });
    const log = fs.createWriteStream(path.join(output, "backend.log"), { flags: "wx" });
    logStreams.push(log);
    backend.stdout.pipe(log, { end: false }); backend.stderr.pipe(log, { end: false });
    await poll(async () => {
      childAlive(backend, "Owned backend");
      return (await fetch(`${backendUrl}/api/health`, { signal: AbortSignal.timeout(1500) })).ok;
    });
    assert.deepEqual(portOwner(backendPort), [backend.pid], "Backend port owner mismatch");
    // Fixture setup uses the public import API. All navigation below is real UI.
    const imported = await fetch(`${backendUrl}/api/project/projects/import`, {
      method: "POST", headers: { "Content-Type": "application/octet-stream",
        "X-AgentVN-Filename": encodeURIComponent(path.basename(isolation.input)) },
      body: fs.readFileSync(isolation.input),
    });
    assert(imported.ok, `Isolated fixture import failed: ${await imported.text()}`);
    const catalog = await (await fetch(`${backendUrl}/api/project/catalog`)).json();
    assert.deepEqual(catalog.data.map(item => item.project_id), [isolation.fixtureProjectId],
      "Isolated backend must contain only the supplied small project");
    const fixture = JSON.parse(fs.readFileSync(isolation.input, "utf8"));
    const previousUrl = process.env.VITE_BACKEND_URL;
    process.env.VITE_BACKEND_URL = backendUrl;
    try { vite = await startOwnedViteServer({ root: path.join(root, "editor"), port: 6767,
      logFile: path.join(output, "vite.log") }); }
    finally {
      if (previousUrl === undefined) delete process.env.VITE_BACKEND_URL;
      else process.env.VITE_BACKEND_URL = previousUrl;
    }
    await vite.assertAlive();
    assert.deepEqual(portOwner(6767), [vite.pid], "Fixed devUrl must be owned by this run");
    host = spawn(exe, [], { cwd: output, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, AGENTVN_EDITOR_DATA_DIR: data, AGENTVN_BACKEND_PORT: String(backendPort),
        AGENTVN_LEGACY_DATABASE_PATHS: "", WEBVIEW2_USER_DATA_FOLDER: webview,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}` } });
    const hostLog = fs.createWriteStream(path.join(output, "native-host.log"), { flags: "wx" });
    logStreams.push(hostLog);
    host.stdout.pipe(hostLog, { end: false }); host.stderr.pipe(hostLog, { end: false });
    browser = await poll(async () => {
      childAlive(host, "Owned Dev");
      await vite.assertAlive();
      return chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`, { timeout: 2000 });
    });
    report.browser = { version: browser.version(), renderingMode: "native WebView2" };
    const processes = windowsProcesses();
    const native = processes.find(proc => proc.ProcessId === host.pid);
    assert.equal(native?.ExecutablePath?.toLowerCase(), exe.toLowerCase());
    const descendants = new Set([host.pid]);
    for (let changed = true; changed;) {
      changed = false;
      for (const proc of processes) if (descendants.has(proc.ParentProcessId) && !descendants.has(proc.ProcessId)) {
        descendants.add(proc.ProcessId); changed = true;
      }
    }
    assert(portOwner(cdpPort).every(pid => descendants.has(pid)), "CDP listener is not owned by this host");
    report.owner = { host: native, backendPid: backend.pid, vitePid: vite.pid, viteRunId: vite.runId,
      viteUrl: vite.url, cdpOwners: portOwner(cdpPort), data, webview };
    page = browser.contexts()[0].pages()[0];
    assert(page, "Native WebView did not expose a page");
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on("pageerror", error => errors.push(String(error.stack || error)));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.locator(".project-home").waitFor({ timeout: 60000 });
    assert.equal(new URL(page.url()).origin, vite.url, "Native frontend connected to an unrelated service");
    const capabilities = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("get_native_capabilities"));
    assert(capabilities.includes(`backend-base-url=${backendUrl}`), "Native host backend did not stay isolated");
    report.nativeCapabilities = capabilities;
    report.actualWindowViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
      dpr: devicePixelRatio, screen: { width: screen.width, height: screen.height } }));
    await page.locator(".recent-project-open").filter({ hasText: fixture.title }).waitFor();
    assert.equal(await page.locator(".recent-project-open").count(), 1, "WebView reused unknown recent projects");
    report.coldEntry = await captureColdEntry(page, page.locator(".recent-project-open"));
    const projectId = await page.evaluate(async () => {
      const { useProjectStore } = await import("/src/store/projectStore.ts");
      return useProjectStore.getState().projectId;
    });
    assert.equal(projectId, isolation.fixtureProjectId);
    report.fixtureSetup = "public backend fixture import; real recent-project button; projectId verified read-only";
    report.cases.push({ name: "real-native-cold-container-entry", status: "PASS",
      viewport: report.actualWindowViewport, metrics: report.coldEntry.metrics });
    session = await page.context().newCDPSession(page);
    if (process.argv.includes("--gui-directory-only")) {
      report.nativeGuiDirectory = await require("./lib/renpy-native-directory-flow.cjs").runNativeDirectoryFlow({
        page, hostPid: host.pid, output, root,
      });
      report.cases.push({ name: "native-directory-cancel-scan-apply-bytes", status: "PASS" });
      report.errors = errors;
      assert.equal(errors.length, 0, "Native directory flow browser errors");
      report.status = "PASS";
      return;
    }
    const matrix = [
      { name: "actual-native-window", actual: true },
      ...[
        { name: "1080p", width: 1920, height: 1080 },
        { name: "1440p", width: 2560, height: 1440 },
        { name: "4k", width: 3840, height: 2160 },
      ].flatMap(viewport => [
        { ...viewport, name: `${viewport.name}-webview`, dpr: 1 },
        { ...viewport, name: `${viewport.name}-dpr2-webview`, dpr: 2 },
        { ...viewport, name: `${viewport.name}-reduced-dpr2-webview`, dpr: 2, reduced: true },
      ]),
    ];
    const selectedMatrix = requestedViewports
      ? matrix.filter(viewport => requestedViewports.includes(viewport.name))
      : matrix;
    assert(selectedMatrix.length > 0, `Unknown native viewport filter: ${requestedViewports?.join(",")}`);
    if (requestedViewports) {
      const selectedNames = new Set(selectedMatrix.map(viewport => viewport.name));
      const missing = requestedViewports.filter(name => !selectedNames.has(name));
      assert.equal(missing.length, 0, `Unknown native viewport filters: ${missing.join(",")}`);
    }
    report.matrixSelection = {
      requestedViewports,
      selected: selectedMatrix.map(viewport => viewport.name),
    };
    for (const viewport of selectedMatrix) {
      childAlive(host, "Owned Dev"); childAlive(backend, "Owned backend"); await vite.assertAlive();
      const viewportBeforeCase = await applyViewport(page, session, viewport);
      const result = { viewport, scope: viewport.actual ? "actual native window" : "CDP viewport emulation in actual WebView2; not physical screen",
        browserViewport: viewportBeforeCase,
        transitionViewportCheckpoints: [],
        baseline: await inspectPersistentWorkspace(page), transitions: [] };
      report.results.push(result);
      const logicalWidth = await page.evaluate(() => innerWidth);
      const expectedRail = Math.min(360, Math.max(280, logicalWidth * 0.15)) * 0.7;
      assert(Math.abs(result.baseline.paletteRect.width - expectedRail) <= 1,
        `Native node rail must use 70% of its original track (${result.baseline.paletteRect.width} vs ${expectedRail})`);
      result.nodeRail = { expectedWidth: expectedRail, actualWidth: result.baseline.paletteRect.width, status: "PASS" };
      for (const [from, to] of [["edit", "options"], ["options", "assistant"], ["assistant", "options"]]) {
        const transitionViewport = await applyViewport(page, session, viewport);
        const expectedViewport = viewport.actual
          ? result.browserViewport
          : { width: viewport.width, height: viewport.height, dpr: viewport.dpr };
        assert.equal(transitionViewport.width, expectedViewport.width,
          `Native WebView width drifted before ${from}->${to}: ${JSON.stringify(transitionViewport)}`);
        assert.equal(transitionViewport.height, expectedViewport.height,
          `Native WebView height drifted before ${from}->${to}: ${JSON.stringify(transitionViewport)}`);
        assert.equal(transitionViewport.dpr, expectedViewport.dpr,
          `Native WebView DPR drifted before ${from}->${to}: ${JSON.stringify(transitionViewport)}`);
        assert.equal(transitionViewport.reducedMotion, Boolean(viewport.reduced),
          `Native WebView motion preference drifted before ${from}->${to}`);
        result.transitionViewportCheckpoints.push({ from, to, viewport: transitionViewport });
        const handoff = await captureHandoff(page, from, to);
        for (const frame of handoff.frames) {
          assert.equal(frame.viewport?.width, expectedViewport.width,
            `Native WebView width changed during ${from}->${to}`);
          assert.equal(frame.viewport?.height, expectedViewport.height,
            `Native WebView height changed during ${from}->${to}`);
          assert.equal(frame.viewport?.dpr, expectedViewport.dpr,
            `Native WebView DPR changed during ${from}->${to}`);
        }
        result.transitions.push({ from, to, handoff, measurement: measureHandoff(handoff, to) });
        assertHandoff(handoff, to);
        const workspace = await inspectPersistentWorkspace(page);
        assertWorkspace(workspace, result.baseline);
        await captureNativeScreenshot(session, path.join(output, `${viewport.name}-${to}.png`));
      }
      result.close = await captureWorkspacePanelClose(page);
      result.close.backgroundContinuity = inspectCloseBackgroundContinuity(result.close);
      assert.equal(result.close.backgroundContinuity.rebounds.length, 0,
        `Native close background reblurred by ${result.close.backgroundContinuity.maximumReboundPx}px`);
      assert(result.close.frames.filter(frame => frame.selectedSurface === "edit")
        .every(frame => !frame.bodyInert && !frame.focusedInClosingPanel),
      "Native cleanup retained Editor input/focus after ownership returned");
      result.closeMeasurement = measureClose(result.close);
      assert.equal(result.close.finalSurface, "edit");
      assert.equal(result.close.focusedSurface, "edit");
      assert.equal(result.close.finalWorkspaceFilter, "none");
      assert.equal(result.close.finalPanelCount, 0);
      assert(result.close.frames.filter(frame => frame.opacity > 0.01 && frame.opacity < 0.99).length >= 4,
        "Native close has no visible transition");
      result.closingWorkspaceInput = await captureClosingWorkspaceInput(page);
      assert(Object.values(result.closingWorkspaceInput.checks).every(Boolean),
        `Native Editor input during cleanup/reopen failed: ${JSON.stringify(result.closingWorkspaceInput.checks)}`);
      await captureWorkspacePanelClose(page);
      result.interruptedEntry = await captureInterruptedWorkspacePanelEntry(page);
      assert.equal(result.interruptedEntry.finalSurface, "edit");
      assert(result.interruptedEntry.monotonicExit && Math.abs(result.interruptedEntry.firstClosingFrame.opacity
        - result.interruptedEntry.opacityAtReverse) <= 0.12, "Native entry reversal discontinuity");
      await page.locator('[data-workspace-surface="options"]:visible').click();
      await waitForSurfaceTransitionSettled(page, "options");
      result.interruptedExit = await captureInterruptedWorkspacePanelExit(page);
      assert.equal(result.interruptedExit.finalTask, "options");
      assert(result.interruptedExit.monotonicEntry && Math.abs(result.interruptedExit.firstOpeningFrame.opacity
        - result.interruptedExit.opacityAtReverse) <= 0.12, "Native exit reversal discontinuity");
      await captureWorkspacePanelClose(page);
      if (process.argv.includes("--preview-geometry") || process.argv.includes("--gui-dialog") || process.argv.includes("--preview-motion")) {
        result.previewGeometry = [];
        await page.locator('[data-workspace-surface="options"]:visible').click();
        await waitForSurfaceTransitionSettled(page, "options");
        const panel = page.locator(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)");
        await panel.locator('[data-help-key="advanced.tab.layout"]').click();
        await page.waitForFunction(() => document.querySelector(".advanced-tools-panel")?.classList.contains("is-tab-idle")
          && !document.querySelector(".toolbar-popover.advanced.is-morphing"));
        await panel.locator('[data-layout-type-option="renpy"]').click();
        const layout = panel.locator(".renpy-title-editor");
        await layout.waitFor();
        if (process.argv.includes("--gui-dialog")) {
          const trigger = layout.getByTestId("renpy-gui-import-open");
          const dialog = page.getByTestId("renpy-gui-import-dialog");
          await startGuiFrames(page);
          await trigger.click();
          result.guiDialog = { entry: assertGuiMotion(await stopGuiFrames(page, true), "native entry") };
          assert(await dialog.evaluate(node => node.contains(document.activeElement)), "Native import initial focus");
          await dialog.getByRole("button", { name: "关闭导入预览", exact: true }).focus();
          await page.keyboard.press("Shift+Tab");
          assert(await dialog.evaluate(node => node.contains(document.activeElement)), "Native import focus fence");
          const guiPng = await captureNativeScreenshot(session, path.join(output, `${viewport.name}-gui-import.png`));
          result.guiDialog.paint = await inspectGuiDialogPaint(page, dialog, guiPng);
          assertGuiDialogPaint(result.guiDialog.paint);
          await startGuiFrames(page);
          await page.keyboard.press("Escape");
          result.guiDialog.exit = assertGuiMotion(await stopGuiFrames(page, false), "native exit");
          assert(await trigger.evaluate(node => node === document.activeElement), "Native import focus restore");
          assert.equal(await layout.count(), 1, "Native Escape must preserve underlying Editor");
          result.guiDialog.status = "PASS";
        }
        for (const screen of ["title", "about"]) {
          await layout.locator(".runtime-layout-sidebar").getByRole("button", {
            name: screen === "title" ? "标题主页" : "关于", exact: true }).click();
          if (screen === "about") {
            await layout.locator('.renpy-editor-runtime-viewport[data-preview-phase="ready"]').waitFor();
            await waitForRuntimePreview(page, screen);
          }
          if (process.argv.includes("--preview-motion")) {
            result.previewMotion ??= [];
            await layout.getByRole("button", { name: "桌面预览", exact: true }).click();
            await page.waitForFunction(() => document.querySelector(".renpy-editor-device-frame")?.dataset.framePhase === "idle");
            for (const mode of ["mobile", "desktop"]) {
              const button = layout.getByRole("button", { name: mode === "desktop" ? "桌面预览" : "移动预览", exact: true });
              await startDeviceMotion(page);
              if (mode === "desktop") { await button.focus(); await page.keyboard.press("Enter"); }
              else await button.click();
              const motion = await finishDeviceMotion(page, mode);
              assertDeviceMotion(motion);
              assertTitleLogicalScale(motion);
              assert(await button.evaluate(node => node === document.activeElement), "Native device handoff lost focus");
              result.previewMotion.push({ screen, mode, status: "PASS", capture: motion });
            }
          }
          for (const mode of ["desktop", "mobile"]) {
            await layout.getByRole("button", { name: mode === "desktop" ? "桌面预览" : "移动预览", exact: true }).click();
            let runtime;
            if (screen !== "title") {
              await layout.locator('.renpy-editor-runtime-viewport[data-preview-phase="ready"]').waitFor();
              runtime = await waitForRuntimePreview(page, screen);
              assert(runtime.text.length > 0, "Native Runtime preview must render final page content");
            }
            await page.waitForFunction(() => document.querySelector(".renpy-editor-device-frame")?.dataset.framePhase !== "moving");
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const value = await inspectRenpyPreview(page, screen === "title");
            assertRenpyPreview(value, ...(mode === "desktop" ? [1280, 720] : [915, 412]));
            result.previewGeometry.push({ screen, mode, geometry: value, runtime, status: "PASS" });
            await captureNativeScreenshot(session, path.join(output, `${viewport.name}-${screen}-${mode}-geometry.png`));
          }
          if (process.argv.includes("--preview-motion")) {
            await layout.getByRole("button", { name: "桌面预览", exact: true }).click();
            await page.waitForFunction(() => document.querySelector(".renpy-editor-device-frame")?.dataset.framePhase === "idle");
            await panel.locator('[data-help-key="advanced.tab.settings"]').click();
            await page.waitForFunction(() => document.querySelector(".advanced-tools-panel")?.classList.contains("is-tab-idle")
              && !document.querySelector(".toolbar-popover.advanced.is-morphing"));
            await panel.locator('[data-help-key="advanced.tab.layout"]').click();
            await page.waitForFunction(() => {
              const panel = document.querySelector(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)");
              return panel?.getAnimations().some(animation => {
                const progress = animation.effect.getComputedTiming().progress;
                return animation.playState === "running" && progress > .1 && progress < .75;
              }) && panel.querySelector(".renpy-title-editor");
            });
            const duringMorph = await page.evaluate(() => {
              const stage = document.querySelector(".renpy-title-editor .is-device-stage");
              return { rect: stage.getBoundingClientRect().toJSON(), width: stage.clientWidth, height: stage.clientHeight };
            });
            await layout.getByRole("button", { name: "移动预览", exact: true }).focus();
            await page.keyboard.press("Enter");
            await page.waitForFunction(() => document.querySelector(".advanced-tools-panel")?.classList.contains("is-tab-idle")
              && !document.querySelector(".toolbar-popover.advanced.is-morphing")
              && document.querySelector(".renpy-editor-device-frame")?.dataset.framePhase === "idle");
            assert(Math.abs(duringMorph.rect.width - duringMorph.width) > 2
              || Math.abs(duringMorph.rect.height - duringMorph.height) > 2,
            "Native fit test must exercise a transformed workbench");
            const finalGeometry = await inspectRenpyPreview(page, screen === "title");
            assertRenpyPreview(finalGeometry, 915, 412);
            result.previewMotion.push({ screen, mode: "ancestor-morph", duringMorph,
              geometry: finalGeometry, status: "PASS" });
          }
        }
        await panel.locator('[data-help-key="advanced.tab.settings"]').click();
        await page.waitForFunction(() => document.querySelector(".advanced-tools-panel")?.classList.contains("is-tab-idle")
          && !document.querySelector(".toolbar-popover.advanced.is-morphing"));
        await captureWorkspacePanelClose(page);
      }
      result.status = "PASS";
      console.log(`PASS native Editor: ${viewport.name}`);
    }
    report.routeInventory = await page.locator("[data-workspace-surface]:visible").evaluateAll(nodes =>
      nodes.map(node => ({ label: node.textContent.trim(), surface: node.dataset.workspaceSurface })));
    report.loveChat = { status: "NOT_APPLICABLE", note: "User explicitly confirmed on 2026-10-10 that this feature does not exist; historical requirement withdrawn." };
    if (process.argv.includes("--interactive-review")) {
      // Keep this owned, isolated Dev available for native Computer Use.
      // Never launch a second editor against the user's shared data.
      await session.send("Emulation.clearDeviceMetricsOverride");
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.bringToFront();
      const releaseFile = path.join(output, "release-ui-review.json");
      const readyFile = path.join(output, "ui-review-ready.json");
      fs.writeFileSync(readyFile, JSON.stringify({
        scope: report.scope, pid: host.pid, executable: exe, sha256: sha256(exe),
        data, webview, releaseFile, reviewTimeoutMs: interactiveReviewTimeoutMs,
        readyAt: new Date().toISOString(),
      }, null, 2));
      console.log(`READY native UI review: ${readyFile}`);
      const deadline = Date.now() + interactiveReviewTimeoutMs;
      while (!fs.existsSync(releaseFile) && Date.now() < deadline) {
        childAlive(host, "Owned review Dev");
        await vite.assertAlive();
        await pause(250);
      }
      assert(fs.existsSync(releaseFile), "Native UI review was not released before its deadline");
      report.interactiveReview = JSON.parse(fs.readFileSync(releaseFile, "utf8"));
      await captureNativeScreenshot(session, path.join(output, "ui-review-final.png"));
      report.interactiveReview.finalRouteInventory = await page.locator("button:visible").evaluateAll(nodes =>
        nodes.map(node => ({ label: node.textContent.trim(), helpKey: node.dataset.helpKey,
          surface: node.dataset.workspaceSurface })));
    }
    report.errors = errors;
    assert.equal(errors.length, 0, "Native WebView browser errors");
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
    if (page && !page.isClosed()) {
      if (session) await captureNativeScreenshot(session, path.join(output, "failure.png")).catch(() => {});
      report.failureText = await page.locator("body").innerText().catch(() => "");
    }
  } finally {
    for (const [label, operation] of [
      ["host", () => stopOwned(host)],
      ["vite", () => vite?.stop()],
      ["backend", () => stopOwned(backend)],
      ["cdp", () => browser?.close()],
    ]) {
      try { await operation(); report.cleanup[label] = "PASS"; }
      catch (error) { report.cleanup[label] = String(error); report.status = "FAILED"; process.exitCode = 1; }
    }
    for (const stream of logStreams) stream.end();
    const remaining = windowsProcesses().filter(proc => [host?.pid, backend?.pid, vite?.pid].includes(proc.ProcessId));
    report.cleanup.remainingOwnedProcesses = remaining;
    if (remaining.length) { report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`${report.status}: ${path.join(output, "report.json")}`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
