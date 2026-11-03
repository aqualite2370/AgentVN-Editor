"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { buildSync } = require("../editor/node_modules/esbuild");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");

const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = process.env.AGENTVN_QA_OUTPUT || path.join(root, "output/playwright/runtime-agentvn-blackout", runId);
const viewports = [
  { name: "1080p", width: 1920, height: 1080 },
  { name: "1440p", width: 2560, height: 1440 },
  { name: "4k", width: 3840, height: 2160 },
];
const compiled = { exports: {} };
new Function("module", "exports", buildSync({
  stdin: {
    resolveDir: root,
    loader: "ts",
    contents: 'export { getDefaultUISkinLayout } from "./shared/cartridge/uiSkin";',
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
}).outputFiles[0].text)(compiled, compiled.exports);

const report = {
  runId,
  status: "RUNNING",
  scope: "AgentVN-layout-runtime-blackout-real-browser-not-installed-final",
  viewports,
  cases: [],
};

function fixture() {
  const id = "runtime-agentvn-blackout";
  const now = new Date().toISOString();
  return {
    manifest: {
      manifest_version: "1.0.0",
      cartridge_version: "1.0.0",
      runtime_version: "0.9.0",
      game_id: id,
      title: "AgentVN 黑场转场验收",
      author: "QA",
      version: "1.0.0",
      language: "zh-CN",
      entry_script: "script.json",
      entry_scene_id: "main",
      assets: [],
      created_at: now,
      updated_at: now,
    },
    script: {
      schema_version: "1.1.0",
      game_id: id,
      title: "AgentVN 黑场转场验收",
      entry_scene_id: "main",
      characters: [],
      scenes: [{
        scene_id: "main",
        title: "Main",
        chapter: 1,
        tags: [],
        commands: [{ type: "narration", text: "验证 AgentVN 客户端页面黑场转场。" }],
      }],
    },
    uiSkin: compiled.exports.getDefaultUISkinLayout(),
    assetUrls: {},
  };
}

async function initialize(page, url) {
  await page.goto(`${url}/?mode=preview`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#root")?.childElementCount);
  await page.evaluate(payload => window.postMessage({
    type: "agentvn.live-preview.init",
    protocolVersion: 2,
    sessionId: "runtime-agentvn-blackout",
    revision: 1,
    requestId: "init",
    runId: "init",
    screen: "title_menu",
    ...payload,
  }, "*"), fixture());
  await page.getByTestId("game-state-title").waitFor();
  await waitForIdle(page);
}

async function waitForIdle(page) {
  await page.waitForFunction(() =>
    document.querySelector("[data-runtime-screen-transition]")
      ?.getAttribute("data-runtime-screen-transition") === "idle",
  undefined, { timeout: 15000 });
}

async function captureTransition(page, action, expectedScreen) {
  await page.evaluate(() => {
    window.__agentvnBlackoutCapture = true;
    window.__agentvnBlackoutFrames = [];
    const sample = () => {
      const seam = document.querySelector("[data-runtime-screen-transition]");
      if (seam) {
        const rect = seam.getBoundingClientRect();
        window.__agentvnBlackoutFrames.push({
          phase: seam.getAttribute("data-runtime-transition-phase"),
          from: seam.getAttribute("data-runtime-transition-from"),
          to: seam.getAttribute("data-runtime-transition-to"),
          presented: seam.getAttribute("data-runtime-presented-screen"),
          committed: seam.getAttribute("data-runtime-committed-screen"),
          black: Number(getComputedStyle(seam, "::before").opacity),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          overflow: document.documentElement.scrollWidth - innerWidth,
        });
      }
      if (window.__agentvnBlackoutCapture) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  await action();
  await page.waitForFunction(screen => {
    const seam = document.querySelector("[data-runtime-screen-transition]");
    return seam?.getAttribute("data-runtime-presented-screen") === screen
      && seam?.getAttribute("data-runtime-screen-transition") === "idle";
  }, expectedScreen, { timeout: 20000 });
  const frames = await page.evaluate(() => {
    window.__agentvnBlackoutCapture = false;
    return window.__agentvnBlackoutFrames;
  });

  const phases = new Set(frames.map(frame => frame.phase));
  assert(phases.has("covering") && phases.has("swap") && phases.has("revealing"),
    `AgentVN ${expectedScreen} transition must cover, swap, and reveal`, frames);
  assert(frames.some(frame => frame.phase === "covering" && frame.black > 0 && frame.black < 1),
    `AgentVN ${expectedScreen} transition must visibly fade to black`, frames);
  assert(frames.some(frame => frame.phase === "swap" && frame.black >= 0.99
    && frame.presented === expectedScreen && frame.committed === expectedScreen),
  `AgentVN ${expectedScreen} must be committed beneath the opaque black cover`, frames);
  assert(frames.some(frame => frame.phase === "revealing" && frame.black > 0 && frame.black < 1),
    `AgentVN ${expectedScreen} transition must visibly reveal from black`, frames);
  assert(frames.every(frame => frame.rect.x <= 0.5 && frame.rect.y <= 0.5
    && Math.abs(frame.rect.width - page.viewportSize().width) <= 1
    && Math.abs(frame.rect.height - page.viewportSize().height) <= 1),
  "The blackout surface must cover the full viewport on every sampled frame", frames);
  assert(frames.every(frame => frame.overflow <= 1),
    "The global blackout must not introduce horizontal overflow", frames);
  return frames;
}

async function runViewport(browser, server, viewport, dpr, reduced) {
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: dpr,
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  try {
    await server.run(async () => {
      await initialize(page, server.url);

      const toSettings = await captureTransition(page,
        () => page.getByTestId("open-settings").click(), "settings");
      await page.getByTestId("settings-screen").waitFor();
      const toTitle = await captureTransition(page,
        () => page.getByTestId("settings-finish").click(), "title_menu");
      report.cases.push({
        viewport: viewport.name,
        dpr, reduced,
        path: "title-settings-title",
        status: "PASS",
        frames: { toSettings, toTitle },
      });

      const launchFrames = [];
      await page.evaluate(() => {
        window.__launchCapture = true;
        window.__launchFrames = [];
        const sample = () => {
          const overlay = document.querySelector('[data-testid="game-launch-blackout"]');
          if (overlay) window.__launchFrames.push({
            phase: [...overlay.classList].find(value => value.startsWith("is-")) ?? "",
            opacity: Number(getComputedStyle(overlay).opacity),
          });
          if (window.__launchCapture) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      await page.getByTestId("start-new-game").click();
      await page.getByTestId("game-state-playing").waitFor({ timeout: 30000 });
      await page.waitForSelector('[data-testid="game-launch-blackout"]', { state: "detached", timeout: 30000 });
      launchFrames.push(...await page.evaluate(() => {
        window.__launchCapture = false;
        return window.__launchFrames;
      }));
      assert(launchFrames.some(frame => frame.phase === "is-covering" && frame.opacity > 0 && frame.opacity < 1),
        "AgentVN gameplay entry must retain the independent global black cover", launchFrames);

      await page.getByTestId("quick-menu-toggle").click();
      const toGameMenu = await captureTransition(page,
        () => page.getByTestId("open-main-menu").click(), "main_menu");
      await page.getByTestId("continue-game").waitFor();
      report.cases.push({
        viewport: viewport.name,
        dpr, reduced,
        path: "gameplay-main-menu",
        status: "PASS",
        frames: { toGameMenu },
      });
    });
  } finally {
    await page.close();
  }
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  let server;
  let browser;
  try {
    server = await startOwnedViteServer({
      root: path.join(root, "GameCli_framework"),
      configFile: path.join(root, "GameCli_framework/vite.config.cjs"),
      logFile: path.join(output, "vite.log"),
    });
    report.owner = { pid: server.pid, runId: server.runId, url: server.url };
    browser = await chromium.launch({args:process.env.RUNTIME_QA_GPU==="1"?["--use-angle=d3d11"]:[]});
    for (const viewport of viewports) for (const dpr of [1, 2]) for (const reduced of [false, true])
      await runViewport(browser, server, viewport, dpr, reduced);
    assert.equal(report.cases.length, 24, "三横屏/DPR/动效矩阵不得缺失或空跑");
    assert(report.cases.every(row => row.status === "PASS"));
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED";
    report.error = String(error.stack || error);
    console.error(report.error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    await server?.stop();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Evidence: ${path.join(output, "report.json")}`);
  }
})();
