#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const editorRoot = path.join(root, "editor");
const runtimeRoot = path.join(root, "GameCli_framework");
const backendRoot = path.join(root, "backend");
const unpacked = path.join(root, "output", "hidden-growth", "unpacked");
const fixture = path.join(root, "data", "backup-timeline", "project_msiz08p7_0_89ebc8a8cb__1786898326185__project.vnproj");
const outputDir = path.join(root, "output", "playwright", "quick-menu-runtime-editor-parity");
const editorUrl = process.env.AGENTVN_EDITOR_URL || "http://127.0.0.1:6767/";
const runtimeUrl = process.env.AGENTVN_RUNTIME_URL || "http://127.0.0.1:6868/?mode=preview";
const backendHealth = process.env.AGENTVN_BACKEND_HEALTH_URL || "http://127.0.0.1:8278/api/health";

function assert(condition, message, details) {
  if (!condition) {
    throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`);
  }
}

function cleanOutput() {
  fs.mkdirSync(outputDir, { recursive: true });
  for (const name of ["error.txt", "report.json"]) {
    const target = path.join(outputDir, name);
    if (fs.existsSync(target)) fs.rmSync(target, { force: true });
  }
}

async function ready(url, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server not ready: ${url}`);
}

function start(command, args, cwd) {
  return spawn(command, args, {
    cwd,
    windowsHide: true,
    shell: process.platform === "win32",
    stdio: "ignore",
  });
}

function stop(child) {
  if (!child?.pid) return;
  try {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } catch {}
}

function startStatic(rootDir, allowedOrigin) {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname).replace(/^\/+/, "");
    const target = path.resolve(rootDir, pathname);
    if (!target.startsWith(path.resolve(rootDir) + path.sep) || !fs.existsSync(target)) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Cache-Control": "no-store",
    });
    fs.createReadStream(target).pipe(response);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function loadPayload() {
  const manifest = JSON.parse(fs.readFileSync(path.join(unpacked, "manifest.json"), "utf8"));
  const script = JSON.parse(fs.readFileSync(path.join(unpacked, "script.json"), "utf8"));
  const galleryPath = path.join(unpacked, "gallery.json");
  const gallery = fs.existsSync(galleryPath)
    ? JSON.parse(fs.readFileSync(galleryPath, "utf8"))
    : { items: [] };
  const uiPath = manifest.ui_skin?.path || "ui/layout.json";
  const uiSkin = JSON.parse(fs.readFileSync(path.join(unpacked, uiPath), "utf8"));
  return { manifest, script, gallery, uiSkin };
}

function authoredFrame(viewport) {
  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height);
  const logicalWidth = Math.min(width, height * 16 / 9);
  return {
    width: logicalWidth,
    height: logicalWidth * 9 / 16,
    rotated: false,
  };
}

async function importEditorFixture(page) {
  await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
  const input = page.locator(".project-import-button input").first();
  await input.waitFor({ state: "attached", timeout: 30_000 });
  await page.waitForFunction(
    () => [...document.querySelectorAll(".project-import-button input")]
      .some((candidate) => candidate instanceof HTMLInputElement && !candidate.disabled),
    undefined,
    { timeout: 30_000 },
  );
  await input.setInputFiles(fixture);
  await page.waitForFunction(
    () => [...document.querySelectorAll('[data-help-key="home.openDraft"], [data-help-key="home.recentProject"]')]
      .some((element) => {
        const value = element.getBoundingClientRect();
        return value.width > 0 && value.height > 0
          && !(element instanceof HTMLButtonElement && element.disabled);
      }),
    undefined,
    { timeout: 60_000 },
  );
  const openDraft = page.locator(
    '[data-help-key="home.openDraft"]:visible:not(:disabled), [data-help-key="home.recentProject"]:visible:not(:disabled)',
  ).first();
  await openDraft.waitFor({ state: "visible", timeout: 45_000 });
  await openDraft.click({ force: true });
  await page.locator(".editor-toolbar").waitFor({ state: "visible", timeout: 90_000 });
  await page.waitForFunction(
    () => !document.querySelector(".project-entry-loading-overlay"),
    undefined,
    { timeout: 90_000 },
  ).catch(() => {});
  await page.waitForTimeout(300);
}

