#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const gameCliRoot = path.join(root, "GameCli_framework");
const gameCliUrl = "http://127.0.0.1:6868/?preview=1&embedded=1";

async function isListening() {
  try {
    return (await fetch(gameCliUrl)).ok;
  } catch {
    return false;
  }
}

function startServer() {
  return spawn(process.execPath, [path.join(gameCliRoot, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", "6868"], {
    cwd: gameCliRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function stopServer(child) {
  if (!child?.pid) return;
  spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
}

async function ensureServer() {
  if (await isListening()) return undefined;
  const child = startServer();
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await isListening()) return child;
    if (child.exitCode !== null) throw new Error(`GameCLI dev server exited: ${child.exitCode}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  stopServer(child);
  throw new Error("GameCLI dev server did not start");
}

function previewMessage() {
  const now = new Date().toISOString();
  const gameId = "gallery_anchor_runtime_playwright";
  const pixel = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='2' height='2'><rect width='2' height='2' fill='%23202a44'/></svg>";
  return {
    type: "agentvn.live-preview.init",
    protocolVersion: 2,
    sessionId: "gallery-session",
    revision: 1,
    requestId: "gallery-init",
    runId: "gallery-run",
    manifest: {
      manifest_version: "1.0.0",
      game_id: gameId,
      title: "Gallery runtime",
      author: "AgentVN",
      version: "0.1.0",
      description: "",
      entry_script: "script.json",
      entry_scene_id: "scene_gallery",
      assets: [
        { asset_id: "bg_runtime", asset_type: "background", path: "assets/bg.svg", mime_type: "image/svg+xml", size_bytes: pixel.length },
        { asset_id: "cg_runtime", asset_type: "ui", path: "assets/cg.svg", mime_type: "image/svg+xml", size_bytes: pixel.length },
      ],
      runtime_version: "0.2.0",
      tags: [],
      language: "zh-CN",
      created_at: now,
      updated_at: now,
    },
    script: {
      schema_version: "1.0.0",
      game_id: gameId,
      title: "Gallery runtime",
      entry_scene_id: "scene_gallery",
      scenes: [{
        scene_id: "scene_gallery",
        title: "Gallery scene",
        summary: "",
        chapter: 1,
        tags: [],
        commands: [
          { type: "background", background_id: "bg_runtime" },
          { type: "narration", text: "Gallery opening" },
          { type: "gallery_anchor", anchor_id: "gallery_runtime", title: "雨夜告白", asset_id: "cg_runtime", description: "Gallery replay" },
          { type: "narration", text: "Gallery ending" },
        ],
      }],
    },
    assetUrls: { bg_runtime: pixel, "assets/bg.svg": pixel, cg_runtime: pixel, "assets/cg.svg": pixel },
    start: {
      requestId: "gallery-start",
      target: { sceneId: "scene_gallery", commandIndex: 0 },
      entryPath: [],
      mode: "play_target_event",
      playbackRate: 1,
    },
    screen: "playing",
  };
}

async function advance(page) {
  await page.locator(".story-player").click({ position: { x: 100, y: 100 } });
  await page.waitForTimeout(120);
}

async function run() {
  const server = await ensureServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const viewport of [
      { width: 757, height: 299 },
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await page.goto(gameCliUrl, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith("agentvn.gamecli.gallery.")) localStorage.removeItem(key);
        }
      });
      await page.evaluate((message) => window.postMessage(message, window.location.origin), previewMessage());
      await page.locator('[data-testid="game-state-playing"]').waitFor({ timeout: 10_000 });
      await page.locator(".dialog-box").waitFor({ timeout: 10_000 });

      await advance(page);
      await advance(page);
      await page.locator('[data-testid="quick-menu-toggle"]').click();
      await page.locator('[data-testid="open-main-menu"]').click();
      await page.locator('[data-testid="main-menu"]').waitFor({ timeout: 10_000 });
      await page.locator('[data-testid="open-gallery"]').click();
      await page.locator('[data-testid="gallery-screen"]').waitFor({ timeout: 10_000 });

      const item = page.locator('[data-testid="gallery-item-gallery_runtime"]');
      await item.waitFor();
      if (!await item.locator("button").isEnabled()) throw new Error(`${viewport.width}x${viewport.height}: unlocked gallery item should be clickable`);
      await item.locator("button").click();
      await page.locator('[data-testid="game-state-playing"]').waitFor({ timeout: 10_000 });
      await page.waitForFunction(() => {
        const player = document.querySelector('[data-testid="game-state-playing"]');
        const dialog = document.querySelector(".dialog-box");
        return player?.getAttribute("data-current-scene-id") === "scene_gallery"
          && dialog?.textContent?.includes("Gallery opening");
      });
      const replayText = await page.locator(".story-player").innerText();
      if (!replayText.includes("Gallery opening")) {
        throw new Error(`${viewport.width}x${viewport.height}: gallery replay must start from scene opening: ${replayText}`);
      }

      await page.locator('[data-testid="quick-menu-toggle"]').click();
      const saveButton = page.locator('[data-ui-component-id="quick_save_load_button"]');
      if (!await saveButton.isDisabled()) throw new Error(`${viewport.width}x${viewport.height}: save must be disabled during replay`);
      await page.locator('[data-testid="open-main-menu"]').click();
      await page.locator('[data-testid="gallery-screen"]').waitFor({ timeout: 10_000 });
      await context.close();
    }
    console.log("gallery anchor runtime playwright test OK");
  } finally {
    await browser?.close();
    stopServer(server);
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
