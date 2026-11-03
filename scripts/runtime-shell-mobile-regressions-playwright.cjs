#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const runtimeRoot = path.join(root, "GameCli_framework");
const outputDir = process.env.AGENTVN_RUNTIME_SHELL_OUTPUT
  ? path.resolve(process.env.AGENTVN_RUNTIME_SHELL_OUTPUT)
  : path.join(root, "output", "playwright", "runtime-shell-mobile-regressions",
    new Date().toISOString().replace(/[:.]/g, "-"));
const port = Number(process.env.AGENTVN_GAMECLI_TEST_PORT || 6878);
const runtimeUrl = `http://127.0.0.1:${port}/?mode=preview`;
const androidUserAgent = "Mozilla/5.0 (Linux; Android 15; AgentVN QA) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36";

function compactRect(element) {
  const rect = element?.getBoundingClientRect();
  return rect
    ? {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      }
    : null;
}

function fixture() {
  const now = new Date().toISOString();
  const titleButton = (componentId, componentType, y) => ({
    component_id: componentId,
    component_type: componentType,
    required: true,
    // Deliberately use the pre-1.1 default title geometry. Migration must
    // preserve this user-authored surface and the absent/deleted mask.
    rect: { x: 78, y, width: 18, height: 7 },
    mobileRect: { x: 78, y, width: 18, height: 7 },
    style: {
      backgroundColor: "#143650",
      borderColor: "#285674",
      borderRadius: 8,
      color: "#e8f7ff",
      fontSize: 18,
      fontWeight: 800,
    },
  });
  return {
    manifest: {
      manifest_version: "1.0.0",
      cartridge_version: "1.0.0",
      runtime_version: "0.6.0",
      game_id: "runtime-shell-mobile-regressions",
      title: "不应覆盖背景的标题",
      author: "AgentVN QA",
      version: "1.0.0",
      description: "设置背景后，这段简介和游戏图标都不应显示。",
      language: "zh-CN",
      entry_script: "script.json",
      entry_scene_id: "scene_main",
      assets: [
        {
          asset_id: "title_background",
          asset_type: "background",
          path: "assets/title-background.svg",
          filename: "title-background.svg",
          mime_type: "image/svg+xml",
          size_bytes: 1,
          preload: true,
        },
        {
          asset_id: "game_icon",
          asset_type: "ui",
          path: "assets/game-icon.svg",
          filename: "game-icon.svg",
          mime_type: "image/svg+xml",
          size_bytes: 1,
          preload: true,
        },
      ],
      shell: { icon: "game_icon" },
      created_at: now,
      updated_at: now,
    },
    script: {
      schema_version: "1.5.0",
      game_id: "runtime-shell-mobile-regressions",
      title: "Runtime shell regressions",
      entry_scene_id: "scene_main",
      characters: [],
      scenes: [{
        scene_id: "scene_main",
        title: "Main",
        chapter: 1,
        tags: [],
        commands: [{ type: "narration", text: "Runtime shell regression fixture." }],
      }],
    },
    uiSkin: {
      ui_layout_version: "1.0.0",
      name: "Runtime shell regression skin",
      target_runtime: "0.6.0",
      assets: [],
      tokens: {
        colorBackground: "#061725",
        colorSurface: "#0c2234",
        colorSurfaceStrong: "#143650",
        colorInk: "#e8f7ff",
        colorMuted: "#a2c8dc",
        colorAccent: "#0ea5e9",
        colorAccent2: "#34d399",
        colorLine: "#285674",
        colorControl: "#143650",
        colorControlHover: "#0c2234",
        colorControlActive: "#0ea5e9",
        colorControlText: "#e8f7ff",
        colorQuickMenu: "#102b41",
        colorFocus: "#38bdf8",
        radius: 8,
      },
      screens: [
        {
          screen_id: "title",
          components: [
            {
              component_id: "title_hero",
              component_type: "main_menu_hero",
              required: true,
              rect: { x: 0, y: 0, width: 100, height: 100 },
              style: {
                backgroundImage: "asset:title_background",
                backgroundFit: "cover",
                color: "#ffffff",
                fontSize: 18,
                fontWeight: 700,
              },
            },
            titleButton("title_continue_button", "main_menu_continue_button", 28),
            titleButton("title_start_button", "main_menu_start_button", 36),
            titleButton("title_save_load_button", "main_menu_save_load_button", 44),
            titleButton("title_gallery_button", "main_menu_gallery_button", 52),
            titleButton("title_settings_button", "main_menu_settings_button", 60),
            titleButton("title_about_button", "main_menu_about_button", 68),
            {
              component_id: "title_custom_button_frame_edge",
              component_type: "main_menu_custom_button",
              label: "边缘自定义按钮",
              rect: { x: 89.4, y: 91.5, width: 9.92, height: 6.75 },
              style: {
                backgroundColor: "#143650",
                borderColor: "#285674",
                borderRadius: 8,
                color: "#e8f7ff",
                fontSize: 14,
                fontWeight: 800,
              },
              visible: true,
              zIndex: 27,
            },
          ],
        },
        {
          screen_id: "preferences",
          components: [{
            component_id: "settings_group",
            component_type: "settings_group",
            required: true,
            rect: { x: 22, y: 20, width: 56, height: 60 },
            style: {
              backgroundColor: "#0c2234",
              borderColor: "#285674",
              borderRadius: 8,
              color: "#e8f7ff",
            },
          }],
        },
      ],
    },
    assetUrls: {
      title_background: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1600' height='900'%3E%3Crect width='1600' height='900' fill='%23132b45'/%3E%3Cpath d='M0 720L420 350L760 610L1110 240L1600 700V900H0Z' fill='%232c7194'/%3E%3C/svg%3E",
      game_icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='128' height='128'%3E%3Crect width='128' height='128' rx='20' fill='%230ea5e9'/%3E%3C/svg%3E",
    },
  };
}