async function openEditorLayout(page) {
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
  await page.locator(".runtime-layout-designer").waitFor({ state: "visible", timeout: 30_000 });
  const playerScreen = page.locator('[data-help-key="layout.screen"]:visible').filter({ hasText: "播放页" }).first();
  if (await playerScreen.count()) await playerScreen.click({ force: true });
  await page.locator('[data-testid="runtime-quick-menu-preview-controls"]').waitFor({
    state: "visible",
    timeout: 30_000,
  });
}

async function setEditorBreakpoint(page, breakpoint) {
  // Mobile and desktop now share one authored geometry; the editor no longer
  // exposes a breakpoint switch. Keep this helper as a compatibility no-op.
  if (breakpoint === "desktop") return;
  const expectedPreview = page.locator(".runtime-layout-expected-preview.is-player");
  await expectedPreview.waitFor({ state: "visible", timeout: 30_000 });
  const current = await expectedPreview.getAttribute("data-preview-quick-menu-breakpoint");
  if (current === breakpoint) return;
  const selector = `.runtime-layout-breakpoint-switch button[data-help-key="layout.${breakpoint}"]`;
  const control = page.locator(selector).first();
  await control.waitFor({ state: "visible", timeout: 15_000 });
  await control.click({ force: true });
  try {
    await page.waitForFunction(
      (expected) => document.querySelector(".runtime-layout-expected-preview.is-player")
        ?.getAttribute("data-preview-quick-menu-breakpoint") === expected
        && document.querySelector(".runtime-layout-stage-wrap")?.classList.contains(expected),
      breakpoint,
      { timeout: 15_000 },
    );
  } catch (error) {
    // Some narrow editor layouts place the breakpoint control under a
    // transformed toolbar hit region. Dispatch the same public click once
    // more on the actual button before treating it as a failed state change.
    await control.dispatchEvent("click");
    try {
      await page.waitForFunction(
        (expected) => document.querySelector(".runtime-layout-expected-preview.is-player")
          ?.getAttribute("data-preview-quick-menu-breakpoint") === expected
          && document.querySelector(".runtime-layout-stage-wrap")?.classList.contains(expected),
        breakpoint,
        { timeout: 5_000 },
      );
      return;
    } catch {
      // Fall through with a diagnostic that captures the settled state.
    }
    const diagnostic = await page.evaluate(() => ({
      previewBreakpoint: document.querySelector(".runtime-layout-expected-preview.is-player")
        ?.getAttribute("data-preview-quick-menu-breakpoint"),
      stageWrapClass: document.querySelector(".runtime-layout-stage-wrap")?.className,
      switchButtons: [...document.querySelectorAll(".runtime-layout-breakpoint-switch button")].map((node) => ({
        help: node.getAttribute("data-help-key"),
        className: node.className,
        disabled: node.disabled,
      })),
    }));
    throw new Error(`editor breakpoint did not settle to ${breakpoint}: ${JSON.stringify(diagnostic)}`, { cause: error });
  }
}

