#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const gameCliRoot = path.join(root, "GameCli_framework");
const gameCliUrl = "http://127.0.0.1:6868/?mode=preview";
const npmCliPath = process.platform === "win32"
  ? process.env.npm_execpath || path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
  : undefined;

async function isListening() {
  try {
    return (await fetch(gameCliUrl)).ok;
  } catch {
    return false;
  }
}

function startServer() {
  const command = process.platform === "win32" ? process.execPath : "npm";
  const args = process.platform === "win32"
    ? [npmCliPath, "run", "dev"]
    : ["run", "dev"];
  return spawn(command, args, {
    cwd: gameCliRoot,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function stopServer(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

async function ensureServer() {
  if (await isListening()) return undefined;
  const child = startServer();
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await isListening()) return child;
    if (child.exitCode !== null) {
      throw new Error(`GameCLI dev server exited before listening (code ${child.exitCode}).`);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  stopServer(child);
  throw new Error("GameCLI dev server did not start within 60 seconds.");
}

function previewMessage(screen) {
  const now = new Date().toISOString();
  const gameId = "preview_save_load_navigation";
  const requestId = `init-${screen}`;
  return {
    type: "agentvn.live-preview.init",
    protocolVersion: 2,
    sessionId: `session-${screen}`,
    revision: 1,
    requestId,
    runId: `run-${screen}`,
    manifest: {
      manifest_version: "1.0.0",
      cartridge_version: "1.0.0",
      runtime_version: "0.2.0",
      game_id: gameId,
      title: "Preview save/load navigation",
      author: "AgentVN QA",
      description: "Preview save/load navigation regression fixture",
      version: "0.0.0",
      language: "zh-CN",
      tags: [],
      entry_script: "script.json",
      entry_scene_id: "opening",
      assets: [],
      created_at: now,
      updated_at: now,
    },
    script: {
      schema_version: "1.1.0",
      game_id: gameId,
      title: "Preview save/load navigation",
      entry_scene_id: "opening",
      scenes: [{
        scene_id: "opening",
        title: "Opening",
        summary: "",
        chapter: 1,
        tags: [],
        commands: [
          { type: "narration", text: "First scene" },
          { type: "narration", text: "Second line" },
        ],
      }],
    },
    assetUrls: {},
    start: {
      requestId,
      target: { sceneId: "opening" },
      entryPath: [],
      mode: "stable_frame",
      playbackRate: 1,
    },
    screen,
  };
}

async function initializePreview(page, screen) {
  const target = screen === "playing"
    ? page.locator('[data-testid="game-state-playing"]')
    : page.locator(`[data-runtime-state="${screen}"]`);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.evaluate((message) => window.postMessage(message, window.location.origin), previewMessage(screen));
    if (await target.isVisible().catch(() => false)) return;
    await target.waitFor({ state: "visible", timeout: 2_000 }).catch(() => undefined);
    if (await target.isVisible().catch(() => false)) return;
  }
  const debug = await page.evaluate(() => ({
    bodyText: document.body.innerText,
    bodyHtml: document.body.innerHTML.slice(0, 3_000),
  }));
  throw new Error(`Live preview did not initialize ${screen}: ${JSON.stringify(debug)}`);
}

async function runtimeState(page) {
  return page.evaluate(() => {
    if (document.querySelector(".save-load-screen")) return "save_load";
    if (document.querySelector('[data-testid="game-state-playing"]')) return "playing";
    return document.querySelector("[data-runtime-state]")?.getAttribute("data-runtime-state") ?? "unknown";
  });
}

async function openQuickMenu(page) {
  const toggle = page.getByTestId("quick-menu-toggle");
  await toggle.waitFor({ state: "visible", timeout: 10_000 });
  if (await toggle.getAttribute("aria-expanded") !== "true") {
    await toggle.click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute("aria-expanded") === "true",
      undefined,
      { timeout: 5_000 },
    );
    await page.locator(".quick-menu-surface.is-expanded").waitFor({ state: "visible", timeout: 5_000 });
    await page.waitForTimeout(240);
  }
}

async function main() {
  const server = await ensureServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    // Keep this browser acceptance isolated from a stale fixed-only marker
    // left by a standalone package build.
    await page.route("**/fixed-only.json", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ fixedOnly: false }),
    }));
    await page.goto(gameCliUrl, { waitUntil: "domcontentloaded" });
    await page.locator("#root").waitFor({ state: "attached", timeout: 10_000 });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("agentvn.gamecli.saves.")) localStorage.removeItem(key);
      }
    });

    await initializePreview(page, "title_menu");
    await page.locator('[data-testid="open-save-load"]').click();
    await page.locator(".save-load-screen").waitFor({ state: "visible", timeout: 10_000 });
    const titleState = await runtimeState(page);
    const titleMode = await page.locator(".save-load-header h2").count();
    if (titleMode !== 0) throw new Error("Save/load header must not render a title.");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#root").waitFor({ state: "attached", timeout: 10_000 });
    await page.waitForTimeout(1_500);
    await initializePreview(page, "playing");
    // Live-preview startup may expose the playing DOM one frame before the
    // shared launch transition reaches idle. Navigation actions intentionally
    // reject while that transition is active, so wait for the surface to
    // settle before exercising the quick-menu action.
    await page.locator(".game-launch-blackout").waitFor({ state: "detached", timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(500);
    await openQuickMenu(page);
    await page.locator(".quick-menu-surface.is-expanded .quick-menu-action-layer > .quick-menu-button").nth(3).evaluate((button) => button.click());
    await page.locator(".save-load-screen").waitFor({ state: "visible", timeout: 10_000 });
    await page.waitForTimeout(250);
    const playingState = await runtimeState(page);
    const previewSaveDisabled = await page
      .locator('[data-testid="save-slot-manual-1"] .save-card-main')
      .isDisabled()
      .catch(() => false);
    await page.locator('[data-testid="save-slot-manual-1"] .save-card-main').click();
    await page.waitForFunction(() => Object.keys(localStorage)
      .filter((key) => key.startsWith("agentvn.gamecli.saves."))
      .some((key) => JSON.parse(localStorage.getItem(key) || "[]")
        .some((save) => (save.save_kind || "manual") === "manual" && save.slot === 1)));
    const savedSlot = await page.locator('[data-testid="save-slot-manual-1"].has-save').isVisible();

    await page.evaluate(() => {
      window.postMessage({ type: "agentvn.runtime.screen", screen: "title_menu" }, window.location.origin);
    });
    await page.locator('[data-runtime-state="title_menu"]').waitFor({ state: "visible", timeout: 10_000 });
    await page.locator('[data-testid="open-save-load"]').click();
    await page.locator(".save-load-screen").waitFor({ state: "visible", timeout: 10_000 });
    const titleLoadState = await runtimeState(page);
    const titleLoadMode = await page.locator(".save-load-header h2").count();
    await page.locator('[data-testid="save-slot-manual-1"].has-save .save-card-main').click();
    await page.locator('[data-testid="game-state-playing"]').waitFor({ state: "visible", timeout: 10_000 });
    await page.locator(".dialog-box").waitFor({ state: "visible", timeout: 10_000 });
    await page.waitForFunction(() => document.querySelector(".dialog-box")?.textContent?.includes("First scene"), null, { timeout: 10_000 });
    const loadedText = await page.locator(".story-player").innerText();

    const result = { titleState, titleMode, playingState, previewSaveDisabled, savedSlot, titleLoadState, titleLoadMode, loadedText, consoleErrors };
    if (
      titleState !== "save_load"
      || titleMode !== 0
      || playingState !== "save_load"
      || previewSaveDisabled
      || !savedSlot
      || titleLoadState !== "save_load"
      || titleLoadMode !== 0
      || !loadedText.includes("First scene")
    ) {
      throw new Error(`Preview save/load navigation failed: ${JSON.stringify(result)}`);
    }
    console.log(`preview save/load navigation: PASS ${JSON.stringify(result)}`);
  } finally {
    await browser?.close().catch(() => undefined);
    stopServer(server);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
