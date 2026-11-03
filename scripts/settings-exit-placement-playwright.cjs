#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");

const root = path.resolve(__dirname, "..");
const runtimeRoot = path.join(root, "GameCli_framework");
const outputDir = path.join(root, "output", "playwright", "settings-exit-placement", new Date().toISOString().replace(/[:.]/g, "-"));
let baseUrl;

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
      game_id: "settings-exit-placement",
      title: "设置布局验收",
      author: "AgentVN QA",
      version: "1.0.0",
      description: "Settings exit placement acceptance",
      language: "zh-CN",
      entry_script: "script.json",
      entry_scene_id: "scene_main",
      assets: [],
      created_at: now,
      updated_at: now,
    },
    script: {
      schema_version: "1.5.0",
      game_id: "settings-exit-placement",
      title: "设置布局验收",
      entry_scene_id: "scene_main",
      characters: [],
      scenes: [{
        scene_id: "scene_main",
        title: "Main",
        chapter: 1,
        tags: [],
        commands: [{ type: "narration", text: "选项页布局验收。" }],
      }],
    },
    uiSkin: {
      ui_layout_version: "1.3.0",
      name: "Settings exit placement skin",
      target_runtime: "0.6.0",
      assets: [],
      tokens: {
        colorBackground: "#071018",
        colorSurface: "#101a27",
        colorSurfaceStrong: "#1a2a3c",
        colorInk: "#f4f8ff",
        colorMuted: "#aab8ca",
        colorAccent: "#8bb8df",
        colorAccent2: "#d6a77c",
        colorLine: "#c8d7e8",
        colorControl: "#1a2a3c",
        colorControlHover: "#253c54",
        colorControlActive: "#8bb8df",
        colorControlText: "#f4f8ff",
        colorQuickMenu: "#101a27",
        colorFocus: "#8bb8df",
        radius: 12,
      },
      screens: [],
    },
  };
}

async function openSettings(page) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate((payload) => {
    window.postMessage({
      type: "agentvn.live-preview.init",
      protocolVersion: 2,
      sessionId: "settings-exit-placement-session",
      revision: 1,
      requestId: "settings-exit-placement-init",
      runId: "settings-exit-placement-run",
      manifest: payload.manifest,
      script: payload.script,
      uiSkin: payload.uiSkin,
      assetUrls: {},
      start: {
        requestId: "settings-exit-placement-start",
        target: { sceneId: "scene_main", commandIndex: 0 },
        entryPath: [],
        mode: "stable_frame",
        playbackRate: 1,
        reducedMotion: true,
      },
      screen: "title_menu",
    }, "*");
  }, fixture());
  await page.waitForSelector('[data-testid="open-settings"]', { state: "visible", timeout: 20_000 });
  await page.getByTestId("open-settings").click();
  await page.waitForSelector('[data-testid="settings-screen"]', { state: "visible", timeout: 20_000 });
  await page.waitForFunction(() => document.querySelector("[data-runtime-screen-transition]")
    ?.getAttribute("data-runtime-screen-transition") === "idle");
}

async function sample(page, viewport) {
  return page.evaluate(({ viewport }) => {
    const rect = (selector) => {
      const node = document.querySelector(selector);
      if (!(node instanceof HTMLElement)) return null;
      const box = node.getBoundingClientRect();
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
    };
    const footer = rect(".settings-footer");
    const group = rect(".settings-footer-actions");
    const exit = rect('[data-testid="open-exit-confirmation"]');
    const reset = rect('[data-testid="settings-reset-default"]');
    const finish = rect('[data-testid="settings-finish"]');
    const viewportRect = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    const outside = (box) => box && (
      box.left < viewportRect.left - 1
      || box.top < viewportRect.top - 1
      || box.right > viewportRect.right + 1
      || box.bottom > viewportRect.bottom + 1
    );
    return {
      viewport,
      footer,
      group,
      exit,
      reset,
      finish,
      exitText: document.querySelector('[data-testid="open-exit-confirmation"]')?.textContent?.trim() ?? null,
      headerExitCount: document.querySelector(".settings-screen > header [data-testid='open-exit-confirmation']") ? 1 : 0,
      hasHeaderTitle: Boolean(document.querySelector(".settings-screen > header h2")),
      hasHeaderClose: Boolean(document.querySelector(".settings-screen > header [data-testid='back-to-main-menu']")),
      outside: { footer: outside(footer), group: outside(group), exit: outside(exit), reset: outside(reset), finish: outside(finish) },
      scrollWidth: document.documentElement.scrollWidth,
      buttons: [".settings-exit-link", "[data-testid='settings-reset-default']", "[data-testid='settings-finish']"].map(selector => {
        const button = document.querySelector(selector);
        const r = button.getBoundingClientRect();
        return { rect: r.toJSON(), clipped: button.scrollWidth > button.clientWidth + 1,
          hit: button.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) };
      }),
    };
  }, { viewport });
}

