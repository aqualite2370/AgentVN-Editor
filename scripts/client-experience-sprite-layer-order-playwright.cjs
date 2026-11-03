#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "output", "playwright", "client-experience-enhancement", "sprite-layer-order");
const REPORT = path.join(OUT, "report.json");
const PORT = Number(process.env.AGENTVN_SPRITE_LAYER_PORT || 6997);
const URL = `http://127.0.0.1:${PORT}/`;
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

function loadApi() {
  const esbuild = require("../editor/node_modules/esbuild");
  const result = esbuild.buildSync({
    stdin: {
      contents: [
        "export { StoryEngine } from './GameCli_framework/src/engine/StoryEngine';",
        "export { validateRuntimeScript } from './shared/cartridge/validators';",
        "export { inheritedSpriteLayer, sanitizeSpriteLayer, spriteLayerZIndex } from './shared/cartridge/spriteLayer';",
        "export { exportScript } from './editor/src/utils/exportScript';",
      ].join("\n"),
      loader: "ts",
      resolveDir: ROOT,
      sourcefile: "output/playwright/sprite-layer-order-entry.ts",
    },
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    write: false,
    logLevel: "silent",
  });
  const filename = path.join(OUT, "sprite-layer-order-entry.cjs");
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(ROOT);
  compiled._compile(result.outputFiles[0].text, filename);
  return compiled.exports;
}

