#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const { chromium } = require(path.join(ROOT, "editor", "node_modules", "playwright"));
const PORT = Number(process.env.AGENTVN_SCENE_SPRITE_UI_PORT || 6992);
const URL = "http://127.0.0.1:" + PORT + "/?mode=preview";
const VITE = path.join(ROOT, "GameCli_framework", "node_modules", ".bin", process.platform === "win32" ? "vite.cmd" : "vite");
const OUT = path.join(ROOT, "output", "playwright", "gamecli-scene-sprite-isolation");
const REPORT = path.join(OUT, "report.json");

let server;
let serverOut;
const assertions = [];
const screenshots = [];

function ensure(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, data) {
  ensure(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function assertPass(name, pass, details) {
  assertions.push({ name, pass: Boolean(pass), details: details ?? null });
  if (!pass) throw new Error(name + " failed: " + JSON.stringify(details));
}

function svg(text, fill) {
  return "data:image/svg+xml;base64," + Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="768">' +
    '<rect width="512" height="768" fill="none"/>' +
    '<circle cx="256" cy="150" r="92" fill="#f0c4a8"/>' +
    '<rect x="136" y="288" width="240" height="380" rx="48" fill="' + fill + '"/>' +
    '<text x="256" y="550" text-anchor="middle" fill="#fff" font-size="70" font-family="Arial">' + text + "</text>" +
    "</svg>",
    "utf8",
  ).toString("base64");
}

const SPRITE_OLD = svg("A", "#3f6fd8");
const SPRITE_NEW = svg("C", "#c05b9b");
const BG = "data:image/svg+xml;base64," + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#1c2135"/><text x="640" y="360" text-anchor="middle" fill="#fff" opacity=".22" font-size="54">Scene Sprite Isolation</text></svg>',
  "utf8",
).toString("base64");

function killPort(port) {
  if (process.platform !== "win32") return;
  try {
    execFileSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Get-NetTCPConnection -LocalPort " + port + " -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique | % { if ($_ -gt 0) { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }",
    ], { windowsHide: true, stdio: "ignore" });
  } catch (_) {}
}

async function reachable(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok || response.status < 500;
  } catch (_) {
    return false;
  }
}

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitServer() {
  const started = Date.now();
  while (Date.now() - started < 90000) {
    if (await reachable(URL)) return;
    await wait(500);
  }
  throw new Error("GameCLI dev server not reachable: " + URL);
}

function startServer() {
  ensure(path.join(OUT, "logs"));
  const logFile = path.join(OUT, "logs", "gamecli-vite.log");
  serverOut = fs.openSync(logFile, "a");
  const cmd = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : VITE;
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", VITE, "--host", "127.0.0.1", "--port", String(PORT)]
    : ["--host", "127.0.0.1", "--port", String(PORT)];
  server = spawn(cmd, args, {
    cwd: path.join(ROOT, "GameCli_framework"),
    stdio: ["ignore", serverOut, serverOut],
    shell: false,
    windowsHide: true,
  });
}

function stopServer() {
  try { if (server) server.kill(); } catch (_) {}
  try { if (serverOut !== undefined) fs.closeSync(serverOut); } catch (_) {}
}

