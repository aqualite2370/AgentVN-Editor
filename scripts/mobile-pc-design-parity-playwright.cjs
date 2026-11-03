#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const runtimeRoot = path.join(root, "GameCli_framework");
const outputDir = path.join(root, "output", "playwright", "mobile-pc-design-parity");
const port = Number(process.env.AGENTVN_GAMECLI_TEST_PORT || 6871);
const runtimeUrl = `http://127.0.0.1:${port}/?mode=preview`;

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`);
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
      "Access-Control-Allow-Origin": `http://127.0.0.1:${port}`,
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

function fixture() {
  const now = new Date().toISOString();
  const titleButton = (id, type, y, mobileX, mobileY) => ({
    component_id: id,
    component_type: type,
    required: true,
    rect: { x: 72, y, width: 20, height: 7 },
    mobileRect: { x: mobileX, y: mobileY, width: 42, height: 12 },
    style: { backgroundColor: "#182234", borderRadius: 8, color: "#f8fbff", fontWeight: 800 },
  });
  return {
    manifest: {
      manifest_version: "1.0.0",
      cartridge_version: "1.0.0",
      runtime_version: "0.6.0",
      game_id: "mobile-pc-design-parity",
      title: "移动端 PC 设计一致性",
      author: "AgentVN QA",
      version: "1.0.0",
      description: "移动端必须复用 PC authored layout。",
      language: "zh-CN",
      entry_script: "script.json",
      entry_scene_id: "scene_main",
      assets: [],
      created_at: now,
      updated_at: now,
    },
    script: {
      schema_version: "1.5.0",
      game_id: "mobile-pc-design-parity",
      title: "移动端 PC 设计一致性",
      entry_scene_id: "scene_main",
      characters: [{ character_id: "tester", name: "测试角色" }],
      scenes: [{
        scene_id: "scene_main",
        title: "Main",
        chapter: 1,
        tags: [],
        commands: [
          { type: "dialog", character_id: "tester", speaker: "测试角色", text: "移动端必须使用与 PC 完全相同的对白、按钮和快捷菜单设计。" },
          { type: "narration", text: "用于保持播放状态。" },
        ],
      }],
    },
    uiSkin: {
      ui_layout_version: "1.3.0",
      name: "PC parity skin",
      target_runtime: "0.6.0",
      assets: [],
      tokens: {
        colorBackground: "#071018",
        colorSurface: "#121c28",
        colorSurfaceStrong: "#1c2b3a",
        colorInk: "#f4f8ff",
        colorMuted: "#aab7c6",
        colorAccent: "#8cb2d0",
        colorAccent2: "#c8a379",
        colorLine: "#8ea5ba",
        colorControl: "#1c2b3a",
        colorControlHover: "#294054",
        colorControlActive: "#8cb2d0",
        colorControlText: "#f4f8ff",
        colorQuickMenu: "#121c28",
        colorFocus: "#a6c8df",
        radius: 12,
      },
      screens: [
        {
          screen_id: "title",
          components: [
            { component_id: "title_hero", component_type: "main_menu_hero", rect: { x: 8, y: 18, width: 48, height: 38 }, mobileRect: { x: 2, y: 2, width: 96, height: 25 } },
            titleButton("title_continue_button", "main_menu_continue_button", 30, 5, 54),
            titleButton("title_start_button", "main_menu_start_button", 40, 5, 66),
            titleButton("title_save_load_button", "main_menu_save_load_button", 50, 5, 78),
            titleButton("title_gallery_button", "main_menu_gallery_button", 60, 52, 54),
            titleButton("title_settings_button", "main_menu_settings_button", 70, 52, 66),
            titleButton("title_about_button", "main_menu_about_button", 80, 52, 78),
          ],
        },
        {
          screen_id: "player",
          components: [
            { component_id: "stage_background", component_type: "stage_background", rect: { x: 0, y: 0, width: 100, height: 100 }, mobileRect: { x: 0, y: 0, width: 100, height: 100 } },
            { component_id: "dialog_panel", component_type: "dialog_panel", rect: { x: 7, y: 69, width: 86, height: 22 }, mobileRect: { x: 3, y: 62, width: 94, height: 30 }, style: { backgroundColor: "rgba(7,12,20,.78)", borderRadius: 8, padding: 12 } },
            { component_id: "speaker_label", component_type: "speaker_label", rect: { x: 9, y: 65, width: 17, height: 5.5 }, mobileRect: { x: 4, y: 58, width: 36, height: 7 } },
            { component_id: "dialog_text", component_type: "dialog_text", rect: { x: 10, y: 74, width: 76, height: 11 }, mobileRect: { x: 6, y: 70, width: 88, height: 15 } },
            { component_id: "continue_indicator", component_type: "continue_indicator", rect: { x: 80, y: 87, width: 14, height: 6 }, mobileRect: { x: 82, y: 88, width: 12, height: 5 } },
            { component_id: "quick_menu", component_type: "quick_menu", rect: { x: 98, y: 2, width: 42, height: 9, anchor: "top_right" }, mobileRect: { x: 90, y: 12, width: 54, height: 12, anchor: "top_right" }, style: { quickMenuVariant: "C", quickMenuDirection: "up", borderRadius: 16, padding: 4, gap: 3 } },
          ],
        },
      ],
    },
  };
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

async function initialize(page, payload, sessionId) {
  await page.goto(runtimeUrl, { waitUntil: "domcontentloaded" });
  const message = {
    type: "agentvn.live-preview.init",
    protocolVersion: 2,
    sessionId: sessionId,
    revision: 1,
    requestId: `${sessionId}-init`,
    runId: `${sessionId}-run`,
    manifest: payload.manifest,
    script: payload.script,
    uiSkin: payload.uiSkin,
    assetUrls: {},
    start: {
      requestId: `${sessionId}-start`,
      target: { sceneId: payload.manifest.entry_scene_id, commandIndex: 0 },
      entryPath: [],
      mode: "stable_frame",
      playbackRate: 1,
      reducedMotion: true,
    },
    screen: "title_menu",
  };
  const target = page.locator('[data-testid="game-state-title"]:visible');
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.evaluate((nextMessage) => window.postMessage(nextMessage, window.location.origin), message);
    if (await target.isVisible().catch(() => false)) break;
    await target.waitFor({ state: "visible", timeout: 6_000 }).catch(() => undefined);
    if (await target.isVisible().catch(() => false)) break;
  }
  await target.waitFor({ state: "visible", timeout: 30_000 }).catch(async (error) => {
    const debug = await page.evaluate(() => ({
      body: document.body.innerText,
      root: document.querySelector("#root")?.innerHTML?.slice(0, 3000),
      errors: window.__AGENTVN_RUNTIME_DIAGNOSTICS__ ?? null,
    })).catch(() => null);
    await page.screenshot({ path: path.join(outputDir, `${sessionId}-initialize-timeout.png`) }).catch(() => {});
    throw new Error(`mobile-pc initialize failed: ${JSON.stringify(debug)}`, { cause: error });
  });
  await page.waitForTimeout(250);
}

