#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { chromium } = require("../Editor/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "output", "playwright", "client-experience-enhancement", "sprite-transition-runtime");
const ENGINE_ONLY = process.argv.includes("--engine-only");
const INTERRUPTION = process.argv.includes("--interruption");
const REPORT = path.join(OUT, ENGINE_ONLY ? "engine-report.json" : INTERRUPTION ? "interruption-report.json" : "runtime-report.json");
const PORT = Number(process.env.AGENTVN_SPRITE_TRANSITION_PORT || 6991);
const URL = `http://127.0.0.1:${PORT}/?mode=preview`;
const VITE = path.join(ROOT, "GameCli_framework", "node_modules", ".bin", process.platform === "win32" ? "vite.cmd" : "vite");
const checks = [];
const consoleErrors = [];
const pageErrors = [];
let server;
let serverOutput;

function expect(condition, assertion, value, file = "GameCli_framework/src/engine/StoryEngine.ts") {
  if (!condition) throw new Error(`${assertion}; ${JSON.stringify(value)}`);
  checks.push({ assertion, value, file });
}

function loadEngineApi() {
  const esbuild = require("../Editor/node_modules/esbuild");
  const result = esbuild.buildSync({
    stdin: {
      contents: "export { StoryEngine } from './GameCli_framework/src/engine/StoryEngine';",
      loader: "ts",
      resolveDir: ROOT,
      sourcefile: "output/playwright/sprite-transition-engine-entry.ts",
    },
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    write: false,
    logLevel: "silent",
  });
  const filename = path.join(OUT, "sprite-transition-engine.cjs");
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(ROOT);
  compiled._compile(result.outputFiles[0].text, filename);
  return compiled.exports;
}

function configureEngine(engine) {
  engine.script = {
    schema_version: "1.0.0",
    game_id: "sprite_transition_engine",
    title: "Sprite Transition Engine",
    entry_scene_id: "scene",
    default_sprite_scale: 1,
    characters: [{ character_id: "hero", name: "Hero", aliases: [] }],
    scenes: [{
      scene_id: "scene",
      title: "Scene",
      summary: "Sprite transition engine acceptance.",
      chapter: 1,
      tags: ["acceptance"],
      commands: [],
      is_ending: true,
    }],
  };
  engine.manifest = { game_id: "sprite_transition_engine" };
}

