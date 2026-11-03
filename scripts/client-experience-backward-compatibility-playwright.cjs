#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../Editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const testDir = path.join(root, "test_AgentVN", "backward-compatibility");
const outputDir = path.join(root, "output", "playwright", "client-experience-enhancement", "backward-compatibility");
const editorUrl = "http://127.0.0.1:6767/";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const headed = process.argv.includes("--headed");

function expect(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `; ${JSON.stringify(details)}` : ""}`);
}

function resetDirectories() {
  for (const directory of [testDir, outputDir]) {
    const resolved = path.resolve(directory);
    expect(resolved.startsWith(root + path.sep), "Refusing to reset outside workspace", resolved);
    fs.rmSync(resolved, { recursive: true, force: true });
    fs.mkdirSync(resolved, { recursive: true });
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

function startServer() {
  const child = spawn(npmCommand, ["run", "dev"], {
    cwd: path.join(root, "Editor"),
    shell: process.platform === "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (data) => fs.appendFileSync(path.join(outputDir, "editor.log"), data));
  child.stderr.on("data", (data) => fs.appendFileSync(path.join(outputDir, "editor.log"), data));
  return child;
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
  if (await isListening(editorUrl)) return undefined;
  const child = startServer();
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await isListening(editorUrl)) return child;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  stopServer(child);
  throw new Error(`Editor did not start at ${editorUrl}.`);
}

function imageAsset(assetId, assetType, color, now) {
  const filename = `${assetId}.svg`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="${color}"/><text x="48" y="492" fill="#fff" font-size="42">${assetId}</text></svg>`;
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return {
    asset_id: assetId,
    asset_type: assetType,
    metadata: {
      display_name: assetId,
      filename,
      mime_type: "image/svg+xml",
      size_bytes: Buffer.byteLength(svg),
      source: "bundled",
      data_url: dataUrl,
      blob_url: dataUrl,
      project_path: `assets/${assetType}/${filename}`,
      created_at: now,
    },
  };
}

function buildProjectFixture(definition) {
  const now = new Date().toISOString();
  const sceneId = `${definition.id}_scene`;
  const sceneNodeId = `${definition.id}_scene_node`;
  const scene = {
    scene_id: sceneId,
    title: definition.title,
    summary: `legacy-summary:${definition.id}`,
    chapter: 7,
    tags: ["legacy", definition.id, "sentinel"],
    commands: structuredClone(definition.commands),
    is_ending: true,
  };
  return {
    id: definition.id,
    sceneId,
    sceneNodeId,
    project: {
      schema_version: "1.0.0",
      project_id: definition.id,
      title: definition.title,
      author: "AgentVN Compatibility QA",
      nodes: [
        {
          id: "start",
          type: "startNode",
          position: { x: 60, y: 220 },
          data: {
            nodeKind: "start",
            label: "入口",
            description: "legacy-start",
            memoryMode: "hybrid",
            aiSettings: { authorGoal: "", autoExtractMemory: false, autoApplyMemory: false },
            previewState: { currentCommandIndex: 0, isPlaying: false },
            editorMeta: { collapsedInspectorSections: [], legacySentinel: `${definition.id}:start` },
          },
        },
        {
          id: sceneNodeId,
          type: "sceneNode",
          position: { x: 360, y: 180 },
          data: {
            nodeKind: "scene",
            label: definition.title,
            description: `legacy-description:${definition.id}`,
            memoryMode: "hybrid",
            aiSettings: { authorGoal: "preserve-me", autoExtractMemory: false, autoApplyMemory: false },
            previewState: { currentCommandIndex: 0, isPlaying: false },
            editorMeta: { collapsedInspectorSections: [], legacySentinel: `${definition.id}:scene` },
            scene,
          },
        },
      ],
      edges: [{
        id: `edge_start_${definition.id}`,
        source: "start",
        target: sceneNodeId,
        sourceHandle: "default",
      }],
      viewport: { x: 17, y: -23, zoom: 0.92 },
      memory_mode: "hybrid",
      asset_manifest: definition.assets.map((asset) => imageAsset(
        asset.assetId,
        asset.assetType,
        asset.color,
        now,
      )),
      editor_settings: {
        legacySentinel: `${definition.id}:settings`,
        nestedSentinel: { retain: true, fixture: definition.id },
      },
      created_at: now,
      updated_at: now,
    },
  };
}