async function initRuntime(page, payload, assetUrls) {
  await page.goto(runtimeUrl, { waitUntil: "domcontentloaded" });
  // App installs the live-preview message listener from a React effect.  A
  // DOMContentLoaded-only sender can race that effect and silently lose the
  // init packet, leaving the test waiting for a menu that was never loaded.
  await page.waitForFunction(
    () => document.readyState === "complete" && Boolean(document.querySelector("#root")?.firstElementChild),
    undefined,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(250);
  await page.evaluate(({ payload, assetUrls }) => {
    window.postMessage({
      type: "agentvn.live-preview.init",
      protocolVersion: 2,
      sessionId: `quick-menu-runtime-editor-parity-${Date.now()}`,
      revision: 1,
      requestId: "quick-menu-runtime-editor-parity-init",
      runId: "quick-menu-runtime-editor-parity-run",
      manifest: payload.manifest,
      script: payload.script,
      gallery: payload.gallery,
      uiSkin: payload.uiSkin,
      assetUrls,
      start: {
        requestId: "quick-menu-runtime-editor-parity-start",
        target: { sceneId: payload.manifest.entry_scene_id, commandIndex: 0 },
        entryPath: [],
        mode: "stable_frame",
        playbackRate: 1,
        reducedMotion: true,
      },
      screen: "playing",
    }, "*");
  }, { payload, assetUrls });
  await page.getByTestId("quick-menu-toggle").waitFor({ state: "visible", timeout: 30_000 });
  await page.getByTestId("quick-menu-toggle").click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute("aria-expanded") === "true",
    undefined,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(260);
}

async function sampleRuntime(page) {
  return page.evaluate(() => {
    const color = (value) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context || !value) return null;
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return {
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      };
    };
    const root = document.querySelector(".playback-controls");
    const rootStyle = root ? getComputedStyle(root) : null;
    const frame = rect(".runtime-layout-frame");
    const surface = document.querySelector(".quick-menu-surface");
    const firstButton = document.querySelector(".quick-menu-button");
    return {
      frame,
      root: rect(".playback-controls"),
      surface: rect(".quick-menu-surface"),
      metricSurfaceWidth: Number.parseFloat(rootStyle?.getPropertyValue("--runtime-quick-menu-surface-width") || "0"),
      metricSurfaceHeight: Number.parseFloat(rootStyle?.getPropertyValue("--runtime-quick-menu-surface-height") || "0"),
      metricActionWidth: Number.parseFloat(rootStyle?.getPropertyValue("--runtime-quick-menu-action-visual-width") || "0"),
      metricActionHeight: Number.parseFloat(rootStyle?.getPropertyValue("--runtime-quick-menu-action-visual-height") || "0"),
      metricActionHitSize: Number.parseFloat(rootStyle?.getPropertyValue("--runtime-quick-menu-action-hit-size") || "0"),
      metricToggleHitSize: Number.parseFloat(rootStyle?.getPropertyValue("--runtime-quick-menu-toggle-size") || "0"),
      metricUniformScale: Number.parseFloat(rootStyle?.getPropertyValue("--runtime-quick-menu-uniform-scale") || "0"),
      direction: root?.getAttribute("data-quick-menu-direction"),
      variant: root?.getAttribute("data-quick-menu-variant"),
      surfaceBackground: surface ? getComputedStyle(surface).backgroundColor : null,
      actionBackground: firstButton ? getComputedStyle(firstButton).backgroundColor : null,
      surfaceBackgroundRGBA: surface ? color(getComputedStyle(surface).backgroundColor) : null,
      actionBackgroundRGBA: firstButton ? color(getComputedStyle(firstButton).backgroundColor) : null,
      surfaceBackdropFilter: surface ? getComputedStyle(surface).backdropFilter : null,
      actionBackdropFilter: firstButton ? getComputedStyle(firstButton).backdropFilter : null,
      surfaceOpacity: surface ? getComputedStyle(surface).opacity : null,
      rootOpacity: rootStyle?.opacity ?? null,
      quickMenuToken: rootStyle?.getPropertyValue("--runtime-quick-menu") ?? null,
      quickMenuSkinToken: rootStyle?.getPropertyValue("--runtime-quick-menu-skin-background") ?? null,
      materialAlpha: rootStyle?.getPropertyValue("--runtime-quick-menu-material-alpha") ?? null,
      glassBackgroundVar: rootStyle?.getPropertyValue("--runtime-quick-menu-glass-background") ?? null,
    };
  });
}