function runEngineChecks() {
  global.window = {
    setTimeout: () => 0,
    dispatchEvent: () => true,
  };
  global.CustomEvent ??= class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  global.performance ??= { now: () => Date.now() };
  const { StoryEngine } = loadEngineApi();
  const engine = new StoryEngine();
  configureEngine(engine);

  engine.executeCommand({
    type: "sprite",
    character_id: "hero",
    sprite_id: "sprite_a",
    position: "center",
    visible: true,
    scale: 1,
    animation_config: {
      kind: "fade",
      phase: "enter",
      duration_ms: 280,
      easing: "ease-out",
      blocking: true,
    },
    switch_transition: { kind: "blur", duration_ms: 640, easing: "ease-in-out" },
  });
  expect(engine.state.sprites.hero?.sprite_id === "sprite_a", "first visible sprite command stores the requested sprite", engine.state.sprites.hero);
  expect(!engine.state.sprites.hero?.replacement, "first appearance does not create replacement metadata", engine.state.sprites.hero);
  expect(
    engine.state.animationEffects.some((effect) => effect.target_id === "hero" && effect.params.character_animation_phase === "enter"),
    "first appearance continues to use animation_config entry behavior",
    engine.state.animationEffects,
  );

  engine.state.animationEffects = [];
  engine.executeCommand({
    type: "sprite",
    character_id: "hero",
    sprite_id: "sprite_a",
    position: "center",
    visible: true,
    scale: 1,
    switch_transition: { kind: "crossfade", duration_ms: 500, easing: "ease-out" },
  });
  expect(!engine.state.sprites.hero?.replacement, "same sprite id does not create replacement metadata", engine.state.sprites.hero);

  engine.executeCommand({
    type: "sprite",
    character_id: "hero",
    sprite_id: "sprite_b",
    position: "center",
    visible: true,
    scale: 1.2,
    animation_config: {
      kind: "fade",
      phase: "enter",
      duration_ms: 300,
      easing: "ease-out",
      blocking: true,
    },
    switch_transition: { kind: "blur", duration_ms: 640, easing: "ease-out" },
  });
  const firstReplacement = engine.state.sprites.hero?.replacement;
  expect(engine.state.sprites.hero?.sprite_id === "sprite_b" && engine.state.sprites.hero?.scale === 1.2, "replacement command stores the new sprite and scale", engine.state.sprites.hero);
  expect(
    firstReplacement?.previous_sprite_id === "sprite_a"
      && firstReplacement.previous_scale === 1
      && firstReplacement.previous_position === "center",
    "replacement metadata preserves the outgoing sprite visual state",
    firstReplacement,
  );
  expect(
    firstReplacement?.transition.kind === "blur"
      && firstReplacement.transition.duration_ms === 640
      && firstReplacement.transition.easing === "ease-out",
    "switch_transition is normalized into replacement metadata",
    firstReplacement,
  );
  expect(firstReplacement?.key === 1, "first real sprite replacement receives a stable replacement key", firstReplacement);
  expect(
    engine.state.animationEffects.length === 0,
    "same-position replacement does not replay animation_config enter behavior",
    engine.state.animationEffects,
  );

  engine.executeCommand({
    type: "sprite",
    character_id: "hero",
    sprite_id: "sprite_c",
    position: "center",
    visible: true,
    scale: 0.95,
    switch_transition: { kind: "wipe_right_to_left", duration_ms: 520, easing: "linear" },
  });
  const secondReplacement = engine.state.sprites.hero?.replacement;
  expect(
    secondReplacement?.previous_sprite_id === "sprite_b"
      && secondReplacement.key === 2
      && secondReplacement.transition.kind === "wipe_right_to_left",
    "consecutive same-position replacement uses the latest sprite and increments the key",
    secondReplacement,
  );

  engine.executeCommand({
    type: "sprite",
    character_id: "hero",
    sprite_id: "sprite_d",
    position: "right",
    visible: true,
    scale: 0.9,
    switch_transition: { kind: "crossfade", duration_ms: 420, easing: "ease-in-out" },
  });
  expect(
    engine.state.sprites.hero?.sprite_id === "sprite_d"
      && engine.state.sprites.hero?.position === "right"
      && !engine.state.sprites.hero?.replacement,
    "sprite and placement change uses placement lifecycle instead of replacement metadata",
    engine.state.sprites.hero,
  );

  engine.executeCommand({
    type: "sprite",
    character_id: "hero",
    sprite_id: "sprite_e",
    position: "right",
    visible: true,
    switch_transition: { kind: "none", duration_ms: 0, easing: "linear" },
  });
  expect(!engine.state.sprites.hero?.replacement, "explicit none switch transition keeps replacement instantaneous", engine.state.sprites.hero);

  engine.executeCommand({
    type: "sprite",
    character_id: "hero",
    sprite_id: "sprite_e",
    position: "right",
    visible: false,
    switch_transition: { kind: "blur", duration_ms: 900, easing: "ease-in-out" },
  });
  expect(!engine.state.sprites.hero, "visible false removes the sprite without applying switch transition", engine.state.sprites);

  engine.executeCommand({
    type: "sprite",
    character_id: "hero",
    sprite_id: "sprite_a",
    position: "left",
    visible: true,
    scale: 1.05,
  });
  engine.executeCommand({
    type: "sprite",
    character_id: "hero",
    sprite_id: "sprite_b",
    position: "left",
    visible: true,
    scale: 1.1,
    switch_transition: { kind: "slide_up", duration_ms: 700, easing: "ease-in-out" },
  });
  expect(Boolean(engine.state.sprites.hero?.replacement), "pre-save fixture contains transient replacement metadata", engine.state.sprites.hero);
  const save = engine.createSaveSnapshot(2);
  expect(
    save.sprites.hero?.sprite_id === "sprite_b" && !save.sprites.hero?.replacement,
    "save snapshot preserves final sprite while excluding replacement metadata",
    save.sprites.hero,
  );
  expect(
    !JSON.stringify(save).includes("replacement") && !JSON.stringify(save).match(/timer|element|node/i),
    "serialized save contains no replacement, timer, or DOM state",
    save,
  );
  engine.restoreSaveSnapshot(save);
  expect(
    engine.state.sprites.hero?.sprite_id === "sprite_b" && !engine.state.sprites.hero?.replacement,
    "save restore keeps only the final sprite without replaying replacement",
    engine.state.sprites.hero,
  );
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
  throw new Error(`GameCli dev server did not start: ${URL}`);
}

function stopServer() {
  try { server?.kill(); } catch (_) {}
  try { if (serverOutput !== undefined) fs.closeSync(serverOutput); } catch (_) {}
}