function buildFixtures() {
  return [
    buildProjectFixture({
      id: "legacy_minimal",
      title: "Legacy Minimal Project",
      assets: [],
      commands: [
        { type: "narration", text: "Legacy project without custom buttons or transition config." },
      ],
    }),
    buildProjectFixture({
      id: "legacy_background",
      title: "Legacy Background Transition",
      assets: [
        { assetId: "legacy_bg", assetType: "background", color: "#354a70" },
      ],
      commands: [
        {
          type: "background",
          background_id: "legacy_bg",
          background_fit: "cover",
          transition: "wipe_rtl",
          transition_display_name: "Legacy right-to-left wipe",
        },
        { type: "narration", text: "Legacy background transition remains usable." },
      ],
    }),
    buildProjectFixture({
      id: "legacy_sprite",
      title: "Legacy Sprite Animation",
      assets: [
        { assetId: "hero_legacy", assetType: "sprite", color: "#7b4768" },
      ],
      commands: [
        {
          type: "sprite",
          character_id: "hero",
          sprite_id: "hero_legacy",
          position: "left",
          animation: "slide_in_left",
          animation_display_name: "Legacy slide in",
          animation_config: {
            kind: "move",
            phase: "enter",
            direction: "left",
            duration_ms: 520,
            easing: "ease-out",
            blocking: false,
            display_name: "Existing structured enter",
          },
          visible: true,
        },
        {
          type: "sprite",
          character_id: "hero",
          sprite_id: "hero_legacy",
          position: "left",
          animation: "fade_out",
          animation_display_name: "Legacy fade out",
          animation_config: {
            kind: "fade",
            phase: "exit",
            duration_ms: 460,
            easing: "ease-in",
            blocking: false,
            display_name: "Existing structured exit",
          },
          visible: false,
        },
        { type: "narration", text: "Existing enter and exit animation remain independent." },
      ],
    }),
  ];
}

async function openEditor(page, fixturePath, fixture) {
  await page.addInitScript((draft) => {
    localStorage.setItem("agentvn.currentProjectDraft", JSON.stringify(draft));
    localStorage.setItem("agentvn.recentProjects", JSON.stringify([{
      project_id: draft.project_id,
      title: draft.title,
      author: draft.author,
      updated_at: draft.updated_at,
      project: draft,
    }]));
  }, fixture.project);
  await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
  const toolbar = page.locator(".editor-toolbar");
  if (!(await toolbar.isVisible({ timeout: 3000 }).catch(() => false))) {
    const input = page.locator(".project-import-button input").first();
    await input.waitFor({ state: "attached", timeout: 20_000 });
    await input.setInputFiles(fixturePath);
    const openDraft = page.locator('[data-help-key="home.openDraft"]:visible, [data-help-key="home.recentProject"]:visible').first();
    await openDraft.waitFor({ state: "visible", timeout: 20_000 });
    await openDraft.click({ force: true });
  }
  await toolbar.waitFor({ state: "visible", timeout: 20_000 });
  await page.locator(".project-entry-loading-overlay").waitFor({ state: "hidden", timeout: 20_000 }).catch(() => {});
}

