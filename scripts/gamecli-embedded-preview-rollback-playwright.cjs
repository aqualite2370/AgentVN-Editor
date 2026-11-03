#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const editorRoot = path.join(root, "editor");
const outputDir = path.join(root, "output", "playwright", "gamecli-embedded-preview-rollback");
const editorUrl = "http://127.0.0.1:6767/";

function assert(condition, message, details) {
  if (!condition) {
    throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`);
  }
}

async function serverReady() {
  try {
    return (await fetch(editorUrl)).ok;
  } catch {
    return false;
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (await serverReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Editor Vite server did not become ready.");
}

function fixture() {
  const now = new Date().toISOString();
  return {
    manifest: {
      manifest_version: "1.0.0",
      cartridge_version: "1.0.0",
      runtime_version: "0.6.0",
      game_id: "embedded-preview-rollback",
      title: "Embedded Preview Rollback",
      author: "AgentVN QA",
      version: "1.0.0",
      language: "zh-CN",
      entry_script: "script.json",
      entry_scene_id: "scene_main",
      assets: [],
      created_at: now,
      updated_at: now,
    },
    script: {
      schema_version: "1.5.0",
      game_id: "embedded-preview-rollback",
      title: "Embedded Preview Rollback",
      entry_scene_id: "scene_main",
      characters: [],
      scenes: [{
        scene_id: "scene_main",
        title: "Main",
        chapter: 1,
        tags: [],
        commands: [
          { type: "narration", text: "ROLLBACK-LINE-A" },
          { type: "bgm", action: "stop" },
          { type: "wait", duration_ms: 20 },
          { type: "narration", text: "ROLLBACK-LINE-B" },
        ],
      }],
    },
  };
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  let vite;
  let viteLog = "";
  if (!(await serverReady())) {
    vite = spawn("cmd.exe", ["/d", "/s", "/c", "npm run dev"], {
      cwd: editorRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    vite.stdout.on("data", (chunk) => { viteLog += chunk; });
    vite.stderr.on("data", (chunk) => { viteLog += chunk; });
  }

  const browser = await chromium.launch({ headless: true });
  try {
    await waitForServer();
    const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
    const pageErrors = [];
    const consoleErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      document.body.replaceChildren();
      const iframe = document.createElement("iframe");
      iframe.id = "runtime";
      iframe.src = "/gamecli-preview/?preview=1&embedded=1";
      iframe.style.cssText = "width:100vw;height:100vh;border:0";
      document.body.appendChild(iframe);
    });

    const iframeHandle = await page.waitForSelector("#runtime");
    const runtimeFrame = await iframeHandle.contentFrame();
    assert(runtimeFrame, "Embedded GameCLI frame was not created.");
    await runtimeFrame.waitForLoadState("domcontentloaded");
    await runtimeFrame.waitForURL(/\/gamecli-preview\//);

    const data = fixture();
    await page.evaluate((payload) => {
      document.querySelector("#runtime").contentWindow.postMessage({
        type: "agentvn.live-preview.init",
        protocolVersion: 2,
        sessionId: "embedded-preview-rollback-session",
        revision: 1,
        requestId: "embedded-preview-rollback-init",
        runId: "embedded-preview-rollback-run",
        manifest: payload.manifest,
        script: payload.script,
        assetUrls: {},
        start: {
          requestId: "embedded-preview-rollback-init",
          target: { sceneId: "scene_main", commandIndex: 0 },
          entryPath: [],
          mode: "stable_frame",
          playbackRate: 1,
          reducedMotion: true,
        },
        screen: "playing",
      }, window.location.origin);
    }, data);

    await runtimeFrame.waitForSelector("[data-testid='game-state-playing']", { timeout: 20_000 });
    await runtimeFrame.waitForFunction(() => document.querySelector(".dialog-text")?.textContent?.trim() === "ROLLBACK-LINE-A");
    const rollbackButton = runtimeFrame.locator('button[aria-label="回退"]');
    await rollbackButton.waitFor();
    assert(await runtimeFrame.locator('button[aria-label="前滚"]').count() === 0, "Top quick menu must not expose a roll-forward button.");
    assert(await rollbackButton.isDisabled(), "Rollback must begin disabled at the first interaction.");

    await runtimeFrame.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    });
    await runtimeFrame.waitForFunction(() => document.querySelector(".dialog-text")?.textContent?.trim() === "ROLLBACK-LINE-B");
    await runtimeFrame.waitForFunction(() => document.querySelector('button[aria-label="回退"]')?.disabled === false);

    await runtimeFrame.evaluate(() => {
      window.dispatchEvent(new WheelEvent("wheel", { deltaY: -160, bubbles: true, cancelable: true }));
    });
    await runtimeFrame.waitForFunction(() => document.querySelector(".dialog-text")?.textContent?.trim() === "ROLLBACK-LINE-A");
    await runtimeFrame.waitForTimeout(350);
    await runtimeFrame.evaluate(() => {
      window.dispatchEvent(new WheelEvent("wheel", { deltaY: 160, bubbles: true, cancelable: true }));
    });
    await runtimeFrame.waitForFunction(() => document.querySelector(".dialog-text")?.textContent?.trim() === "ROLLBACK-LINE-B");

    await rollbackButton.click();
    await runtimeFrame.waitForFunction(() => document.querySelector(".dialog-text")?.textContent?.trim() === "ROLLBACK-LINE-A");
    await runtimeFrame.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true, cancelable: true }));
    });
    await runtimeFrame.waitForFunction(() => document.querySelector(".dialog-text")?.textContent?.trim() === "ROLLBACK-LINE-B");

    const probe = await runtimeFrame.evaluate(() => {
      const menu = document.querySelector('[aria-label="播放快捷菜单"]');
      const rollback = document.querySelector('button[aria-label="回退"]');
      const rollForward = document.querySelector('button[aria-label="前滚"]');
      return {
        menuVisible: Boolean(menu && menu.getBoundingClientRect().width > 0 && menu.getBoundingClientRect().height > 0),
        rollbackVisible: Boolean(rollback && rollback.getBoundingClientRect().width > 0),
        rollForwardAbsent: !rollForward,
        dialog: document.querySelector(".dialog-text")?.textContent?.trim(),
        runtimeMode: document.querySelector(".playback-controls")?.className,
      };
    });
    assert(probe.menuVisible && probe.rollbackVisible && probe.rollForwardAbsent, "Embedded preview must show only the rollback timeline button.", probe);
    assert(pageErrors.length === 0, "Embedded preview raised page errors.", { pageErrors, consoleErrors });

    await page.screenshot({ path: path.join(outputDir, "embedded-preview-rollback.png"), fullPage: true });
    fs.writeFileSync(path.join(outputDir, "result.json"), JSON.stringify({
      ok: true,
      probe,
      pageErrors,
      consoleErrors,
    }, null, 2));
    console.log("PASS embedded GameCLI preview exposes rollback only while preserving wheel/PageDown roll-forward");
  } finally {
    await browser.close();
    if (vite) {
      try {
        execFileSync("taskkill.exe", ["/PID", String(vite.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      } catch {
        vite.kill();
      }
    }
    if (viteLog) fs.writeFileSync(path.join(outputDir, "vite.log"), viteLog);
  }
})().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "error.txt"), String(error.stack || error));
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