async function runBrowserChecks() {
  killPort();
  startServer();
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: ENGINE_ONLY ? "reduce" : "no-preference",
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
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
    await page.waitForSelector("#root", { timeout: 30_000 });
    await page.waitForTimeout(1_500);
    await page.evaluate(async ({ engineOnly }) => {
      const [{ StoryEngine }, { useRuntimeStore }, { assetResolver }] = await Promise.all([
        import("/src/engine/StoryEngine.ts"),
        import("/src/store/runtimeStore.ts"),
        import("/src/engine/assetResolver.ts"),
      ]);
      const spriteSvg = (color, label) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="520" height="980"><rect width="520" height="980" fill="transparent"/><ellipse cx="260" cy="170" rx="112" ry="132" fill="${color}"/><path d="M92 920 Q118 330 260 310 Q402 330 428 920Z" fill="${color}"/><text x="260" y="890" text-anchor="middle" fill="white" font-size="44">${label}</text></svg>`)}`;
      const engine = new StoryEngine();
      const script = {
        schema_version: "1.0.0",
        game_id: "sprite_transition_engine_browser",
        title: "Sprite Transition Engine",
        entry_scene_id: "scene",
        default_sprite_scale: 1,
        characters: [{ character_id: "hero", name: "Hero", aliases: [] }],
        scenes: [{ scene_id: "scene", title: "Scene", summary: "Acceptance", chapter: 1, tags: ["acceptance"], commands: [], is_ending: true }],
      };
      const manifest = {
        manifest_version: "1.0.0",
        cartridge_version: "1.0.0",
        runtime_version: "0.2.0",
        game_id: script.game_id,
        title: script.title,
        author: "AgentVN QA",
        description: "Sprite transition engine acceptance.",
        version: "1.0.0",
        language: "zh-CN",
        tags: ["acceptance"],
        entry_script: "script.json",
        entry_scene_id: "scene",
        assets: [
          { asset_id: "bg_stage", asset_type: "background", path: "assets/background/stage.svg", filename: "stage.svg" },
          { asset_id: "sprite_a", asset_type: "sprite", path: "assets/sprites/a.svg", filename: "a.svg" },
          { asset_id: "sprite_b", asset_type: "sprite", path: "assets/sprites/b.svg", filename: "b.svg" },
          { asset_id: "sprite_c", asset_type: "sprite", path: "assets/sprites/c.svg", filename: "c.svg" },
        ],
        created_at: "2026-07-11T00:00:00.000Z",
        updated_at: "2026-07-11T00:00:00.000Z",
      };
      const assetUrls = {
        bg_stage: `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#16243b"/><stop offset="1" stop-color="#452b4d"/></linearGradient></defs><rect width="1280" height="720" fill="url(#g)"/><circle cx="1040" cy="160" r="220" fill="#d8a85f" opacity=".16"/><path d="M0 610 Q340 510 640 610 T1280 600 V720 H0Z" fill="#0b1220" opacity=".72"/></svg>')}`,
        sprite_a: spriteSvg("#6f9bd1", "SPRITE A"),
        sprite_b: spriteSvg("#bf6d88", "SPRITE B"),
        sprite_c: spriteSvg("#70b29a", "SPRITE C"),
      };
      engine.script = script;
      engine.manifest = manifest;
      engine.state.background = "bg_stage";
      engine.state.backgroundFit = "cover";
      engine.executeCommand({ type: "sprite", character_id: "hero", sprite_id: "sprite_a", position: "center", scale: 1, visible: true });
      const initialEngineState = structuredClone(engine.state);
      engine.executeCommand({
        type: "sprite",
        character_id: "hero",
        sprite_id: "sprite_b",
        position: "center",
        scale: 0.78,
        visible: true,
        switch_transition: { kind: "crossfade", duration_ms: 900, easing: "ease-out" },
      });
      const replacementState = structuredClone(engine.state.sprites.hero);
      const replacementEngineState = structuredClone(engine.state);
      const save = engine.createSaveSnapshot(3);
      engine.restoreSaveSnapshot(save);
      const restoredState = structuredClone(engine.state.sprites.hero);
      window.__AGENTVN_SPRITE_ENGINE_PROBE__ = { replacementState, save, restoredState };
      assetResolver.configure(manifest, "", assetUrls);
      window.__AGENTVN_SET_SPRITE_STATE__ = ({
        currentSpriteId,
        currentScale,
        position = "center",
        previousSpriteId,
        previousScale,
        transition,
        key,
        visible = true,
      }) => {
        useRuntimeStore.setState((state) => ({
          engineState: {
            ...state.engineState,
            sprites: visible
              ? {
                  ...state.engineState.sprites,
                  hero: {
                    character_id: "hero",
                    sprite_id: currentSpriteId,
                    position,
                    scale: currentScale,
                    visible: true,
                    replacement: transition && transition.kind !== "none"
                      ? {
                          previous_sprite_id: previousSpriteId,
                          previous_position: position,
                          previous_scale: previousScale,
                          transition,
                          key,
                        }
                      : undefined,
                  },
                }
              : Object.fromEntries(
                  Object.entries(state.engineState.sprites).filter(([characterId]) => characterId !== "hero"),
                ),
            spriteOrder: visible ? ["hero"] : [],
          },
        }));
      };
      window.__AGENTVN_SET_SPRITE_REPLACEMENT__ = ({
        currentSpriteId,
        currentScale,
        previousSpriteId,
        previousScale,
        transition,
        key,
      }) => {
        window.__AGENTVN_SET_SPRITE_STATE__({
          currentSpriteId,
          currentScale,
          position: "center",
          previousSpriteId,
          previousScale,
          transition,
          key,
          visible: true,
        });
      };
      useRuntimeStore.setState({
        currentGame: {
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
          source_file_name: "sprite-transition-engine.vncart",
          cartridge_path: "",
        },
        engineState: engineOnly ? structuredClone(engine.state) : initialEngineState,
        runtimeMode: "fixed",
        screen: "playing",
        saves: [],
      });
      // Keep the store-owned engine in sync with the injected state. The App
      // boot lifecycle can emit from its singleton engine after this harness
      // mounts; leaving that engine empty would overwrite the fixture's
      // sprite state on the next emit.
      const runtimeEngine = useRuntimeStore.getState().engine;
      runtimeEngine.script = script;
      runtimeEngine.manifest = manifest;
      runtimeEngine.state = structuredClone(engineOnly ? engine.state : initialEngineState);
      window.__AGENTVN_RUNTIME_STORE_DEBUG__ = structuredClone(useRuntimeStore.getState().engineState);
    }, { engineOnly: ENGINE_ONLY });
    await page.locator(".story-player").waitFor({ state: "visible", timeout: 10_000 });
    // The application boot effect may finish after the fixture injection and
    // publish one final empty engine snapshot. Re-apply the stable sprite
    // through the same store seam once StoryPlayer is mounted.
    await page.evaluate(({ engineOnly }) => window.__AGENTVN_SET_SPRITE_STATE__({
      currentSpriteId: engineOnly ? "sprite_b" : "sprite_a",
      currentScale: engineOnly ? 0.78 : 1,
      position: "center",
      visible: true,
    }), { engineOnly: ENGINE_ONLY });
    await page.locator(`.sprite-slot[data-character-id="hero"][data-sprite-id="${ENGINE_ONLY ? "sprite_b" : "sprite_a"}"]`).waitFor({ state: "visible", timeout: 10_000 }).catch(async (error) => {
      const debug = await page.evaluate(() => ({
        runtimeState: document.querySelector("[data-runtime-state]")?.getAttribute("data-runtime-state"),
        story: document.querySelector(".story-player")?.outerHTML.slice(0, 600),
        sprites: document.querySelector(".sprite-layer")?.outerHTML.slice(0, 1200),
        store: (window).__AGENTVN_SPRITE_ENGINE_PROBE__,
        runtimeStore: (window).__AGENTVN_RUNTIME_STORE_DEBUG__,
      }));
      throw new Error(`sprite fixture did not render: ${JSON.stringify(debug)}`, { cause: error });
    });
    await page.locator(".boot-overlay").waitFor({ state: "hidden", timeout: ENGINE_ONLY ? 5_000 : 8_000 }).catch(() => undefined);
    await page.locator(".game-entry-transition").waitFor({ state: "detached", timeout: 3_000 }).catch(() => undefined);
    await page.waitForTimeout(120);
    if (!ENGINE_ONLY && !INTERRUPTION) {
      await page.evaluate(() => window.__AGENTVN_SET_SPRITE_REPLACEMENT__({
        currentSpriteId: "sprite_b",
        currentScale: 0.78,
        previousSpriteId: "sprite_a",
        previousScale: 1,
        transition: { kind: "crossfade", duration_ms: 900, easing: "ease-out" },
        key: 1,
      }));
    }
    const probe = await page.evaluate(() => window.__AGENTVN_SPRITE_ENGINE_PROBE__);
    expect(
      probe.replacementState.replacement?.previous_sprite_id === "sprite_a"
        && probe.replacementState.replacement?.transition.kind === "crossfade",
      "real GameCli browser observes replacement metadata before save",
      probe.replacementState,
    );
    expect(
      !probe.save.sprites.hero.replacement && !probe.restoredState.replacement,
      "real GameCli save and restore remove transient replacement metadata",
      probe,
    );
    if (ENGINE_ONLY) {
      const rendered = await page.locator(".sprite-layer").evaluate((element) => ({
        slots: element.querySelectorAll(".sprite-slot").length,
        spriteId: element.querySelector(".sprite-slot")?.getAttribute("data-sprite-id"),
        characterId: element.querySelector(".sprite-slot")?.getAttribute("data-character-id"),
      }));
      expect(
        rendered.slots === 1 && rendered.spriteId === "sprite_b" && rendered.characterId === "hero",
        "current SpriteLayer renders the restored final sprite exactly once",
        rendered,
        "GameCli_framework/src/components/player/SpriteLayer.tsx",
      );
      await page.screenshot({ path: path.join(OUT, "01-sprite-transition-engine-state.png"), fullPage: true });
    } else if (INTERRUPTION) {
      await page.evaluate(() => {
        window.__AGENTVN_SPRITE_INTERRUPTION_SAMPLES__ = [];
        const sample = () => {
          const slots = [...document.querySelectorAll('.sprite-slot[data-character-id="hero"]')];
          window.__AGENTVN_SPRITE_INTERRUPTION_SAMPLES__.push({
            slotCount: slots.length,
            frameCount: slots.reduce((total, slot) => total + slot.querySelectorAll(".sprite-replacement-frame").length, 0),
            phases: slots.map((slot) => slot.getAttribute("data-sprite-phase")),
            ids: slots.flatMap((slot) => [...slot.querySelectorAll(".sprite-replacement-frame")].map((frame) => frame.getAttribute("data-sprite-id"))),
          });
        };
        const observer = new MutationObserver(sample);
        observer.observe(document.querySelector(".sprite-layer"), {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ["class", "data-sprite-id", "data-sprite-phase", "data-sprite-replacement-active"],
        });
        window.__AGENTVN_STOP_SPRITE_INTERRUPTION_OBSERVER__ = () => observer.disconnect();
        sample();
      });

      await page.evaluate(() => window.__AGENTVN_SET_SPRITE_STATE__({
        currentSpriteId: "sprite_b",
        currentScale: 0.86,
        position: "center",
        previousSpriteId: "sprite_a",
        previousScale: 1,
        transition: { kind: "crossfade", duration_ms: 900, easing: "ease-out" },
        key: 1,
      }));
      await page.waitForFunction(() => document.querySelectorAll('.sprite-slot[data-character-id="hero"] .sprite-replacement-frame').length === 2);
      await page.evaluate(() => window.__AGENTVN_SET_SPRITE_STATE__({
        currentSpriteId: "sprite_c",
        currentScale: 0.74,
        position: "center",
        previousSpriteId: "sprite_b",
        previousScale: 0.86,
        transition: { kind: "crossfade", duration_ms: 900, easing: "ease-in-out" },
        key: 2,
      }));
      await page.waitForFunction(() => {
        const slot = document.querySelector('.sprite-slot[data-character-id="hero"]');
        return slot?.querySelectorAll(".sprite-replacement-frame").length === 2
          && slot.querySelector('[data-sprite-role="previous"]')?.getAttribute("data-sprite-id") === "sprite_b"
          && slot.querySelector('[data-sprite-role="current"]')?.getAttribute("data-sprite-id") === "sprite_c";
      });
      const rapid = await page.locator('.sprite-slot[data-character-id="hero"]').evaluate((slot) => ({
        slotCount: document.querySelectorAll('.sprite-slot[data-character-id="hero"]').length,
        frameCount: slot.querySelectorAll(".sprite-replacement-frame").length,
        previous: slot.querySelector('[data-sprite-role="previous"]')?.getAttribute("data-sprite-id"),
        current: slot.querySelector('[data-sprite-role="current"]')?.getAttribute("data-sprite-id"),
        key: slot.getAttribute("data-sprite-replacement-key"),
      }));
      expect(
        rapid.slotCount === 1 && rapid.frameCount === 2 && rapid.previous === "sprite_b" && rapid.current === "sprite_c" && rapid.key === "2",
        "rapid A-to-B-to-C replacement keeps only latest B-to-C frames",
        rapid,
        "GameCli_framework/src/components/player/SpriteLayer.tsx",
      );
      await page.waitForTimeout(220);
      await page.screenshot({ path: path.join(OUT, "04-sprite-rapid-replacement.png"), fullPage: true });
      await page.waitForFunction(() => {
        const frames = [...document.querySelectorAll('.sprite-slot[data-character-id="hero"] .sprite-replacement-frame')];
        return frames.length === 1 && frames[0].getAttribute("data-sprite-id") === "sprite_c";
      }, null, { timeout: 3_000 });
      expect(true, "rapid replacement settles on C without stale A or B frames", "sprite_c", "GameCli_framework/src/components/player/SpriteLayer.tsx");

      await page.evaluate(() => window.__AGENTVN_SET_SPRITE_STATE__({
        currentSpriteId: "sprite_b",
        currentScale: 0.82,
        position: "center",
        previousSpriteId: "sprite_c",
        previousScale: 0.74,
        transition: { kind: "blur", duration_ms: 900, easing: "ease-out" },
        key: 3,
      }));
      await page.waitForFunction(() => document.querySelectorAll('.sprite-slot[data-character-id="hero"] .sprite-replacement-frame').length === 2);
      await page.evaluate(() => window.__AGENTVN_SET_SPRITE_STATE__({
        currentSpriteId: "sprite_b",
        currentScale: 0.82,
        position: "center",
        visible: false,
      }));
      await page.waitForFunction(() => {
        const slot = document.querySelector('.sprite-slot[data-character-id="hero"].is-exiting');
        const frames = [...(slot?.querySelectorAll(".sprite-replacement-frame") ?? [])];
        return frames.length === 1 && frames[0].getAttribute("data-sprite-id") === "sprite_b";
      }, null, { timeout: 1_000 });
      const hiding = await page.locator('.sprite-slot[data-character-id="hero"].is-exiting').evaluate((slot) => ({
        frameCount: slot.querySelectorAll(".sprite-replacement-frame").length,
        current: slot.querySelector(".sprite-replacement-frame")?.getAttribute("data-sprite-id"),
        replacementActive: slot.getAttribute("data-sprite-replacement-active"),
        phase: slot.getAttribute("data-sprite-phase"),
      }));
      expect(
        hiding.frameCount === 1 && hiding.current === "sprite_b" && hiding.replacementActive === "false" && hiding.phase === "exiting",
        "hiding during replacement cancels outgoing frame and exits the current sprite",
        hiding,
        "GameCli_framework/src/components/player/SpriteLayer.tsx",
      );
      await page.screenshot({ path: path.join(OUT, "05-sprite-hide-during-replacement.png"), fullPage: true });
      await page.waitForSelector('.sprite-slot[data-character-id="hero"]', { state: "detached", timeout: 2_000 });
      expect(true, "hidden replacement sprite is removed after exit hold", "removed", "GameCli_framework/src/components/player/SpriteLayer.tsx");

      await page.evaluate(() => window.__AGENTVN_SET_SPRITE_STATE__({
        currentSpriteId: "sprite_a",
        currentScale: 1,
        position: "center",
        transition: { kind: "none", duration_ms: 0, easing: "linear" },
        key: 4,
      }));
      await page.waitForSelector('.sprite-slot.center[data-character-id="hero"]');
      await page.evaluate(() => window.__AGENTVN_SET_SPRITE_STATE__({
        currentSpriteId: "sprite_b",
        currentScale: 0.88,
        position: "center",
        previousSpriteId: "sprite_a",
        previousScale: 1,
        transition: { kind: "slide_up", duration_ms: 900, easing: "ease-in-out" },
        key: 5,
      }));
      await page.waitForFunction(() => document.querySelectorAll('.sprite-slot[data-character-id="hero"] .sprite-replacement-frame').length === 2);
      await page.evaluate(() => window.__AGENTVN_SET_SPRITE_STATE__({
        currentSpriteId: "sprite_c",
        currentScale: 0.76,
        position: "right",
        transition: { kind: "none", duration_ms: 0, easing: "linear" },
        key: 6,
      }));
      await page.waitForFunction(() => {
        const exiting = document.querySelector('.sprite-slot.center.is-exiting[data-character-id="hero"]');
        const entering = document.querySelector('.sprite-slot.right[data-character-id="hero"]:not(.is-exiting)');
        return exiting?.querySelectorAll(".sprite-replacement-frame").length === 1
          && exiting.querySelector(".sprite-replacement-frame")?.getAttribute("data-sprite-id") === "sprite_b"
          && entering?.querySelectorAll(".sprite-replacement-frame").length === 1
          && entering.querySelector(".sprite-replacement-frame")?.getAttribute("data-sprite-id") === "sprite_c";
      }, null, { timeout: 1_000 });
      const placement = await page.locator(".sprite-layer").evaluate((layer) => {
        const slots = [...layer.querySelectorAll('.sprite-slot[data-character-id="hero"]')];
        return {
          slotCount: slots.length,
          frameCount: slots.reduce((total, slot) => total + slot.querySelectorAll(".sprite-replacement-frame").length, 0),
          slots: slots.map((slot) => ({
            className: slot.className,
            phase: slot.getAttribute("data-sprite-phase"),
            ids: [...slot.querySelectorAll(".sprite-replacement-frame")].map((frame) => frame.getAttribute("data-sprite-id")),
          })),
        };
      });
      expect(
        placement.slotCount === 2 && placement.frameCount === 2,
        "sprite and position change uses one exiting current frame plus one entering frame",
        placement,
        "GameCli_framework/src/components/player/SpriteLayer.tsx",
      );
      await page.screenshot({ path: path.join(OUT, "06-sprite-position-change-interruption.png"), fullPage: true });
      await page.waitForFunction(() => {
        const slots = [...document.querySelectorAll('.sprite-slot[data-character-id="hero"]')];
        const frames = [...document.querySelectorAll('.sprite-slot[data-character-id="hero"] .sprite-replacement-frame')];
        return slots.length === 1
          && slots[0].classList.contains("right")
          && frames.length === 1
          && frames[0].getAttribute("data-sprite-id") === "sprite_c";
      }, null, { timeout: 2_000 });
      expect(true, "position-changing replacement settles on only C in the right slot", "sprite_c:right", "GameCli_framework/src/components/player/SpriteLayer.tsx");

      const samples = await page.evaluate(() => {
        window.__AGENTVN_STOP_SPRITE_INTERRUPTION_OBSERVER__?.();
        return window.__AGENTVN_SPRITE_INTERRUPTION_SAMPLES__;
      });
      const maxFrameCount = Math.max(...samples.map((sample) => sample.frameCount));
      const maxSlotCount = Math.max(...samples.map((sample) => sample.slotCount));
      expect(
        maxFrameCount <= 2 && maxSlotCount <= 2,
        "interrupted replacements do not accumulate unbounded sprite DOM nodes",
        { maxFrameCount, maxSlotCount, samples: samples.slice(-12) },
        "GameCli_framework/src/components/player/SpriteLayer.tsx",
      );
    } else {
      await page.waitForFunction(() => {
        const slot = document.querySelector('.sprite-slot[data-character-id="hero"]');
        const previous = slot?.querySelector('[data-sprite-role="previous"]');
        const current = slot?.querySelector('[data-sprite-role="current"]');
        return slot?.getAttribute("data-sprite-replacement-active") === "true"
          && slot.querySelectorAll(".sprite-replacement-frame").length === 2
          && previous?.getAttribute("data-sprite-id") === "sprite_a"
          && current?.getAttribute("data-sprite-id") === "sprite_b";
      }, null, { timeout: 3_000 });
      const mid = await page.locator('.sprite-slot[data-character-id="hero"]').evaluate((element) => {
        const stack = element.querySelector(".sprite-replacement-stack");
        const previous = element.querySelector('[data-sprite-role="previous"]');
        const current = element.querySelector('[data-sprite-role="current"]');
        return {
          frameCount: element.querySelectorAll(".sprite-replacement-frame").length,
          position: element.className,
          key: element.getAttribute("data-sprite-replacement-key"),
          kind: element.getAttribute("data-sprite-transition-kind"),
          duration: stack?.style.getPropertyValue("--sprite-switch-duration"),
          easing: stack?.style.getPropertyValue("--sprite-switch-easing"),
          previousScale: previous?.querySelector(".sprite-placement-frame")?.style.getPropertyValue("--sprite-base-scale"),
          currentScale: current?.querySelector(".sprite-placement-frame")?.style.getPropertyValue("--sprite-base-scale"),
          currentAnimation: current ? getComputedStyle(current).animationName : undefined,
        };
      });
      expect(
        mid.frameCount === 2 && mid.position.includes("center") && mid.key === "1" && mid.kind === "crossfade",
        "same-character replacement renders explicit previous and current frames in the original slot",
        mid,
        "GameCli_framework/src/components/player/SpriteLayer.tsx",
      );
      expect(
        mid.duration?.trim() === "900ms" && mid.easing?.trim() === "ease-out",
        "sprite replacement duration and easing enter CSS variables",
        mid,
        "GameCli_framework/src/components/player/SpriteLayer.tsx",
      );
      expect(
        mid.previousScale?.trim() === "1" && mid.currentScale?.trim() === "0.78",
        "outgoing and current sprite frames preserve independent scale values",
        mid,
        "GameCli_framework/src/components/player/SpriteLayer.tsx",
      );
      expect(
        mid.currentAnimation && mid.currentAnimation !== "none",
        "crossfade replacement starts a real CSS animation",
        mid,
        "GameCli_framework/src/styles/player.css",
      );
      await page.waitForTimeout(180);
      await page.screenshot({ path: path.join(OUT, "02-sprite-transition-crossfade-mid.png"), fullPage: true });
      await page.waitForFunction(() => {
        const slot = document.querySelector('.sprite-slot[data-character-id="hero"]');
        const frames = slot?.querySelectorAll(".sprite-replacement-frame");
        return slot?.getAttribute("data-sprite-replacement-active") === "false"
          && frames?.length === 1
          && frames[0].getAttribute("data-sprite-id") === "sprite_b";
      }, null, { timeout: 3_000 });
      expect(true, "replacement completion removes the outgoing sprite frame", "sprite_b", "GameCli_framework/src/components/player/SpriteLayer.tsx");

      const kinds = [
        "fade",
        "reveal_center",
        "wipe_left_to_right",
        "wipe_right_to_left",
        "blur",
        "slide_left",
        "slide_right",
        "slide_up",
        "slide_down",
      ];
      let currentSpriteId = "sprite_b";
      let currentScale = 0.78;
      let key = 1;
      const observedKinds = [];
      for (const kind of kinds) {
        const nextSpriteId = currentSpriteId === "sprite_b" ? "sprite_c" : "sprite_b";
        const nextScale = currentScale === 0.78 ? 0.84 : 0.78;
        key += 1;
        await page.evaluate((payload) => window.__AGENTVN_SET_SPRITE_REPLACEMENT__(payload), {
          currentSpriteId: nextSpriteId,
          currentScale: nextScale,
          previousSpriteId: currentSpriteId,
          previousScale: currentScale,
          transition: { kind, duration_ms: 320, easing: "ease-in-out" },
          key,
        });
        await page.waitForFunction(({ expectedKind, expectedSprite }) => {
          const slot = document.querySelector('.sprite-slot[data-character-id="hero"]');
          const current = slot?.querySelector('[data-sprite-role="current"]');
          return slot?.getAttribute("data-sprite-transition-kind") === expectedKind
            && slot.querySelectorAll(".sprite-replacement-frame").length === 2
            && current?.getAttribute("data-sprite-id") === expectedSprite
            && getComputedStyle(current).animationName !== "none";
        }, { expectedKind: kind, expectedSprite: nextSpriteId }, { timeout: 2_000 });
        observedKinds.push(kind);
        await page.waitForFunction((expectedSprite) => {
          const slot = document.querySelector('.sprite-slot[data-character-id="hero"]');
          const frames = [...(slot?.querySelectorAll(".sprite-replacement-frame") ?? [])];
          return frames.length === 1 && frames[0].getAttribute("data-sprite-id") === expectedSprite;
        }, nextSpriteId, { timeout: 2_000 });
        currentSpriteId = nextSpriteId;
        currentScale = nextScale;
      }
      expect(
        observedKinds.length === kinds.length,
        "all remaining shared sprite switch transition kinds animate and clean up",
        observedKinds,
        "GameCli_framework/src/styles/player.css",
      );

      key += 1;
      const noneTarget = currentSpriteId === "sprite_b" ? "sprite_c" : "sprite_b";
      await page.evaluate((payload) => window.__AGENTVN_SET_SPRITE_REPLACEMENT__(payload), {
        currentSpriteId: noneTarget,
        currentScale: 0.8,
        previousSpriteId: currentSpriteId,
        previousScale: currentScale,
        transition: { kind: "none", duration_ms: 0, easing: "linear" },
        key,
      });
      await page.waitForFunction((expectedSprite) => {
        const slot = document.querySelector('.sprite-slot[data-character-id="hero"]');
        const frames = [...(slot?.querySelectorAll(".sprite-replacement-frame") ?? [])];
        return slot?.getAttribute("data-sprite-replacement-active") === "false"
          && frames.length === 1
          && frames[0].getAttribute("data-sprite-id") === expectedSprite;
      }, noneTarget, { timeout: 1_000 });
      expect(true, "none switch transition replaces the sprite without retaining an outgoing frame", noneTarget, "GameCli_framework/src/components/player/SpriteLayer.tsx");
      await page.screenshot({ path: path.join(OUT, "03-sprite-transition-final.png"), fullPage: true });
    }
    expect(
      consoleErrors.length === 0 && pageErrors.length === 0,
      "GameCli browser console and page-error streams remain clean",
      { consoleErrors, pageErrors },
      "scripts/client-experience-sprite-transition-runtime-playwright.cjs",
    );
    await context.close();
  } finally {
    await browser.close();
    stopServer();
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const modeScreenshots = ENGINE_ONLY
    ? ["01-sprite-transition-engine-state.png"]
    : INTERRUPTION
      ? [
          "04-sprite-rapid-replacement.png",
          "05-sprite-hide-during-replacement.png",
          "06-sprite-position-change-interruption.png",
        ]
      : [
          "02-sprite-transition-crossfade-mid.png",
          "03-sprite-transition-final.png",
        ];
  for (const target of [
    REPORT,
    ...modeScreenshots.map((filename) => path.join(OUT, filename)),
    path.join(OUT, "sprite-transition-engine.cjs"),
    path.join(OUT, "logs"),
  ]) {
    fs.rmSync(target, { recursive: true, force: true });
  }
  const report = { ok: false, startedAt: new Date().toISOString(), checks, artifacts: { outputDir: OUT } };
  try {
    runEngineChecks();
    await runBrowserChecks();
    report.ok = true;
    report.finishedAt = new Date().toISOString();
    report.consoleErrors = consoleErrors;
    report.pageErrors = pageErrors;
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
    console.log(`Sprite transition ${ENGINE_ONLY ? "engine" : INTERRUPTION ? "interruption" : "runtime"} acceptance passed: ${checks.length} checks.`);
  } catch (error) {
    report.error = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    report.finishedAt = new Date().toISOString();
    report.consoleErrors = consoleErrors;
    report.pageErrors = pageErrors;
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
    throw error;
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