async function importFixtureIntoEditor(page, fixture) {
  await page.evaluate((snapshot) => {
    window.__AGENTVN_EDITOR_STORE__?.getState?.().importProject(snapshot.project);
    window.__AGENTVN_PROJECT_STORE__?.getState?.().loadProjectMetadata(snapshot.project);
    window.__AGENTVN_EDITOR_STORE__?.getState?.().selectNode?.(snapshot.sceneNodeId);
  }, fixture);
  await waitForEditorReady(page);
  await page.waitForFunction(
    (nodeId) => window.__AGENTVN_EDITOR_STORE__?.getState?.().nodes?.some((node) => node.id === nodeId),
    fixture.sceneNodeId,
    { timeout: 10_000 },
  );
  const node = page.locator(`.react-flow__node[data-id="${fixture.sceneNodeId}"]`).first();
  await node.waitFor({ state: "visible", timeout: 15_000 });
  await node.click({ position: { x: 44, y: 34 }, force: true });
  await page.evaluate((nodeId) => {
    window.__AGENTVN_EDITOR_STORE__?.getState?.().selectNode?.(nodeId);
  }, fixture.sceneNodeId);
  await page.locator(".command-card").first().waitFor({ state: "visible", timeout: 15_000 });
}

async function waitForEditorReady(page) {
  await page.waitForFunction(() => {
    const stage = document.querySelector(".app-transition-stage");
    const overlay = document.querySelector(".project-entry-loading-overlay");
    const toolbar = document.querySelector(".editor-toolbar");
    return Boolean(toolbar)
      && !overlay
      && !stage?.classList.contains("is-home-hydrating")
      && !stage?.classList.contains("is-switching")
      && !stage?.classList.contains("is-enter-cartridge")
      && !stage?.classList.contains("is-project-entry-loading");
  }, null, { timeout: 30_000 }).catch(async () => {
    await page.evaluate(() => {
      document.querySelectorAll(".project-entry-loading-overlay").forEach((element) => {
        if (!(element instanceof HTMLElement)) return;
        element.dispatchEvent(new AnimationEvent("animationiteration", {
          animationName: "project-entry-rose-cycle",
          bubbles: true,
        }));
      });
    });
    await page.waitForFunction(() => {
      const stage = document.querySelector(".app-transition-stage");
      const overlay = document.querySelector(".project-entry-loading-overlay");
      const toolbar = document.querySelector(".editor-toolbar");
      return Boolean(toolbar)
        && !overlay
        && !stage?.classList.contains("is-home-hydrating")
        && !stage?.classList.contains("is-switching")
        && !stage?.classList.contains("is-enter-cartridge")
        && !stage?.classList.contains("is-project-entry-loading");
    }, null, { timeout: 30_000 });
  });
}

async function roundTripFixture(page, fixture) {
  return page.evaluate((snapshot) => {
    const store = window.__AGENTVN_EDITOR_STORE__.getState();
    const readSceneNode = () => window.__AGENTVN_EDITOR_STORE__.getState().nodes
      .find((node) => node.id === snapshot.sceneNodeId);
    const beforeNode = structuredClone(readSceneNode());
    const beforeCommands = structuredClone(beforeNode.data.scene.commands);
    const exportedProject = store.exportProject({
      projectId: snapshot.project.project_id,
      title: snapshot.project.title,
      author: snapshot.project.author,
      assetManifest: snapshot.project.asset_manifest,
      editorSettings: snapshot.project.editor_settings,
      createdAt: snapshot.project.created_at,
    });
    const exportedScript = store.exportScript();
    store.importProject(exportedProject);
    const reopenedNode = structuredClone(readSceneNode());
    const reopenedScript = window.__AGENTVN_EDITOR_STORE__.getState().exportScript();
    return {
      beforeNode,
      beforeCommands,
      exportedProject,
      exportedScript,
      reopenedNode,
      reopenedScript,
    };
  }, fixture);
}