async function installStory(page) {
  await page.evaluate(async (payload) => {
    const { assetResolver } = await import("/src/engine/assetResolver.ts");
    const { useRuntimeStore } = await import("/src/store/runtimeStore.ts");
    const { useSettingsStore } = await import("/src/store/settingsStore.ts");
    window.__AGENTVN_RUNTIME_STORE__ = useRuntimeStore;
    const manifest = {
      game_id: "scene_sprite_isolation_ui",
      title: "Scene Sprite Isolation UI",
      version: "1.0.0",
      locale: "zh-CN",
      assets: [
        { asset_id: "bg", type: "background", path: "bg.svg" },
        { asset_id: "sprite_old", type: "sprite", path: "old.svg" },
        { asset_id: "sprite_new", type: "sprite", path: "new.svg" },
      ],
      entry_scene_id: "scene_a",
    };
    const script = {
      schema_version: "1.0.0",
      entry_scene_id: "scene_a",
      characters: [{ character_id: "hero", name: "Hero" }],
      scenes: [
        {
          scene_id: "scene_a",
          title: "A",
          summary: "Scene A shows old sprite.",
          tags: [],
          chapter: 1,
          next_scene_id: "scene_b",
          commands: [
            { type: "background", background_id: "bg", background_fit: "cover" },
            { type: "sprite", character_id: "hero", sprite_id: "sprite_old", position: "center", visible: true, scale: 1 },
            { type: "narration", text: "场景 A：这里显示旧立绘。" },
          ],
        },
        {
          scene_id: "scene_b",
          title: "B",
          summary: "Scene B has no sprite command.",
          tags: [],
          chapter: 1,
          next_scene_id: "scene_c",
          commands: [{ type: "narration", text: "场景 B：没有任何立绘命令，旧人物必须消失。" }],
        },
        {
          scene_id: "scene_c",
          title: "C",
          summary: "Scene C shows fresh sprite.",
          tags: [],
          chapter: 1,
          commands: [
            { type: "sprite", character_id: "hero", sprite_id: "sprite_new", position: "right", visible: true, scale: 0.85 },
            { type: "narration", text: "场景 C：重新显式声明新立绘。" },
          ],
        },
      ],
    };
    const urls = { bg: payload.bg, "bg.svg": payload.bg, sprite_old: payload.old, "old.svg": payload.old, sprite_new: payload.fresh, "new.svg": payload.fresh };
    assetResolver.configure(manifest, "", urls);
    const runtime = useRuntimeStore.getState();
    runtime.engine.loadScript(script, manifest);
    useRuntimeStore.setState({
      currentGame: { install_id: "scene-sprite-isolation-ui", game_id: manifest.game_id, title: manifest.title, manifest, script, assetUrls: urls },
      screen: "playing",
      engineState: runtime.engine.state,
      isUiHidden: false,
      skipToggleActive: false,
      skipHoldActive: false,
    });
    useSettingsStore.getState().updateSettings({ textSpeed: 1, skipUnread: true, autoSpeed: 1200, fullscreen: false });
    useRuntimeStore.getState().startNewGame();
    window.__AGENTVN_SCENE_SPRITE_READY__ = true;
  }, { old: SPRITE_OLD, fresh: SPRITE_NEW, bg: BG });
}

async function state(page) {
  return page.evaluate(() => {
    const playing = document.querySelector("[data-testid='game-state-playing']");
    const sprites = Array.from(document.querySelectorAll("[data-character-id]")).map((node) => ({
      characterId: node.getAttribute("data-character-id"),
      spriteId: node.getAttribute("data-sprite-id"),
      className: node.getAttribute("class"),
      visible: getComputedStyle(node).display !== "none" && getComputedStyle(node).visibility !== "hidden",
      rect: (() => {
        const rect = node.getBoundingClientRect();
        return { width: rect.width, height: rect.height, left: rect.left, top: rect.top };
      })(),
    }));
    return {
      sceneId: playing?.getAttribute("data-current-scene-id") || "",
      commandIndex: playing?.getAttribute("data-current-command-index") || "",
      commandType: playing?.getAttribute("data-current-command-type") || "",
      text: document.querySelector(".dialog-text")?.textContent || "",
      sprites,
      engineSprites: window.__AGENTVN_RUNTIME_STORE__?.getState?.().engineState?.sprites || {},
      engineDialogText: window.__AGENTVN_RUNTIME_STORE__?.getState?.().engineState?.dialog?.text || "",
    };
  });
}

async function shot(page, name) {
  const file = path.join(OUT, name + ".png");
  await page.screenshot({ path: file, fullPage: true });
  screenshots.push(path.relative(ROOT, file).replaceAll("\\", "/"));
}

