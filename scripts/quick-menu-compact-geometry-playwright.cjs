#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const runtimeRoot = path.join(root, "GameCli_framework");
const outputDir = path.join(root, "output", "playwright", "quick-menu-compact-geometry");
const url = "http://127.0.0.1:6868/?mode=preview";

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`);
}

function fixture() {
  const now = new Date().toISOString();
  return {
    manifest: { manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.6.0", game_id: "compact-geometry", title: "Compact", author: "QA", version: "1.0.0", description: "", language: "zh-CN", entry_script: "script.json", entry_scene_id: "scene_main", assets: [], created_at: now, updated_at: now },
    script: { schema_version: "1.5.0", game_id: "compact-geometry", title: "Compact", entry_scene_id: "scene_main", characters: [], scenes: [{ scene_id: "scene_main", title: "Main", chapter: 1, tags: [], commands: [{ type: "narration", text: "测试" }] }] },
    uiSkin: { ui_layout_version: "1.2.0", name: "Compact", target_runtime: "0.6.0", assets: [], tokens: { colorBackground: "#060812", colorSurface: "#0d121f", colorSurfaceStrong: "#192234", colorInk: "#f6f8ff", colorMuted: "#aeb9cc", colorAccent: "#82b6ff", colorAccent2: "#f2a0c4", colorLine: "#d8e2ff", colorControl: "#192234", colorControlHover: "#24324d", colorControlActive: "#82b6ff", colorControlText: "#f6f8ff", colorQuickMenu: "#0d121f", colorFocus: "#82b6ff", radius: 10 }, screens: [{ screen_id: "player", components: [{ component_id: "dialog_panel", component_type: "dialog_panel", required: true, rect: { x: 6, y: 76, width: 88, height: 18 } }, { component_id: "choice_list", component_type: "choice_list", required: true, rect: { x: 50, y: 44, width: 34, height: 32, anchor: "center" } }, { component_id: "quick_menu", component_type: "quick_menu", required: true, rect: { x: 98, y: 2, width: 42, height: 9, anchor: "top_right" }, mobileRect: { x: 98, y: 2, width: 50, height: 10, anchor: "top_right" }, style: { quickMenuVariant: "C", quickMenuDirection: "auto" } }] }] },
  };
}

async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("GameCLI server did not become ready");
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const vite = spawn("cmd.exe", ["/d", "/s", "/c", "npm run dev"], { cwd: runtimeRoot, windowsHide: true, stdio: "ignore" });
  const browser = await chromium.launch({ headless: true });
  try {
    await waitForServer();
    const results = [];
    for (const viewport of [{ name: "android", width: 2400, height: 1080 }, { name: "full-hd", width: 1920, height: 1080 }, { name: "desktop", width: 1440, height: 900 }, { name: "laptop", width: 1280, height: 800 }, { name: "wide", width: 2560, height: 1392 }, { name: "reported-757x299", width: 757, height: 299 }, { name: "small", width: 640, height: 360 }, { name: "narrow", width: 390, height: 844 }, { name: "high-dpi", width: 757, height: 299, deviceScaleFactor: 2 }]) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.name === "narrow" || viewport.name === "android",
        hasTouch: true,
        userAgent: viewport.name === "android" ? "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/132 Mobile Safari/537.36" : undefined,
        deviceScaleFactor: viewport.deviceScaleFactor || 1,
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.stack || error.message));
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.evaluate((payload) => window.postMessage({ type: "agentvn.live-preview.init", protocolVersion: 2, sessionId: "compact", revision: 1, requestId: "compact", runId: "compact", manifest: payload.manifest, script: payload.script, uiSkin: payload.uiSkin, assetUrls: {}, start: { requestId: "compact", target: { sceneId: "scene_main", commandIndex: 0 }, entryPath: [], mode: "stable_frame", playbackRate: 1, reducedMotion: true }, screen: "playing" }, "*"), fixture());
      const toggle = page.getByTestId("quick-menu-toggle");
      await toggle.waitFor({ state: "visible", timeout: 20000 }).catch(async (error) => {
        const body = await page.locator("body").innerText().catch(() => "");
        throw new Error(`${error.message}\nRuntime body:\n${body.slice(0, 1200)}`);
      });
      const initialToggle = await toggle.boundingBox();
      const dialog = await page.locator('.dialog-box').boundingBox();
      assert(dialog, `${viewport.name}: dialog box is missing`, { initialToggle });
      const dialogAnchor = {
        right: dialog.x + dialog.width,
        top: dialog.y,
      };
      assert(
        Math.abs(initialToggle.x + initialToggle.width - dialogAnchor.right) <= 1
          && Math.abs(dialogAnchor.top - (initialToggle.y + initialToggle.height) - 8) <= 1,
        `${viewport.name}: initial toggle must stay outside and above the dialog top-right`,
        { initialToggle, dialog: dialogAnchor },
      );
      await toggle.tap();
      await page.waitForFunction(() => document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute("aria-expanded") === "true");
      await page.waitForTimeout(520);
      const expandedToggle = await toggle.boundingBox();
      assert(Math.abs(initialToggle.x - expandedToggle.x) <= 1 && Math.abs(initialToggle.y - expandedToggle.y) <= 1, `${viewport.name}: touching expand moves the toggle`, { initialToggle, expandedToggle });
      const metrics = await page.evaluate(() => {
        const menu = document.querySelector(".quick-menu-surface");
        const actions = [...document.querySelectorAll(".quick-menu-button")];
        const toggleNode = document.querySelector('[data-testid="quick-menu-toggle"]');
        const rect = (node) => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
        const controls = document.querySelector(".playback-controls");
        const actionLayer = document.querySelector(".quick-menu-action-layer");
        const menuStyle = getComputedStyle(menu);
        const rootStyle = controls ? getComputedStyle(controls) : null;
        const actionStyle = actionLayer ? getComputedStyle(actionLayer) : null;
        return { viewport: { width: innerWidth, height: innerHeight }, variant: controls?.getAttribute("data-quick-menu-variant"), direction: controls?.getAttribute("data-quick-menu-direction"), columns: Number(controls?.getAttribute("data-quick-menu-columns")), rows: Number(controls?.getAttribute("data-quick-menu-rows")), vars: rootStyle ? Object.fromEntries(["--runtime-quick-menu-drawer-width", "--runtime-quick-menu-drawer-height", "--runtime-quick-menu-action-visual-width", "--runtime-quick-menu-action-visual-height", "--runtime-quick-menu-action-hit-size"].map((key) => [key, rootStyle.getPropertyValue(key)])) : {}, display: menuStyle.display, flexDirection: menuStyle.flexDirection, actionLayout: actionStyle ? { ...rect(actionLayer), widthCss: Number.parseFloat(actionStyle.width), gap: Number.parseFloat(actionStyle.columnGap), paddingLeft: Number.parseFloat(actionStyle.paddingLeft), paddingRight: Number.parseFloat(actionStyle.paddingRight) } : null, menu: rect(menu), toggle: rect(toggleNode), actions: actions.map((node) => ({ ...rect(node), display: getComputedStyle(node).display, widthCss: Number.parseFloat(getComputedStyle(node).width), heightCss: Number.parseFloat(getComputedStyle(node).height), flex: getComputedStyle(node).flex, transform: getComputedStyle(node).transform })), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, errors: window.__AGENTVN_QA_CONSOLE_ERRORS__ || [] };
      });
      const visibility = await page.evaluate(() => {
        const layer = document.querySelector('.quick-menu-action-layer');
        const buttons = [...document.querySelectorAll('.quick-menu-button'), document.querySelector('[data-testid="quick-menu-toggle"]')];
        return {
          scrollHeight: layer.scrollHeight, clientHeight: layer.clientHeight,
          scrollWidth: layer.scrollWidth, clientWidth: layer.clientWidth,
          hit: buttons.map(node => {
            const r = node.getBoundingClientRect();
            return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
          }),
        };
      });
      const intersects = (left, right) => left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
      assert(metrics.menu.width <= Math.min(360, viewport.width - 24), `${viewport.name}: drawer is too wide`, metrics);
      assert(metrics.variant === "C" && metrics.columns === 1 && metrics.actions.length === 7, `${viewport.name}: drawer must have seven single-column actions`, metrics);
      assert(visibility.scrollHeight <= visibility.clientHeight + 1 && visibility.scrollWidth <= visibility.clientWidth + 1, `${viewport.name}: all seven actions must fit without internal scrolling`, visibility);
      assert(visibility.hit.length === 8 && visibility.hit.every(Boolean), `${viewport.name}: all seven actions and collapse must be hit-testable simultaneously`, visibility);
      const expectedActionWidth = (
        metrics.actionLayout.widthCss
        - metrics.actionLayout.paddingLeft
        - metrics.actionLayout.paddingRight
        - metrics.actionLayout.gap * (metrics.columns - 1)
      ) / metrics.columns;
      assert(metrics.actions.every((item) => item.widthCss <= expectedActionWidth + 1 && item.heightCss > 0), `${viewport.name}: C action rows exceed their scaled grid tracks`, metrics);
      assert(metrics.actions.every((item) => item.left >= metrics.menu.left - 1 && item.right <= metrics.menu.right + 1 && item.top >= metrics.menu.top - 1 && item.bottom <= metrics.menu.bottom + 1), `${viewport.name}: C action leaves the drawer surface`, metrics);
      assert(!metrics.actions.some((item, index) => metrics.actions.slice(index + 1).some((other) => intersects(item, other))), `${viewport.name}: C action rows overlap`, metrics);
      assert(!metrics.actions.some((item) => intersects(item, metrics.toggle)), `${viewport.name}: C action row overlaps the close toggle`, metrics);
      assert(metrics.toggle.width > 0 && metrics.toggle.height > 0, `${viewport.name}: collapse toggle has no hit area`, metrics);
      assert([metrics.menu, metrics.toggle].every(item => item.left >= -1 && item.top >= -1 && item.right <= viewport.width + 1 && item.bottom <= viewport.height + 1), `${viewport.name}: menu leaves viewport`, metrics);
      for (const button of await page.locator('.quick-menu-button:not(:disabled)').all()) await button.click({ trial: true });
      const autoButton = page.locator('[data-ui-component-id="quick_auto_button"]');
      const beforeAuto = await autoButton.boundingBox();
      await autoButton.tap();
      await autoButton.tap();
      const afterAuto = await autoButton.boundingBox();
      assert(Math.abs(beforeAuto.x - afterAuto.x) <= 1 && Math.abs(beforeAuto.y - afterAuto.y) <= 1, `${viewport.name}: action tap moves buttons`, { beforeAuto, afterAuto });
      if (viewport.name === 'android') {
        const beforeRecovery = await toggle.boundingBox();
        await page.evaluate(() => {
          window.__originalInnerWidthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');
          Object.defineProperty(window, 'innerWidth', { configurable: true, value: innerWidth - 800 });
          window.dispatchEvent(new Event('resize'));
        });
        await page.waitForTimeout(350);
        await autoButton.tap();
        await autoButton.tap();
        const afterRecovery = await toggle.boundingBox();
        assert(Math.abs(beforeRecovery.x - afterRecovery.x) <= 1 && Math.abs(beforeRecovery.y - afterRecovery.y) <= 1, 'Android stale innerWidth changed placement while visual viewport stayed stable', { beforeRecovery, afterRecovery });
        await page.evaluate(() => Object.defineProperty(window, 'innerWidth', window.__originalInnerWidthDescriptor));
      }
      assert(metrics.overflow <= 1, `${viewport.name}: quick menu overflows viewport`, metrics);
      assert(errors.length === 0, `${viewport.name}: runtime errors`, errors);
      await page.screenshot({ path: path.join(outputDir, `${viewport.name}.png`) });
      await toggle.click();
      await page.waitForTimeout(300);
      const collapsedAgain = await toggle.boundingBox();
      assert(Math.abs(initialToggle.x - collapsedAgain.x) <= 1 && Math.abs(initialToggle.y - collapsedAgain.y) <= 1, `${viewport.name}: collapse loses authored position`, { initialToggle, collapsedAgain });
      assert(await page.locator('.quick-menu-button').evaluateAll(nodes => nodes.every(node => node.tabIndex === -1 && getComputedStyle(node).pointerEvents === 'none')), `${viewport.name}: collapsed actions remain focusable or clickable`);
      results.push({ viewport, metrics, visibility });
      await page.close();
    }
    fs.writeFileSync(path.join(outputDir, "report.json"), JSON.stringify({ ok: true, results }, null, 2));
    console.log(`quick-menu-compact-geometry-playwright: PASS (${outputDir})`);
  } finally {
    await browser.close();
    try { spawnSync("taskkill.exe", ["/PID", String(vite.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch { vite.kill(); }
  }
})().catch((error) => { fs.writeFileSync(path.join(outputDir, "error.txt"), String(error.stack || error)); console.error(error.stack || error); process.exitCode = 1; });