function stopProcess(child) {
  if (!child?.pid) return;
  try {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } catch {
    child.kill();
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    try {
      if ((await fetch(runtimeUrl)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("GameCLI Vite server did not become ready");
}

async function initialize(page, payload, viewportName, options = {}) {
  await page.goto(runtimeUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ fixturePayload, name }) => {
    window.postMessage({
      type: "agentvn.live-preview.init",
      protocolVersion: 2,
      sessionId: `runtime-shell-${name}-${Date.now()}`,
      revision: 1,
      requestId: `runtime-shell-${name}-init`,
      runId: `runtime-shell-${name}-run`,
      manifest: fixturePayload.manifest,
      script: fixturePayload.script,
      uiSkin: fixturePayload.uiSkin,
      assetUrls: fixturePayload.assetUrls,
      screen: "title_menu",
    }, "*");
  }, { fixturePayload: payload, name: viewportName });
  const title = page.locator('[data-testid="game-state-title"]');
  await title.waitFor({ state: options.allowHiddenTitle ? "attached" : "visible", timeout: 30_000 });
  await page.waitForTimeout(500);
}

async function waitForTransition(page) {
  await page.waitForFunction(
    () => document.querySelector("[data-runtime-screen-transition]")?.getAttribute("data-runtime-screen-transition") === "idle",
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(180);
}

async function sampleTitle(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
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
    const visible = (selector) => [...document.querySelectorAll(selector)].filter((element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0;
    }).length;
    return {
      frame: rect(".runtime-layout-frame"),
      background: rect(".main-menu-title-hero-background"),
      actions: rect('[data-testid="main-menu-actions"]'),
      titleMaskCount: document.querySelectorAll(".main-menu-title-mask").length,
      controls: [...document.querySelectorAll(".menu-action-button")]
        .filter((element) => getComputedStyle(element).display !== "none")
        .map((element) => {
          const value = element.getBoundingClientRect();
          return {
            componentId: element.getAttribute("data-ui-component-id"),
            rect: {
              left: value.left,
              top: value.top,
              right: value.right,
              bottom: value.bottom,
              width: value.width,
              height: value.height,
            },
          };
        }),
      orientation: document.querySelector(".ui-skin-scope")?.getAttribute("data-ui-orientation"),
      formFactor: document.querySelector(".ui-skin-scope")?.getAttribute("data-ui-form-factor"),
      viewportReady: document.querySelector(".ui-skin-scope")?.getAttribute("data-ui-viewport-ready"),
      viewportPhase: document.querySelector(".ui-skin-scope")?.getAttribute("data-ui-viewport-phase"),
      committedScreen: document.querySelector("[data-runtime-screen-transition]")?.getAttribute("data-runtime-committed-screen"),
      presentedScreen: document.querySelector("[data-runtime-screen-transition]")?.getAttribute("data-runtime-presented-screen"),
      transitionPhase: document.querySelector("[data-runtime-screen-transition]")?.getAttribute("data-runtime-transition-phase"),
      runtimeScreen: document.querySelector(".ui-skin-scope")?.getAttribute("data-ui-screen"),
      rootChildCount: document.querySelector("#root")?.childElementCount ?? 0,
      bodyText: document.body.innerText.slice(0, 180),
      visibleTitleCount: visible(".menu-hero h1"),
      visibleDescriptionCount: visible(".menu-hero p"),
      visibleIconCount: visible(".main-menu-cartridge-icon"),
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
    };
  });
}

async function sampleSettings(page) {
  return page.evaluate(() => {
    const box = (selector) => {
      const element = document.querySelector(selector);
      const rect = element?.getBoundingClientRect();
      return rect
        ? {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          }
        : null;
    };
    const frame = box(".runtime-layout-frame");
    const screen = box('[data-testid="settings-screen"]');
    const panel = box(".settings-renpy");
    const tabs = document.querySelector(".settings-tabs");
    const content = document.querySelector(".settings-content");
    const tabRects = [...document.querySelectorAll(".settings-tabs button")].map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        label: element.textContent?.trim() ?? "",
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    });
    const tabsRect = tabs?.getBoundingClientRect();
    const contentRect = content?.getBoundingClientRect();
    const finish = document.querySelector('[data-testid="settings-finish"]');
    const finishRect = finish?.getBoundingClientRect();
    const hit = finishRect
      ? document.elementFromPoint(finishRect.left + finishRect.width / 2, finishRect.top + finishRect.height / 2)
      : null;
    const inside = (child, parent) => Boolean(child && parent
      && child.left >= parent.left - 1
      && child.top >= parent.top - 1
      && child.right <= parent.right + 1
      && child.bottom <= parent.bottom + 1);
    return {
      frame,
      screen,
      panel,
      panelInsideFrame: inside(panel, frame),
      panelWidthRatio: frame && panel ? panel.width / frame.width : 0,
      panelHeightRatio: frame && panel ? panel.height / frame.height : 0,
      tabs: tabsRect
        ? {
            left: tabsRect.left,
            top: tabsRect.top,
            right: tabsRect.right,
            bottom: tabsRect.bottom,
            width: tabsRect.width,
            height: tabsRect.height,
            clientWidth: tabs.clientWidth,
            clientHeight: tabs.clientHeight,
            scrollWidth: tabs.scrollWidth,
            scrollHeight: tabs.scrollHeight,
            tabRects,
          }
        : null,
      content: contentRect
        ? {
            left: contentRect.left,
            top: contentRect.top,
            right: contentRect.right,
            bottom: contentRect.bottom,
            width: contentRect.width,
            height: contentRect.height,
            clientWidth: content.clientWidth,
            clientHeight: content.clientHeight,
            scrollWidth: content.scrollWidth,
            scrollHeight: content.scrollHeight,
            scrollTop: content.scrollTop,
          }
        : null,
      hasHeaderTitle: Boolean(document.querySelector('[data-testid="settings-screen"] > header h2')),
      hasHeaderClose: Boolean(document.querySelector('[data-testid="back-to-main-menu"]')),
      finishClickable: Boolean(hit && finish && (hit === finish || finish.contains(hit))),
      hasSideRollbackSettings: /桌面侧边回退|移动端侧边回退/.test(document.querySelector(".settings-content")?.textContent ?? ""),
      screenHorizontalOverflow: (() => {
        const element = document.querySelector('[data-testid="settings-screen"]');
        return element ? element.scrollWidth - element.clientWidth : Number.POSITIVE_INFINITY;
      })(),
      documentHorizontalOverflow: document.documentElement.scrollWidth - innerWidth,
    };
  });
}

