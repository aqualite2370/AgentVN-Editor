#!/usr/bin/env node
"use strict";

const { spawn, execFileSync } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const editorRoot = path.join(root, "editor");

function assert(condition, message, details) {
  if (!condition) {
    throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`);
  }
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function serverReady(editorUrl) {
  try {
    return (await fetch(editorUrl)).ok;
  } catch {
    return false;
  }
}

async function waitForServer(editorUrl) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (await serverReady(editorUrl)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Editor Vite server did not become ready.");
}

function scene(sceneId, text) {
  return {
    scene_id: sceneId,
    title: sceneId,
    summary: "",
    chapter: 1,
    tags: [],
    commands: [{ type: "narration", text }],
  };
}

function fixture(entrySceneId, scenes) {
  const now = new Date().toISOString();
  return {
    manifest: {
      manifest_version: "1.0.0",
      cartridge_version: "1.0.0",
      runtime_version: "0.2.0",
      game_id: "live-preview-stale-scene",
      title: "Live Preview Stale Scene",
      author: "AgentVN QA",
      version: "1.0.0",
      language: "zh-CN",
      entry_script: "script.json",
      entry_scene_id: entrySceneId,
      assets: [],
      created_at: now,
      updated_at: now,
    },
    script: {
      schema_version: "1.0.0",
      game_id: "live-preview-stale-scene",
      title: "Live Preview Stale Scene",
      entry_scene_id: entrySceneId,
      characters: [],
      scenes,
    },
  };
}

(async () => {
  const port = await getFreePort();
  const editorUrl = `http://127.0.0.1:${port}/`;
  execFileSync("cmd.exe", ["/d", "/s", "/c", "npm --prefix ../GameCli_framework run build"], {
    cwd: editorRoot,
    windowsHide: true,
    stdio: "inherit",
  });
  let viteOutput = "";
  const vite = spawn(
    process.execPath,
    [path.join(editorRoot, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(port)],
    {
      cwd: editorRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  vite.stdout.on("data", (chunk) => { viteOutput += chunk.toString(); });
  vite.stderr.on("data", (chunk) => { viteOutput += chunk.toString(); });

  const browser = await chromium.launch({ headless: true });
  try {
    try {
      await waitForServer(editorUrl);
    } catch (error) {
      throw new Error(`${error.message}\n${viteOutput}`);
    }
    const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
    await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      document.body.replaceChildren();
      window.__LIVE_PREVIEW_RESPONSES__ = [];
      window.addEventListener("message", (event) => {
        if (event.data?.type?.startsWith("agentvn.live-preview.")) {
          window.__LIVE_PREVIEW_RESPONSES__.push(event.data);
        }
      });
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

    const sessionId = "stale-scene-session";
    const oldData = fixture("scene_opening", [scene("scene_opening", "OLD")]);
    await page.evaluate(({ sessionId, oldData }) => {
      document.querySelector("#runtime").contentWindow.postMessage({
        type: "agentvn.live-preview.init",
        protocolVersion: 2,
        sessionId,
        revision: 1,
        requestId: "init-old",
        runId: "run-old",
        manifest: oldData.manifest,
        script: oldData.script,
        assetUrls: {},
        start: {
          requestId: "init-old",
          target: { sceneId: "scene_opening" },
          entryPath: [],
          mode: "stable_frame",
          playbackRate: 1,
        },
        screen: "playing",
      }, window.location.origin);
    }, { sessionId, oldData });
    await page.waitForFunction(() => window.__LIVE_PREVIEW_RESPONSES__.some((item) => item.revision === 1 && item.type === "agentvn.live-preview.ready"));

    const newData = fixture("scene_new", [scene("scene_new", "NEW")]);
    await page.evaluate(({ sessionId, newData }) => {
      const runtime = document.querySelector("#runtime").contentWindow;
      runtime.postMessage({
        type: "agentvn.live-preview.patch",
        protocolVersion: 2,
        sessionId,
        revision: 2,
        requestId: "patch-full",
        runId: "run-full",
        manifest: newData.manifest,
        script: newData.script,
        start: {
          requestId: "patch-full",
          target: { sceneId: "scene_new" },
          entryPath: [],
          mode: "stable_frame",
          playbackRate: 1,
        },
      }, window.location.origin);
      runtime.postMessage({
        type: "agentvn.live-preview.patch",
        protocolVersion: 2,
        sessionId,
        revision: 3,
        requestId: "patch-partial",
        runId: "run-partial",
        scenes: [{
          scene_id: "scene_new",
          title: "scene_new",
          summary: "",
          chapter: 1,
          tags: [],
          commands: [{ type: "narration", text: "NEW UPDATED" }],
        }],
        start: {
          requestId: "stale-request",
          target: { sceneId: "scene_opening", commandIndex: 4 },
          entryPath: [],
          mode: "play_target_event",
          playbackRate: 1,
        },
      }, window.location.origin);
    }, { sessionId, newData });

    await page.waitForFunction(() => window.__LIVE_PREVIEW_RESPONSES__.some((item) => item.revision === 3));
    const rapidPatchResponses = await page.evaluate(() => window.__LIVE_PREVIEW_RESPONSES__.filter((item) => item.revision >= 2));
    const finalPatchResponse = rapidPatchResponses.find((item) => item.revision === 3);
    assert(finalPatchResponse?.type === "agentvn.live-preview.ready", "rapid partial patch must recover instead of reporting a stale-scene error", rapidPatchResponses);
    assert(finalPatchResponse?.sceneId === "scene_new", "rapid partial patch must end at the latest entry scene", rapidPatchResponses);

    await page.evaluate((sessionId) => {
      document.querySelector("#runtime").contentWindow.postMessage({
        type: "agentvn.live-preview.start",
        protocolVersion: 2,
        sessionId,
        revision: 4,
        requestId: "explicit-missing",
        runId: "run-explicit-missing",
        start: {
          requestId: "explicit-missing",
          target: { sceneId: "scene_missing" },
          entryPath: [],
          mode: "stable_frame",
          playbackRate: 1,
        },
      }, window.location.origin);
    }, sessionId);
    await page.waitForFunction(() => window.__LIVE_PREVIEW_RESPONSES__.some((item) => item.revision === 4));
    const explicitResponse = await page.evaluate(() => window.__LIVE_PREVIEW_RESPONSES__.find((item) => item.revision === 4));
    assert(explicitResponse?.type === "agentvn.live-preview.error", "explicit live-preview.start must remain strict", explicitResponse);
    assert(explicitResponse?.sceneId === "scene_missing", "explicit start error must identify the missing scene", explicitResponse);

    console.log("PASS live preview recovers stale passive patches and keeps explicit starts strict");
  } finally {
    await browser.close();
    try {
      execFileSync("taskkill.exe", ["/PID", String(vite.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } catch {
      vite.kill();
    }
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
