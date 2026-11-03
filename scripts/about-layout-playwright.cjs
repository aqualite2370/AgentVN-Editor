#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const runtimeRoot = path.join(root, "GameCli_framework");
const outputDir = path.join(root, "output", "playwright", "about-layout");
const baseUrl = "http://127.0.0.1:6868/?mode=preview";
const longToken = "AgentVNAboutLayoutUnbrokenToken".repeat(8);

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
      game_id: "about-layout",
      title: "关于页布局验收",
      author: "AgentVN QA",
      version: "1.0.0",
      description: "用于验证关于页长文、字段和说明在不同屏幕下始终留在可滚动内容区域内。",
      language: "zh-CN",
      entry_script: "script.json",
      entry_scene_id: "scene_main",
      assets: [],
      shell: {
        about: {
          title: "关于这部很长标题的作品",
          kicker: "作品档案 / ARCHIVE",
          heading: "隐忍的成长：关于页真实长内容布局验收",
          description: `这是连续多段的项目说明。${"文字必须在关于页内容区域内换行，并且不能越过容器边界。".repeat(14)} ${longToken}`,
          fields: Array.from({ length: 9 }, (_, index) => ({
            label: `字段 ${index + 1} 的较长名称`,
            value: `${index + 1} / ${"字段内容需要保持可读并在狭窄屏幕中自然换行。".repeat(3)} ${longToken}`,
          })),
          note: `说明：${"这段说明必须留在关于页内部，并允许用户滚动阅读。".repeat(12)} ${longToken}`,
        },
      },
      created_at: now,
      updated_at: now,
    },
    script: {
      schema_version: "1.5.0",
      game_id: "about-layout",
      title: "关于页布局验收",
      entry_scene_id: "scene_main",
      characters: [],
      scenes: [{
        scene_id: "scene_main",
        title: "Main",
        chapter: 1,
        tags: [],
        commands: [{ type: "narration", text: "关于页布局验收。" }],
      }],
    },
    uiSkin: {
      ui_layout_version: "1.3.0",
      name: "About layout skin",
      target_runtime: "0.6.0",
      assets: [],
      tokens: {
        colorBackground: "#070d14",
        colorSurface: "#121b27",
        colorSurfaceStrong: "#1c2a39",
        colorInk: "#f4f7fb",
        colorMuted: "#a8b4c2",
        colorAccent: "#8cb0c9",
        colorAccent2: "#c7a27a",
        colorLine: "#8fa1b4",
        colorControl: "#1c2a39",
        colorControlHover: "#293c50",
        colorControlActive: "#8cb0c9",
        colorControlText: "#f4f7fb",
        colorQuickMenu: "#121b27",
        colorFocus: "#a8c7dc",
        radius: 12,
      },
      screens: [{
        screen_id: "about",
        components: [{
          component_id: "about_panel",
          component_type: "about_panel",
          required: true,
          rect: { x: 10, y: 17, width: 80, height: 72 },
          mobileRect: { x: 4, y: 16, width: 92, height: 76 },
        }],
      }],
    },
  };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(baseUrl)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("GameCLI Vite server did not become ready");
}

async function initialize(page) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator("#root > *").first().waitFor({ state: "attached" });
  await page.evaluate((payload) => {
    const initMessage = {
      type: "agentvn.live-preview.init",
      protocolVersion: 2,
      sessionId: `about-layout-${Math.random()}`,
      revision: 1,
      requestId: "about-layout-init",
      runId: "about-layout-run",
      manifest: payload.manifest,
      script: payload.script,
      uiSkin: payload.uiSkin,
      assetUrls: {},
      start: {
        requestId: "about-layout-start",
        target: { sceneId: "scene_main", commandIndex: 0 },
        entryPath: [],
        mode: "stable_frame",
        playbackRate: 1,
        reducedMotion: true,
      },
      screen: "title_menu",
    };
    window.__ABOUT_PREVIEW_READY__ = false;
    window.__ABOUT_PREVIEW_INIT__ = initMessage;
    window.addEventListener("message", (event) => {
      if (event.data?.type === "agentvn.live-preview.ready" && event.data.sessionId === initMessage.sessionId) {
        window.__ABOUT_PREVIEW_READY__ = true;
      }
    });
    window.postMessage(initMessage, "*");
  }, fixture());
  try {
    await page.waitForFunction(() => window.__ABOUT_PREVIEW_READY__, undefined, { timeout: 5_000 });
  } catch {
    await page.evaluate(() => window.postMessage(window.__ABOUT_PREVIEW_INIT__, "*"));
    await page.waitForFunction(() => window.__ABOUT_PREVIEW_READY__, undefined, { timeout: 20_000 });
  }
  try {
    await page.waitForSelector('[data-testid="open-about"]', { state: "visible", timeout: 20_000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => {
      const nodes = [];
      let node = document.querySelector('[data-testid="open-about"]');
      while (node) {
        const style = getComputedStyle(node);
        nodes.push({ tag: node.tagName, className: node.className, rect: node.getBoundingClientRect().toJSON(), display: style.display, visibility: style.visibility, opacity: style.opacity });
        node = node.parentElement;
      }
      return { nodes, body: document.body.innerText.slice(0, 1500) };
    });
    throw new Error(`${error.message}\n${JSON.stringify(diagnostics, null, 2)}`);
  }
  await page.getByTestId("open-about").click();
  await page.waitForSelector('[data-testid="about-screen"]', { state: "visible", timeout: 20_000 });
  await page.waitForFunction(() => document.querySelector("[data-runtime-screen-transition]")?.getAttribute("data-runtime-screen-transition") === "idle");
  await page.waitForTimeout(620);
}

