#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const gameCliRoot = path.join(root, "GameCli_framework");
const gameCliUrl = "http://127.0.0.1:6868/";
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
  const deadline = Date.now() + 60000;
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

function fixtureSkin(layoutFit = "contain") {
  return {
    ui_layout_version: "1.0.0",
    name: "Dialog background fit inheritance acceptance",
    target_runtime: "0.2.0",
    tokens: {},
    assets: [],
    screens: [{
      screen_id: "player",
      label: "Player",
      components: [
        {
          component_id: "dialog_panel",
          component_type: "dialog_panel",
          required: true,
          rect: { x: 10, y: 65, width: 80, height: 25 },
          mobileRect: { x: 5, y: 60, width: 90, height: 30 },
          style: {
            backgroundImage: "asset:layout_dialog",
            backgroundFit: layoutFit,
            backgroundColor: "#111827",
          },
        },
        {
          component_id: "dialog_text",
          component_type: "dialog_text",
          rect: { x: 14, y: 72, width: 72, height: 12 },
          mobileRect: { x: 10, y: 68, width: 80, height: 16 },
          style: { color: "#ffffff", fontSize: 18 },
        },
        {
          component_id: "speaker_label",
          component_type: "speaker_label",
          rect: { x: 14, y: 67, width: 20, height: 4 },
          mobileRect: { x: 10, y: 63, width: 25, height: 5 },
          style: { color: "#ffffff" },
        },
        {
          component_id: "continue_indicator",
          component_type: "continue_indicator",
          rect: { x: 80, y: 84, width: 6, height: 3 },
          mobileRect: { x: 80, y: 84, width: 8, height: 4 },
          style: { color: "#ffffff" },
        },
      ],
    }],
  };
}

function fixtureMessage({ sessionId, command, characters, layoutFit = "contain" }) {
  const now = new Date().toISOString();
  return {
    type: "agentvn.live-preview.init",
    protocolVersion: 2,
    sessionId,
    revision: 1,
    requestId: `${sessionId}-init`,
    runId: `${sessionId}-run`,
    manifest: {
      manifest_version: "1.0.0",
      cartridge_version: "1.0.0",
      runtime_version: "0.2.0",
      game_id: sessionId,
      title: "Dialog fit acceptance",
      author: "AgentVN QA",
      version: "0.0.0",
      language: "zh-CN",
      entry_script: "script.json",
      entry_scene_id: "scene",
      assets: [{
        asset_id: "layout_dialog",
        asset_type: "ui",
        path: "assets/ui/layout-dialog.svg",
        filename: "layout-dialog.svg",
        mime_type: "image/svg+xml",
        size_bytes: 1,
        hash_sha256: "",
      }],
      created_at: now,
      updated_at: now,
    },
    script: {
      schema_version: "1.1.0",
      game_id: sessionId,
      title: "Dialog fit acceptance",
      entry_scene_id: "scene",
      characters,
      scenes: [{
        scene_id: "scene",
        title: "Scene",
        summary: "",
        chapter: 1,
        tags: [],
        commands: [command],
      }],
    },
    uiSkin: fixtureSkin(layoutFit),
    assetUrls: {
      layout_dialog: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='100'%3E%3Crect width='400' height='100' fill='%23111827'/%3E%3C/svg%3E",
    },
    start: {
      requestId: `${sessionId}-init`,
      target: { sceneId: "scene" },
      entryPath: [],
      mode: "stable_frame",
      playbackRate: 1,
    },
    screen: "playing",
  };
}

async function renderCase(page, testCase) {
  const message = fixtureMessage(testCase);
  await page.evaluate((payload) => window.postMessage(payload, window.location.origin), message);
  await page.waitForFunction((expectedText) => {
    const dialog = document.querySelector(".dialog-box");
    return dialog && dialog.textContent?.includes(expectedText);
  }, testCase.command.text, { timeout: 15000 });
  return page.locator(".dialog-box").evaluate((element) => ({
    backgroundImage: getComputedStyle(element).backgroundImage,
    backgroundSize: getComputedStyle(element).backgroundSize,
  }));
}

async function main() {
  const server = await ensureServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const cases = [
      {
        name: "manual narration fit overrides inherited skin image fit",
        sessionId: "manual-narration",
        command: {
          type: "narration",
          text: "manual narration",
          dialog_style_mode: "manual",
          dialog_style: { background_asset_id: null, background_fit: "stretch" },
        },
        expectedSize: "100% 100%",
      },
      {
        name: "manual dialog fit overrides inherited skin image fit",
        sessionId: "manual-dialog",
        command: {
          type: "dialog",
          character_id: "alice",
          text: "manual dialog",
          dialog_style_mode: "manual",
          dialog_style: { background_asset_id: null, background_fit: "stretch" },
        },
        expectedSize: "100% 100%",
      },
      {
        name: "character default fit overrides inherited skin image fit",
        sessionId: "character-default",
        characters: [{
          character_id: "alice",
          name: "Alice",
          dialog_style: { background_asset_id: null, background_fit: "stretch" },
        }],
        command: {
          type: "dialog",
          character_id: "alice",
          text: "character default",
          dialog_style_mode: "inherit",
        },
        expectedSize: "100% 100%",
      },
      {
        name: "missing command fit preserves skin fit",
        sessionId: "skin-default",
        command: {
          type: "narration",
          text: "skin default",
        },
        expectedSize: "contain",
      },
    ];

    for (const testCase of cases) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      try {
        await page.goto(`${gameCliUrl}?preview=1&embedded=1`, { waitUntil: "domcontentloaded" });
        const rendered = await renderCase(page, testCase);
        if (rendered.backgroundImage === "none") {
          throw new Error(`${testCase.name}: inherited skin background image was not rendered.`);
        }
        if (rendered.backgroundSize !== testCase.expectedSize) {
          throw new Error(
            `${testCase.name}: expected background-size ${testCase.expectedSize}, got ${rendered.backgroundSize}.`,
          );
        }
        console.log(`PASS ${testCase.name}: ${rendered.backgroundSize}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
    stopServer(server);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
