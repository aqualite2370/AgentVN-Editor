#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "output", "playwright", "video-performance");
const REPORT = path.join(OUT, "report.json");
const FIXTURE = path.join(OUT, "video-performance.vncart");
const PORT = Number(process.env.AGENTVN_VIDEO_PERFORMANCE_PORT || 6996);
const URL = `http://127.0.0.1:${PORT}/`;
const VITE = path.join(
  ROOT,
  "GameCli_framework",
  "node_modules",
  ".bin",
  process.platform === "win32" ? "vite.cmd" : "vite",
);
const checks = [];
const consoleErrors = [];
const pageErrors = [];
let server;
let serverOutput;

function expect(condition, assertion, value, file = "scripts/video-performance-playwright.cjs") {
  if (!condition) throw new Error(`${assertion}; ${JSON.stringify(value)}`);
  checks.push({ assertion, value, file });
  console.log(`[PASS] ${assertion}`);
}

function killPort() {
  if (process.platform !== "win32") return;
  try {
    execFileSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique | % { if ($_ -gt 0) { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }`,
    ], { windowsHide: true, stdio: "ignore" });
  } catch (_) {}
}

function startServer() {
  fs.mkdirSync(path.join(OUT, "logs"), { recursive: true });
  serverOutput = fs.openSync(path.join(OUT, "logs", "gamecli-vite.log"), "a");
  const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : VITE;
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", VITE, "--host", "127.0.0.1", "--port", String(PORT)]
    : ["--host", "127.0.0.1", "--port", String(PORT)];
  server = spawn(command, args, {
    cwd: path.join(ROOT, "GameCli_framework"),
    stdio: ["ignore", serverOutput, serverOutput],
    windowsHide: true,
    shell: false,
  });
}

async function waitForServer() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(URL);
      if (response.ok || response.status < 500) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`GameCLI dev server did not start: ${URL}`);
}

function stopServer() {
  try { server?.kill(); } catch (_) {}
  try { if (serverOutput !== undefined) fs.closeSync(serverOutput); } catch (_) {}
  server = undefined;
  serverOutput = undefined;
  killPort();
}

function loadCartridgeApi() {
  const esbuild = require("../editor/node_modules/esbuild");
  const result = esbuild.buildSync({
    stdin: {
      contents: [
        "export { packCartridgeToUint8Array } from './shared/cartridge/packer';",
        "export { loadCartridgeFromArrayBuffer } from './shared/cartridge/unpacker';",
        "export { validateAssetReferences, validateManifest, validateRuntimeScript } from './shared/cartridge/validators';",
      ].join("\n"),
      loader: "ts",
      resolveDir: ROOT,
      sourcefile: "output/playwright/video-performance/cartridge-entry.ts",
    },
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    write: false,
    logLevel: "silent",
  });
  const filename = path.join(OUT, "cartridge-entry.cjs");
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(ROOT);
  compiled._compile(result.outputFiles[0].text, filename);
  return compiled.exports;
}

function svgBytes(svg) {
  return Buffer.from(svg, "utf8");
}

function backgroundSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#173049"/><path d="M0 810L620 310l450 350 430-280 420 430v270H0z" fill="#315b66"/><text x="90" y="990" fill="#fff" font-size="64">VIDEO PERFORMANCE QA</text></svg>`;
}

function spriteSvg(color, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="980"><ellipse cx="260" cy="170" rx="112" ry="132" fill="${color}"/><path d="M86 940Q115 330 260 305Q405 330 434 940Z" fill="${color}"/><text x="260" y="880" text-anchor="middle" fill="#fff" font-size="52">${label}</text></svg>`;
}

function fixtureModel() {
  const now = "2026-07-15T00:00:00.000Z";
  const script = {
    schema_version: "1.0.0",
    game_id: "video_performance_acceptance",
    title: "Video Performance Acceptance",
    entry_scene_id: "opening",
    speaker_focus: { enabled: true, scale: 1.08, duration_ms: 260 },
    characters: [
      { character_id: "alpha", name: "Alpha", aliases: [] },
      { character_id: "beta", name: "Beta", aliases: [] },
      { character_id: "ghost", name: "Ghost", aliases: [] },
    ],
    scenes: [{
      scene_id: "opening",
      title: "Opening",
      summary: "Speaker focus, video blocking and launch transition acceptance.",
      chapter: 1,
      tags: ["acceptance", "video"],
      commands: [
        { type: "background", background_id: "title_fallback", background_fit: "cover" },
        { type: "sprite", character_id: "alpha", sprite_id: "alpha_sprite", position: "left", layer: -20, visible: true },
        { type: "sprite", character_id: "beta", sprite_id: "beta_sprite", position: "right", layer: 80, visible: true },
        { type: "dialog", character_id: "alpha", text: "Alpha speaking." },
        { type: "narration", text: "Narration restores every sprite." },
        { type: "dialog", character_id: "ghost", text: "Invisible speaker does not focus a sprite." },
        { type: "dialog", character_id: "beta", text: "Beta speaking." },
        { type: "video", video_id: "cutscene_video", video_fit: "contain", fade_in_ms: 180, fade_out_ms: 180 },
        { type: "narration", text: "After cutscene." },
      ],
      is_ending: true,
    }],
  };
  const manifest = {
    manifest_version: "1.0.0",
    cartridge_version: "1.0.0",
    runtime_version: "0.2.0",
    game_id: script.game_id,
    title: script.title,
    author: "AgentVN QA",
    description: "Deterministic browser acceptance fixture.",
    version: "1.0.0",
    language: "zh-CN",
    tags: ["acceptance"],
    entry_script: "script.json",
    entry_scene_id: "opening",
    shell: {
      background: "title_fallback",
      background_video: "title_video",
      background_fit: "cover",
    },
    assets: [
      { asset_id: "title_fallback", asset_type: "background", path: "assets/background/title.svg", filename: "title.svg", mime_type: "image/svg+xml" },
      { asset_id: "alpha_sprite", asset_type: "sprite", path: "assets/sprite/alpha.svg", filename: "alpha.svg", mime_type: "image/svg+xml" },
      { asset_id: "beta_sprite", asset_type: "sprite", path: "assets/sprite/beta.svg", filename: "beta.svg", mime_type: "image/svg+xml" },
      { asset_id: "title_video", asset_type: "video", path: "assets/video/title.webm", filename: "title.webm", mime_type: "video/webm" },
      { asset_id: "cutscene_video", asset_type: "video", path: "assets/video/cutscene.webm", filename: "cutscene.webm", mime_type: "video/webm" },
    ],
    created_at: now,
    updated_at: now,
  };
  return { manifest, script };
}

async function createWebm(browser) {
  const page = await browser.newPage();
  try {
    await page.setContent("<canvas width='320' height='180'></canvas>");
    const bytes = await page.evaluate(async () => {
      const canvas = document.querySelector("canvas");
      const context = canvas.getContext("2d");
      const stream = canvas.captureStream(12);
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
        ? "video/webm;codecs=vp8"
        : "video/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      const stopped = new Promise((resolve) => {
        recorder.onstop = resolve;
      });
      recorder.start(40);
      for (let frame = 0; frame < 8; frame += 1) {
        context.fillStyle = frame % 2 ? "#246c73" : "#562e68";
        context.fillRect(0, 0, 320, 180);
        context.fillStyle = "#fff";
        context.font = "bold 28px sans-serif";
        context.fillText(`AgentVN ${frame + 1}`, 72, 100);
        await new Promise((resolve) => setTimeout(resolve, 45));
      }
      recorder.stop();
      await stopped;
      stream.getTracks().forEach((track) => track.stop());
      return [...new Uint8Array(await new Blob(chunks, { type: mimeType }).arrayBuffer())];
    });
    expect(bytes.length > 1000, "browser generated a deterministic playable WebM fixture", bytes.length);
    return Buffer.from(bytes);
  } finally {
    await page.close();
  }
}

async function createAndValidateFixture(videoBytes) {
  const api = loadCartridgeApi();
  const { manifest, script } = fixtureModel();
  const packed = await api.packCartridgeToUint8Array({
    manifest,
    script,
    gallery: { gallery_version: "1.0.0", items: [] },
    assets: [
      { path: "assets/background/title.svg", data: svgBytes(backgroundSvg()) },
      { path: "assets/sprite/alpha.svg", data: svgBytes(spriteSvg("#3c74b9", "ALPHA")) },
      { path: "assets/sprite/beta.svg", data: svgBytes(spriteSvg("#b64f79", "BETA")) },
      { path: "assets/video/title.webm", data: videoBytes },
      { path: "assets/video/cutscene.webm", data: videoBytes },
    ],
    exportOptions: { fileName: path.basename(FIXTURE) },
  });
  fs.writeFileSync(FIXTURE, packed);
  const buffer = packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength);
  const unpacked = await api.loadCartridgeFromArrayBuffer(buffer, {
    runtimeVersion: "0.2.0",
    sourceFileName: path.basename(FIXTURE),
  });
  const manifestValidation = api.validateManifest(unpacked.manifest);
  const scriptValidation = api.validateRuntimeScript(unpacked.script, unpacked.manifest);
  const references = api.validateAssetReferences(unpacked.script, unpacked.manifest);
  expect(manifestValidation.ok, "generated video fixture manifest passes shared validation", manifestValidation);
  expect(scriptValidation.ok, "generated video fixture script passes shared validation", scriptValidation);
  expect(references.ok, "title and cutscene video references pass shared validation", references);
  expect(
    unpacked.manifest.shell.background_video === "title_video"
      && unpacked.script.speaker_focus.scale === 1.08
      && unpacked.script.scenes[0].commands.some((command) => command.type === "video"),
    "real .vncart round-trip preserves video and speaker-focus fields",
    { shell: unpacked.manifest.shell, speakerFocus: unpacked.script.speaker_focus },
  );
}

function attachErrorCollectors(page, label) {
  page.on("pageerror", (error) => pageErrors.push(`${label}: ${error.stack || error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(`${label}: ${message.text()}`);
  });
}

async function preparePage(page, videoBytes, playPolicy = "allow") {
  await page.route("**/qa-fixtures/*.webm", async (route) => {
    const body = route.request().url().includes("corrupt.webm")
      ? Buffer.from("not-a-video", "utf8")
      : videoBytes;
    await route.fulfill({ status: 200, contentType: "video/webm", body });
  });
  await page.addInitScript((policy) => {
    window.__AGENTVN_MEDIA_PLAY_CALLS__ = [];
    HTMLMediaElement.prototype.play = function qaPlay() {
      window.__AGENTVN_MEDIA_PLAY_CALLS__.push({
        src: this.currentSrc || this.src,
        muted: this.muted,
        loop: this.loop,
        playsInline: this.playsInline,
      });
      if (policy === "reject-title" && (this.currentSrc || this.src).includes("title.webm")) {
        return Promise.reject(new DOMException("Autoplay rejected by QA policy.", "NotAllowedError"));
      }
      return Promise.resolve();
    };
  }, playPolicy);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#root", { timeout: 30_000 });
  await page.locator('[data-testid="game-state-library"]').waitFor({ state: "visible", timeout: 20_000 });
  await page.locator(".boot-overlay").waitFor({ state: "detached", timeout: 20_000 });
  await page.evaluate(({ fixtureUrl }) => {
    window.__AGENTVN_QA_LOAD__ = async (options = {}) => {
      const [{ useRuntimeStore }, { assetResolver }] = await Promise.all([
        import("/src/store/runtimeStore.ts"),
        import("/src/engine/assetResolver.ts"),
      ]);
      const svg = (color, label) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="520" height="980"><ellipse cx="260" cy="170" rx="112" ry="132" fill="${color}"/><path d="M86 940Q115 330 260 305Q405 330 434 940Z" fill="${color}"/><text x="260" y="880" text-anchor="middle" fill="white" font-size="52">${label}</text></svg>`)}`;
      const bg = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#173049"/><text x="80" y="990" fill="white" font-size="64">FALLBACK IMAGE</text></svg>`)}`;
      const speakerFocus = options.speakerFocus ?? { enabled: true, scale: 1.08, duration_ms: 260 };
      const script = {
        schema_version: "1.0.0",
        game_id: `video_performance_browser_${Date.now()}`,
        title: "Video Performance Browser",
        entry_scene_id: "opening",
        speaker_focus: speakerFocus,
        characters: [
          { character_id: "alpha", name: "Alpha", aliases: [] },
          { character_id: "beta", name: "Beta", aliases: [] },
          { character_id: "ghost", name: "Ghost", aliases: [] },
        ],
        scenes: [{
          scene_id: "opening",
          title: "Opening",
          summary: "Browser acceptance",
          chapter: 1,
          tags: ["acceptance"],
          commands: [
            { type: "background", background_id: "fallback", background_fit: "cover" },
            { type: "sprite", character_id: "alpha", sprite_id: "alpha_sprite", position: "left", layer: -20, visible: true },
            { type: "sprite", character_id: "beta", sprite_id: "beta_sprite", position: "right", layer: 80, visible: true },
            { type: "dialog", character_id: "alpha", text: "Alpha speaking." },
            { type: "narration", text: "Narration restores every sprite." },
            { type: "dialog", character_id: "ghost", text: "Invisible speaker." },
            { type: "dialog", character_id: "beta", text: "Beta speaking." },
            { type: "video", video_id: "cutscene", video_fit: "contain", fade_in_ms: 180, fade_out_ms: 180 },
            { type: "narration", text: "After cutscene." },
          ],
          is_ending: true,
        }],
      };
      const manifest = {
        manifest_version: "1.0.0",
        cartridge_version: "1.0.0",
        runtime_version: "0.2.0",
        game_id: script.game_id,
        title: script.title,
        author: "AgentVN QA",
        description: "Browser fixture",
        version: "1.0.0",
        language: "zh-CN",
        tags: ["acceptance"],
        entry_script: "script.json",
        entry_scene_id: "opening",
        shell: { background: "fallback", background_video: "title_video", background_fit: "cover" },
        assets: [
          { asset_id: "fallback", asset_type: "background", path: "fallback.svg", filename: "fallback.svg" },
          { asset_id: "alpha_sprite", asset_type: "sprite", path: "alpha.svg", filename: "alpha.svg" },
          { asset_id: "beta_sprite", asset_type: "sprite", path: "beta.svg", filename: "beta.svg" },
          { asset_id: "title_video", asset_type: "video", path: "title.webm", filename: "title.webm" },
          { asset_id: "cutscene", asset_type: "video", path: "cutscene.webm", filename: "cutscene.webm" },
        ],
        created_at: "2026-07-15T00:00:00.000Z",
        updated_at: "2026-07-15T00:00:00.000Z",
      };
      const assetUrls = {
        fallback: bg,
        alpha_sprite: svg("#3c74b9", "ALPHA"),
        beta_sprite: svg("#b64f79", "BETA"),
        title_video: `${fixtureUrl}/title.webm`,
        cutscene: options.missingCutscene
          ? ""
          : options.corruptCutscene
            ? `${fixtureUrl}/corrupt.webm`
            : `${fixtureUrl}/cutscene.webm`,
      };
      const game = {
        install_id: script.game_id,
        game_id: script.game_id,
        title: script.title,
        author: manifest.author,
        version: manifest.version,
        description: manifest.description,
        language: manifest.language,
        manifest,
        script,
        gallery: [],
        assetUrls,
        imported_at: manifest.created_at,
        updated_at: manifest.updated_at,
        source_file_name: "video-performance.vncart",
        cartridge_path: "",
      };
      assetResolver.configure(manifest, "", assetUrls);
      useRuntimeStore.getState().loadLivePreview(game);
      window.__AGENTVN_QA__ = {
        store: useRuntimeStore,
        startDirect() {
          useRuntimeStore.getState().openPreviewScreen("playing");
        },
        advance() {
          const runtime = useRuntimeStore.getState();
          if (runtime.engine.state.isTyping) runtime.engine.completeTyping();
          if (runtime.engine.state.typingRevealRequested) runtime.engine.completeTyping();
          useRuntimeStore.getState().next();
        },
        setPlaybackModes() {
          const runtime = useRuntimeStore.getState();
          runtime.engine.state.isAutoMode = true;
          runtime.engine.state.isSkipMode = true;
          runtime.engine.onChange?.(runtime.engine.state);
        },
        snapshot() {
          const state = useRuntimeStore.getState();
          return {
            screen: state.screen,
            launchTransition: state.launchTransition,
            launchTransitionDurationMs: state.launchTransitionDurationMs,
            commandIndex: state.engineState.currentCommandIndex,
            commandType: state.engineState.currentCommandType,
            activeVideo: state.engineState.activeVideo,
            dialog: state.engineState.dialog,
            isTyping: state.engineState.isTyping,
            typingRevealRequested: state.engineState.typingRevealRequested,
            isPaused: state.engineState.isPaused,
            isAutoMode: state.engineState.isAutoMode,
            isSkipMode: state.engineState.isSkipMode,
            playthroughId: state.engineState.playthroughId,
          };
        },
      };
    };
  }, { fixtureUrl: `${URL}qa-fixtures` });
}

async function loadScenario(page, options = {}) {
  await page.evaluate((value) => window.__AGENTVN_QA_LOAD__(value), options);
  await page.locator('[data-testid="game-state-title"]').waitFor({ state: "visible", timeout: 10_000 });
}

async function startDirect(page) {
  await page.evaluate(() => window.__AGENTVN_QA__.startDirect());
  await page.waitForFunction(
    () => {
      const state = window.__AGENTVN_QA__.snapshot();
      return state.screen === "playing" && state.launchTransition === "idle";
    },
    { timeout: 10_000 },
  );
}

async function advance(page, expectedIndex) {
  await page.evaluate((index) => {
    const runtime = window.__AGENTVN_QA__;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const state = runtime.snapshot();
      if (state.commandIndex >= index || (index === 7 && state.activeVideo)) return;
      runtime.advance();
    }
  }, expectedIndex);
  try {
    await page.waitForFunction(
      (index) => {
        const state = window.__AGENTVN_QA__.snapshot();
        return state.commandIndex === index || (index === 7 && state.activeVideo);
      },
      expectedIndex,
      { timeout: 5_000 },
    );
  } catch (error) {
    const state = await page.evaluate(() => window.__AGENTVN_QA__.snapshot()).catch(() => null);
    throw new Error(`advance to ${expectedIndex} timed out with state ${JSON.stringify(state)}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function focusChecks(browser, videoBytes) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  attachErrorCollectors(page, "focus");
  try {
    await preparePage(page, videoBytes);
    await loadScenario(page);
    await startDirect(page);
    const alpha = page.locator('.sprite-slot[data-character-id="alpha"]');
    const beta = page.locator('.sprite-slot[data-character-id="beta"]');
    await alpha.waitFor({ state: "visible" });
    const speaking = await page.locator(".sprite-slot").evaluateAll((nodes) => nodes.map((node) => ({
      id: node.getAttribute("data-character-id"),
      speaking: node.classList.contains("is-speaking"),
      zIndex: Number(getComputedStyle(node).zIndex),
      focusScale: getComputedStyle(node.querySelector(".speaker-focus-frame")).getPropertyValue("--speaker-focus-scale").trim(),
      focusDuration: getComputedStyle(node.querySelector(".speaker-focus-frame")).transitionDuration,
      animationTransform: getComputedStyle(node.querySelector(".sprite-animation-frame")).transform,
    })));
    const byId = Object.fromEntries(speaking.map((item) => [item.id, item]));
    expect(byId.alpha.speaking && byId.alpha.focusScale === "1.08", "visible speaking character receives configured focus scale", speaking, "GameCli_framework/src/components/player/SpriteLayer.tsx");
    expect(byId.alpha.zIndex > byId.beta.zIndex, "speaking character is raised above higher base sprite layers", speaking, "GameCli_framework/src/components/player/SpriteLayer.tsx");
    expect(byId.alpha.animationTransform === "none", "speaker focus uses an independent transform frame", speaking, "GameCli_framework/src/components/player/SpriteLayer.tsx");
    await page.screenshot({ path: path.join(OUT, "01-speaker-focus-desktop.png"), fullPage: true });

    await advance(page, 4);
    expect(await page.locator(".sprite-slot.is-speaking").count() === 0, "narration restores all sprites to their base scale");
    await advance(page, 5);
    const invisibleSpeakerState = await page.locator(".sprite-slot").evaluateAll((nodes) => nodes.map((node) => ({
      id: node.getAttribute("data-character-id"),
      phase: node.getAttribute("data-sprite-phase"),
      speaking: node.classList.contains("is-speaking"),
      focusScale: getComputedStyle(node.querySelector(".speaker-focus-frame")).getPropertyValue("--speaker-focus-scale").trim(),
    })));
    expect(
      invisibleSpeakerState.every((item) => !item.speaking && item.focusScale === "1"),
      "invisible speaker does not focus an unrelated sprite",
      invisibleSpeakerState,
      "GameCli_framework/src/components/player/SpriteLayer.tsx",
    );
    await advance(page, 6);
    expect(await beta.evaluate((node) => node.classList.contains("is-speaking")), "speaker focus follows dialog character changes");

    await loadScenario(page, { speakerFocus: { enabled: false, scale: 1.12, duration_ms: 400 } });
    await startDirect(page);
    expect(await page.locator(".sprite-slot.is-speaking").count() === 0, "disabled project speaker focus leaves every sprite unchanged");
  } finally {
    await context.close();
  }
}

async function titleVideoChecks(browser, videoBytes) {
  const successContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const successPage = await successContext.newPage();
  attachErrorCollectors(successPage, "title-success");
  try {
    await preparePage(successPage, videoBytes, "allow");
    await loadScenario(successPage);
    const video = successPage.locator(".main-menu-background-video");
    await video.waitFor({ state: "visible" });
    const attributes = await video.evaluate((node) => ({
      muted: node.muted,
      loop: node.loop,
      controls: node.controls,
      playsInline: node.playsInline,
      objectFit: getComputedStyle(node).objectFit,
    }));
    expect(
      attributes.muted === false && attributes.loop && !attributes.controls && attributes.playsInline && attributes.objectFit === "cover",
      "title video is unmuted, looping, inline, control-free and cover-fitted",
      attributes,
      "GameCli_framework/src/components/shell/MainMenu.tsx",
    );
    const calls = await successPage.evaluate(() => window.__AGENTVN_MEDIA_PLAY_CALLS__);
    expect(calls.some((call) => call.src.includes("title.webm") && call.muted === false), "title menu attempts unmuted autoplay", calls, "GameCli_framework/src/components/shell/MainMenu.tsx");
    await successPage.screenshot({ path: path.join(OUT, "02-title-video-desktop.png"), fullPage: true });
  } finally {
    await successContext.close();
  }

  const failureContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const failurePage = await failureContext.newPage();
  attachErrorCollectors(failurePage, "title-fallback");
  try {
    await preparePage(failurePage, videoBytes, "reject-title");
    await loadScenario(failurePage);
    await failurePage.locator(".main-menu-background-video").waitFor({ state: "detached", timeout: 3_000 });
    const menu = failurePage.locator(".main-menu");
    const state = await menu.evaluate((node) => ({
      activeVideo: node.classList.contains("has-active-video"),
      backgroundImage: getComputedStyle(node).backgroundImage,
    }));
    expect(!state.activeVideo && state.backgroundImage.includes("data:image/svg+xml"), "rejected title autoplay hides video and keeps fallback image", state, "GameCli_framework/src/components/shell/MainMenu.tsx");
    await failurePage.screenshot({ path: path.join(OUT, "03-title-video-fallback-mobile.png"), fullPage: true });
  } finally {
    await failureContext.close();
  }
}

async function enterVideo(page) {
  await startDirect(page);
  await advance(page, 4);
  await advance(page, 5);
  await advance(page, 6);
  await advance(page, 7);
  await page.evaluate(() => window.__AGENTVN_QA__.setPlaybackModes());
  await page.locator('[data-testid="cutscene-video-overlay"]').waitFor({ state: "visible" });
  await page.locator(".cutscene-video-overlay video").evaluate((video) => {
    video.pause();
    video.currentTime = 0;
  }).catch(() => {});
}

async function videoBlockingAndCompletionChecks(browser, videoBytes) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  attachErrorCollectors(page, "video-blocking");
  try {
    await preparePage(page, videoBytes);
    await loadScenario(page);
    await enterVideo(page);
    const before = await page.evaluate(() => window.__AGENTVN_QA__.snapshot());
    expect(
      before.commandIndex === 7 && before.activeVideo && before.isAutoMode && before.isSkipMode,
      "video command remains active while auto and skip modes are enabled",
      before,
      "GameCli_framework/src/components/player/StoryPlayer.tsx",
    );
    expect(
      await page.locator(".dialog-box, .choice-panel, .playback-controls").count() === 0,
      "cutscene hides dialog, choices and playback controls",
    );
    const presentation = await page.locator('[data-testid="cutscene-video-overlay"]').evaluate((node) => ({
      fadeIn: node.style.getPropertyValue("--cutscene-fade-in").trim(),
      fadeOut: node.style.getPropertyValue("--cutscene-fade-out").trim(),
      objectFit: getComputedStyle(node.querySelector("video")).objectFit,
    }));
    expect(
      presentation.fadeIn === "180ms" && presentation.fadeOut === "180ms" && presentation.objectFit === "contain",
      "cutscene applies configured fit and independent fade durations",
      presentation,
      "GameCli_framework/src/components/player/CutsceneVideoOverlay.tsx",
    );
    await page.locator('[data-testid="cutscene-video-overlay"]').click();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Control");
    await page.waitForTimeout(350);
    const blocked = await page.evaluate(() => window.__AGENTVN_QA__.snapshot());
    expect(blocked.commandIndex === 7 && blocked.activeVideo, "normal click, keyboard advance, auto and skip cannot pass through video", blocked);

    const video = page.locator(".cutscene-video-overlay video");
    await video.evaluate((node) => node.dispatchEvent(new Event("ended")));
    await page.waitForFunction(() => window.__AGENTVN_QA__.snapshot().commandIndex === 8);
    await page.waitForTimeout(250);
    const completed = await page.evaluate(() => window.__AGENTVN_QA__.snapshot());
    expect(completed.commandIndex === 8 && !completed.activeVideo, "natural video completion advances exactly once", completed);

    await loadScenario(page, { corruptCutscene: true });
    await enterVideo(page);
    const alert = page.locator(".cutscene-video-error");
    await alert.waitFor({ state: "visible" });
    expect(await alert.getByRole("button").count() === 1, "undecodable video exposes a continue-story recovery action");
    await alert.getByRole("button").click();
    await page.waitForFunction(() => window.__AGENTVN_QA__.snapshot().commandIndex === 8);
    expect(!(await page.evaluate(() => window.__AGENTVN_QA__.snapshot().activeVideo)), "video recovery action cannot deadlock story progression");
  } finally {
    await context.close();
  }
}

async function armSkip(page) {
  const overlay = page.locator('[data-testid="cutscene-video-overlay"]');
  const box = await overlay.boundingBox();
  if (!box) throw new Error("Cutscene overlay has no bounding box.");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.click(x, y);
  await page.waitForTimeout(90);
  await page.mouse.click(x, y);
  await page.locator(".cutscene-skip-prompt").waitFor({ state: "visible" });
  return { overlay, x, y };
}

async function videoGestureChecks(browser, videoBytes) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  attachErrorCollectors(page, "video-gesture");
  try {
    await preparePage(page, videoBytes);
    await loadScenario(page);
    await enterVideo(page);
    let pointer = await armSkip(page);
    expect(await page.locator(".cutscene-skip-prompt").isVisible(), "two taps within 320ms arm the five-second skip prompt");
    await page.screenshot({ path: path.join(OUT, "04-cutscene-ring-0.png"), fullPage: true });

    await page.mouse.move(pointer.x, pointer.y);
    await page.mouse.down();
    await page.waitForTimeout(420);
    await page.mouse.up();
    await page.waitForTimeout(50);
    let ring = await page.locator(".cutscene-progress-value").evaluate((node) => ({
      dashOffset: node.style.strokeDashoffset,
      dashArray: node.style.strokeDasharray,
    }));
    expect(ring.dashOffset === ring.dashArray, "short hold resets ring progress without skipping", ring);
    expect((await page.evaluate(() => window.__AGENTVN_QA__.snapshot().commandIndex)) === 7, "short hold keeps the cutscene active");

    await page.mouse.down();
    await page.waitForTimeout(300);
    await page.mouse.move(pointer.x + 35, pointer.y);
    await page.waitForTimeout(80);
    await page.mouse.up();
    ring = await page.locator(".cutscene-progress-value").evaluate((node) => ({
      dashOffset: node.style.strokeDashoffset,
      dashArray: node.style.strokeDasharray,
    }));
    expect(ring.dashOffset === ring.dashArray, "moving outside the hold tolerance cancels and resets progress", ring);

    await page.mouse.move(pointer.x, pointer.y);
    await page.mouse.down();
    await page.waitForTimeout(220);
    await pointer.overlay.dispatchEvent("pointercancel", {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: pointer.x,
      clientY: pointer.y,
    });
    await page.mouse.up();
    ring = await page.locator(".cutscene-progress-value").evaluate((node) => ({
      dashOffset: node.style.strokeDashoffset,
      dashArray: node.style.strokeDasharray,
    }));
    expect(ring.dashOffset === ring.dashArray, "pointer cancellation resets hold progress while keeping skip armed", ring);

    await page.mouse.move(pointer.x, pointer.y);
    await page.mouse.down();
    await page.waitForTimeout(2500);
    const middleRing = await page.locator(".cutscene-progress-value").evaluate((node) => ({
      dashOffset: Number(node.style.strokeDashoffset),
      dashArray: Number(node.style.strokeDasharray),
    }));
    expect(
      middleRing.dashOffset > 0 && middleRing.dashOffset < middleRing.dashArray,
      "progress ring exposes an intermediate monotonic hold state",
      middleRing,
    );
    await page.screenshot({ path: path.join(OUT, "05-cutscene-ring-mid.png"), fullPage: true });
    await page.mouse.up();

    await page.mouse.down();
    await page.waitForTimeout(5100);
    await page.locator(".cutscene-video-overlay.is-exiting").waitFor({ state: "visible", timeout: 1500 });
    const completedRing = await page.locator(".cutscene-progress-value").evaluate((node) => ({
      dashOffset: Number(node.style.strokeDashoffset),
      dashArray: Number(node.style.strokeDasharray),
    }));
    expect(completedRing.dashOffset <= 0.01, "five-second hold closes the progress ring", completedRing);
    await page.screenshot({ path: path.join(OUT, "06-cutscene-ring-complete.png"), fullPage: true });
    await page.mouse.up();
    await page.waitForFunction(() => window.__AGENTVN_QA__.snapshot().commandIndex === 8);
    expect((await page.evaluate(() => window.__AGENTVN_QA__.snapshot().commandIndex)) === 8, "completed hold fades out and advances to the next event");
  } finally {
    await context.close();
  }

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobilePage = await mobileContext.newPage();
  attachErrorCollectors(mobilePage, "video-mobile");
  try {
    await preparePage(mobilePage, videoBytes);
    await loadScenario(mobilePage);
    await enterVideo(mobilePage);
    const overlay = mobilePage.locator('[data-testid="cutscene-video-overlay"]');
    const box = await overlay.boundingBox();
    if (!box) throw new Error("Mobile cutscene overlay has no bounding box.");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await mobilePage.touchscreen.tap(x, y);
    await mobilePage.waitForTimeout(90);
    await mobilePage.touchscreen.tap(x, y);
    await mobilePage.locator(".cutscene-skip-prompt").waitFor({ state: "visible" });
    await mobilePage.screenshot({ path: path.join(OUT, "07-cutscene-mobile.png"), fullPage: true });
    expect(await mobilePage.locator(".cutscene-skip-prompt").isVisible(), "touch double-tap arms the skip prompt in a mobile viewport");
  } finally {
    await mobileContext.close();
  }
}

async function launchTransitionMode(browser, videoBytes, reducedMotion) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion,
  });
  const page = await context.newPage();
  attachErrorCollectors(page, `launch-${reducedMotion}`);
  try {
    await preparePage(page, videoBytes);
    await loadScenario(page);
    const before = await page.evaluate(() => window.__AGENTVN_QA__.snapshot());
    await page.locator('[data-testid="start-new-game"]').evaluate((button) => {
      button.click();
      button.click();
    });
    const blackout = page.locator('[data-testid="game-launch-blackout"]');
    await blackout.waitFor({ state: "visible" });
    await page.waitForFunction(() => window.__AGENTVN_QA__.snapshot().launchTransition === "covering");
    const covering = await page.evaluate(() => window.__AGENTVN_QA__.snapshot());
    const css = await blackout.evaluate((node) => ({
      phase: node.className,
      duration: node.style.getPropertyValue("--game-launch-duration"),
      opacity: getComputedStyle(node).opacity,
    }));
    const expectedCoverDuration = reducedMotion === "reduce" ? 408 : 748;
    const expectedRevealDuration = reducedMotion === "reduce" ? 408 : 884;
    expect(
      covering.screen === "title_menu"
        && covering.launchTransition === "covering"
        && covering.launchTransitionDurationMs === expectedCoverDuration
        && css.duration.trim() === `${expectedCoverDuration}ms`,
      `new-game transition covers the title before loading (${reducedMotion})`,
      { covering, css },
      "GameCli_framework/src/store/runtimeStore.ts",
    );
    await page.waitForFunction(() => {
      const state = window.__AGENTVN_QA__.snapshot();
      return state.screen === "playing" && state.commandIndex === 3 && state.launchTransition !== "idle";
    });
    const stable = await page.evaluate(() => window.__AGENTVN_QA__.snapshot());
    expect(
      stable.playthroughId === before.playthroughId + 1 && stable.dialog?.character_id === "alpha",
      `first stable scene frame is committed once behind blackout (${reducedMotion})`,
      { before, stable },
      "GameCli_framework/src/store/runtimeStore.ts",
    );
    await page.waitForFunction(() => window.__AGENTVN_QA__.snapshot().launchTransition === "revealing");
    const revealing = await page.evaluate(() => window.__AGENTVN_QA__.snapshot());
    const revealCss = await blackout.evaluate((node) => ({
      phase: node.className,
      duration: node.style.getPropertyValue("--game-launch-duration"),
    }));
    expect(
      revealing.launchTransitionDurationMs === expectedRevealDuration
        && revealCss.duration.trim() === `${expectedRevealDuration}ms`,
      `new-game transition reveals with the extended blackout duration (${reducedMotion})`,
      { revealing, revealCss },
      "GameCli_framework/src/store/runtimeStore.ts",
    );
    if (reducedMotion === "no-preference") {
      await page.screenshot({ path: path.join(OUT, "08-new-game-blackout.png"), fullPage: true });
    }
    await blackout.waitFor({ state: "detached", timeout: 2500 });
    const final = await page.evaluate(() => window.__AGENTVN_QA__.snapshot());
    expect(
      final.screen === "playing" && final.playthroughId === before.playthroughId + 1,
      `blackout reveals without duplicate starts (${reducedMotion})`,
      final,
      "GameCli_framework/src/store/runtimeStore.ts",
    );
    return { cover: expectedCoverDuration, reveal: expectedRevealDuration };
  } finally {
    await context.close();
  }
}

async function launchTransitionChecks(browser, videoBytes) {
  expect(
    JSON.stringify(await launchTransitionMode(browser, videoBytes, "no-preference")) === JSON.stringify({ cover: 748, reveal: 884 }),
    "normal-motion launch uses 1.7x extended blackout cover and reveal phases",
  );
  expect(
    JSON.stringify(await launchTransitionMode(browser, videoBytes, "reduce")) === JSON.stringify({ cover: 408, reveal: 408 }),
    "reduced-motion launch keeps blackout protection with 1.7x extended opacity fades",
  );
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const report = {
    ok: false,
    startedAt: new Date().toISOString(),
    fixture: FIXTURE,
    checks,
    artifacts: { outputDir: OUT },
  };
  killPort();
  startServer();
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const videoBytes = await createWebm(browser);
    await createAndValidateFixture(videoBytes);
    await focusChecks(browser, videoBytes);
    await titleVideoChecks(browser, videoBytes);
    await videoBlockingAndCompletionChecks(browser, videoBytes);
    await videoGestureChecks(browser, videoBytes);
    await launchTransitionChecks(browser, videoBytes);
    expect(pageErrors.length === 0, "browser acceptance has no uncaught page errors", pageErrors);
    expect(consoleErrors.length === 0, "browser acceptance has no console errors", consoleErrors);
    report.ok = true;
  } catch (error) {
    report.error = error instanceof Error ? error.stack || error.message : String(error);
    throw error;
  } finally {
    await browser.close();
    stopServer();
    report.finishedAt = new Date().toISOString();
    report.pageErrors = pageErrors;
    report.consoleErrors = consoleErrors;
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  }
  console.log(`Video performance browser acceptance passed with ${checks.length} checks.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
