const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const EDITOR_URL = "http://127.0.0.1:6767/";
const GAMECLI_URL = "http://127.0.0.1:6868/?mode=preview";
const OUT_DIR = path.join(ROOT, "output", "playwright", "gamecli-preview-legacy-host");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function assert(condition, message, context) {
  if (!condition) {
    const detail = context ? `\n${JSON.stringify(context, null, 2)}` : "";
    throw new Error(`${message}${detail}`);
  }
}

async function isListening(url) {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

function startServer(name, cwd) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const logPath = path.join(OUT_DIR, `${name}.log`);
  const out = fs.openSync(logPath, "a");
  return spawn(npmCommand, ["run", "dev"], {
    cwd,
    shell: process.platform === "win32",
    windowsHide: true,
    stdio: ["ignore", out, out],
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

async function ensureServer(name, url, cwd) {
  if (await isListening(url)) return undefined;
  const child = startServer(name, cwd);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await isListening(url)) return child;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${name} did not start at ${url}.`);
}

(async () => {
  const startedAt = Date.now();
  const logStep = (step, extra = {}) => {
    console.log(JSON.stringify({ step, elapsedMs: Date.now() - startedAt, ...extra }));
  };

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  logStep("ensure-gamecli-server");
  const gameCliServer = await ensureServer("gamecli", GAMECLI_URL, path.join(ROOT, "GameCli_framework"));

  logStep("launch-browser");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const events = [];
  const assetResponses = [];

  const editorPage = await context.newPage();
  await editorPage.addInitScript(() => {
    const calls = [];
    window.__AGENTVN_PREVIEW_IPC_CALLS__ = calls;
    window.__TAURI_INTERNALS__ = {
      invoke: async (command, args) => {
        calls.push({
          command,
          cartridgeBytesLength: Array.isArray(args?.cartridgeBytes) ? args.cartridgeBytes.length : undefined,
          chunkBytesLength: Array.isArray(args?.chunkBytes) ? args.chunkBytes.length : undefined,
          fileName: args?.fileName,
        });
        if (command === "begin_gamecli_preview_upload") {
          throw new Error("Command begin_gamecli_preview_upload not found");
        }
        if (command === "open_gamecli_preview") {
          throw new Error("legacy byte-array preview command should not be used for large cartridges");
        }
        if (command === "close_gamecli_preview") return null;
        throw new Error(`Unexpected command ${command}`);
      },
      transformCallback: () => 1,
      unregisterCallback: () => {},
      callbacks: {},
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      convertFileSrc: (value) => value,
    };
  });

  editorPage.on("console", (msg) => events.push({ page: "editor", type: "console", level: msg.type(), text: msg.text() }));
  editorPage.on("pageerror", (error) => events.push({ page: "editor", type: "pageerror", text: error.message, stack: error.stack }));
  editorPage.on("response", (response) => {
    const url = response.url();
    if (url.includes("/api/project/assets/")) {
      assetResponses.push({ status: response.status(), url });
    }
    if (/\/api\/project|PreviewWindowControls/.test(url)) {
      events.push({ page: "editor", type: "response", status: response.status(), url });
    }
  });

  logStep("goto-editor");
  await editorPage.goto(EDITOR_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const tauriMockInstalled = await editorPage.evaluate(() => ({
    hasInternals: "__TAURI_INTERNALS__" in window,
    hasInvoke: typeof window.__TAURI_INTERNALS__?.invoke === "function",
  }));
  assert(tauriMockInstalled.hasInternals && tauriMockInstalled.hasInvoke, "Tauri mock was not installed before the editor loaded", tauriMockInstalled);

  logStep("open-project");
  await editorPage.waitForSelector('button[data-help-key="home.recentProject"]', { timeout: 30_000 });
  await editorPage.locator('button[data-help-key="home.recentProject"]').first().click();
  await editorPage.waitForSelector('button[data-help-key="toolbar.advanced"]', { timeout: 60_000 });

  logStep("open-preview-tab");
  await editorPage.locator('button[data-help-key="toolbar.advanced"]').click();
  await editorPage.waitForSelector('button[data-help-key="advanced.tab.preview"]', { timeout: 30_000 });
  await editorPage.locator('button[data-help-key="advanced.tab.preview"]').click();

  logStep("click-preview-open");
  await editorPage.waitForSelector('button[data-help-key="preview.open"]', { timeout: 30_000 });
  const popupPromise = editorPage.waitForEvent("popup", { timeout: 120_000 });
  await editorPage.locator('button[data-help-key="preview.open"]').click();

  logStep("wait-browser-preview-delivery");
  const gamePage = await popupPromise;
  gamePage.on("console", (msg) => events.push({ page: "gamecli", type: "console", level: msg.type(), text: msg.text() }));
  gamePage.on("pageerror", (error) => events.push({ page: "gamecli", type: "pageerror", text: error.message, stack: error.stack }));
  await gamePage.waitForSelector('[data-testid="start-new-game"], [data-testid="game-state-playing"]', { timeout: 120_000 });
  const gameState = await gamePage.evaluate(() => ({
    hasStart: Boolean(document.querySelector("[data-testid='start-new-game']")),
    hasPlaying: Boolean(document.querySelector("[data-testid='game-state-playing']")),
    bodyText: document.body.innerText.slice(0, 1200),
  }));

  const calls = await editorPage.evaluate(() => window.__AGENTVN_PREVIEW_IPC_CALLS__ || []);
  const bodyText = await editorPage.locator("body").innerText();
  const failedAssets = assetResponses.filter((item) => item.status >= 400);

  assert(calls.some((call) => call.command === "begin_gamecli_preview_upload"), "preview did not attempt the new upload command", calls);
  assert(!calls.some((call) => call.command === "open_gamecli_preview"), "large preview incorrectly used legacy byte-array IPC", calls);
  assert(!bodyText.includes("Command begin_gamecli_preview_upload not found"), "UI still exposes the missing command error", { bodyText: bodyText.slice(0, 1000), calls });
  assert(failedAssets.length === 0, "preview export had asset HTTP failures", failedAssets.slice(0, 10));

  console.log(JSON.stringify({
    ok: true,
    calls,
    assetRequestCount: assetResponses.length,
    gameState,
    eventCount: events.length,
  }, null, 2));

  await browser.close();
  stopServer(gameCliServer);
})().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