async function sampleEditor(page) {
  return page.evaluate(() => {
    const color = (value) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context || !value) return null;
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return {
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      };
    };
    const expected = document.querySelector(".runtime-layout-expected-preview.is-player");
    const preview = expected?.querySelector(".preview-quick-menu-preview");
    const style = preview ? getComputedStyle(preview) : null;
    const surface = preview?.querySelector(".preview-quick-menu-surface");
    const firstButton = preview?.querySelector(".preview-quick-menu-button");
    const previewComponent = preview?.closest(".part-quick_menu");
    const stageNode = document.querySelector(".runtime-layout-stage");
    const stageRect = stageNode?.getBoundingClientRect();
    return {
      stage: rect(".runtime-layout-stage"),
      // RuntimeLayoutDesigner observes the stage content box; use the same
      // box for normalized comparisons instead of including its 1px border.
      stageContent: stageNode ? {
        left: stageRect.left + stageNode.clientLeft,
        top: stageRect.top + stageNode.clientTop,
        width: stageNode.clientWidth,
        height: stageNode.clientHeight,
      } : null,
      preview: rect(".preview-quick-menu-preview"),
      component: previewComponent ? {
        rect: (() => {
          const value = previewComponent.getBoundingClientRect();
          return {
            left: value.left,
            top: value.top,
            right: value.right,
            bottom: value.bottom,
            width: value.width,
            height: value.height,
          };
        })(),
        style: {
          left: getComputedStyle(previewComponent).left,
          top: getComputedStyle(previewComponent).top,
          right: getComputedStyle(previewComponent).right,
          bottom: getComputedStyle(previewComponent).bottom,
          width: getComputedStyle(previewComponent).width,
          height: getComputedStyle(previewComponent).height,
          transform: getComputedStyle(previewComponent).transform,
        },
        parentChain: (() => {
          const values = [];
          let node = previewComponent?.parentElement;
          for (let index = 0; node && index < 4; index += 1, node = node.parentElement) {
            const value = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            values.push({
              className: node.className,
              rect: { left: value.left, top: value.top, width: value.width, height: value.height },
              position: style.position,
              overflow: style.overflow,
              transform: style.transform,
            });
          }
          return values;
        })(),
      } : null,
      surface: rect(".preview-quick-menu-surface"),
      metricSurfaceWidth: Number.parseFloat(preview?.getAttribute("data-preview-quick-menu-surface-width") || "0"),
      metricSurfaceHeight: Number.parseFloat(preview?.getAttribute("data-preview-quick-menu-surface-height") || "0"),
      metricActionWidth: Number.parseFloat(style?.getPropertyValue("--preview-quick-menu-action-visual-width") || "0"),
      metricActionHeight: Number.parseFloat(style?.getPropertyValue("--preview-quick-menu-action-visual-height") || "0"),
      metricActionHitSize: Number.parseFloat(style?.getPropertyValue("--preview-quick-menu-action-hit-size") || "0"),
      metricToggleHitSize: Number.parseFloat(style?.getPropertyValue("--preview-quick-menu-toggle-hit-size") || "0"),
      metricUniformScale: Number.parseFloat(preview?.getAttribute("data-preview-quick-menu-uniform-scale") || "0"),
      direction: preview?.getAttribute("data-preview-quick-menu-direction"),
      variant: preview?.getAttribute("data-preview-quick-menu-variant"),
      surfaceBackground: surface ? getComputedStyle(surface).backgroundColor : null,
      actionBackground: firstButton ? getComputedStyle(firstButton).backgroundColor : null,
      surfaceBackgroundRGBA: surface ? color(getComputedStyle(surface).backgroundColor) : null,
      actionBackgroundRGBA: firstButton ? color(getComputedStyle(firstButton).backgroundColor) : null,
      surfaceBackdropFilter: surface ? getComputedStyle(surface).backdropFilter : null,
      actionBackdropFilter: firstButton ? getComputedStyle(firstButton).backdropFilter : null,
      surfaceOpacity: surface ? getComputedStyle(surface).opacity : null,
      previewOpacity: style?.opacity ?? null,
      quickMenuToken: style?.getPropertyValue("--preview-runtime-quick-menu") ?? null,
      quickMenuSkinToken: style?.getPropertyValue("--preview-quick-menu-surface-background") ?? null,
      materialAlpha: style?.getPropertyValue("--preview-quick-menu-surface-alpha") ?? null,
      surfaceTransform: surface ? getComputedStyle(surface).transform : null,
    };
  });
}

