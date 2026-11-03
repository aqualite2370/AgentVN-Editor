#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const unpacked = path.join(root, "output", "hidden-growth", "unpacked");
const runtimeRoot = path.join(root, "GameCli_framework");
const outputDir = path.join(root, "output", "playwright", "quick-menu-size-parity");
const runtimeUrl = "http://127.0.0.1:6868/?mode=preview";

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(runtimeUrl)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("GameCLI Vite server did not become ready");
}

function startStatic(rootDir) {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname).replace(/^\/+/, "");
    const target = path.resolve(rootDir, pathname);
    if (!target.startsWith(path.resolve(rootDir) + path.sep) || !fs.existsSync(target)) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      "Access-Control-Allow-Origin": "http://127.0.0.1:6868",
      "Cache-Control": "no-store",
    });
    fs.createReadStream(target).pipe(response);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function stopProcess(child) {
  if (!child?.pid) return;
  try {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } catch {}
}

function loadHiddenGrowth() {
  const manifest = JSON.parse(fs.readFileSync(path.join(unpacked, "manifest.json"), "utf8"));
  const script = JSON.parse(fs.readFileSync(path.join(unpacked, "script.json"), "utf8"));
  const gallery = fs.existsSync(path.join(unpacked, "gallery.json"))
    ? JSON.parse(fs.readFileSync(path.join(unpacked, "gallery.json"), "utf8"))
    : { items: [] };
  const uiPath = manifest.ui_skin?.path || "ui/layout.json";
  const uiSkin = JSON.parse(fs.readFileSync(path.join(unpacked, uiPath), "utf8"));
  return { manifest, script, gallery, uiSkin };
}

async function init(page, payload, assetUrls, variant = "C") {
  const uiSkin = structuredClone(payload.uiSkin);
  uiSkin.tokens = {
    ...(uiSkin.tokens ?? {}),
    colorQuickMenu: "#987654",
    colorControl: "#654321",
    colorControlText: "#fedcba",
    colorLine: "#abcdef",
  };
  const quickMenu = uiSkin.screens
    .find((screen) => screen.screen_id === "player")
    ?.components.find((component) => component.component_type === "quick_menu");
  if (quickMenu) {
    quickMenu.style = {
      ...(quickMenu.style ?? {}),
      borderRadius: 96,
      quickMenuVariant: variant,
    };
  }
  await page.goto(runtimeUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ payload, uiSkin: nextUiSkin, assetUrls: nextAssetUrls }) => {
    window.postMessage({
      type: "agentvn.live-preview.init",
      protocolVersion: 2,
      sessionId: `quick-menu-size-${Date.now()}`,
      revision: 1,
      requestId: "quick-menu-size-init",
      runId: "quick-menu-size-run",
      manifest: payload.manifest,
      script: payload.script,
      gallery: payload.gallery,
      uiSkin: nextUiSkin,
      assetUrls: nextAssetUrls,
      start: {
        requestId: "quick-menu-size-start",
        target: { sceneId: payload.manifest.entry_scene_id, commandIndex: 0 },
        entryPath: [],
        mode: "stable_frame",
        playbackRate: 1,
        reducedMotion: true,
      },
      screen: "playing",
    }, "*");
  }, { payload, uiSkin, assetUrls });
  await page.getByTestId("quick-menu-toggle").waitFor({ state: "visible", timeout: 30_000 });
}