function assertPlacement(sample, label) {
  assert(sample.headerExitCount === 0, `${label}: header still contains the exit action`, sample);
  assert(!sample.hasHeaderTitle && !sample.hasHeaderClose, `${label}: settings header was not fully removed`, sample);
  assert(sample.group && sample.exit && sample.reset, `${label}: footer exit/reset group is incomplete`, sample);
  assert(sample.exitText === "退出游戏", `${label}: exit action text changed`, sample);
  assert(!Object.values(sample.outside).some(Boolean), `${label}: settings action escaped viewport`, sample);
  assert(sample.scrollWidth <= sample.viewport.width + 1, `${label}: settings page has horizontal overflow`, sample);
  const ratio = sample.exit.width / Math.max(1, sample.reset.width);
  assert(ratio >= 0.38 && ratio <= 0.48, `${label}: exit/reset visual width is not approximately 3:7`, { ...sample, ratio });
  for (const button of sample.buttons) assert(button.hit && !button.clipped,
    `${label}: footer button clipped or unclickable`, button);
  for (let i = 0; i < sample.buttons.length; i++) for (let j = i + 1; j < sample.buttons.length; j++) {
    const a = sample.buttons[i].rect, b = sample.buttons[j].rect;
    assert(!(Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
      && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1), `${label}: footer buttons overlap`, sample);
  }
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  let vite, browser;
  const viewports = desktopViewports.map(([width, height]) => ({ name: `desktop-${width}x${height}`, width, height }));
  const results = {};
  try {
    vite = await startOwnedViteServer({ root: runtimeRoot, configFile: path.join(runtimeRoot, "vite.config.cjs"),
      logFile: path.join(outputDir, "vite.log") });
    baseUrl = `${vite.url}/?mode=preview`;
    browser = await chromium.launch({ headless: true });
    for (const viewport of viewports) {
      await vite.assertAlive();
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.width <= 900,
        hasTouch: viewport.width <= 900,
        deviceScaleFactor: Number(process.env.PROFILE_DPR || 1),
        reducedMotion: process.env.PROFILE_REDUCED === "1" ? "reduce" : "no-preference",
        userAgent: viewport.android
          ? "Mozilla/5.0 (Linux; Android 14; AgentVN QA) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36"
          : undefined,
      });
      try {
        await openSettings(page);
        const metrics = await sample(page, viewport);
        assertPlacement(metrics, viewport.name);
        await page.getByTestId("open-exit-confirmation").click();
        await page.waitForSelector('[data-testid="confirm-exit-game"]', { state: "visible", timeout: 5_000 });
        await page.getByRole("dialog", { name: "退出游戏？" }).getByRole("button", { name: "取消", exact: true }).click();
        await page.waitForSelector('[data-testid="settings-screen"]', { state: "visible" });
        results[viewport.name] = metrics;
        await page.screenshot({ path: path.join(outputDir, `${viewport.name}.png`) });
      } finally {
        await page.close();
      }
    }
    await vite.assertAlive();
    const reportPath = path.join(outputDir, "report.json");
    fs.writeFileSync(reportPath, `${JSON.stringify({ ok: true, results,
      service: { pid: vite.pid, runId: vite.runId, url: vite.url } }, null, 2)}\n`, "utf8");
    console.log(`settings-exit-placement-playwright: PASS (${outputDir})`);
  } finally {
    await browser?.close();
    await vite?.stop();
  }
})().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "error.txt"), String(error.stack || error));
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
