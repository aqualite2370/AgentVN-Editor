#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const runtimeRoot = path.join(root, "GameCli_framework");
const outputDir = path.join(root, "output", "playwright", "runtime-solid-buttons");
const port = 6892;
const baseUrl = `http://127.0.0.1:${port}/?mode=preview`;

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`);
}

function fixture() {
  const now = new Date().toISOString();
  return {
    manifest: {
      manifest_version: "1.0.0",
      cartridge_version: "1.0.0",
      runtime_version: "0.6.0",
      game_id: "runtime-solid-buttons",
      title: "实心按钮验收",
      author: "AgentVN QA",
      version: "1.0.0",
      description: "验证真实 GameCLI 页面按钮的实心材料与 hover 稳定性。",
      language: "zh-CN",
      entry_script: "script.json",
      entry_scene_id: "scene_main",
      assets: [],
      created_at: now,
      updated_at: now,
    },
    script: {
      schema_version: "1.5.0",
      game_id: "runtime-solid-buttons",
      title: "实心按钮验收",
      entry_scene_id: "scene_main",
      characters: [],
      scenes: [{
        scene_id: "scene_main",
        title: "Main",
        chapter: 1,
        tags: [],
        commands: [
          {
            type: "choice",
            choices: [
              { choice_id: "choice_a", text: "继续", target_scene_id: "scene_main", conditions: [] },
              { choice_id: "choice_b", text: "返回", target_scene_id: "scene_main", conditions: [] },
            ],
          },
        ],
      }],
    },
    uiSkin: {
      ui_layout_version: "1.3.0",
      name: "Solid controls acceptance skin",
      target_runtime: "0.6.0",
      assets: [],
      tokens: {
        colorBackground: "#090d14",
        colorSurface: "#18202b99",
        colorSurfaceStrong: "#253243a6",
        colorInk: "#f2f5f8",
        colorMuted: "#a9b3bd",
        colorAccent: "#8098aa",
        colorAccent2: "#aa9178",
        colorLine: "#9aabb8",
        colorControl: "#34475a99",
        colorControlHover: "#3e536699",
        colorControlActive: "#7892a6a6",
        colorControlText: "#f2f5f8",
        colorQuickMenu: "#18202b99",
        colorFocus: "#a7bdcc",
        radius: 12,
      },
      screens: [{
        screen_id: "player",
        components: [
          {
            component_id: "dialog_panel",
            component_type: "dialog_panel",
            required: true,
            rect: { x: 6, y: 76, width: 88, height: 18 },
          },
          {
            component_id: "choice_list",
            component_type: "choice_list",
            required: true,
            rect: { x: 50, y: 40, width: 38, height: 28, anchor: "center" },
          },
          {
            component_id: "quick_menu",
            component_type: "quick_menu",
            required: true,
            rect: { x: 96, y: 72, width: 28, height: 56, anchor: "bottom_right" },
            mobileRect: { x: 96, y: 72, width: 52, height: 58, anchor: "bottom_right" },
            style: {
              quickMenuVariant: "C",
              quickMenuDirection: "auto",
              backgroundColor: "#18202b",
              borderColor: "#8494a1",
              borderRadius: 16,
              opacity: 0.9,
              padding: 4,
              gap: 3,
              backdropBlur: 12,
            },
          },
        ],
      }],
    },
  };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    try {
      const response = await fetch(baseUrl, { cache: "no-store" });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("GameCLI Vite server did not become ready");
}

function stop(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } else {
      child.kill("SIGTERM");
    }
  } catch {}
}

async function initialize(page) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate((payload) => {
    window.postMessage({
      type: "agentvn.live-preview.init",
      protocolVersion: 2,
      sessionId: `runtime-solid-buttons-${Math.random()}`,
      revision: 1,
      requestId: "runtime-solid-buttons-init",
      runId: "runtime-solid-buttons-run",
      manifest: payload.manifest,
      script: payload.script,
      uiSkin: payload.uiSkin,
      assetUrls: {},
      start: {
        requestId: "runtime-solid-buttons-start",
        target: { sceneId: "scene_main", commandIndex: 0 },
        entryPath: [],
        mode: "stable_frame",
        playbackRate: 1,
        reducedMotion: true,
      },
      screen: "title_menu",
    }, "*");
  }, fixture());
  await page.getByTestId("game-state-title").waitFor({ state: "visible", timeout: 30_000 });
  await waitForIdle(page);
}

async function waitForIdle(page) {
  await page.waitForFunction(() => (
    document.querySelector("[data-runtime-screen-transition]")
      ?.getAttribute("data-runtime-screen-transition") === "idle"
  ), undefined, { timeout: 30_000 });
  await page.waitForTimeout(80);
}

async function navigate(page, selector, destinationSelector) {
  await page.locator(selector).first().click();
  await page.waitForFunction(() => (
    document.querySelector("[data-runtime-screen-transition]")
      ?.getAttribute("data-runtime-screen-transition") === "active"
  ), undefined, { timeout: 10_000 });
  await waitForIdle(page);
  await page.locator(destinationSelector).first().waitFor({ state: "visible", timeout: 30_000 });
}

async function inspectButtons(page, label) {
  const states = await page.evaluate(() => {
    function colorAlpha(value) {
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
    }
    const root = document.querySelector(".runtime-screen-transition-current");
    return [...(root?.querySelectorAll("button") ?? [])]
      .filter((button) => {
        const style = getComputedStyle(button);
        const rect = button.getBoundingClientRect();
        return (
          style.display !== "none"
          && style.visibility === "visible"
          && rect.width > 1
          && rect.height > 1
          && !button.classList.contains("settings-select-backdrop")
          && button.getAttribute("data-ui-frame-mode") !== "image_owned"
          && !button.classList.contains("is-image-owned")
        );
      })
      .map((button, index) => {
        const style = getComputedStyle(button);
        const before = getComputedStyle(button, "::before");
        const after = getComputedStyle(button, "::after");
        const rect = button.getBoundingClientRect();
        return {
          index,
          selectorHint: button.getAttribute("data-testid")
            ?? button.getAttribute("aria-label")
            ?? button.className
            ?? button.textContent?.trim().slice(0, 32),
          className: button.className,
          text: button.textContent?.trim().replace(/\s+/g, " ").slice(0, 48) ?? "",
          disabled: button.disabled,
          opacity: Number(style.opacity),
          backgroundColor: style.backgroundColor,
          backgroundAlpha: colorAlpha(style.backgroundColor),
          backgroundImage: style.backgroundImage,
          before: {
            content: before.content,
            backgroundColor: before.backgroundColor,
            backgroundImage: before.backgroundImage,
          },
          after: {
            content: after.content,
            backgroundColor: after.backgroundColor,
            backgroundImage: after.backgroundImage,
          },
          rect: {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          },
        };
      });
  });
  assert(states.length > 0, `${label}: no visible runtime buttons were found`);
  for (const state of states) {
    assert(state.opacity >= 0.999, `${label}: non-image button is not element-opaque`, state);
    // Quick-menu actions intentionally use a translucent gray material with
    // backdrop blur; the element itself remains opaque so text/icons stay
    // crisp. All other runtime controls must retain a solid background.
    const isQuickMenu = String(state.className).split(/\s+/).includes("quick-menu-button")
      || String(state.className).split(/\s+/).includes("quick-menu-toggle")
      || state.selectorHint === "回退"
      || state.selectorHint === "自动"
      || state.selectorHint === "快进"
      || state.selectorHint === "存档"
      || state.selectorHint === "历史"
      || state.selectorHint === "隐藏"
      || state.selectorHint === "菜单"
      || state.selectorHint === "开启自动播放"
      || state.selectorHint === "关闭自动播放"
      || state.selectorHint === "开启快进"
      || state.selectorHint === "关闭快进"
      || state.selectorHint === "回退（滚轮上滑 / PageUp）"
      || state.selectorHint === "打开存档读档"
      || state.selectorHint === "打开历史记录"
      || state.selectorHint === "隐藏界面"
      || state.selectorHint === "打开主菜单"
      || state.selectorHint === "返回画廊";
    if (!isQuickMenu) {
      assert(state.backgroundAlpha >= 0.999, `${label}: non-image button background is not solid`, state);
    }
  }

  const representativeIndexes = await page.evaluate(() => {
    const root = document.querySelector(".runtime-screen-transition-current");
    const buttons = [...(root?.querySelectorAll("button") ?? [])]
      .filter((button) => {
        const style = getComputedStyle(button);
        const rect = button.getBoundingClientRect();
        return (
          style.display !== "none"
          && style.visibility === "visible"
          && rect.width > 1
          && rect.height > 1
          && !button.disabled
          && !button.classList.contains("settings-select-backdrop")
          && button.getAttribute("data-ui-frame-mode") !== "image_owned"
          && !button.classList.contains("is-image-owned")
        );
      });
    const seen = new Set();
    const indexes = [];
    buttons.forEach((button, index) => {
      const key = [
        button.tagName,
        button.className,
        button.getAttribute("role"),
        button.getAttribute("aria-pressed"),
      ].join("|");
      if (seen.has(key)) return;
      seen.add(key);
      const probeId = String(indexes.length);
      button.setAttribute("data-runtime-solid-probe", probeId);
      indexes.push(probeId);
    });
    return indexes.slice(0, 12);
  });

  const hoverReports = [];
  for (const index of representativeIndexes) {
    const button = page.locator(`[data-runtime-solid-probe="${index}"]`);
    if (!await button.isVisible() || await button.isDisabled()) continue;
    const isQuickMenuButton = await button.evaluate((element) => Boolean(element.closest(".playback-controls")));
    let centerIsHittable = await button.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return Boolean(hit && element.contains(hit));
    });
    if (!centerIsHittable && !isQuickMenuButton) {
      await button.scrollIntoViewIfNeeded();
      await page.waitForTimeout(80);
      centerIsHittable = await button.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return Boolean(hit && element.contains(hit));
      });
    }
    assert(centerIsHittable, `${label}: visible runtime button center is clipped or intercepted`, {
      index,
      hint: await button.getAttribute("data-testid")
        ?? await button.getAttribute("aria-label")
        ?? await button.textContent(),
    });
    await page.mouse.move(2, 2);
    await page.evaluate(() => {
      document.body.tabIndex = -1;
      document.body.focus({ preventScroll: true });
    });
    await page.waitForTimeout(620);
    const before = await button.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        hovered: element.matches(":hover"),
        hint: element.getAttribute("data-testid") ?? element.getAttribute("aria-label") ?? element.textContent?.trim(),
        focused: document.activeElement === element,
        focusVisible: element.matches(":focus-visible"),
        insideRuntimeScope: Boolean(element.closest(".ui-skin-scope[data-ui-screen]")),
        matchesGlobalGlowExclusion: element.matches(":not(.ui-skin-scope[data-ui-screen] *)"),
        hitTarget: (() => {
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return hit ? {
            tag: hit.tagName,
            className: hit.className,
            testId: hit.getAttribute("data-testid"),
            insideButton: element.contains(hit),
          } : null;
        })(),
        opacity: style.opacity,
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        color: style.color,
        borderColor: style.borderColor,
        borderWidth: style.borderWidth,
        borderRadius: style.borderRadius,
        boxShadow: style.boxShadow,
        filter: style.filter,
        transform: style.transform,
        position: style.position,
        left: style.left,
        right: style.right,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        menuRect: (() => {
          const menu = element.closest(".playback-controls")?.getBoundingClientRect();
          return menu ? { left: menu.left, top: menu.top, width: menu.width, height: menu.height } : null;
        })(),
        actionLayer: (() => {
          const layer = element.closest(".quick-menu-action-layer");
          const layerRect = layer?.getBoundingClientRect();
          const layerStyle = layer ? getComputedStyle(layer) : null;
          return layerRect && layerStyle ? {
            left: layerRect.left,
            top: layerRect.top,
            width: layerRect.width,
            height: layerRect.height,
            gridTemplateColumns: layerStyle.gridTemplateColumns,
            gridTemplateRows: layerStyle.gridTemplateRows,
          } : null;
        })(),
      };
    });
    const center = await button.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await page.mouse.move(center.x, center.y);
    await page.waitForTimeout(520);
    const after = await button.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        hovered: element.matches(":hover"),
        hint: element.getAttribute("data-testid") ?? element.getAttribute("aria-label") ?? element.textContent?.trim(),
        focused: document.activeElement === element,
        focusVisible: element.matches(":focus-visible"),
        insideRuntimeScope: Boolean(element.closest(".ui-skin-scope[data-ui-screen]")),
        matchesGlobalGlowExclusion: element.matches(":not(.ui-skin-scope[data-ui-screen] *)"),
        hitTarget: (() => {
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return hit ? {
            tag: hit.tagName,
            className: hit.className,
            testId: hit.getAttribute("data-testid"),
            insideButton: element.contains(hit),
          } : null;
        })(),
        opacity: style.opacity,
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        color: style.color,
        borderColor: style.borderColor,
        borderWidth: style.borderWidth,
        borderRadius: style.borderRadius,
        boxShadow: style.boxShadow,
        filter: style.filter,
        transform: style.transform,
        position: style.position,
        left: style.left,
        right: style.right,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        menuRect: (() => {
          const menu = element.closest(".playback-controls")?.getBoundingClientRect();
          return menu ? { left: menu.left, top: menu.top, width: menu.width, height: menu.height } : null;
        })(),
        actionLayer: (() => {
          const layer = element.closest(".quick-menu-action-layer");
          const layerRect = layer?.getBoundingClientRect();
          const layerStyle = layer ? getComputedStyle(layer) : null;
          return layerRect && layerStyle ? {
            left: layerRect.left,
            top: layerRect.top,
            width: layerRect.width,
            height: layerRect.height,
            gridTemplateColumns: layerStyle.gridTemplateColumns,
            gridTemplateRows: layerStyle.gridTemplateRows,
          } : null;
        })(),
      };
    });
    assert(after.hovered, `${label}: hover sample did not reach :hover`, { index, before, after });
    for (const property of [
      "opacity",
      "backgroundColor",
      "backgroundImage",
      "color",
      "borderColor",
      "borderWidth",
      "borderRadius",
      "boxShadow",
      "filter",
      "transform",
    ]) {
      assert(after[property] === before[property], `${label}: hover changed ${property}`, { index, before, after });
    }
    for (const property of ["left", "top", "width", "height"]) {
      assert(Math.abs(after.rect[property] - before.rect[property]) < 0.25, `${label}: hover changed geometry`, { index, before, after });
    }
    hoverReports.push({ index, before, after });
  }
  return { states, hoverReports };
}

async function runViewport(browser, viewport) {
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.width < 600,
    hasTouch: viewport.width < 600,
  });
  const failures = [];
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.stack || error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (request) => failures.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ""}`));
  const result = {};
  try {
    await initialize(page);
    result.title = await inspectButtons(page, `${viewport.name}/title`);

    await navigate(page, '[data-testid="open-settings"]', '[data-testid="settings-screen"]');
    result.settings = await inspectButtons(page, `${viewport.name}/settings`);
    await navigate(page, '[data-testid="settings-finish"]', '[data-testid="game-state-title"]');

    await navigate(page, '[data-testid="open-about"]', '[data-testid="about-screen"]');
    result.about = await inspectButtons(page, `${viewport.name}/about`);
    await navigate(page, '[data-testid="back-to-main-menu"]', '[data-testid="game-state-title"]');

    await navigate(page, '[data-testid="open-gallery"]', '[data-testid="gallery-screen"]');
    result.gallery = await inspectButtons(page, `${viewport.name}/gallery`);
    await navigate(page, '[data-testid="back-to-main-menu"]', '[data-testid="game-state-title"]');

    await navigate(page, '[data-testid="open-save-load"]', ".save-load-screen");
    result.saveLoad = await inspectButtons(page, `${viewport.name}/save-load`);
    await navigate(page, '[data-testid="back-to-player"]', '[data-testid="game-state-title"]');

    await page.getByTestId("start-new-game").click();
    await page.getByTestId("game-launch-blackout").waitFor({ state: "detached", timeout: 30_000 });
    await page.getByTestId("game-state-playing").waitFor({ state: "visible", timeout: 30_000 });
    await page.getByTestId("quick-menu-toggle").click();
    await page.waitForFunction(() => (
      document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute("aria-expanded") === "true"
    ));
    await page.waitForTimeout(280);
    result.playing = await inspectButtons(page, `${viewport.name}/playing`);
    assert(failures.length === 0, `${viewport.name}: runtime errors`, failures);
    await page.screenshot({ path: path.join(outputDir, `${viewport.name}.png`) });
    return { viewport, result, failures };
  } finally {
    await page.close();
  }
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const staleError = path.join(outputDir, "error.txt");
  if (fs.existsSync(staleError)) fs.unlinkSync(staleError);
  const vite = spawn(
    "cmd.exe",
    ["/d", "/s", "/c", `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`],
    { cwd: runtimeRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let viteLog = "";
  vite.stdout.on("data", (chunk) => { viteLog += chunk; });
  vite.stderr.on("data", (chunk) => { viteLog += chunk; });
  const browser = await chromium.launch({ headless: true });
  try {
    await waitForServer();
    const reports = [];
    const requestedViewport = process.env.RUNTIME_SOLID_VIEWPORT?.trim();
    const viewports = [
      { name: "reported-1040x559", width: 1040, height: 559 },
      { name: "wide-1440x900", width: 1440, height: 900 },
      { name: "narrow-390x844", width: 390, height: 844 },
    ].filter((viewport) => !requestedViewport || viewport.name === requestedViewport);
    assert(viewports.length > 0, `unknown RUNTIME_SOLID_VIEWPORT: ${requestedViewport}`);
    for (const viewport of viewports) {
      reports.push(await runViewport(browser, viewport));
    }
    fs.writeFileSync(path.join(outputDir, "report.json"), `${JSON.stringify({ ok: true, reports }, null, 2)}\n`, "utf8");
    console.log(`runtime-solid-buttons-playwright: PASS (${outputDir})`);
  } finally {
    await browser.close();
    stop(vite);
    fs.writeFileSync(path.join(outputDir, "vite.log"), viteLog, "utf8");
  }
})().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "error.txt"), String(error.stack || error), "utf8");
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
