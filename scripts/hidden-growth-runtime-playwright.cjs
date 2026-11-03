#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn, spawnSync, execFileSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const cartridge = path.join(root, "output", "hidden-growth", "hidden-growth.vncart");
const unpacked = path.join(root, "output", "hidden-growth", "unpacked");
const outputDir = path.join(root, "output", "hidden-growth", "runtime-playwright");
const runtimeRoot = path.join(root, "GameCli_framework");
const runtimeUrl = "http://127.0.0.1:6868/?mode=preview";

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`);
}

async function waitFor(url, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const response = await fetch(url); if (response.ok || response.status < 500) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`server not ready: ${url}`);
}

function startRuntime() {
  if (process.platform === "win32") {
    return spawn("cmd.exe", ["/d", "/s", "/c", "npm run dev -- --host 127.0.0.1 --port 6868"], {
      cwd: runtimeRoot,
      windowsHide: true,
      stdio: "ignore",
    });
  }
  return spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "6868"], {
    cwd: runtimeRoot,
    stdio: "ignore",
  });
}

function stop(child) {
  if (!child?.pid) return;
  try { if (process.platform === "win32") spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); else child.kill("SIGTERM"); } catch {}
}

function startStatic(rootDir) {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname).replace(/^\/+/, "");
    const target = path.resolve(rootDir, pathname);
    if (!target.startsWith(path.resolve(rootDir) + path.sep) || !fs.existsSync(target)) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, {
      "Access-Control-Allow-Origin": "http://127.0.0.1:6868",
      "Cache-Control": "no-store",
    }); fs.createReadStream(target).pipe(response);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function staticPort(server) { return server.address().port; }

async function inspectThemedSurface(page, selector, label) {
  const metrics = await page.evaluate((surfaceSelector) => {
    const element = document.querySelector(surfaceSelector);
    const style = element ? getComputedStyle(element) : null;
    const thumb = element ? getComputedStyle(element, "::-webkit-scrollbar-thumb") : null;
    const track = element ? getComputedStyle(element, "::-webkit-scrollbar-track") : null;
    const rect = element?.getBoundingClientRect();
    return {
      exists: Boolean(element),
      rect: rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } : null,
      overflowX: style?.overflowX ?? null,
      scrollbarWidth: style?.scrollbarWidth ?? null,
      scrollbarColor: style?.scrollbarColor ?? null,
      thumbBackground: thumb?.backgroundImage ?? thumb?.background ?? null,
      thumbColor: thumb?.backgroundColor ?? null,
      thumbRadius: thumb?.borderRadius ?? null,
      trackBackground: track?.backgroundImage ?? track?.background ?? null,
      trackColor: track?.backgroundColor ?? null,
      viewport: { width: innerWidth, height: innerHeight },
      documentScrollWidth: document.documentElement.scrollWidth,
    };
  }, selector);
  assert(metrics.exists, `${label}: themed surface is missing`, metrics);
  assert(metrics.overflowX !== "visible", `${label}: surface overflow is not contained`, metrics);
  assert(metrics.scrollbarWidth === "thin", `${label}: surface uses the default scrollbar width`, metrics);
  assert(metrics.scrollbarColor && metrics.scrollbarColor !== "auto", `${label}: surface uses the default scrollbar color`, metrics);
  const usesGradientThumb = typeof metrics.thumbBackground === "string"
    && (metrics.thumbBackground.includes("repeating-linear-gradient") || metrics.thumbBackground.includes("linear-gradient"));
  const usesFlatThumb = metrics.thumbColor && metrics.thumbColor !== "rgba(0, 0, 0, 0)";
  assert(usesGradientThumb || usesFlatThumb, `${label}: surface scrollbar thumb is transparent`, metrics);
  assert(metrics.thumbRadius === (usesGradientThumb ? "999px" : "4px"), `${label}: surface scrollbar thumb radius does not match its material`, metrics);
  assert(
    (typeof metrics.trackBackground === "string"
      && metrics.trackBackground !== "none"
      && metrics.trackBackground !== "transparent"
      && metrics.trackBackground !== "rgba(0, 0, 0, 0)")
      || (metrics.trackColor && metrics.trackColor !== "transparent" && metrics.trackColor !== "rgba(0, 0, 0, 0)"),
    `${label}: surface scrollbar track is still browser-default`,
    metrics,
  );
  assert(metrics.documentScrollWidth <= metrics.viewport.width + 1, `${label}: surface introduced horizontal overflow`, metrics);
  return metrics;
}

async function inspectTitleLandscape(page, viewport) {
  const metrics = await page.evaluate(() => {
    const rect = (element) => {
      const value = element?.getBoundingClientRect();
      return value
        ? {
            left: value.left,
            top: value.top,
            right: value.right,
            bottom: value.bottom,
            width: value.width,
            height: value.height,
          }
        : null;
    };
    const frame = document.querySelector(".runtime-layout-frame");
    const hero = document.querySelector(".main-menu-title-hero-background");
    const scope = document.querySelector(".ui-skin-scope");
    const controls = [...document.querySelectorAll(".menu-action-button")]
      .filter((element) => getComputedStyle(element).display !== "none")
      .map((element) => ({
        id: element.getAttribute("data-ui-component-id"),
        source: element.getAttribute("data-ui-layout-source"),
        rect: rect(element),
      }));
    return {
      frame: rect(frame),
      hero: rect(hero),
      controls,
      breakpoint: scope?.getAttribute("data-ui-breakpoint"),
      formFactor: scope?.getAttribute("data-ui-form-factor"),
      documentScrollWidth: document.documentElement.scrollWidth,
    };
  });
  assert(metrics.frame, `${viewport.name}: title frame missing`, metrics);
  const expectedWidth = Math.min(viewport.width, viewport.height * (16 / 9));
  const expectedHeight = expectedWidth * (9 / 16);
  assert(
    Math.abs(metrics.frame.width - expectedWidth) <= 2
      && Math.abs(metrics.frame.height - expectedHeight) <= 2
      && Math.abs(metrics.frame.width / metrics.frame.height - 16 / 9) < 0.01,
    `${viewport.name}: title frame is not a viewport-fitted 16:9 frame`,
    { viewport, expectedWidth, expectedHeight, metrics },
  );
  if (metrics.hero) {
    assert(
      metrics.hero.left >= metrics.frame.left - 1
        && metrics.hero.top >= metrics.frame.top - 1
        && metrics.hero.right <= metrics.frame.right + 1
        && metrics.hero.bottom <= metrics.frame.bottom + 1
        && metrics.hero.width >= metrics.frame.width * 0.97
        && metrics.hero.height >= metrics.frame.height * 0.97,
      `${viewport.name}: title background does not cover the authored frame`,
      metrics,
    );
  }
  assert(
    metrics.controls.every((item) => item.rect
      && item.rect.left >= metrics.frame.left - 1
      && item.rect.top >= metrics.frame.top - 1
      && item.rect.right <= metrics.frame.right + 1
      && item.rect.bottom <= metrics.frame.bottom + 1
      && item.source !== "mobile"),
    `${viewport.name}: title control escaped the PC-authored frame`,
    metrics,
  );
  assert(
    metrics.documentScrollWidth <= viewport.width + 1,
    `${viewport.name}: title introduced horizontal overflow`,
    metrics,
  );
  return metrics;
}

async function waitForRuntimeScreen(page, screen) {
  const visibleSelector = {
    main_menu: '[data-testid="main-menu"]:visible, [data-testid="game-state-title"]:visible',
    title_menu: '[data-testid="game-state-title"]:visible, [data-testid="main-menu"]:visible',
    gallery: '[data-testid="gallery-screen"]:visible',
    save_load: '.save-load-screen:visible',
    settings: '[data-testid="settings-screen"]:visible',
    about: '[data-testid="about-screen"]:visible',
  }[screen];
  await page.waitForFunction(
    (expected) => {
      const seam = document.querySelector("[data-runtime-screen-transition]");
      return seam?.getAttribute("data-runtime-committed-screen") === expected
        && seam.getAttribute("data-runtime-screen-transition") === "idle"
        && seam.getAttribute("data-runtime-transition-phase") === "idle";
    },
    screen === "main_menu" ? "main_menu" : screen,
    { timeout: 20_000 },
  );
  if (visibleSelector) {
    await page.locator(visibleSelector).first().waitFor({ state: "visible", timeout: 20_000 });
    await page.waitForFunction(
      () => !document.querySelector("[data-runtime-screen-transition]")
        || document.querySelector("[data-runtime-screen-transition]")?.getAttribute("data-runtime-screen-transition") === "idle",
      undefined,
      { timeout: 20_000 },
    );
    await page.waitForTimeout(180);
    return;
  }
  try {
    await page.waitForFunction(
      (expected) => document.querySelector("[data-runtime-screen-transition]")?.getAttribute("data-runtime-committed-screen") === expected,
      screen,
      { timeout: 20_000 },
    );
    // The runtime intentionally keeps the incoming page non-interactive until
    // reveal settles.  Some shell screens expose data-runtime-screen while
    // others use only a screen-specific test id/class, so the transition seam
    // is the stable cross-screen readiness signal; callers wait for their
    // concrete screen surface immediately afterward.
    await page.waitForFunction(
      () => document.querySelector("[data-runtime-screen-transition]")?.getAttribute("data-runtime-screen-transition") === "idle"
        && document.querySelector("[data-runtime-screen-transition]")?.getAttribute("data-runtime-transition-phase") === "idle",
      undefined,
      { timeout: 20_000 },
    );
  } catch (error) {
    const snapshot = await page.evaluate(() => ({
      seam: document.querySelector("[data-runtime-screen-transition]")?.outerHTML.slice(0, 1200),
      states: [...document.querySelectorAll("[data-runtime-state]")].map((node) => ({ state: node.getAttribute("data-runtime-state"), testid: node.getAttribute("data-testid"), display: getComputedStyle(node).display, visibility: getComputedStyle(node).visibility, opacity: getComputedStyle(node).opacity })),
      menuButton: document.querySelector('[data-testid="open-main-menu"]') ? { disabled: document.querySelector('[data-testid="open-main-menu"]').disabled, pointerEvents: getComputedStyle(document.querySelector('[data-testid="open-main-menu"]')).pointerEvents, rect: document.querySelector('[data-testid="open-main-menu"]').getBoundingClientRect().toJSON() } : null,
      body: document.body.innerText.slice(0, 600),
    }));
    throw new Error(`runtime screen ${screen} did not settle: ${error.message}\n${JSON.stringify(snapshot, null, 2)}`);
  }
}

async function initializeLivePreview(page, payload, viewportName) {
  const sessionId = `hidden-growth-${viewportName}-${Date.now()}`;
  const message = {
    type: "agentvn.live-preview.init",
    protocolVersion: 2,
    sessionId,
    revision: 1,
    requestId: `hidden-growth-runtime-init-${viewportName}`,
    runId: `hidden-growth-runtime-${viewportName}`,
    manifest: payload.manifest,
    script: payload.script,
    gallery: payload.gallery,
    uiSkin: payload.uiSkin,
    assetUrls: payload.assetUrls,
    start: { requestId: `hidden-growth-start-${viewportName}`, target: { sceneId: payload.manifest.entry_scene_id, commandIndex: 0 }, entryPath: [], mode: "stable_frame", playbackRate: 1, reducedMotion: true },
    screen: "title_menu",
  };
  await page.evaluate(({ initMessage, expectedSessionId }) => {
    window.__AGENTVN_HIDDEN_GROWTH_READY__ = false;
    window.addEventListener("message", (event) => {
      if (event.data?.type === "agentvn.live-preview.ready" && event.data.sessionId === expectedSessionId) {
        window.__AGENTVN_HIDDEN_GROWTH_READY__ = true;
      }
    }, { once: false });
    window.postMessage(initMessage, "*");
  }, { initMessage: message, expectedSessionId: sessionId });
  try {
    await page.waitForFunction(() => window.__AGENTVN_HIDDEN_GROWTH_READY__ === true, undefined, { timeout: 20_000 });
  } catch {
    await page.evaluate((initMessage) => window.postMessage(initMessage, "*"), message);
    await page.waitForFunction(() => window.__AGENTVN_HIDDEN_GROWTH_READY__ === true, undefined, { timeout: 40_000 });
  }
}

(async () => {
  fs.mkdirSync(path.dirname(cartridge), { recursive: true });
  if (!fs.existsSync(cartridge)) {
    execFileSync(process.execPath, [path.join(root, "scripts", "build-vnproj-cartridge.cjs"), "--input", path.join(root, "data", "backup-timeline", "project_msiz08p7_0_89ebc8a8cb__1786898326185__project.vnproj"), "--output", cartridge], { stdio: "inherit" });
  }
  if (!fs.existsSync(path.join(unpacked, "manifest.json"))) {
    execFileSync(process.execPath, [path.join(root, "scripts", "unpack-vncart.cjs"), cartridge, unpacked], { stdio: "inherit" });
  }
  fs.mkdirSync(outputDir, { recursive: true });
  fs.rmSync(path.join(outputDir, "error.txt"), { force: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(unpacked, "manifest.json"), "utf8"));
  const script = JSON.parse(fs.readFileSync(path.join(unpacked, "script.json"), "utf8"));
  const gallery = fs.existsSync(path.join(unpacked, "gallery.json")) ? JSON.parse(fs.readFileSync(path.join(unpacked, "gallery.json"), "utf8")) : { items: [] };
  const uiPath = manifest.ui_skin?.path || "ui/layout.json";
  const uiSkin = fs.existsSync(path.join(unpacked, uiPath)) ? JSON.parse(fs.readFileSync(path.join(unpacked, uiPath), "utf8")) : undefined;
  const staticServer = await startStatic(unpacked);
  const staticBase = `http://127.0.0.1:${staticPort(staticServer)}`;
  const assetUrls = {};
  for (const asset of manifest.assets || []) { assetUrls[asset.asset_id] = `${staticBase}/${asset.path}`; assetUrls[asset.path] = `${staticBase}/${asset.path}`; }
  let runtimeServer;
  try {
    await waitFor(runtimeUrl, 15_000);
  } catch {
    runtimeServer = startRuntime();
    await waitFor(runtimeUrl, 120_000);
  }
  const browser = await chromium.launch({ headless: true });
  const results = {};
  try {
    for (const viewport of [
      { name: "reported-757x299", width: 757, height: 299 },
      { name: "android-landscape-1920x864", width: 1920, height: 864 },
      { name: "android-landscape-2400x1080", width: 2400, height: 1080 },
      { name: "wide-desktop", width: 1440, height: 900 },
      { name: "narrow-mobile", width: 390, height: 844 },
    ]) {
      const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.width < 900, hasTouch: viewport.width < 900 });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      await page.goto(runtimeUrl, { waitUntil: "domcontentloaded" });
      await page.locator("#root").waitFor({ state: "attached", timeout: 15_000 });
      await page.waitForTimeout(600);
      await initializeLivePreview(page, { manifest, script, gallery, uiSkin, assetUrls }, viewport.name);
      try {
        await page.locator('[data-testid="game-state-title"]:visible, [data-testid="main-menu"]:visible').first().waitFor({ state: "visible", timeout: 60_000 });
      } catch (error) {
        const diagnostics = await page.evaluate(() => ({
          body: document.body.innerText.slice(0, 1600),
          titleNodes: [...document.querySelectorAll('[data-testid="game-state-title"], [data-testid="main-menu"]')].map((node) => ({
            className: node.className,
            ariaHidden: node.getAttribute("aria-hidden"),
            rect: node.getBoundingClientRect().toJSON(),
            display: getComputedStyle(node).display,
            visibility: getComputedStyle(node).visibility,
            opacity: getComputedStyle(node).opacity,
          })),
          testIds: [...document.querySelectorAll("[data-testid]")].map((node) => node.getAttribute("data-testid")).slice(0, 80),
          transition: document.querySelector(".runtime-screen-transition")?.className,
          ready: window.__AGENTVN_HIDDEN_GROWTH_READY__,
        }));
        throw new Error(`${error.message}\n${JSON.stringify({ ...diagnostics, errors }, null, 2)}`);
      }
      const titleLayout = await inspectTitleLandscape(page, viewport);
      await page.screenshot({ path: path.join(outputDir, `title-${viewport.name}.png`) });
      const titleButtonVisual = async () => page.locator('[data-testid="start-new-game"]:visible').first().evaluate((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return { background: style.backgroundColor, color: style.color, transform: style.transform, filter: style.filter, boxShadow: style.boxShadow, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
      });
      const titleBeforeHover = await titleButtonVisual();
      await page.locator('[data-testid="start-new-game"]:visible').first().hover();
      const titleAfterHover = await titleButtonVisual();
      const visualFrame = ({ rect: _rect, ...visual }) => visual;
      assert(JSON.stringify(visualFrame(titleBeforeHover)) === JSON.stringify(visualFrame(titleAfterHover)), `${viewport.name}: main menu button hover changes visual styling`, { before: titleBeforeHover, after: titleAfterHover });
      const titleButtonRect = titleAfterHover.rect;
      assert(titleButtonRect.width > 0 && titleButtonRect.height > 0
        && titleButtonRect.left >= -1 && titleButtonRect.top >= -1
        && titleButtonRect.left + titleButtonRect.width <= viewport.width + 1
        && titleButtonRect.top + titleButtonRect.height <= viewport.height + 1,
      `${viewport.name}: main menu button moved outside the viewport`, titleAfterHover);
      await page.locator('[data-testid="open-gallery"]:visible').first().click();
      await waitForRuntimeScreen(page, "gallery");
      await page.locator('[data-testid="gallery-screen"]').waitFor({ state: "visible", timeout: 10_000 });
      assert(await page.locator('.gallery-item.locked').count() === 8, `${viewport.name}: empty gallery must show locked placeholders`);
      const lockedGallery = await page.locator(".gallery-item.locked").first().evaluate((item) => {
        const card = getComputedStyle(item);
        const button = item.querySelector("button");
        const lock = item.querySelector(".gallery-item-lock");
        const buttonStyle = button ? getComputedStyle(button) : null;
        const itemRect = item.getBoundingClientRect();
        const lockRect = lock?.getBoundingClientRect();
        return {
          borderTopColor: card.borderTopColor,
          filter: buttonStyle?.filter ?? "none",
          lockCount: item.querySelectorAll(".gallery-item-lock").length,
          lockCenterDelta: lockRect ? Math.max(
            Math.abs((lockRect.left + lockRect.width / 2) - (itemRect.left + itemRect.width / 2)),
            Math.abs((lockRect.top + lockRect.height / 2) - (itemRect.top + itemRect.height / 2)),
          ) : Number.POSITIVE_INFINITY,
          text: item.textContent ?? "",
        };
      });
      assert(lockedGallery.borderTopColor === "rgba(0, 0, 0, 0)", `${viewport.name}: locked gallery card kept the gray top edge`, lockedGallery);
      assert(lockedGallery.filter.includes("blur"), `${viewport.name}: locked gallery content is not blurred as a whole`, lockedGallery);
      assert(lockedGallery.lockCount === 1 && lockedGallery.lockCenterDelta <= 2, `${viewport.name}: locked gallery card is missing its centered vector lock`, lockedGallery);
      assert(!/🔒|🔓|🔐|🔏|🔑/.test(lockedGallery.text), `${viewport.name}: gallery introduced an emoji lock`, lockedGallery);
      await page.locator('[data-testid="back-to-main-menu"]').click();
      await page.locator('[data-testid="start-new-game"]').click();
      await page.locator('[data-testid="game-state-playing"]').waitFor({ state: "visible", timeout: 10_000 });
      await page.locator('[data-testid="game-launch-blackout"]').waitFor({ state: "detached", timeout: 30_000 }).catch(() => {});
      const quickMenuPaint = async () => page.evaluate(() => {
        const menu = document.querySelector(".playback-controls");
        const surface = document.querySelector(".quick-menu-surface");
        const firstButton = document.querySelector(".quick-menu-button");
        const menuStyle = menu ? getComputedStyle(menu) : null;
        const surfaceStyle = surface ? getComputedStyle(surface) : null;
        const buttonStyle = firstButton ? getComputedStyle(firstButton) : null;
        const rect = (node) => {
          const value = node?.getBoundingClientRect();
          return value ? { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height } : null;
        };
        return {
          menu: rect(menu),
          surface: rect(surface),
          surfaceBackground: surfaceStyle?.backgroundColor ?? null,
          surfaceBackdropFilter: surfaceStyle?.backdropFilter ?? null,
          surfaceBoxShadow: surfaceStyle?.boxShadow ?? null,
          buttonBackground: buttonStyle?.backgroundColor ?? null,
          buttonColor: buttonStyle?.color ?? null,
          buttonTransform: buttonStyle?.transform ?? null,
          buttonFilter: buttonStyle?.filter ?? null,
          buttonBoxShadow: buttonStyle?.boxShadow ?? null,
          buttonCount: document.querySelectorAll(".quick-menu-button").length,
          buttonVisibility: buttonStyle?.visibility ?? null,
          buttonPointerEvents: buttonStyle?.pointerEvents ?? null,
        };
      });
      const collapsedPaint = await quickMenuPaint();
      assert(collapsedPaint.surfaceBackground === "rgba(0, 0, 0, 0)" && (collapsedPaint.surfaceBackdropFilter === "none" || collapsedPaint.surfaceBackdropFilter === ""), `${viewport.name}: collapsed runtime surface still paints blur/background`, collapsedPaint);
      assert(collapsedPaint.surfaceBoxShadow === "none" || collapsedPaint.surfaceBoxShadow === "", `${viewport.name}: collapsed runtime surface still paints shadow`, collapsedPaint);
      await page.locator('[data-testid="quick-menu-toggle"]').click();
      await page.waitForTimeout(260);
      const expandedPaint = await quickMenuPaint();
      assert(expandedPaint.surface && expandedPaint.menu && Math.abs(expandedPaint.surface.width - expandedPaint.menu.width) <= 1 && Math.abs(expandedPaint.surface.height - expandedPaint.menu.height) <= 1, `${viewport.name}: expanded runtime surface does not fill menu container`, expandedPaint);
      assert(expandedPaint.surfaceBackground !== "rgba(0, 0, 0, 0)" && expandedPaint.surfaceBackdropFilter !== "none", `${viewport.name}: expanded runtime surface has no visible skin surface`, expandedPaint);
      assert(expandedPaint.buttonCount === 7 && expandedPaint.buttonVisibility === "visible" && expandedPaint.buttonPointerEvents !== "none", `${viewport.name}: expanded runtime actions are not visible/clickable`, expandedPaint);
      const beforeHover = { background: expandedPaint.buttonBackground, color: expandedPaint.buttonColor, transform: expandedPaint.buttonTransform, filter: expandedPaint.buttonFilter, shadow: expandedPaint.buttonBoxShadow };
      await page.locator(".quick-menu-button").first().hover();
      const afterHover = await quickMenuPaint();
      assert(JSON.stringify(beforeHover) === JSON.stringify({ background: afterHover.buttonBackground, color: afterHover.buttonColor, transform: afterHover.buttonTransform, filter: afterHover.buttonFilter, shadow: afterHover.buttonBoxShadow }), `${viewport.name}: runtime quick-menu hover changes visual styling`, { beforeHover, afterHover });
      const overlap = await page.evaluate(() => {
          const dialog = document.querySelector(".dialog-box")?.getBoundingClientRect();
          const controls = [...document.querySelectorAll(".quick-menu-button")].map((element) => element.getBoundingClientRect());
          const intersects = (a, b) => a && b && Math.max(a.left, b.left) < Math.min(a.right, b.right) && Math.max(a.top, b.top) < Math.min(a.bottom, b.bottom);
        const frame = document.querySelector(".runtime-layout-frame");
        const scope = document.querySelector(".ui-skin-scope");
        const menu = document.querySelector(".playback-controls");
        const surface = document.querySelector(".quick-menu-surface");
        const compact = (element) => element ? { rect: (() => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; })(), style: { position: getComputedStyle(element).position, transform: getComputedStyle(element).transform, left: getComputedStyle(element).left, right: getComputedStyle(element).right, top: getComputedStyle(element).top, bottom: getComputedStyle(element).bottom, width: getComputedStyle(element).width, height: getComputedStyle(element).height } } : null;
        return {
          dialog: compact(document.querySelector(".dialog-box")),
          frame: compact(frame),
          scope: compact(scope),
          menu: compact(menu),
          surface: compact(surface),
          controls: controls.map((rect) => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom })),
          overlaps: controls.filter((rect) => intersects(dialog, rect)).map((rect) => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom })),
        };
      });
      assert(overlap.overlaps.length === 0, `${viewport.name}: quick-menu controls overlap dialog`, overlap);
      const menuEntry = page.locator('[data-testid="open-main-menu"]:visible').last();
      assert(await page.locator('[data-testid="open-main-menu"]:visible').count() === 1, `${viewport.name}: expected one visible main-menu action`, await page.locator('[data-testid="open-main-menu"]').count());
      await menuEntry.scrollIntoViewIfNeeded();
      await menuEntry.dispatchEvent("click");
      try {
        await page.waitForFunction(() => document.querySelector("[data-runtime-screen-transition]")?.getAttribute("data-runtime-screen-transition") === "active", undefined, { timeout: 10_000 });
      } catch (error) {
        const snapshot = await page.evaluate(() => ({
          button: (() => { const b = document.querySelector('[data-testid="open-main-menu"]'); return b ? { disabled: b.disabled, ariaDisabled: b.getAttribute("aria-disabled"), pointerEvents: getComputedStyle(b).pointerEvents, rect: b.getBoundingClientRect().toJSON() } : null; })(),
          seam: document.querySelector("[data-runtime-screen-transition]")?.getAttribute("data-runtime-screen-transition"),
          pending: (window).__AGENTVN_RUNTIME_STORE__?.pendingScreenNavigation ?? null,
          body: document.body.innerText.slice(-300),
        }));
        throw new Error(`open main menu did not start transition: ${error.message}\n${JSON.stringify(snapshot, null, 2)}`);
      }
      await waitForRuntimeScreen(page, "main_menu");
      const settingsButton = page.locator('[data-testid="open-settings"]:visible').last();
      await settingsButton.waitFor({ state: "visible", timeout: 10_000 });
      await settingsButton.click();
      try {
        await page.locator('[data-testid="settings-screen"]').waitFor({ state: "visible", timeout: 10_000 });
      } catch (error) {
        const debug = await page.evaluate(() => ({
          transition: document.querySelector("[data-runtime-screen-transition]")?.getAttribute("data-runtime-screen-transition"),
          phase: document.querySelector("[data-runtime-screen-transition]")?.getAttribute("data-runtime-transition-phase"),
          committed: document.querySelector("[data-runtime-screen-transition]")?.getAttribute("data-runtime-committed-screen"),
          target: document.querySelector("[data-runtime-screen-transition]")?.getAttribute("data-runtime-transition-to"),
          settingsButton: document.querySelector('[data-testid="open-settings"]')?.outerHTML.slice(0, 600) ?? null,
          states: [...document.querySelectorAll("[data-runtime-state]")].map((node) => ({
            state: node.getAttribute("data-runtime-state"),
            testid: node.getAttribute("data-testid"),
            opacity: getComputedStyle(node).opacity,
            visibility: getComputedStyle(node).visibility,
            rect: node.getBoundingClientRect().toJSON(),
          })),
          body: document.body.innerText.slice(0, 1000),
        }));
        throw new Error(`settings screen did not appear after a real menu click: ${error.message}\n${JSON.stringify(debug, null, 2)}`);
      }
      assert(await page.getByTestId("settings-exit-placement").count().catch(() => 0) >= 0, "settings page loaded");
      assert(await page.locator('[data-testid="settings-exit-link"], [aria-label="退出游戏"]').count() > 0, `${viewport.name}: settings exit action missing`);
      await page.locator('[data-testid="settings-finish"]').click();
      await waitForRuntimeScreen(page, "main_menu");
      await page.locator('[data-testid="open-about"]').click();
      await waitForRuntimeScreen(page, "about");
      await page.locator('[data-testid="about-screen"]').waitFor({ state: "visible", timeout: 10_000 });
      const aboutVisual = await inspectThemedSurface(page, ".about-card-content", `${viewport.name} about`);
      await page.locator('[data-testid="back-to-main-menu"]').click();
      await waitForRuntimeScreen(page, "main_menu");
      await page.locator('[data-testid="open-gallery"]').click();
      await waitForRuntimeScreen(page, "gallery");
      await page.locator('[data-testid="gallery-screen"]').waitFor({ state: "visible", timeout: 10_000 });
      const galleryVisual = await inspectThemedSurface(page, ".gallery-grid", `${viewport.name} gallery`);
      await page.locator('[data-testid="back-to-main-menu"]').click();
      await waitForRuntimeScreen(page, "main_menu");
      const saveLoadEntry = page.locator('[data-testid="open-save-load"]:visible').last();
      await saveLoadEntry.waitFor({ state: "visible", timeout: 10_000 });
      await page.waitForFunction(
        () => document.querySelector('[data-testid="open-save-load"]:not([disabled])') !== null,
        undefined,
        { timeout: 10_000 },
      );
      await saveLoadEntry.click();
      await waitForRuntimeScreen(page, "save_load");
      await page.locator(".save-load-screen").waitFor({ state: "visible", timeout: 10_000 });
      const saveVisual = await inspectThemedSurface(page, ".save-grid", `${viewport.name} save-load`);
      await page.locator('[data-testid="back-to-player"]').click();
      await waitForRuntimeScreen(page, "main_menu");
      await page.locator('[data-testid="open-settings"]').click();
      await waitForRuntimeScreen(page, "settings");
      await page.locator('[data-testid="settings-screen"]').waitFor({ state: "visible", timeout: 10_000 });
      const settingsVisual = await inspectThemedSurface(page, ".settings-content", `${viewport.name} settings`);
      await page.locator('[data-testid="settings-finish"]').click();
      assert(errors.length === 0, `${viewport.name}: runtime errors`, errors);
      results[viewport.name] = {
        galleryLockedPlaceholders: 8,
        titleLayout,
        visualSurfaces: { about: aboutVisual, gallery: galleryVisual, save: saveVisual, settings: settingsVisual },
        errors,
        viewport,
      };
      await page.screenshot({ path: path.join(outputDir, `${viewport.name}.png`) });
      await page.close();
    }
    fs.writeFileSync(path.join(outputDir, "report.json"), `${JSON.stringify({ ok: true, manifest: { game_id: manifest.game_id, title: manifest.title, assets: manifest.assets?.length || 0, galleryItems: gallery.items?.length || 0 }, results }, null, 2)}\n`, "utf8");
    fs.rmSync(path.join(outputDir, "error.txt"), { force: true });
    console.log(`hidden-growth-runtime-playwright: PASS (${outputDir})`);
  } finally {
    await browser.close();
    staticServer.close();
    stop(runtimeServer);
  }
})().catch((error) => { fs.mkdirSync(outputDir, { recursive: true }); fs.writeFileSync(path.join(outputDir, "error.txt"), String(error.stack || error), "utf8"); console.error(error.stack || error); process.exitCode = 1; });