function compareNormalized(viewport, runtime, editor) {
  const frame = authoredFrame(viewport);
  assert(runtime.variant === "C" && editor.variant === "C", `${viewport.name}: variant is not C`, { runtime, editor });
  assert(["up", "down"].includes(runtime.direction) && runtime.direction === editor.direction, `${viewport.name}: runtime/editor expansion directions differ`, { runtime, editor });
  assert(runtime.metricSurfaceWidth > 0 && runtime.metricSurfaceHeight > 0, `${viewport.name}: runtime metrics missing`, runtime);
  assert(editor.metricSurfaceWidth > 0 && editor.metricSurfaceHeight > 0, `${viewport.name}: editor metrics missing`, editor);
  const runtimeNormalized = {
    width: runtime.metricSurfaceWidth / frame.width,
    height: runtime.metricSurfaceHeight / frame.height,
    actionWidth: runtime.metricActionWidth / frame.width,
    actionHeight: runtime.metricActionHeight / frame.height,
    actionHit: runtime.metricActionHitSize / frame.height,
    toggleHit: runtime.metricToggleHitSize / frame.height,
  };
  const editorNormalized = {
    width: editor.metricSurfaceWidth / (editor.stageContent?.width || 1),
    height: editor.metricSurfaceHeight / (editor.stageContent?.height || 1),
    actionWidth: editor.metricActionWidth / (editor.stageContent?.width || 1),
    actionHeight: editor.metricActionHeight / (editor.stageContent?.height || 1),
    actionHit: editor.metricActionHitSize / (editor.stageContent?.height || 1),
    toggleHit: editor.metricToggleHitSize / (editor.stageContent?.height || 1),
  };
  const differences = Object.fromEntries(Object.keys(runtimeNormalized).map((key) => [
    key,
    Math.abs(runtimeNormalized[key] - editorNormalized[key]),
  ]));
  const maxDifference = Math.max(...Object.values(differences));
  assert(
    maxDifference <= 0.01,
    `${viewport.name}: runtime/editor quick-menu proportions differ`,
    { viewport, frame, runtime, editor, runtimeNormalized, editorNormalized, differences },
  );
  const normalizeCss = (value) => String(value || "").replace(/\s+/g, "").toLowerCase();
  const normalizedFilter = (value, scale) => {
    const text = normalizeCss(value);
    const match = text.match(/blur\(([0-9.]+)px\)/);
    if (!match) return text;
    const blur = Number(match[1]) / Math.max(0.0001, Number(scale) || 1);
    // Runtime exposes authored pixels; the editor preview exposes the same
    // filter after its uniform scale. Compare the canonical authored value,
    // not browser-specific decimal serialization.
    return { text: text.replace(match[0], "blur(__AUTHORED__px)"), blur };
  };
  const filtersMatch = (left, leftScale, right, rightScale) => {
    const normalizedLeft = normalizedFilter(left, leftScale);
    const normalizedRight = normalizedFilter(right, rightScale);
    if (typeof normalizedLeft === "string" || typeof normalizedRight === "string") return normalizedLeft === normalizedRight;
    return normalizedLeft.text === normalizedRight.text && Math.abs(normalizedLeft.blur - normalizedRight.blur) <= 0.35;
  };
  assert(
    runtime.quickMenuToken === editor.quickMenuToken
      && runtime.materialAlpha === editor.materialAlpha
      && runtime.actionBackgroundRGBA && editor.actionBackgroundRGBA
      && runtime.actionBackgroundRGBA.every((value, index) => Math.abs(value - editor.actionBackgroundRGBA[index]) <= 2)
      && filtersMatch(runtime.surfaceBackdropFilter, runtime.metricUniformScale, editor.surfaceBackdropFilter, editor.metricUniformScale)
      && filtersMatch(runtime.actionBackdropFilter, runtime.metricUniformScale, editor.actionBackdropFilter, editor.metricUniformScale),
    `${viewport.name}: runtime/editor quick-menu material differs`,
    { runtime, editor },
  );

  const normalizedPlacement = (sample, isRuntime) => {
    if (isRuntime && (!sample.frame || !sample.root)) return null;
    if (!isRuntime && (!sample.stageContent || !sample.preview)) return null;
    const parent = isRuntime ? sample.frame : sample.stageContent;
    const item = isRuntime ? sample.root : sample.preview;
    if (!parent || !item) return null;
    return {
      left: (item.left - parent.left) / parent.width,
      top: (item.top - parent.top) / parent.height,
      width: item.width / parent.width,
      height: item.height / parent.height,
    };
  };
  const runtimePlacement = normalizedPlacement(runtime, true);
  const editorPlacement = normalizedPlacement(editor, false);
  assert(runtimePlacement && editorPlacement, `${viewport.name}: placement samples are incomplete`, { runtime, editor });
  const placementDifferences = Object.fromEntries(Object.keys(runtimePlacement).map((key) => [
    key,
    Math.abs(runtimePlacement[key] - editorPlacement[key]),
  ]));
  const maxPlacementDifference = Math.max(...Object.values(placementDifferences));
  assert(
    // The editor stage has a one-pixel border and can letterbox by up to two
    // physical pixels at the narrowest viewport; geometry is still authored
    // identically once normalized to the 16:9 frame.
    maxPlacementDifference <= 0.02,
    `${viewport.name}: runtime/editor quick-menu placement differs`,
    { viewport, runtimePlacement, editorPlacement, placementDifferences, runtime, editor },
  );
  return {
    frame,
    runtimeNormalized,
    editorNormalized,
    differences,
    maxDifference,
    runtimePlacement,
    editorPlacement,
    placementDifferences,
    maxPlacementDifference,
  };
}