async function clickAdvance(page) {
  const target = page.locator(".dialog-text").first();
  await page.locator(".boot-overlay").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);
  const initialScene = await page.locator("[data-testid='game-state-playing']").getAttribute("data-current-scene-id");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const interaction = attempt % 2 === 0 ? target : page.locator(".dialog-box").first();
    await interaction.click({ delay: 5, force: true });
    await page.waitForTimeout(260);
    const scene = await page.locator("[data-testid='game-state-playing']").getAttribute("data-current-scene-id");
    if (scene && scene !== initialScene) return;
  }
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  ensure(OUT);
  killPort(PORT);
  startServer();

  const browser = await chromium.launch({ headless: true });
  let context;
  const errors = [];
  try {
    await waitServer();
    context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/fixed-only.json", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ fixedOnly: false }),
    }));
    await page.route("**/runtime-mode.json", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ mode: "preview" }),
    }));
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#root", { timeout: 30000 });
    await page.waitForTimeout(1000);
    await installStory(page);
    await page.waitForFunction(() => window.__AGENTVN_SCENE_SPRITE_READY__ === true, null, { timeout: 30000 });
    await page.waitForSelector("[data-testid='game-state-playing'][data-current-scene-id='scene_a']", { timeout: 30000 });
    await page.waitForSelector("[data-character-id='hero'][data-sprite-id='sprite_old']", { timeout: 30000 });
    await shot(page, "scene-a-old-sprite");
    const sceneA = await state(page);
    assertPass("scene A shows old sprite", sceneA.sprites.some((sprite) => sprite.characterId === "hero" && sprite.spriteId === "sprite_old" && sprite.visible), sceneA);

    await page.evaluate(() => window.__AGENTVN_RUNTIME_STORE__.getState().next());
    await page.waitForSelector("[data-testid='game-state-playing'][data-current-scene-id='scene_b']", { timeout: 6000 });
    await page.waitForTimeout(800);
    await shot(page, "scene-b-no-sprite");
    const sceneB = await state(page);
    assertPass("scene B has no inherited sprite DOM", !sceneB.sprites.some((sprite) => sprite.characterId === "hero"), sceneB);
    assertPass("scene B engine sprite state is empty", Object.keys(sceneB.engineSprites).length === 0, sceneB.engineSprites);
    assertPass("scene B narration still renders", sceneB.engineDialogText.includes("场景 B"), sceneB);

    await page.evaluate(() => window.__AGENTVN_RUNTIME_STORE__.getState().next());
    await page.waitForSelector("[data-testid='game-state-playing'][data-current-scene-id='scene_c']", { timeout: 6000 });
    await page.waitForSelector("[data-character-id='hero'][data-sprite-id='sprite_new']", { timeout: 6000 });
    await page.waitForTimeout(300);
    await shot(page, "scene-c-new-sprite");
    const sceneC = await state(page);
    assertPass("scene C shows fresh explicit sprite", sceneC.sprites.some((sprite) => sprite.characterId === "hero" && sprite.spriteId === "sprite_new" && sprite.visible), sceneC);
    assertPass("scene C does not inherit old sprite id", !sceneC.sprites.some((sprite) => sprite.spriteId === "sprite_old"), sceneC);
    assertPass("browser console has no errors", errors.length === 0, errors);

    writeJson(REPORT, { status: "passed", assertions, screenshots, errors, finalState: sceneC });
    console.log("PASS GameCLI scene sprite isolation Playwright acceptance");
    console.log(REPORT);
  } catch (error) {
    writeJson(REPORT, { status: "failed", assertions, screenshots, errors, failure: String(error && error.stack || error) });
    throw error;
  } finally {
    if (context) await context.close().catch(() => {});
    await browser.close().catch(() => {});
    stopServer();
  }
}

main().catch((error) => {
  console.error(error);
  stopServer();
  process.exit(1);
});