async function sample(page, viewport) {
  return page.evaluate(({ viewport }) => {
    const box = (element) => {
      const rect = element?.getBoundingClientRect();
      return rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } : null;
    };
    const screen = document.querySelector('[data-testid="about-screen"]');
    const card = document.querySelector(".about-card");
    const content = document.querySelector(".about-card-content");
    const fieldList = document.querySelector(".about-field-list");
    const returnButton = document.querySelector('[data-testid="back-to-main-menu"]');
    const contentStyle = content ? getComputedStyle(content) : null;
    const cardStyle = card ? getComputedStyle(card) : null;
    const scrollbarThumbStyle = content ? getComputedStyle(content, "::-webkit-scrollbar-thumb") : null;
    const scrollbarTrackStyle = content ? getComputedStyle(content, "::-webkit-scrollbar-track") : null;
    const screenRect = box(screen);
    const cardRect = box(card);
    const contentRect = box(content);
    const viewportRect = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    const inside = (rect, outer) => Boolean(rect && outer
      && rect.left >= outer.left - 1
      && rect.top >= outer.top - 1
      && rect.right <= outer.right + 1
      && rect.bottom <= outer.bottom + 1);
    const buttonRect = box(returnButton);
    const hit = buttonRect
      ? document.elementFromPoint(buttonRect.left + buttonRect.width / 2, buttonRect.top + buttonRect.height / 2)
      : null;
    return {
      viewport,
      formFactor: document.querySelector(".ui-skin-scope")?.getAttribute("data-ui-form-factor"),
      screenRect,
      cardRect,
      contentRect,
      cardInsideViewport: inside(cardRect, viewportRect),
      contentInsideCard: inside(contentRect, cardRect),
      screenScrollWidth: screen?.scrollWidth ?? 0,
      screenClientWidth: screen?.clientWidth ?? 0,
      cardScrollWidth: card?.scrollWidth ?? 0,
      cardClientWidth: card?.clientWidth ?? 0,
      contentScrollWidth: content?.scrollWidth ?? 0,
      contentClientWidth: content?.clientWidth ?? 0,
      contentScrollHeight: content?.scrollHeight ?? 0,
      contentClientHeight: content?.clientHeight ?? 0,
      contentOverflowY: contentStyle?.overflowY ?? null,
      contentOverflowX: contentStyle?.overflowX ?? null,
      cardBorderWidth: cardStyle?.borderWidth ?? null,
      cardBoxShadow: cardStyle?.boxShadow ?? null,
      cardBackground: cardStyle?.backgroundColor ?? null,
      cardWidthRatio: cardRect && screenRect ? cardRect.width / screenRect.width : 0,
      cardHeightRatio: cardRect && screenRect ? cardRect.height / screenRect.height : 0,
      contentScrollbarWidth: contentStyle?.scrollbarWidth ?? null,
      contentScrollbarColor: contentStyle?.scrollbarColor ?? null,
      contentScrollbarThumbBackground: scrollbarThumbStyle?.backgroundImage ?? scrollbarThumbStyle?.background ?? null,
      contentScrollbarThumbBackgroundColor: scrollbarThumbStyle?.backgroundColor ?? null,
      contentScrollbarThumbBorderRadius: scrollbarThumbStyle?.borderRadius ?? null,
      contentScrollbarTrackBackground: scrollbarTrackStyle?.backgroundImage ?? scrollbarTrackStyle?.background ?? null,
      fieldCount: fieldList?.querySelectorAll(".about-field-row").length ?? 0,
      returnClickable: Boolean(hit && returnButton && (hit === returnButton || returnButton.contains(hit))),
      documentScrollWidth: document.documentElement.scrollWidth,
    };
  }, { viewport });
}