async function sample(page) {
  return page.evaluate(() => {
    const colorAlpha = (value) => {
      if (!value || value === "transparent") return 0;
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return 0;
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      return context.getImageData(0, 0, 1, 1).data[3] / 255;
    };
    const colorSaturation = (value) => {
      if (!value || value === "transparent") return 0;
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return 1;
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
      const channels = [red, green, blue].map((channel) => channel / 255);
      const max = Math.max(...channels);
      const min = Math.min(...channels);
      const delta = max - min;
      if (delta === 0) return 0;
      const lightness = (max + min) / 2;
      return delta / (1 - Math.abs(2 * lightness - 1));
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
    const toggle = document.querySelector('[data-testid="quick-menu-toggle"]');
    const surface = document.querySelector(".quick-menu-surface");
    const firstButton = document.querySelector(".quick-menu-button");
    const surfaceStyle = surface ? getComputedStyle(surface) : null;
    const surfacePseudoStyle = surface ? getComputedStyle(surface, "::before") : null;
    const toggleStyle = toggle ? getComputedStyle(toggle) : null;
    const surfaceLayoutStyle = surface ? getComputedStyle(surface) : null;
    const firstButtonStyle = firstButton ? getComputedStyle(firstButton) : null;
    const firstButtonPseudoStyle = firstButton ? getComputedStyle(firstButton, "::before") : null;
    const intersects = (a, b) => a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const dialog = rect(".dialog-box");
    const buttonRects = [...document.querySelectorAll(".quick-menu-button")].map((element) => {
      const value = element.getBoundingClientRect();
      return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
    });
    const firstButtonAncestors = (() => {
      const chain = [];
      let node = firstButton;
      for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        chain.push({
          tag: node.tagName,
          className: typeof node.className === "string" ? node.className : "",
          transform: style.transform,
          writingMode: style.writingMode,
          flexDirection: style.flexDirection,
          gridTemplateColumns: style.gridTemplateColumns,
          gridTemplateRows: style.gridTemplateRows,
          rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        });
      }
      return chain;
    })();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      frame: rect(".runtime-layout-frame"),
      dialog,
      root: rect(".playback-controls"),
      surface: rect(".quick-menu-surface"),
      surfaceBorderRadius: surfaceStyle?.borderRadius ?? "",
      toggle: rect('[data-testid="quick-menu-toggle"]'),
      toggleStyle: toggleStyle ? {
        backgroundColor: toggleStyle.backgroundColor,
        backgroundAlpha: colorAlpha(toggleStyle.backgroundColor),
        backgroundSaturation: colorSaturation(toggleStyle.backgroundColor),
        borderRadius: toggleStyle.borderRadius,
        backdropFilter: toggleStyle.backdropFilter,
        filter: toggleStyle.filter,
        opacity: Number(toggleStyle.opacity),
      } : null,
      toggleSurface: toggle ? {
        width: Number.parseFloat(toggleStyle?.getPropertyValue("--runtime-quick-menu-toggle-visual-width")) || 0,
        height: Number.parseFloat(toggleStyle?.getPropertyValue("--runtime-quick-menu-toggle-visual-height")) || 0,
      } : null,
      toggleHitPoints: toggle ? (() => {
        const value = toggle.getBoundingClientRect();
        const points = [
          { x: value.left + value.width / 2, y: value.top + value.height / 2 },
          { x: value.left + Math.min(2, value.width / 4), y: value.top + value.height / 2 },
          { x: value.right - Math.min(2, value.width / 4), y: value.top + value.height / 2 },
          { x: value.left + value.width / 2, y: value.top + Math.min(2, value.height / 4) },
          { x: value.left + value.width / 2, y: value.bottom - Math.min(2, value.height / 4) },
        ];
        return points.map((point) => {
          const hit = document.elementFromPoint(point.x, point.y);
          return {
            point,
            hitButton: hit === toggle || toggle.contains(hit),
          };
        });
      })() : [],
      firstButton: rect(".quick-menu-button"),
      buttonRects,
      overlapsDialog: buttonRects.filter((button) => intersects(button, dialog)).length,
      variant: document.querySelector(".playback-controls")?.getAttribute("data-quick-menu-variant"),
      direction: document.querySelector(".playback-controls")?.getAttribute("data-quick-menu-direction"),
      saturation: surfaceStyle?.backdropFilter ?? "",
      surfaceBackground: surfaceStyle?.backgroundColor ?? "",
      surfaceBackgroundAlpha: colorAlpha(surfaceStyle?.backgroundColor ?? ""),
      surfaceBackgroundSaturation: colorSaturation(surfaceStyle?.backgroundColor ?? ""),
      surfaceBorder: surfaceStyle?.borderWidth ?? "",
      surfaceShadow: surfaceStyle?.boxShadow ?? "",
      surfacePointerEvents: surfaceStyle?.pointerEvents ?? "",
      surfacePseudoDisplay: surfacePseudoStyle?.display ?? "",
      surfacePseudoBackdropFilter: surfacePseudoStyle?.backdropFilter ?? "",
      togglePseudo: toggle ? {
        content: getComputedStyle(toggle, "::before").content,
        backgroundColor: getComputedStyle(toggle, "::before").backgroundColor,
        backgroundAlpha: colorAlpha(getComputedStyle(toggle, "::before").backgroundColor),
        backgroundSaturation: colorSaturation(getComputedStyle(toggle, "::before").backgroundColor),
        backgroundImage: getComputedStyle(toggle, "::before").backgroundImage,
        borderRadius: getComputedStyle(toggle, "::before").borderRadius,
        boxShadow: getComputedStyle(toggle, "::before").boxShadow,
        backdropFilter: getComputedStyle(toggle, "::before").backdropFilter,
      } : null,
      surfaceFlexDirection: surfaceLayoutStyle?.flexDirection ?? "",
      firstButtonStyle: firstButtonStyle ? {
        width: firstButtonStyle.width,
        height: firstButtonStyle.height,
        minWidth: firstButtonStyle.minWidth,
        maxWidth: firstButtonStyle.maxWidth,
        minHeight: firstButtonStyle.minHeight,
        maxHeight: firstButtonStyle.maxHeight,
        flex: firstButtonStyle.flex,
        alignSelf: firstButtonStyle.alignSelf,
        backgroundColor: firstButtonStyle.backgroundColor,
        backgroundAlpha: colorAlpha(firstButtonStyle.backgroundColor),
        backgroundSaturation: colorSaturation(firstButtonStyle.backgroundColor),
        backdropFilter: firstButtonStyle.backdropFilter,
        filter: firstButtonStyle.filter,
        opacity: Number(firstButtonStyle.opacity),
        pseudoContent: firstButtonPseudoStyle?.content ?? "",
        pseudoBackground: firstButtonPseudoStyle?.backgroundColor ?? "",
      } : null,
      firstButtonAncestors,
      surfaceOpacity: Number(surfaceStyle?.opacity ?? 0),
      surfaceClipPath: surfaceStyle?.clipPath ?? "",
      actionLayerPointerEvents: surface?.querySelector(".quick-menu-action-layer")
        ? getComputedStyle(surface.querySelector(".quick-menu-action-layer")).pointerEvents
        : "",
      actionButtonOpacities: [...document.querySelectorAll(".quick-menu-button")].map((button) => Number(getComputedStyle(button).opacity)),
      actionButtonPointerEvents: [...document.querySelectorAll(".quick-menu-button")].map((button) => getComputedStyle(button).pointerEvents),
      rootStyleWidth: getComputedStyle(document.querySelector(".playback-controls")).width,
      rootStyleHeight: getComputedStyle(document.querySelector(".playback-controls")).height,
      rootStyleTop: getComputedStyle(document.querySelector(".playback-controls")).top,
      rootInlineStyle: document.querySelector(".playback-controls")?.getAttribute("style") ?? "",
      metricVars: (() => {
        const root = document.querySelector(".playback-controls");
        const style = root ? getComputedStyle(root) : null;
        return {
          surfaceWidth: style?.getPropertyValue("--runtime-quick-menu-surface-width") ?? "",
          surfaceHeight: style?.getPropertyValue("--runtime-quick-menu-surface-height") ?? "",
          columns: style?.getPropertyValue("--runtime-quick-menu-columns") ?? "",
          rows: style?.getPropertyValue("--runtime-quick-menu-rows") ?? "",
          actionWidth: style?.getPropertyValue("--runtime-quick-menu-action-visual-width") ?? "",
          actionHeight: style?.getPropertyValue("--runtime-quick-menu-action-visual-height") ?? "",
          cellWidth: style?.getPropertyValue("--runtime-quick-menu-cell-width") ?? "",
          cellHeight: style?.getPropertyValue("--runtime-quick-menu-cell-height") ?? "",
          actionHitSize: style?.getPropertyValue("--runtime-quick-menu-action-hit-size") ?? "",
          toggleHitSize: style?.getPropertyValue("--runtime-quick-menu-toggle-size") ?? "",
          surfacePadding: style?.getPropertyValue("--runtime-quick-menu-padding") ?? "",
          rowGap: style?.getPropertyValue("--runtime-quick-menu-toggle-gap") ?? "",
          toggleCellColumn: style?.getPropertyValue("--runtime-quick-menu-toggle-cell-column") ?? "",
          toggleCellRow: style?.getPropertyValue("--runtime-quick-menu-toggle-cell-row") ?? "",
          uniformScale: style?.getPropertyValue("--runtime-quick-menu-uniform-scale") ?? "",
          skinBackground: style?.getPropertyValue("--runtime-quick-menu-skin-background") ?? "",
          skinBorder: style?.getPropertyValue("--runtime-quick-menu-skin-border") ?? "",
          actionBackground: style?.getPropertyValue("--runtime-quick-menu-action-background") ?? "",
        };
      })(),
      actionLabels: [...document.querySelectorAll(".quick-menu-button-label")].map((label) => label.textContent?.trim() ?? ""),
      documentScrollWidth: document.documentElement.scrollWidth,
    };
  });
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.rmSync(path.join(outputDir, "error.txt"), { force: true });
  assert(fs.existsSync(path.join(unpacked, "manifest.json")), "hidden-growth unpacked fixture is missing");
  const payload = loadHiddenGrowth();
  const staticServer = await startStatic(unpacked);
  const staticBase = `http://127.0.0.1:${staticServer.address().port}`;
  const assetUrls = {};
  for (const asset of payload.manifest.assets ?? []) {
    assetUrls[asset.asset_id] = `${staticBase}/${asset.path}`;
    assetUrls[asset.path] = `${staticBase}/${asset.path}`;
  }
  const vite = spawn("cmd.exe", ["/d", "/s", "/c", "npm run dev -- --host 127.0.0.1 --port 6868"], {
    cwd: runtimeRoot,
    windowsHide: true,
    stdio: "ignore",
  });
  const browser = await chromium.launch({ headless: true });
  const results = {};
  try {
    await waitForServer();
    for (const viewport of [
      { name: "2560x1440", width: 2560, height: 1440 },
      { name: "1440x900", width: 1440, height: 900 },
      { name: "757x299", width: 757, height: 299, android: true },
      { name: "android-915x412", width: 915, height: 412, android: true },
      { name: "390x844", width: 390, height: 844 },
    ]) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.android || viewport.width < 900,
        hasTouch: viewport.android || viewport.width < 900,
        userAgent: viewport.android ? "Mozilla/5.0 (Linux; Android 15; AgentVN QA) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36" : undefined,
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      await init(page, payload, assetUrls, "C");
      const collapsed = await sample(page);
      assert(
        collapsed.toggle
          && collapsed.toggle.left >= -1
          && collapsed.toggle.top >= -1
          && collapsed.toggle.right <= viewport.width + 1
          && collapsed.toggle.bottom <= viewport.height + 1,
        `${viewport.name}: collapsed quick-menu entry is outside viewport`,
        collapsed,
      );
      await page.getByTestId("quick-menu-toggle").click();
      await page.waitForFunction(() => document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute("aria-expanded") === "true");
      await page.waitForTimeout(80);
      const expanding = await sample(page);
      await page.waitForTimeout(180);
      const expanded = await sample(page);
      assert(expanded.variant === "C", `${viewport.name}: C variant did not reach runtime`, expanded);
      assert(expanded.surface && expanded.toggleSurface && expanded.firstButton, `${viewport.name}: quick-menu geometry is incomplete`, expanded);
      assert(
        Number.parseFloat(expanded.surfaceBorderRadius)
          <= 10 * Number(expanded.metricVars.uniformScale) + 0.1,
        `${viewport.name}: quick-menu outer frame must remain a subtly rounded rectangle even when the authored radius is oversized`,
        expanded,
      );
      assert(
        Number.parseFloat(expanded.surfaceClipPath.match(/round\s+([\d.]+)px/)?.[1] ?? "Infinity")
          <= 10 * Number(expanded.metricVars.uniformScale) + 0.1,
        `${viewport.name}: expanded quick-menu clipping must use the same restrained corner radius`,
        expanded,
      );
      const expandedWidth = Number.parseFloat(expanded.metricVars.surfaceWidth);
      const expandedHeight = Number.parseFloat(expanded.metricVars.surfaceHeight);
      const observedSurfaceWidth = expanded.surface.width;
      const observedSurfaceHeight = expanded.surface.height;
      assert(
        Math.abs(observedSurfaceWidth - expandedWidth) <= 1
          && Math.abs(observedSurfaceHeight - expandedHeight) <= 1
          && expandedWidth > 0
          && expandedHeight > 0,
        `${viewport.name}: surface geometry does not match shared scaled metrics`,
        expanded,
      );
      assert(expanded.saturation.includes("saturate(0.5)"), `${viewport.name}: surface saturation is not 0.5`, expanded);
      assert(expanded.metricVars.columns.trim() === "1" && expanded.metricVars.rows.trim() === "8", `${viewport.name}: C must be a fixed 1 × 8 drawer`, expanded);
      assert(
        Math.abs(
          Number(expanded.metricVars.uniformScale)
            - expanded.metricVars.surfaceWidth.replace("px", "") / (viewport.android || viewport.width < 900 ? 420 : 320),
        ) < 0.001,
        `${viewport.name}: runtime surface is not using the shared uniform scale`,
        expanded,
      );
      assert(expanded.metricVars.toggleCellColumn.trim() === "1" && expanded.metricVars.toggleCellRow.trim() === "8", `${viewport.name}: C toggle must own the eighth row`, expanded);
      assert(expanded.actionLabels.join("|") === "回退|自动|快进|存档|历史|隐藏|菜单", `${viewport.name}: C action labels/order changed`, expanded);
      assert(expanded.actionLabels.every((label) => [...label].length === 2), `${viewport.name}: C action labels must stay at two Chinese characters`, expanded);
      assert(
        expanded.firstButtonStyle.backgroundAlpha >= 0.6
          && expanded.firstButtonStyle.backgroundAlpha <= 0.85
          && expanded.firstButtonStyle.opacity >= 0.99
          && expanded.firstButtonStyle.backdropFilter.includes("blur(")
          && expanded.firstButtonStyle.filter === "none",
        `${viewport.name}: C action button did not use theme-bound background glass on the real element`,
        expanded,
      );
      assert(
        expanded.metricVars.skinBackground.includes("var(--runtime-quick-menu")
          || expanded.metricVars.skinBackground.trim().toLowerCase() === "#987654",
        `${viewport.name}: C surface material is not bound to the current client theme`,
        expanded,
      );
      assert(
        expanded.metricVars.actionBackground.includes("var(--runtime-control-solid")
          || expanded.metricVars.actionBackground.replace(/\s+/g, "") === "rgb(101,67,33)",
        `${viewport.name}: C action material is not bound to the current client theme`,
        expanded,
      );
      assert(expanded.firstButtonStyle.pseudoContent === "none", `${viewport.name}: C action still paints its material through ::before`, expanded);
      assert(
        expanded.toggleStyle.backgroundAlpha === 0
          && expanded.togglePseudo.backgroundAlpha >= 0.6
          && expanded.togglePseudo.backgroundAlpha <= 0.9
          && expanded.toggleStyle.opacity >= 0.99
          && expanded.toggleStyle.backdropFilter.includes("blur(")
          && expanded.toggleStyle.filter === "none",
        `${viewport.name}: toggle hit layer and visual glass layer are not separated`,
        expanded,
      );
      assert(
        expanded.surfaceBackgroundAlpha >= 0.55
          && expanded.surfaceBackgroundAlpha <= 0.8,
        `${viewport.name}: surface did not retain the theme material alpha`,
        expanded,
      );
      assert(expanded.toggleStyle.borderRadius === "50%", `${viewport.name}: expanded X must remain an independent circular toggle`, expanded);
      assert(expanded.togglePseudo.content !== "none", `${viewport.name}: expanded X lost its visual glass target`, expanded);
      assert(
        expanded.togglePseudo.backdropFilter.includes("blur("),
        `${viewport.name}: toggle visual layer lost its material blur`,
        expanded,
      );
      const expectedCellWidth = Number.parseFloat(expanded.metricVars.cellWidth);
      const expectedActionHeight = Number.parseFloat(expanded.metricVars.actionHitSize);
      const expectedToggleHeight = Number.parseFloat(expanded.metricVars.toggleHitSize);
      const observedToggleTrack = expanded.toggle.width;
      const observedToggleRow = expanded.toggle.height;
      const observedActionTrack = expanded.firstButton.width;
      const observedActionRow = expanded.firstButton.height;
      assert(Math.abs(observedToggleTrack - expectedToggleHeight) <= 1, `${viewport.name}: X hit target must remain circular`, expanded);
      assert(Math.abs(observedToggleRow - expectedToggleHeight) <= 1, `${viewport.name}: X does not fill the eighth drawer row`, expanded);
      assert(
        observedActionTrack <= expectedCellWidth + 1
          && observedActionTrack >= expectedCellWidth - 24,
        `${viewport.name}: C action does not fill its scrollable grid track`,
        expanded,
      );
      assert(Math.abs(observedActionRow - expectedActionHeight) <= 1, `${viewport.name}: C action does not fill one drawer row`, expanded);
      const ratio = expanded.toggleSurface.height / expectedActionHeight;
      assert(ratio > 0.72 && ratio < 0.88, `${viewport.name}: enlarged toggle/action ratio is outside the 1.5x visual scale`, { ratio, expanded });
      assert(expanded.overlapsDialog === 0, `${viewport.name}: quick-menu action overlaps dialog`, expanded);
      assert(expanded.surface.left >= -1 && expanded.surface.right <= viewport.width + 1 && expanded.surface.top >= -1 && expanded.surface.bottom <= viewport.height + 1, `${viewport.name}: surface escaped viewport`, expanded);
      if (viewport.android && viewport.height >= 400) {
        const frameWidth = expanded.frame?.width ?? viewport.width;
        const expandedWidth = expanded.surface.width;
        const toggleHitSize = Number.parseFloat(expanded.metricVars.toggleHitSize);
        assert(
          expandedWidth >= frameWidth * 0.28,
          `${viewport.name}: Android quick-menu drawer still occupies too little of the authored frame`,
          { frame: expanded.frame, expandedWidth, minimum: frameWidth * 0.28, expanded },
        );
        assert(
          toggleHitSize >= frameWidth * 0.038,
          `${viewport.name}: Android quick-menu toggle hit area is still too small`,
          { frame: expanded.frame, toggleHitSize, minimum: frameWidth * 0.038, expanded },
        );
      }
      assert(expanded.documentScrollWidth <= viewport.width + 1, `${viewport.name}: horizontal overflow`, expanded);
      assert(collapsed.direction === "up", `${viewport.name}: C auto direction must resolve to up`, collapsed);
      assert(collapsed.surfaceBackground === "rgba(0, 0, 0, 0)" || collapsed.surfaceBackground === "transparent", `${viewport.name}: collapsed C surface retained a painted background`, collapsed);
      assert(collapsed.surfaceShadow === "none", `${viewport.name}: collapsed C surface retained a shadow`, collapsed);
      assert(collapsed.surfacePseudoDisplay === "none", `${viewport.name}: collapsed C surface retained a pseudo glass layer`, collapsed);
      assert(collapsed.actionLayerPointerEvents === "none", `${viewport.name}: collapsed C action layer still intercepts clicks`, collapsed);
      assert(collapsed.actionButtonPointerEvents.every((value) => value === "none"), `${viewport.name}: collapsed C action buttons still intercept clicks`, collapsed);
      assert(collapsed.toggleHitPoints.length === 5 && collapsed.toggleHitPoints.every((item) => item.hitButton), `${viewport.name}: collapsed toggle edge hit area is not clickable`, collapsed);
      assert(expanding.actionButtonOpacities.some((value) => value > 0.05 && value < 0.98), `${viewport.name}: C actions appeared without a visible intermediate frame`, { collapsed, expanding, expanded });
      assert(expanding.surfaceClipPath !== "inset(0px round 18px)" || expanding.surfaceBackground === "rgba(0, 0, 0, 0)", `${viewport.name}: C surface skipped its reveal frame`, expanding);
      assert(expanded.surfaceBackground !== "rgba(0, 0, 0, 0)" && expanded.surfaceShadow !== "none", `${viewport.name}: expanded C surface did not paint its skin glass`, expanded);
      assert(errors.length === 0, `${viewport.name}: runtime errors`, errors);
      results[viewport.name] = { collapsed, expanding, expanded, ratio, errors };
      await page.screenshot({ path: path.join(outputDir, `${viewport.name}.png`) });
      await page.close();
    }

    const pageA = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await init(pageA, payload, assetUrls, "A");
    await pageA.getByTestId("quick-menu-toggle").click();
    await pageA.waitForFunction(() => document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute("aria-expanded") === "true");
    await pageA.waitForTimeout(240);
    const variantA = await sample(pageA);
    assert(variantA.variant === "C", "legacy A variant must resolve to the fixed C runtime menu", variantA);
    const cColumns = await pageA.locator(".quick-menu-action-layer").evaluate((element) => getComputedStyle(element).gridTemplateColumns);
    assert(cColumns.split(" ").length === 1, "fixed runtime menu must remain a single vertical track", { variantA, cColumns });
    results.legacyVariant = { sample: variantA, gridTemplateColumns: cColumns };
    await pageA.close();

    fs.writeFileSync(path.join(outputDir, "report.json"), `${JSON.stringify({
      ok: true,
      fixture: { title: payload.manifest.title, gameId: payload.manifest.game_id, assets: payload.manifest.assets?.length ?? 0 },
      results,
    }, null, 2)}\n`, "utf8");
    fs.rmSync(path.join(outputDir, "error.txt"), { force: true });
    console.log(`quick-menu-size-parity-playwright: PASS (${outputDir})`);
  } finally {
    await browser.close();
    staticServer.close();
    stopProcess(vite);
  }
})().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "error.txt"), String(error.stack || error), "utf8");
  console.error(error.stack || error);
  process.exitCode = 1;
});
