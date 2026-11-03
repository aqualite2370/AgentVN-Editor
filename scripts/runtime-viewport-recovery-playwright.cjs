#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const runtimeRoot = path.join(root, "GameCli_framework");
const outputDir = path.join(root, "output", "playwright", "runtime-viewport-recovery");
const baseUrl = "http://127.0.0.1:6868/?mode=preview";

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`);
}

function fixture() {
  const now = new Date().toISOString();
  return {
    manifest: {
      manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.6.0",
      game_id: "runtime-viewport-recovery", title: "视口恢复验收", author: "AgentVN QA",
      version: "1.0.0", description: "后台恢复后容器几何必须稳定。", language: "zh-CN",
      entry_script: "script.json", entry_scene_id: "scene_main", assets: [],
      created_at: now, updated_at: now,
    },
    script: {
      schema_version: "1.5.0", game_id: "runtime-viewport-recovery", title: "视口恢复验收",
      entry_scene_id: "scene_main", characters: [{ character_id: "tester", name: "测试角色" }],
      scenes: [{
        scene_id: "scene_main", title: "Main", chapter: 1, tags: [],
        commands: [
          { type: "dialog", character_id: "tester", speaker: "测试角色", text: "恢复视口后对白容器、快捷菜单和舞台比例必须保持稳定。" },
          { type: "narration", text: "第二条事件用于保持 playing 状态。" },
        ],
      }],
    },
    uiSkin: {
      ui_layout_version: "1.3.0", name: "Viewport recovery skin", target_runtime: "0.6.0", assets: [],
      tokens: {
        colorBackground: "#071018", colorSurface: "#121c28", colorSurfaceStrong: "#1c2b3a",
        colorInk: "#f4f8ff", colorMuted: "#aab7c6", colorAccent: "#8cb2d0", colorAccent2: "#c8a379",
        colorLine: "#8ea5ba", colorControl: "#1c2b3a", colorControlHover: "#294054",
        colorControlActive: "#8cb2d0", colorControlText: "#f4f8ff", colorQuickMenu: "#121c28",
        colorFocus: "#a6c8df", radius: 12,
      },
      screens: [],
    },
  };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { if ((await fetch(baseUrl)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("GameCLI Vite server did not become ready");
}

async function initialize(page, viewport) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate((payload) => {
    window.postMessage({
      type: "agentvn.live-preview.init", protocolVersion: 2,
      sessionId: `viewport-recovery-${Math.random()}`, revision: 1,
      requestId: "viewport-recovery-init", runId: "viewport-recovery-run",
      manifest: payload.manifest, script: payload.script, uiSkin: payload.uiSkin, assetUrls: {},
      start: { requestId: "viewport-recovery-start", target: { sceneId: "scene_main", commandIndex: 0 }, entryPath: [], mode: "stable_frame", playbackRate: 1, reducedMotion: true },
      screen: "playing",
    }, "*");
  }, fixture());
  await page.waitForSelector(".runtime-layout-frame", { state: "visible", timeout: 20_000 });
  await page.waitForSelector(".dialog-box", { state: "visible", timeout: 20_000 });
  await page.waitForSelector('[data-testid="quick-menu-toggle"]', { state: "visible", timeout: 20_000 });
  await page.waitForTimeout(500);
}

async function sample(page, viewport) {
  return page.evaluate(({ viewport }) => {
    const compact = (element) => {
      const rect = element?.getBoundingClientRect();
      return rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } : null;
    };
    const frame = document.querySelector(".runtime-layout-frame");
    const scope = document.querySelector(".ui-skin-scope");
    const dialog = document.querySelector(".dialog-box");
    const menu = document.querySelector(".playback-controls");
    const toggle = document.querySelector('[data-testid="quick-menu-toggle"]');
    const frameRect = compact(frame);
    const safe = frameRect ? { left: frameRect.left, top: frameRect.top, right: frameRect.right, bottom: frameRect.bottom } : null;
    const inside = (rect, bounds) => Boolean(rect && bounds && rect.left >= bounds.left - 2 && rect.top >= bounds.top - 2 && rect.right <= bounds.right + 2 && rect.bottom <= bounds.bottom + 2);
    const ratio = frameRect ? frameRect.width / Math.max(1, frameRect.height) : 0;
    return {
      viewport,
      scope: scope ? {
        breakpoint: scope.getAttribute("data-ui-breakpoint"),
        orientation: scope.getAttribute("data-ui-orientation"),
        formFactor: scope.getAttribute("data-ui-form-factor"),
      } : null,
      frame: frameRect,
      dialog: compact(dialog),
      menu: compact(menu),
      toggle: compact(toggle),
      ratio,
      frameClient: frame ? { width: frame.clientWidth, height: frame.clientHeight } : null,
      documentScrollWidth: document.documentElement.scrollWidth,
      safe,
      contained: {
        dialog: inside(compact(dialog), safe),
        menu: inside(compact(menu), safe),
        toggle: inside(compact(toggle), safe),
      },
    };
  }, { viewport });
}

function assertStable(sampled, viewport, label) {
  const portrait = viewport.height > viewport.width;
  const expectedWidth = Math.min(viewport.width, viewport.height * 16 / 9);
  const expectedHeight = expectedWidth * 9 / 16;
  if (portrait) {
    // Portrait handhelds letterbox the same PC-authored 16:9 canvas.  The
    // player is not rotated into a second mobile composition.
    assert(sampled.frame && Math.abs(sampled.frame.width - expectedWidth) <= 3 && Math.abs(sampled.frame.height - expectedHeight) <= 3, `${label}: portrait runtime frame is compressed`, sampled);
    assert(sampled.frameClient && Math.abs(sampled.frameClient.width / Math.max(1, sampled.frameClient.height) - 16 / 9) < 0.02, `${label}: portrait inner canvas aspect ratio changed`, sampled);
  } else {
    assert(sampled.frame && Math.abs(sampled.frame.width - expectedWidth) <= 3 && Math.abs(sampled.frame.height - expectedHeight) <= 3, `${label}: runtime frame is compressed`, sampled);
    assert(Math.abs(sampled.ratio - 16 / 9) < 0.02, `${label}: runtime frame aspect ratio changed`, sampled);
  }
  assert(sampled.dialog && sampled.dialog.width > 40 && sampled.dialog.height > 20, `${label}: dialog container collapsed`, sampled);
  assert(sampled.menu && sampled.menu.width > 20 && sampled.menu.height > 20, `${label}: quick-menu container collapsed`, sampled);
  assert(sampled.toggle && sampled.toggle.width > 0 && sampled.toggle.height > 0, `${label}: quick-menu toggle disappeared`, sampled);
  if (!portrait) {
    assert(sampled.toggle.width >= 18 && sampled.toggle.height >= 18, `${label}: landscape quick-menu toggle is too small to hit`, sampled);
  }
  assert(sampled.contained.dialog && sampled.contained.menu && sampled.contained.toggle, `${label}: critical container escaped frame`, sampled);
  assert(sampled.documentScrollWidth <= viewport.width + 1, `${label}: recovery caused horizontal overflow`, sampled);
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const vite = spawn("cmd.exe", ["/d", "/s", "/c", "npm run dev"], { cwd: runtimeRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let viteLog = "";
  vite.stdout.on("data", (chunk) => { viteLog += chunk; });
  vite.stderr.on("data", (chunk) => { viteLog += chunk; });
  const browser = await chromium.launch({ headless: true });
  const viewports = [
    { name: "reported-757x299", width: 757, height: 299, android: true },
    { name: "wide-desktop", width: 1440, height: 900 },
    { name: "narrow-browser", width: 390, height: 844 },
  ];
  const results = {};
  try {
    await waitForServer();
    for (const viewport of viewports) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.width <= 900, hasTouch: viewport.width <= 900,
        userAgent: viewport.android ? "Mozilla/5.0 (Linux; Android 14; AgentVN QA) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36" : undefined,
      });
      try {
        await initialize(page, viewport);
        const before = await sample(page, viewport);
        assertStable(before, viewport, `${viewport.name} before`);
        const compressedHeight = Math.max(160, Math.round(viewport.height * 0.35));
        await page.setViewportSize({ width: viewport.width, height: compressedHeight });
        await page.evaluate(() => {
          Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await page.waitForTimeout(40);
        await page.setViewportSize(viewport);
        await page.evaluate(() => {
          Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
          document.dispatchEvent(new Event("visibilitychange"));
          window.dispatchEvent(new Event("pageshow"));
          window.dispatchEvent(new Event("focus"));
          window.dispatchEvent(new CustomEvent("agentvn:android-resume"));
          window.dispatchEvent(new Event("resize"));
        });
        await page.waitForTimeout(650);
        const after = await sample(page, viewport);
        assertStable(after, viewport, `${viewport.name} after resume`);
        assert(Math.abs(before.frame.width - after.frame.width) <= 3 && Math.abs(before.frame.height - after.frame.height) <= 3, `${viewport.name}: frame changed after resume`, { before, after });
        results[viewport.name] = { before, after, compressedHeight };
        await page.screenshot({ path: path.join(outputDir, `${viewport.name}.png`) });
      } finally { await page.close(); }
    }
    const staleErrorPath = path.join(outputDir, "error.txt");
    if (fs.existsSync(staleErrorPath)) fs.unlinkSync(staleErrorPath);
    fs.writeFileSync(path.join(outputDir, "report.json"), `${JSON.stringify({ ok: true, results }, null, 2)}\n`, "utf8");
    console.log(`runtime-viewport-recovery-playwright: PASS (${outputDir})`);
  } finally {
    await browser.close();
    try { execFileSync("taskkill.exe", ["/PID", String(vite.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch { vite.kill(); }
    fs.writeFileSync(path.join(outputDir, "vite.log"), viteLog);
  }
})().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "error.txt"), String(error.stack || error));
  console.error(error.stack || error);
  process.exitCode = 1;
});