async function sampleTitle(page) {
  return page.evaluate(() => {
    const frame = document.querySelector(".runtime-layout-frame");
    const scope = document.querySelector(".ui-skin-scope");
    const actions = document.querySelector(".menu-actions");
    const rect = (element) => {
      const value = element?.getBoundingClientRect();
      return value ? { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height } : null;
    };
    const controls = [...document.querySelectorAll(".menu-action-button")].filter((element) => getComputedStyle(element).display !== "none");
    return {
      breakpoint: scope?.getAttribute("data-ui-breakpoint"),
      formFactor: scope?.getAttribute("data-ui-form-factor"),
      textScale: scope?.getAttribute("data-ui-text-scale"),
      frame: rect(frame),
      scrollWidth: document.documentElement.scrollWidth,
      controls: controls.map((element) => ({
        id: element.getAttribute("data-ui-component-id"),
        source: element.getAttribute("data-ui-layout-source"),
        style: {
          left: element.style.left,
          top: element.style.top,
          width: element.style.width,
          height: element.style.height,
        },
        rect: rect(element),
      })),
      actionsDisplay: actions ? getComputedStyle(actions).display : null,
      actionsPosition: actions ? getComputedStyle(actions).position : null,
      heroBackground: (() => {
        const element = document.querySelector(".main-menu-title-hero-background");
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
      })(),
    };
  });
}