function loadRuntimeApi() {
  const esbuild = require("../Editor/node_modules/esbuild");
  const result = esbuild.buildSync({
    stdin: {
      contents: [
        "export { packCartridgeToUint8Array } from './shared/cartridge/packer';",
        "export { importRuntimeCartridgeFromArrayBuffer } from './GameCli_framework/src/cartridge/importCartridge';",
        "export { StoryEngine } from './GameCli_framework/src/engine/StoryEngine';",
        "export { UI_LAYOUT_VERSION } from './shared/cartridge/uiSkin';",
      ].join("\n"),
      loader: "ts",
      resolveDir: root,
      sourcefile: "output/playwright/backward-compatibility-entry.ts",
    },
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    write: false,
    logLevel: "silent",
  });
  const filename = path.join(outputDir, "backward-compatibility-runtime.cjs");
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(root);
  compiled._compile(result.outputFiles[0].text, filename);
  return compiled.exports;
}

function collectRuntimeAssets(project) {
  return project.asset_manifest.map((asset) => {
    const assetId = asset.asset_id;
    const assetType = asset.asset_type;
    const pathName = `assets/${assetType}/${assetId}.svg`;
    const color = assetType === "background" ? "#354a70" : "#7b4768";
    const data = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="${color}"/></svg>`;
    return {
      manifest: {
        asset_id: assetId,
        asset_type: assetType,
        path: pathName,
        filename: `${assetId}.svg`,
        mime_type: "image/svg+xml",
        size_bytes: Buffer.byteLength(data),
      },
      input: { path: pathName, data },
    };
  });
}

async function buildRuntimeCartridge(api, fixture, exportedScript) {
  const runtimeAssets = collectRuntimeAssets(fixture.project);
  const script = {
    ...structuredClone(exportedScript),
    game_id: fixture.id,
    title: fixture.project.title,
  };
  const now = new Date().toISOString();
  const manifest = {
    manifest_version: "1.0.0",
    cartridge_version: "1.0.0",
    runtime_version: "0.2.0",
    game_id: fixture.id,
    title: fixture.project.title,
    author: fixture.project.author,
    description: `Backward compatibility fixture: ${fixture.id}`,
    version: "1.0.0",
    language: "zh-CN",
    tags: ["compatibility", fixture.id],
    entry_script: "script.json",
    entry_scene_id: script.entry_scene_id,
    assets: runtimeAssets.map((asset) => asset.manifest),
    created_at: now,
    updated_at: now,
  };
  const bytes = await api.packCartridgeToUint8Array({
    manifest,
    script,
    assets: runtimeAssets.map((asset) => asset.input),
  });
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const imported = await api.importRuntimeCartridgeFromArrayBuffer(arrayBuffer, `${fixture.id}.vncart`);
  fs.writeFileSync(path.join(testDir, `${fixture.id}.vncart`), bytes);
  return { bytes, imported, manifest, script };
}

function configureRuntimeGlobals() {
  global.window = {
    setTimeout,
    clearTimeout,
    dispatchEvent: () => true,
    __AGENTVN_RUNTIME_ANIMATION_LOG__: [],
  };
  global.CustomEvent = class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  global.performance ??= { now: () => Date.now() };
}

function runRuntimeBehavior(api, fixture, cartridge) {
  const engine = new api.StoryEngine();
  engine.onChange = () => {};
  engine.loadScript(cartridge.script, cartridge.manifest);
  if (fixture.id === "legacy_minimal") {
    engine.start();
    expect(engine.state.currentSceneId === fixture.sceneId, "Legacy minimal project did not start", engine.state);
    expect(engine.state.currentCommandType === "narration", "Legacy minimal narration did not execute", engine.state);
    return {
      fixture: fixture.id,
      currentSceneId: engine.state.currentSceneId,
      currentCommandType: engine.state.currentCommandType,
    };
  }

  const commands = cartridge.script.scenes[0].commands;
  if (fixture.id === "legacy_background") {
    engine.executeCommand(commands[0]);
    expect(
      engine.state.backgroundTransition?.kind === "wipe_right_to_left",
      "Legacy wipe_rtl transition did not map to wipe_right_to_left",
      engine.state.backgroundTransition,
    );
    return {
      fixture: fixture.id,
      transition: engine.state.backgroundTransition,
    };
  }

  engine.executeCommand(commands[0]);
  const enterEffect = engine.state.animationEffects.find((effect) => effect.target_id === "hero");
  expect(enterEffect?.params?.character_animation_phase === "enter", "Existing sprite enter animation did not run", enterEffect);
  expect(engine.state.sprites.hero?.replacement === undefined, "Legacy sprite command created replacement metadata without switch_transition");
  engine.executeCommand(commands[1]);
  const exitEffect = engine.state.animationEffects.find((effect) => effect.target_id === "hero");
  expect(exitEffect?.params?.character_animation_phase === "exit", "Existing sprite exit animation did not run", exitEffect);
  expect(engine.state.sprites.hero?.replacement === undefined, "Legacy sprite exit created replacement metadata without switch_transition");
  return {
    fixture: fixture.id,
    enterAnimationId: enterEffect.animation_id,
    exitAnimationId: exitEffect.animation_id,
    replacement: engine.state.sprites.hero?.replacement,
  };
}

async function main() {
  resetDirectories();
  const fixtures = buildFixtures();
  const fixturePaths = new Map();
  for (const fixture of fixtures) {
    const fixturePath = path.join(testDir, `${fixture.id}.agentvn`);
    fs.writeFileSync(fixturePath, JSON.stringify(fixture.project, null, 2));
    fixturePaths.set(fixture.id, fixturePath);
  }

  const report = {
    ok: false,
    startedAt: new Date().toISOString(),
    checks: [],
    fixtures: fixtures.map((fixture) => fixture.id),
    artifacts: { outputDir, testDir },
  };
  const browserErrors = [];
  const pass = (assertion, value, file = "Editor/src/store/editorStore.ts") => {
    report.checks.push({ assertion, value, file });
  };
  let browser;
  let startedServer;

  try {
    startedServer = await ensureServer();
    browser = await chromium.launch({ headless: !headed });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    await page.route("http://127.0.0.1:8278/**", async (route) => {
      const request = route.request();
      const body = request.postDataJSON?.() ?? {};
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: request.method() === "GET" ? [] : body }),
      });
    });
    page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.stack || error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
    });

    await openEditor(page, fixturePaths.get(fixtures[0].id), fixtures[0]);
    const roundTrips = new Map();
    for (const fixture of fixtures) {
      await importFixtureIntoEditor(page, fixture);
      pass(`Editor opens ${fixture.id} fixture`, true, "scripts/client-experience-backward-compatibility-playwright.cjs");
      const result = await roundTripFixture(page, fixture);
      roundTrips.set(fixture.id, result);

      expect(
        JSON.stringify(result.reopenedNode.data.scene.commands) === JSON.stringify(result.beforeCommands),
        `${fixture.id} project round-trip changed commands`,
        { before: result.beforeCommands, after: result.reopenedNode.data.scene.commands },
      );
      pass(`${fixture.id} project round-trip preserves commands`, true);
      expect(
        JSON.stringify(result.exportedScript.scenes[0].commands) === JSON.stringify(result.beforeCommands)
          && JSON.stringify(result.reopenedScript.scenes[0].commands) === JSON.stringify(result.beforeCommands),
        `${fixture.id} exportScript changed commands`,
      );
      pass(`${fixture.id} exportScript preserves legacy commands`, true, "Editor/src/utils/exportScript.ts");
      expect(
        result.reopenedNode.data.scene.summary === result.beforeNode.data.scene.summary
          && JSON.stringify(result.reopenedNode.data.scene.tags) === JSON.stringify(result.beforeNode.data.scene.tags)
          && result.reopenedNode.data.editorMeta.legacySentinel === result.beforeNode.data.editorMeta.legacySentinel,
        `${fixture.id} round-trip changed unrelated scene or editor fields`,
      );
      pass(`${fixture.id} round-trip preserves unrelated fields`, true);
      expect(
        result.exportedProject.schema_version === "1.1.0"
          && result.exportedProject.editor_settings.legacySentinel === `${fixture.id}:settings`,
        `${fixture.id} project schema/settings changed unexpectedly`,
        result.exportedProject,
      );
      pass(`${fixture.id} upgrades the saved project schema to 1.1.0 and keeps unrelated settings`, true);
    }

    const minimalRoundTrip = roundTrips.get("legacy_minimal");
    const backgroundRoundTrip = roundTrips.get("legacy_background");
    const spriteRoundTrip = roundTrips.get("legacy_sprite");
    expect(
      minimalRoundTrip.exportedProject.editor_settings.runtimeUILayout === undefined,
      "Legacy project gained a forced runtime UI layout",
    );
    pass("Legacy project without custom buttons does not gain forced UI layout fields", true);
    expect(
      backgroundRoundTrip.reopenedNode.data.scene.commands[0].transition_config === undefined,
      "Legacy background command gained transition_config during round-trip",
    );
    pass("Legacy background.transition remains legacy-only after Editor round-trip", true);
    expect(
      spriteRoundTrip.reopenedNode.data.scene.commands.slice(0, 2)
        .every((command) => command.switch_transition === undefined),
      "Legacy sprite commands gained switch_transition during round-trip",
    );
    pass("Existing sprite animation_config remains independent from switch_transition", true);

    await importFixtureIntoEditor(page, fixtures[2]);
    await waitForEditorReady(page);
    await page.locator(".command-card").first().waitFor({ state: "visible", timeout: 15_000 });
    const screenshotPath = path.join(outputDir, "01-legacy-sprite-editor.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    report.artifacts.screenshot = screenshotPath;
    expect(browserErrors.length === 0, "Editor emitted console/page errors", browserErrors);
    pass("Editor browser console and page error streams remain clean", true, "scripts/client-experience-backward-compatibility-playwright.cjs");
    await context.close();
    await browser.close();
    browser = undefined;

    configureRuntimeGlobals();
    const api = loadRuntimeApi();
    expect(api.UI_LAYOUT_VERSION === "1.0.0", "Optional fields unexpectedly bumped UI layout version", api.UI_LAYOUT_VERSION);
    pass("Optional compatibility fields keep UI layout version at 1.0.0", api.UI_LAYOUT_VERSION, "shared/cartridge/uiSkin.ts");

    for (const fixture of fixtures) {
      const roundTrip = roundTrips.get(fixture.id);
      const cartridge = await buildRuntimeCartridge(api, fixture, roundTrip.exportedScript);
      expect(cartridge.imported.validation.ok, `${fixture.id} GameCli import failed`, cartridge.imported.validation);
      expect(cartridge.imported.cartridge.uiSkin === undefined, `${fixture.id} unexpectedly requires uiSkin`);
      expect(
        JSON.stringify(cartridge.imported.cartridge.script.scenes[0].commands) === JSON.stringify(roundTrip.beforeCommands),
        `${fixture.id} GameCli import changed commands`,
      );
      pass(`GameCli imports ${fixture.id} without rewriting commands`, true, "GameCli_framework/src/cartridge/importCartridge.ts");
      const runtimeResult = runRuntimeBehavior(api, fixture, cartridge);
      pass(`GameCli runs ${fixture.id} legacy behavior`, runtimeResult, "GameCli_framework/src/engine/StoryEngine.ts");
    }

    report.ok = true;
    report.browserErrors = browserErrors;
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Backward compatibility acceptance passed: ${report.checks.length} checks.`);
    console.log(`Screenshot: ${report.artifacts.screenshot}`);
  } catch (error) {
    report.error = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    report.browserErrors = browserErrors;
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2));
    throw error;
  } finally {
    if (browser) await browser.close();
    stopServer(startedServer);
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