function nearRect(left, right, tolerance = 3) {
  return Boolean(left && right
    && Math.abs(left.left - right.left) <= tolerance
    && Math.abs(left.top - right.top) <= tolerance
    && Math.abs(left.width - right.width) <= tolerance
    && Math.abs(left.height - right.height) <= tolerance);
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.rmSync(path.join(outputDir, "error.txt"), { force: true });
  const payload = fixture();
  const vite = spawn("cmd.exe", ["/d", "/s", "/c", `npm run dev -- --host 127.0.0.1 --port ${port}`], {
    cwd: runtimeRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let viteLog = "";
  vite.stdout.on("data", (chunk) => { viteLog += chunk; });
  vite.stderr.on("data", (chunk) => { viteLog += chunk; });
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  const results = {};
  const check = (condition, message, details) => {
    if (!condition) failures.push({ message, details });
  };
  try {
    await waitForServer();
    for (const viewport of [
      { name: "reported-2608x1200", width: 2608, height: 1200, android: true },
      { name: "android-webview-732x330", width: 732, height: 330, android: true },
      { name: "android-settings-915x412", width: 915, height: 412, android: true },
      { name: "android-settings-1920x864", width: 1920, height: 864, android: true },
      { name: "wide-desktop", width: 1440, height: 900, android: false },
      { name: "narrow-browser", width: 390, height: 844, android: false },
      { name: "reentry-first-portrait", width: 720, height: 1280, android: true, firstPortrait: true },
    ]) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
        // Large Android WebViews report a normal CSS viewport even when the
        // device uses a high physical resolution. Chromium's phone-emulation
        // scaling would keep the old layout viewport after setViewportSize,
        // which is not the native WebView resume behavior under test here.
        isMobile: viewport.android && viewport.width <= 900,
        hasTouch: viewport.android,
        userAgent: viewport.android ? androidUserAgent : undefined,
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      try {
        await initialize(page, payload, viewport.name, { allowHiddenTitle: viewport.firstPortrait });
        const title = await sampleTitle(page);
        if (viewport.firstPortrait) {
          check(
            title.viewportReady === "false" && title.viewportPhase !== "stable",
            `${viewport.name}: initial portrait viewport was rendered before Android surface became landscape`,
            title,
          );
          await page.setViewportSize({ width: 1280, height: 720 });
          await page.evaluate(() => {
            window.dispatchEvent(new CustomEvent("agentvn:android-surface-ready"));
            window.dispatchEvent(new CustomEvent("agentvn:android-resume"));
            window.dispatchEvent(new Event("resize"));
          });
          await page.waitForTimeout(700);
          const recovered = await sampleTitle(page);
          check(
            recovered.viewportReady === "true" && recovered.orientation === "landscape",
            `${viewport.name}: Android did not become ready after landscape surface recovery`,
            { title, recovered },
          );
        }
        check(title.visibleTitleCount === 0, `${viewport.name}: configured title background still shows the game title`, title);
        check(title.visibleDescriptionCount === 0, `${viewport.name}: configured title background still shows the game description`, title);
        check(title.visibleIconCount === 0, `${viewport.name}: configured title background still shows the game icon`, title);
        check(title.titleMaskCount === 0, `${viewport.name}: deleted title mask was recreated`, title);
        const customTitleButton = title.controls.find((item) => item.componentId === "title_custom_button_frame_edge");
        check(Boolean(customTitleButton?.rect), `${viewport.name}: custom title button is missing`, title);
        check(
          Boolean(title.frame && customTitleButton?.rect
            && customTitleButton.rect.left >= title.frame.left - 1
            && customTitleButton.rect.top >= title.frame.top - 1
            && customTitleButton.rect.right <= title.frame.right + 1
            && customTitleButton.rect.bottom <= title.frame.bottom + 1),
          `${viewport.name}: custom title button escaped the authored frame`,
          { title, customTitleButton },
        );
        check(
          Boolean(title.frame && customTitleButton?.rect
            && Math.abs(customTitleButton.rect.height - title.frame.height * 0.0675) <= 2),
          `${viewport.name}: touch minimum changed the custom button visual height`,
          { title, customTitleButton },
        );
        check(title.horizontalOverflow <= 1, `${viewport.name}: title page has horizontal overflow`, title);

        let resume;
        if (viewport.android && viewport.width > viewport.height) {
          await page.evaluate(() => {
            Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
            document.dispatchEvent(new Event("visibilitychange"));
          });
          await page.setViewportSize({ width: viewport.height, height: viewport.width });
          await page.evaluate(() => {
            Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
            document.dispatchEvent(new Event("visibilitychange"));
            window.dispatchEvent(new CustomEvent("agentvn:android-resume"));
            window.dispatchEvent(new Event("focus"));
            window.dispatchEvent(new Event("resize"));
          });
          await page.waitForTimeout(220);
          const duringTransientPortrait = await sampleTitle(page);
          check(
            duringTransientPortrait.orientation === "landscape"
              && nearRect(title.frame, duringTransientPortrait.frame)
              && nearRect(title.background, duringTransientPortrait.background)
              && nearRect(title.actions, duringTransientPortrait.actions),
            `${viewport.name}: lock-screen resume accepted a transient portrait viewport`,
            { before: title, duringTransientPortrait },
          );
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          await page.evaluate(() => {
            window.dispatchEvent(new CustomEvent("agentvn:android-resume"));
            window.dispatchEvent(new Event("resize"));
          });
          await page.waitForTimeout(700);
          const afterLandscapeRestore = await sampleTitle(page);
          check(
            afterLandscapeRestore.orientation === "landscape"
              && nearRect(title.frame, afterLandscapeRestore.frame)
              && nearRect(title.background, afterLandscapeRestore.background)
              && nearRect(title.actions, afterLandscapeRestore.actions),
            `${viewport.name}: title geometry did not recover after screen unlock`,
            { before: title, afterLandscapeRestore },
          );
          resume = { duringTransientPortrait, afterLandscapeRestore };
        }

        await page.locator('[data-testid="open-settings"]:visible').click();
        await page.locator('[data-testid="settings-screen"]:visible').waitFor({ state: "visible", timeout: 20_000 });
        await waitForTransition(page);
        await page.locator(".settings-tabs button").filter({ hasText: "系统" }).click();
        const settings = await sampleSettings(page);
        check(settings.panelInsideFrame, `${viewport.name}: settings panel escaped the authored frame`, settings);
        if (viewport.width > viewport.height) {
          check(settings.panelWidthRatio >= 0.92, `${viewport.name}: settings page is still a narrow centered panel`, settings);
          check(settings.panelHeightRatio >= 0.84, `${viewport.name}: settings page does not fill the frame vertically`, settings);
          check(
            Boolean(settings.tabs && settings.tabs.scrollHeight <= settings.tabs.clientHeight + 1),
            `${viewport.name}: settings category rail is vertically clipped or scrollable in a normal landscape viewport`,
            settings,
          );
          check(
            Boolean(settings.tabs && settings.tabs.scrollWidth <= settings.tabs.clientWidth + 1),
            `${viewport.name}: settings category rail has horizontal overflow in a normal landscape viewport`,
            settings,
          );
          check(
            Boolean(settings.tabs && settings.panel && settings.tabs.tabRects.every((tab) =>
              tab.top >= settings.panel.top - 1
              && tab.bottom <= settings.panel.bottom + 1
              && tab.left >= settings.panel.left - 1
              && tab.right <= settings.panel.right + 1)),
            `${viewport.name}: one or more settings categories are clipped by the panel`,
            settings,
          );
          check(
            Boolean(settings.content && settings.content.scrollWidth <= settings.content.clientWidth + 1),
            `${viewport.name}: settings content has horizontal overflow`,
            settings,
          );
        }
        check(!settings.hasHeaderTitle, `${viewport.name}: settings page still renders the removed header title`, settings);
        check(!settings.hasHeaderClose, `${viewport.name}: settings page still renders the removed header close button`, settings);
        check(!settings.hasSideRollbackSettings, `${viewport.name}: settings page still exposes the unrequested side rollback controls`, settings);
        check(settings.finishClickable, `${viewport.name}: settings finish button is not clickable`, settings);
        check(
          settings.panel && settings.frame && settings.panel.top <= settings.frame.top + Math.max(24, settings.frame.height * 0.08),
          `${viewport.name}: settings panel did not move up into the authored frame`,
          settings,
        );
        check(settings.screenHorizontalOverflow <= 1, `${viewport.name}: settings screen has horizontal overflow`, settings);
        check(settings.documentHorizontalOverflow <= 1, `${viewport.name}: settings page caused document overflow`, settings);
        check(errors.length === 0, `${viewport.name}: runtime emitted browser errors`, errors);

        results[viewport.name] = { viewport, title, resume, settings, errors };
        await page.screenshot({ path: path.join(outputDir, `${viewport.name}.png`) });
      } finally {
        await page.close();
      }
    }
    const report = { ok: failures.length === 0, failures, results };
    fs.writeFileSync(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    if (failures.length > 0) {
      throw new Error(`runtime shell mobile regressions: ${failures.length} failure(s)\n${JSON.stringify(failures, null, 2)}`);
    }
    console.log(`runtime-shell-mobile-regressions-playwright: PASS (${outputDir})`);
  } finally {
    await browser.close();
    stopProcess(vite);
    fs.writeFileSync(path.join(outputDir, "vite.log"), viteLog, "utf8");
  }
})().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "error.txt"), String(error.stack || error), "utf8");
  console.error(error.stack || error);
  process.exitCode = 1;
});