(async () => {
  cleanOutput();
  assert(fs.existsSync(path.join(unpacked, "manifest.json")), "hidden-growth runtime fixture is missing");
  assert(fs.existsSync(fixture), "hidden-growth editor fixture is missing");
  const payload = loadPayload();
  const staticServer = await startStatic(unpacked, new URL(runtimeUrl).origin);
  const staticBase = `http://127.0.0.1:${staticServer.address().port}`;
  const assetUrls = {};
  for (const asset of payload.manifest.assets ?? []) {
    assetUrls[asset.asset_id] = `${staticBase}/${asset.path}`;
    assetUrls[asset.path] = `${staticBase}/${asset.path}`;
  }

  const backendAlreadyReady = await ready(backendHealth, 1_500).then(() => true).catch(() => false);
  const editorAlreadyReady = await ready(editorUrl, 1_500).then(() => true).catch(() => false);
  const runtimeAlreadyReady = await ready(runtimeUrl, 1_500).then(() => true).catch(() => false);
  const backend = backendAlreadyReady ? null : start(process.env.PYTHON || "python", ["backend_launcher.py"], backendRoot);
  const editorPort = new URL(editorUrl).port || "6767";
  const runtimePort = new URL(runtimeUrl).port || "6868";
  const editor = editorAlreadyReady ? null : start("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", editorPort], editorRoot);
  const runtime = runtimeAlreadyReady ? null : start("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", runtimePort], runtimeRoot);
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const viewports = [
    { name: "2560x1392", width: 2560, height: 1392 },
    { name: "1440x900", width: 1440, height: 900 },
    { name: "757x299", width: 757, height: 299 },
    { name: "390x844", width: 390, height: 844 },
  ];
  const results = {};
  let editorPage;
  try {
    await ready(backendHealth);
    await ready(editorUrl);
    await ready(runtimeUrl);
    editorPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    editorPage.on("pageerror", (error) => errors.push(`editor pageerror: ${error.stack || error.message}`));
    editorPage.on("console", (message) => {
      if (message.type() === "error") errors.push(`editor console: ${message.text()}`);
    });
    await importEditorFixture(editorPage);
    await openEditorLayout(editorPage);

    for (const viewport of viewports) {
      await editorPage.setViewportSize({ width: viewport.width, height: viewport.height });
      await editorPage.waitForTimeout(250);
      const previewState = editorPage.locator(".runtime-layout-expected-preview.is-player");
      if (!(await previewState.isVisible().catch(() => false))) {
        await openEditorLayout(editorPage);
      }
      // Handheld playback now reuses the PC-authored design. Keep the editor
      // preview on the canonical desktop breakpoint so parity compares the
      // same authored rect/metrics the runtime consumes.
      await setEditorBreakpoint(editorPage, "desktop");
      const previewControls = editorPage.locator('[data-testid="runtime-quick-menu-preview-controls"]');
      // Variant/direction/geometry controls were intentionally removed. The
      // editor preview is always the fixed C/up client component.
      await previewControls.waitFor({ state: "visible", timeout: 15_000 });
      const expandControl = previewControls.locator('button[data-preview-quick-menu-state="expanded"]');
      await expandControl.scrollIntoViewIfNeeded();
      await expandControl.dispatchEvent("click");
      try {
        await editorPage.waitForFunction(
          () => document.querySelector(".runtime-layout-expected-preview.is-player")
            ?.getAttribute("data-preview-quick-menu-state") === "expanded"
            && document.querySelector('[data-testid="runtime-quick-menu-preview-controls"] button[data-preview-quick-menu-state="expanded"]')
              ?.getAttribute("aria-pressed") === "true",
          undefined,
          { timeout: 15_000 },
        );
      } catch (error) {
        await expandControl.dispatchEvent("click");
        await editorPage.waitForFunction(
          () => document.querySelector(".runtime-layout-expected-preview.is-player")
            ?.getAttribute("data-preview-quick-menu-state") === "expanded"
            && document.querySelector('[data-testid="runtime-quick-menu-preview-controls"] button[data-preview-quick-menu-state="expanded"]')
              ?.getAttribute("aria-pressed") === "true",
          undefined,
          { timeout: 5_000 },
        ).catch(async () => {
          const diagnostic = await editorPage.evaluate(() => ({
            state: document.querySelector(".runtime-layout-expected-preview.is-player")?.getAttribute("data-preview-quick-menu-state"),
            buttonPressed: document.querySelector('[data-testid="runtime-quick-menu-preview-controls"] button[data-preview-quick-menu-state="expanded"]')?.getAttribute("aria-pressed"),
          }));
          throw new Error(`editor preview did not enter expanded state: ${JSON.stringify(diagnostic)}`, { cause: error });
        });
      }
      await editorPage.waitForTimeout(260);
      const editorSample = await sampleEditor(editorPage);

      const runtimePage = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.width < 900,
        hasTouch: viewport.width < 900,
      });
      runtimePage.on("pageerror", (error) => errors.push(`runtime pageerror: ${error.stack || error.message}`));
      runtimePage.on("console", (message) => {
        if (message.type() === "error") errors.push(`runtime console: ${message.text()}`);
      });
      await initRuntime(runtimePage, payload, assetUrls);
      const runtimeSample = await sampleRuntime(runtimePage);
      const parity = compareNormalized(viewport, runtimeSample, editorSample);
      results[viewport.name] = { runtime: runtimeSample, editor: editorSample, parity };
      await runtimePage.close();
    }

    assert(errors.length === 0, "runtime/editor parity path emitted console or page errors", errors);
    fs.writeFileSync(path.join(outputDir, "report.json"), `${JSON.stringify({
      ok: true,
      fixture: payload.manifest.title,
      results,
    }, null, 2)}\n`, "utf8");
    console.log(`quick-menu-runtime-editor-parity-playwright: PASS (${outputDir})`);
  } finally {
    await editorPage?.close().catch(() => {});
    await browser.close();
    stop(runtime);
    stop(editor);
    stop(backend);
    staticServer.close();
  }
})().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "error.txt"), String(error.stack || error), "utf8");
  console.error(error.stack || error);
  process.exitCode = 1;
});