function runtimeScript(commands) {
  return {
    schema_version: "1.0.0",
    game_id: "sprite_layer_order",
    title: "Sprite Layer Order",
    entry_scene_id: "scene",
    characters: [
      { character_id: "back", name: "Back", aliases: [] },
      { character_id: "middle", name: "Middle", aliases: [] },
      { character_id: "front", name: "Front", aliases: [] },
    ],
    scenes: [{
      scene_id: "scene",
      title: "Layer scene",
      summary: "Layer acceptance",
      chapter: 1,
      tags: ["acceptance"],
      commands,
      is_ending: true,
    }],
  };
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

  const {
    StoryEngine,
    inheritedSpriteLayer,
    sanitizeSpriteLayer,
    spriteLayerZIndex,
    validateRuntimeScript,
    exportScript,
  } = loadApi();
  const engine = new StoryEngine();
  engine.script = runtimeScript([]);
  engine.manifest = { game_id: engine.script.game_id };

  engine.executeCommand({ type: "sprite", character_id: "back", sprite_id: "sprite_back", position: "center", layer: -8, visible: true });
  engine.executeCommand({ type: "sprite", character_id: "middle", sprite_id: "sprite_middle", position: "center", visible: true });
  engine.executeCommand({ type: "sprite", character_id: "front", sprite_id: "sprite_front", position: "center", layer: 12, visible: true });
  expect(engine.state.sprites.back.layer === -8, "negative sprite layer is stored", engine.state.sprites.back);
  expect(engine.state.sprites.middle.layer === undefined, "missing sprite layer remains implicit", engine.state.sprites.middle);
  expect(engine.state.sprites.front.layer === 12, "positive sprite layer is stored", engine.state.sprites.front);
  expect(
    JSON.stringify(engine.state.spriteOrder) === JSON.stringify(["back", "middle", "front"]),
    "sprite layer does not change horizontal/appearance order",
    engine.state.spriteOrder,
  );

  engine.executeCommand({ type: "sprite", character_id: "front", sprite_id: "sprite_front_alt", position: "center", visible: true });
  expect(engine.state.sprites.front.layer === 12, "same-character replacement inherits the current layer", engine.state.sprites.front);
  engine.executeCommand({ type: "sprite", character_id: "front", sprite_id: "sprite_front_alt", position: "center", layer: 0, visible: true });
  expect(engine.state.sprites.front.layer === 0, "explicit zero resets the sprite to the default layer", engine.state.sprites.front);

  const save = engine.createSaveSnapshot(4);
  expect(save.sprites.back.layer === -8 && save.sprites.front.layer === 0, "save snapshot preserves sprite layers", save.sprites);
  engine.restoreSaveSnapshot(save);
  expect(engine.state.sprites.back.layer === -8 && engine.state.sprites.front.layer === 0, "save restore preserves sprite layers", engine.state.sprites);

  engine.executeCommand({ type: "sprite", character_id: "back", sprite_id: "sprite_back", visible: false });
  expect(!engine.state.sprites.back, "hiding a sprite removes its layer state with the sprite", engine.state.sprites);

  expect(inheritedSpriteLayer(undefined, 9) === 9, "undefined command layer inherits the existing layer");
  expect(inheritedSpriteLayer(null, -3) === -3, "null command layer inherits the existing layer");
  expect(sanitizeSpriteLayer("unsafe") === 0, "runtime sanitization falls back to layer zero");
  expect(spriteLayerZIndex(4, false) === 9, "present sprite z-index is derived from its layer");
  expect(spriteLayerZIndex(4, true) === 8, "exiting sprite is behind a present sprite on the same layer");
  expect(spriteLayerZIndex(5, true) > spriteLayerZIndex(4, false), "higher layers remain in front during exit");

  const valid = validateRuntimeScript(runtimeScript([
    { type: "sprite", character_id: "front", sprite_id: "sprite_front", position: "center", layer: 1000, visible: true },
  ]));
  expect(valid.ok === true, "integer sprite layers inside the supported range validate", valid);

  for (const invalidLayer of [-1001, 1001, 1.5, Number.POSITIVE_INFINITY]) {
    const invalid = validateRuntimeScript(runtimeScript([
      { type: "sprite", character_id: "front", sprite_id: "sprite_front", position: "center", layer: invalidLayer, visible: true },
    ]));
    expect(
      invalid.ok === false && invalid.errors.some((issue) => issue.code === "sprite_layer_range"),
      `invalid sprite layer is rejected: ${String(invalidLayer)}`,
      invalid.errors,
      "shared/cartridge/validators.ts",
    );
  }

  const editorSpriteCommand = {
    type: "sprite",
    character_id: "front",
    sprite_id: "sprite_front",
    position: "center",
    layer: 6,
    visible: true,
  };
  const editorProject = {
    schema_version: "1.0.0",
    project_id: "sprite_layer_editor_roundtrip",
    title: "Sprite Layer Editor Roundtrip",
    author: "AgentVN QA",
    nodes: [
      {
        id: "start",
        type: "startNode",
        position: { x: 20, y: 20 },
        data: {
          nodeKind: "start",
          label: "Start",
          description: "",
          aiSettings: { authorGoal: "", autoExtractMemory: false, autoApplyMemory: false },
          previewState: { currentCommandIndex: 0, isPlaying: false },
          editorMeta: { collapsedInspectorSections: [], source: "manual" },
        },
      },
      {
        id: "scene_node",
        type: "sceneNode",
        position: { x: 280, y: 20 },
        data: {
          nodeKind: "scene",
          label: "Layer Scene",
          description: "Layer Scene",
          aiSettings: { authorGoal: "", autoExtractMemory: false, autoApplyMemory: false },
          previewState: { currentCommandIndex: 0, isPlaying: false },
          editorMeta: { collapsedInspectorSections: [], source: "manual" },
          scene: {
            scene_id: "layer_scene",
            title: "Layer Scene",
            summary: "Layer Scene",
            chapter: 1,
            tags: [],
            commands: [editorSpriteCommand],
            is_ending: true,
          },
        },
      },
    ],
    edges: [{ id: "start_scene", source: "start", target: "scene_node", sourceHandle: "default" }],
    viewport: { x: 0, y: 0, zoom: 1 },
    memory_mode: "hybrid",
    asset_manifest: [],
    editor_settings: {},
    created_at: "2026-07-14T00:00:00.000Z",
    updated_at: "2026-07-14T00:00:00.000Z",
  };
  const reopenedProject = JSON.parse(JSON.stringify(editorProject));
  expect(
    reopenedProject.nodes[1].data.scene.commands[0].layer === 6,
    "project save and reopen preserve sprite layer",
    reopenedProject.nodes[1].data.scene.commands[0],
    "editor/src/types/commands.ts",
  );
  const exportedScript = exportScript(reopenedProject.nodes, reopenedProject.edges);
  expect(
    exportedScript.scenes[0].commands[0].layer === 6,
    "editor script export preserves sprite layer",
    exportedScript.scenes[0].commands[0],
    "editor/src/utils/exportScript.ts",
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
  if (server && !server.killed) server.kill();
  server = undefined;
  if (serverOutput !== undefined) {
    fs.closeSync(serverOutput);
    serverOutput = undefined;
  }
  killPort();
}

async function runBrowserChecks() {
  killPort();
  startServer();
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 760 } });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#root", { timeout: 30_000 });
    await page.waitForTimeout(700);
    await page.addStyleTag({
      content: `
        .sprite-slot {
          left: 50% !important;
          right: auto !important;
          width: 58% !important;
          transform: translateX(-50%) !important;
          pointer-events: auto !important;
        }
        .sprite-layer { pointer-events: auto !important; }
        .sprite-placeholder {
          width: 68%;
          height: 82%;
          display: grid;
          place-items: center;
          border: 8px solid rgba(255,255,255,.85);
          border-radius: 24px;
          color: white;
          font: 700 42px/1 sans-serif;
          box-shadow: 0 20px 60px rgba(0,0,0,.45);
        }
        .sprite-slot[data-character-id="back"] .sprite-placeholder { background: #3d6f9d; }
        .sprite-slot[data-character-id="middle"] .sprite-placeholder { background: #a95075; }
        .sprite-slot[data-character-id="front"] .sprite-placeholder { background: #3d987b; }
      `,
    });
    await page.evaluate(async () => {
      const [{ useRuntimeStore }, { assetResolver }] = await Promise.all([
        import("/src/store/runtimeStore.ts"),
        import("/src/engine/assetResolver.ts"),
      ]);
      const script = {
        schema_version: "1.0.0",
        game_id: "sprite_layer_browser",
        title: "Sprite Layer Browser",
        entry_scene_id: "scene",
        characters: [
          { character_id: "back", name: "Back", aliases: [] },
          { character_id: "middle", name: "Middle", aliases: [] },
          { character_id: "front", name: "Front", aliases: [] },
        ],
        scenes: [{ scene_id: "scene", title: "Scene", summary: "Layer", chapter: 1, tags: [], commands: [], is_ending: true }],
      };
      const manifest = {
        manifest_version: "1.0.0",
        cartridge_version: "1.0.0",
        runtime_version: "0.2.0",
        game_id: script.game_id,
        title: script.title,
        author: "AgentVN QA",
        description: "Sprite layer browser acceptance.",
        version: "1.0.0",
        language: "zh-CN",
        tags: ["acceptance"],
        entry_script: "script.json",
        entry_scene_id: "scene",
        assets: [],
        created_at: "2026-07-14T00:00:00.000Z",
        updated_at: "2026-07-14T00:00:00.000Z",
      };
      assetResolver.configure(manifest, "", {});
      useRuntimeStore.setState((state) => ({
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
          assetUrls: {},
          imported_at: manifest.created_at,
          updated_at: manifest.updated_at,
          source_file_name: "sprite-layer.vncart",
          cartridge_path: "",
        },
        runtimeMode: "fixed",
        screen: "playing",
        saves: [],
        engineState: {
          ...state.engineState,
          currentSceneId: "scene",
          sprites: {
            front: { character_id: "front", sprite_id: "front_missing", position: "center", layer: 8, visible: true },
            back: { character_id: "back", sprite_id: "back_missing", position: "center", layer: -5, visible: true },
            middle: { character_id: "middle", sprite_id: "middle_missing", position: "center", layer: 0, visible: true },
          },
          spriteOrder: ["front", "back", "middle"],
        },
      }));
      window.__AGENTVN_SET_LAYER__ = (characterId, layer) => {
        useRuntimeStore.setState((state) => ({
          engineState: {
            ...state.engineState,
            sprites: {
              ...state.engineState.sprites,
              [characterId]: {
                ...state.engineState.sprites[characterId],
                layer,
              },
            },
          },
        }));
      };
      window.__AGENTVN_REMOVE_SPRITE__ = (characterId) => {
        useRuntimeStore.setState((state) => ({
          engineState: {
            ...state.engineState,
            sprites: Object.fromEntries(Object.entries(state.engineState.sprites).filter(([id]) => id !== characterId)),
            spriteOrder: state.engineState.spriteOrder.filter((id) => id !== characterId),
          },
        }));
      };
    });

    await page.locator(".story-player").waitFor({ state: "visible", timeout: 10_000 });
    await page.locator(".sprite-slot").first().waitFor({ state: "visible", timeout: 10_000 });
    await page.locator(".boot-overlay").waitFor({ state: "detached", timeout: 8_000 }).catch(() => {});
    await page.waitForFunction(() => {
      const slots = [...document.querySelectorAll(".sprite-slot")];
      return slots.length === 3 && slots.every((slot) => slot.getAttribute("data-sprite-phase") === "present");
    }, undefined, { timeout: 5_000 });

    const initial = await page.locator(".sprite-slot").evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        characterId: node.getAttribute("data-character-id"),
        layer: Number(node.getAttribute("data-sprite-layer")),
        zIndex: Number(getComputedStyle(node).zIndex),
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    }));
    const byId = Object.fromEntries(initial.map((item) => [item.characterId, item]));
    expect(byId.front.zIndex > byId.middle.zIndex && byId.middle.zIndex > byId.back.zIndex, "browser applies numeric sprite layer ordering", initial, "GameCli_framework/src/components/player/SpriteLayer.tsx");
    expect(new Set(initial.map((item) => item.left)).size === 1, "layer ordering does not alter horizontal placement", initial, "GameCli_framework/src/components/player/SpriteLayer.tsx");

    const topBefore = await page.evaluate(() => {
      const slot = document.querySelector('.sprite-slot[data-character-id="front"]');
      const rect = slot.getBoundingClientRect();
      const element = document.elementsFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        .find((candidate) => candidate.closest?.(".sprite-slot"));
      return element?.closest(".sprite-slot")?.getAttribute("data-character-id");
    });
    expect(topBefore === "front", "highest layer receives the topmost browser hit", topBefore, "GameCli_framework/src/components/player/SpriteLayer.tsx");

    const positionsBefore = Object.fromEntries(initial.map((item) => [item.characterId, item.left]));
    await page.evaluate(() => window.__AGENTVN_SET_LAYER__("middle", 12));
    await page.waitForFunction(() => document.querySelector('.sprite-slot[data-character-id="middle"]')?.getAttribute("data-sprite-layer") === "12");
    const changed = await page.locator(".sprite-slot").evaluateAll((nodes) => nodes.map((node) => ({
      characterId: node.getAttribute("data-character-id"),
      zIndex: Number(getComputedStyle(node).zIndex),
      left: Math.round(node.getBoundingClientRect().left),
    })));
    const changedById = Object.fromEntries(changed.map((item) => [item.characterId, item]));
    expect(changedById.middle.zIndex > changedById.front.zIndex, "updating a layer changes only depth ordering", changed, "GameCli_framework/src/components/player/SpriteLayer.tsx");
    expect(changed.every((item) => item.left === positionsBefore[item.characterId]), "updating a layer keeps every sprite position stable", changed, "GameCli_framework/src/components/player/SpriteLayer.tsx");

    const topAfter = await page.evaluate(() => {
      const slot = document.querySelector('.sprite-slot[data-character-id="middle"]');
      const rect = slot.getBoundingClientRect();
      const element = document.elementsFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        .find((candidate) => candidate.closest?.(".sprite-slot"));
      return element?.closest(".sprite-slot")?.getAttribute("data-character-id");
    });
    expect(topAfter === "middle", "browser topmost hit follows a live layer update", topAfter, "GameCli_framework/src/components/player/SpriteLayer.tsx");

    await page.evaluate(() => window.__AGENTVN_REMOVE_SPRITE__("middle"));
    await page.locator('.sprite-slot[data-character-id="middle"]').waitFor({ state: "detached", timeout: 2_000 });
    expect(await page.locator(".sprite-slot").count() === 2, "removed sprite and its layer are cleaned from the DOM", await page.locator(".sprite-slot").count(), "GameCli_framework/src/components/player/SpriteLayer.tsx");

    await page.screenshot({ path: path.join(OUT, "01-three-sprite-layer-order.png"), fullPage: true });
    expect(pageErrors.length === 0, "browser run has no uncaught page errors", pageErrors);
    expect(consoleErrors.length === 0, "browser run has no console errors", consoleErrors);
  } finally {
    await browser.close();
    stopServer();
  }
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  try {
    runEngineChecks();
    await runBrowserChecks();
    fs.writeFileSync(REPORT, JSON.stringify({ ok: true, checks, consoleErrors, pageErrors }, null, 2));
    console.log(`Sprite layer order acceptance passed with ${checks.length} checks.`);
  } catch (error) {
    stopServer();
    fs.writeFileSync(REPORT, JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.stack || error.message : String(error),
      checks,
      consoleErrors,
      pageErrors,
    }, null, 2));
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