async function samplePlayer(page) {
  return page.evaluate(() => {
    const frame = document.querySelector(".runtime-layout-frame");
    const compact = (element) => {
      if (!element) return null;
      const style = getComputedStyle(element);
      const value = element.getBoundingClientRect();
      return {
        rect: { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height },
        style: { left: element.style.left, top: element.style.top, width: element.style.width, height: element.style.height, position: style.position, transform: style.transform },
      };
    };
    const inside = (child, parent) => Boolean(child && parent && child.left >= parent.left - 2 && child.top >= parent.top - 2 && child.right <= parent.right + 2 && child.bottom <= parent.bottom + 2);
    const frameRect = frame?.getBoundingClientRect();
    const frameBounds = frameRect && { left: frameRect.left, top: frameRect.top, right: frameRect.right, bottom: frameRect.bottom };
    const controls = [...document.querySelectorAll(".dialog-box, .speaker, .dialog-text, .continue-indicator, .playback-controls")];
    return {
      breakpoint: document.querySelector(".ui-skin-scope")?.getAttribute("data-ui-breakpoint"),
      frame: compact(frame),
      frameBounds,
      dialog: compact(document.querySelector(".dialog-box")),
      speaker: compact(document.querySelector(".speaker")),
      text: compact(document.querySelector(".dialog-text")),
      continue: compact(document.querySelector(".continue-indicator")),
      quickMenu: compact(document.querySelector(".playback-controls")),
      quickMenuSource: document.querySelector(".playback-controls")?.getAttribute("data-ui-layout-source"),
      quickMenuBreakpoint: document.querySelector(".playback-controls")?.getAttribute("data-quick-menu-breakpoint"),
      quickMenuColumns: document.querySelector(".playback-controls")?.getAttribute("data-quick-menu-columns"),
      quickMenuRows: document.querySelector(".playback-controls")?.getAttribute("data-quick-menu-rows"),
      allControlsInsideFrame: controls.every((element) => inside(element.getBoundingClientRect(), frameBounds)),
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
}

function assertSharedAuthoredRects(sampled, expected, label) {
  for (const item of sampled.controls) {
    const rect = expected.find((candidate) => candidate.id === item.id);
    assert(rect, `${label}: unexpected title control ${item.id}`, item);
    assert(item.source === "desktop" || item.source === "safe_clamped", `${label}: mobile control still uses mobile layout source`, item);
    for (const [styleKey, rectKey] of [["left", "x"], ["top", "y"], ["width", "width"], ["height", "height"]]) {
      assert(item.style[styleKey] === `${rect[rectKey]}%`, `${label}: ${item.id} did not reuse PC ${styleKey}`, { item, expected: rect });
    }
  }
}

function stopVite(child) {
  stopProcess(child);
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const payload = fixture();
  const expectedTitleRects = [
    { id: "title_continue_button", x: 72, y: 30, width: 20, height: 7 },
    { id: "title_start_button", x: 72, y: 40, width: 20, height: 7 },
    { id: "title_save_load_button", x: 72, y: 50, width: 20, height: 7 },
    { id: "title_gallery_button", x: 72, y: 60, width: 20, height: 7 },
    { id: "title_settings_button", x: 72, y: 70, width: 20, height: 7 },
    { id: "title_about_button", x: 72, y: 80, width: 20, height: 7 },
  ];
  const staticServer = await startStatic(path.join(root, "output", "empty"));
  const vite = spawn("cmd.exe", ["/d", "/s", "/c", `npm run dev -- --host 127.0.0.1 --port ${port}`], {
    cwd: runtimeRoot,
    windowsHide: true,
    stdio: "ignore",
  });
  const browser = await chromium.launch({ headless: true });
  const results = {};
  try {
    await waitForServer();
    for (const viewport of [
      { name: "reported-757x299", width: 757, height: 299, mobile: true },
      { name: "wide-desktop", width: 1440, height: 900, mobile: false },
      { name: "narrow-mobile", width: 390, height: 844, mobile: true },
    ]) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.mobile,
        hasTouch: viewport.mobile,
        // Browser parity covers responsive handheld Web layout. Native
        // Android landscape locking is exercised by the Androiddev suite.
        userAgent: viewport.mobile ? "Mozilla/5.0 (Mobile; AgentVN QA) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36" : undefined,
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      const sessionId = `mobile-pc-design-${viewport.name}`;
      await initialize(page, payload, sessionId);
      await page.locator(".menu-actions:visible").waitFor({ state: "visible", timeout: 10_000 });
      const title = await sampleTitle(page);
      if (viewport.mobile) {
        assert(title.breakpoint === "desktop" && title.formFactor === "handheld", `${viewport.name}: mobile viewport did not keep the PC design breakpoint`, title);
      } else {
        assert(title.breakpoint === "desktop" && title.formFactor === "desktop", `${viewport.name}: desktop viewport detection changed`, title);
      }
      assertSharedAuthoredRects(title, expectedTitleRects, viewport.name);
      assert(title.actionsDisplay === "block" && title.actionsPosition === "absolute", `${viewport.name}: title actions changed to responsive flow layout`, title);
      assert(title.frame, `${viewport.name}: title frame is missing`, title);
      assert(
        Math.abs(title.frame.width / title.frame.height - 16 / 9) < 0.01,
        `${viewport.name}: title frame lost 16:9 aspect ratio`,
        title,
      );
      if (title.heroBackground) {
        assert(
          title.heroBackground.left >= title.frame.left - 1
            && title.heroBackground.top >= title.frame.top - 1
            && title.heroBackground.right <= title.frame.right + 1
            && title.heroBackground.bottom <= title.frame.bottom + 1
            && title.heroBackground.width >= title.frame.width * 0.97
            && title.heroBackground.height >= title.frame.height * 0.97,
          `${viewport.name}: title hero background does not cover the authored frame`,
          title,
        );
      }
      assert(title.scrollWidth <= viewport.width + 1, `${viewport.name}: title introduced horizontal overflow`, title);

      await page.locator('[data-testid="start-new-game"]:visible').click();
      await page.locator('[data-testid="game-state-playing"]').waitFor({ state: "visible", timeout: 15_000 });
      await page.waitForTimeout(300);
      const player = await samplePlayer(page);
      assert(player.quickMenuSource === "runtime-fixed", `${viewport.name}: quick menu must use fixed runtime geometry`, player);
      assert(player.quickMenuBreakpoint === "desktop", `${viewport.name}: quick menu metrics still use mobile breakpoint`, player);
      assert(player.quickMenuColumns === "1" && player.quickMenuRows === "8", `${viewport.name}: PC quick-menu C geometry changed`, player);
      assert(player.allControlsInsideFrame, `${viewport.name}: player controls escaped the authored frame`, player);
      assert(player.scrollWidth <= viewport.width + 1, `${viewport.name}: player introduced horizontal overflow`, player);

      assert(errors.length === 0, `${viewport.name}: runtime errors`, errors);
      results[viewport.name] = { viewport, title, player, errors };
      await page.screenshot({ path: path.join(outputDir, `${viewport.name}.png`) });
      await page.close();
    }
    fs.writeFileSync(path.join(outputDir, "report.json"), `${JSON.stringify({ ok: true, results }, null, 2)}\n`, "utf8");
    console.log(`mobile-pc-design-parity-playwright: PASS (${outputDir})`);
  } finally {
    await browser.close();
    staticServer.close();
    stopVite(vite);
  }
})().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "error.txt"), String(error.stack || error), "utf8");
  console.error(error.stack || error);
  process.exitCode = 1;
});