function assertLayout(metrics, label) {
  assert(metrics.cardInsideViewport, `${label}: about card escaped the viewport`, metrics);
  assert(metrics.contentInsideCard, `${label}: about content box escaped the card`, metrics);
  assert(metrics.screenScrollWidth <= metrics.screenClientWidth + 1, `${label}: about screen has horizontal overflow`, metrics);
  assert(metrics.cardScrollWidth <= metrics.cardClientWidth + 1, `${label}: about card has horizontal overflow`, metrics);
  assert(metrics.contentScrollWidth <= metrics.contentClientWidth + 1, `${label}: about content has horizontal overflow`, metrics);
  assert(metrics.documentScrollWidth <= metrics.viewport.width + 1, `${label}: document has horizontal overflow`, metrics);
  assert(metrics.contentOverflowY === "auto" || metrics.contentOverflowY === "scroll", `${label}: long about content is not internally scrollable`, metrics);
  assert(metrics.contentScrollHeight > metrics.contentClientHeight, `${label}: fixture did not exercise long scrolling content`, metrics);
  assert(metrics.fieldCount === 9, `${label}: about fields were lost`, metrics);
  assert(metrics.returnClickable, `${label}: return button is not clickable`, metrics);
  // Handheld now renders the same PC-authored shell as desktop. The about
  // surface keeps its shared framed material instead of switching to the
  // removed borderless mobile-only composition.
  assert(metrics.cardBorderWidth !== "0px", `${label}: about card lost its shared boundary`, metrics);
  assert(metrics.cardWidthRatio >= 0.9, `${label}: about card is not close to full width`, metrics);
  assert(metrics.cardHeightRatio >= 0.55, `${label}: about card is not close to full height`, metrics);
  assert(metrics.contentScrollbarWidth === "thin", `${label}: about content is using the default scrollbar width`, metrics);
  assert(metrics.contentScrollbarColor && metrics.contentScrollbarColor !== "auto", `${label}: about content is using the default scrollbar color`, metrics);
  const usesGradientThumb = typeof metrics.contentScrollbarThumbBackground === "string"
    && (metrics.contentScrollbarThumbBackground.includes("repeating-linear-gradient")
      || metrics.contentScrollbarThumbBackground.includes("linear-gradient"));
  const usesFlatThumb = metrics.contentScrollbarThumbBackgroundColor
    && metrics.contentScrollbarThumbBackgroundColor !== "rgba(0, 0, 0, 0)";
  assert(usesGradientThumb || usesFlatThumb, `${label}: about scrollbar thumb is transparent`, metrics);
  assert(metrics.contentScrollbarThumbBorderRadius === (usesGradientThumb ? "999px" : "4px"),
    `${label}: about scrollbar thumb radius does not match its material`, metrics);
  assert(
    typeof metrics.contentScrollbarTrackBackground === "string"
      && metrics.contentScrollbarTrackBackground !== "rgba(0, 0, 0, 0)"
      && metrics.contentScrollbarTrackBackground !== "transparent",
    `${label}: about scrollbar track is still the browser default`,
    metrics,
  );
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const vite = spawn("cmd.exe", ["/d", "/s", "/c", "npm run dev"], {
    cwd: runtimeRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let viteLog = "";
  vite.stdout.on("data", (chunk) => { viteLog += chunk; });
  vite.stderr.on("data", (chunk) => { viteLog += chunk; });
  const browser = await chromium.launch({ headless: true });
  const viewports = [
    { name: "reported-757x299", width: 757, height: 299 },
    { name: "android-landscape", width: 2400, height: 1080, android: true },
    { name: "wide-desktop", width: 1440, height: 900 },
    { name: "narrow-mobile", width: 390, height: 844 },
  ];
  const results = {};
  try {
    await waitForServer();
    for (const viewport of viewports) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.width <= 900,
        hasTouch: viewport.width <= 900,
        userAgent: viewport.android
          ? "Mozilla/5.0 (Linux; Android 14; AgentVN QA) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36"
          : undefined,
      });
      try {
        await initialize(page);
        const before = await sample(page, viewport);
        assertLayout(before, viewport.name);
        await page.evaluate(() => {
          Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
          document.dispatchEvent(new Event("visibilitychange"));
          Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
          document.dispatchEvent(new Event("visibilitychange"));
          window.dispatchEvent(new Event("focus"));
          window.dispatchEvent(new Event("resize"));
        });
        await page.waitForTimeout(620);
        const afterResume = await sample(page, viewport);
        assertLayout(afterResume, `${viewport.name} after resume`);
        assert(Math.abs(before.cardRect.width - afterResume.cardRect.width) <= 1 && Math.abs(before.cardRect.height - afterResume.cardRect.height) <= 1, `${viewport.name}: about card changed size after resume`, { before, afterResume });
        results[viewport.name] = { before, afterResume };
        await page.screenshot({ path: path.join(outputDir, `${viewport.name}.png`) });
      } finally {
        await page.close();
      }
    }
    const staleErrorPath = path.join(outputDir, "error.txt");
    if (fs.existsSync(staleErrorPath)) fs.unlinkSync(staleErrorPath);
    fs.writeFileSync(path.join(outputDir, "report.json"), `${JSON.stringify({ ok: true, results }, null, 2)}\n`, "utf8");
    console.log(`about-layout-playwright: PASS (${outputDir})`);
  } finally {
    await browser.close();
    try {
      execFileSync("taskkill.exe", ["/PID", String(vite.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } catch {
      vite.kill();
    }
    fs.writeFileSync(path.join(outputDir, "vite.log"), viteLog);
  }
})().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "error.txt"), String(error.stack || error));
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
