#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { saveProjectContainerSync } = require("./project-container.cjs");
const { spawn, spawnSync } = require("node:child_process");
const JSZip = require("../Editor/node_modules/jszip");
const { chromium } = require("../Editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const testDir = path.join(root, "test_AgentVN", "transition-persist");
const outputDir = path.join(root, "output", "playwright", "client-experience-enhancement", "transition-persist");
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

function imageAsset(assetId, assetType, filename, color, now) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="${color}"/><text x="80" y="640" fill="#fff" font-size="52">${assetId}</text></svg>`;
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

function buildProject() {
  const now = new Date().toISOString();
  const scene = {
    scene_id: "transition_persist_scene",
    title: "过场持久化验收",
    summary: "验证结构化背景与立绘替换过场不会在工程和卡带链路中丢失。",
    chapter: 1,
    tags: ["transition", "persist", "acceptance"],
    commands: [
      {
        type: "background",
        background_id: "bg_transition",
        background_fit: "cover",
        transition: "fade",
        transition_display_name: "Legacy background sentinel",
        transition_config: { kind: "crossfade", duration_ms: 420, easing: "ease-in-out" },
      },
      {
        type: "sprite",
        character_id: "hero",
        sprite_id: "hero_smile",
        position: "left",
        animation: "fade_in",
        animation_display_name: "Legacy sprite sentinel",
        animation_config: {
          kind: "move",
          phase: "enter",
          direction: "left",
          duration_ms: 520,
          easing: "ease-out",
          blocking: false,
        },
        switch_transition: { kind: "crossfade", duration_ms: 600, easing: "ease-in-out" },
        scale: 1.1,
        visible: true,
      },
      {
        type: "background",
        background_id: "legacy_bg",
        background_fit: "contain",
        transition: "wipe_rtl",
        transition_display_name: "Legacy-only sentinel",
      },
      { type: "narration", text: "过场持久化验收完成。" },
    ],
    is_ending: true,
  };
  return {
    schema_version: "1.0.0",
    project_id: `transition_persist_${Date.now()}`,
    title: "Transition Persist Acceptance",
    author: "AgentVN QA",
    nodes: [
      {
        id: "start",
        type: "startNode",
        position: { x: 40, y: 220 },
        data: {
          nodeKind: "start",
          label: "入口",
          description: "",
          memoryMode: "hybrid",
          aiSettings: { authorGoal: "", autoExtractMemory: false, autoApplyMemory: false },
          previewState: { currentCommandIndex: 0, isPlaying: false },
          editorMeta: { collapsedInspectorSections: [], source: "manual" },
        },
      },
      {
        id: "transition_persist_scene_node",
        type: "sceneNode",
        position: { x: 330, y: 180 },
        data: {
          nodeKind: "scene",
          label: scene.title,
          description: scene.summary,
          memoryMode: "hybrid",
          aiSettings: { authorGoal: "", autoExtractMemory: false, autoApplyMemory: false },
          previewState: { currentCommandIndex: 0, isPlaying: false },
          editorMeta: { collapsedInspectorSections: [], source: "manual" },
          scene,
        },
      },
    ],
    edges: [{ id: "edge_start_transition_persist", source: "start", target: "transition_persist_scene_node", sourceHandle: "default" }],
    viewport: { x: 0, y: 0, zoom: 1 },
    memory_mode: "hybrid",
    asset_manifest: [
      imageAsset("bg_transition", "background", "bg-transition.svg", "#24375c", now),
      imageAsset("legacy_bg", "background", "legacy-bg.svg", "#452f52", now),
      imageAsset("hero_smile", "sprite", "hero-smile.svg", "#345f55", now),
    ],
    editor_settings: {},
    created_at: now,
    updated_at: now,
  };
}

async function openProject(page, project, projectPath) {
  await page.addInitScript((draft) => {
    localStorage.setItem("agentvn.currentProjectDraft", JSON.stringify(draft));
    localStorage.setItem("agentvn.recentProjects", JSON.stringify([{
      project_id: draft.project_id,
      title: draft.title,
      author: draft.author,
      updated_at: draft.updated_at,
      project: draft,
    }]));
  }, project);
  await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
  const toolbar = page.locator(".editor-toolbar");
  if (!(await toolbar.isVisible({ timeout: 3000 }).catch(() => false))) {
    const input = page.locator(".project-import-button input").first();
    await input.waitFor({ state: "attached", timeout: 20_000 });
    await input.setInputFiles(projectPath);
    const openDraft = page.locator('[data-help-key="home.openDraft"]:visible, [data-help-key="home.recentProject"]:visible').first();
    await openDraft.waitFor({ state: "visible", timeout: 20_000 });
    await openDraft.click({ force: true });
  }
  await toolbar.waitFor({ state: "visible", timeout: 20_000 });
  await page.locator(".project-entry-loading-overlay").waitFor({ state: "hidden", timeout: 20_000 }).catch(() => {});
  await page.evaluate((snapshot) => {
    window.__AGENTVN_EDITOR_STORE__?.getState?.().importProject(snapshot);
    window.__AGENTVN_PROJECT_STORE__?.getState?.().loadProjectMetadata(snapshot);
  }, project);
  await page.waitForFunction(() => window.__AGENTVN_EDITOR_STORE__?.getState?.().nodes
    ?.some((node) => node.id === "transition_persist_scene_node"), null, { timeout: 10_000 });
}

async function selectScene(page) {
  const node = page.locator('.react-flow__node[data-id="transition_persist_scene_node"]').first();
  await node.waitFor({ state: "visible", timeout: 15_000 });
  await node.click({ position: { x: 44, y: 34 }, force: true });
  await page.evaluate(() => {
    window.__AGENTVN_EDITOR_STORE__?.getState?.().selectNode?.("transition_persist_scene_node");
  });
  if (!(await page.locator(".command-card").first().isVisible({ timeout: 3000 }).catch(() => false))) {
    await node.focus();
    await page.keyboard.press("Enter");
    await page.evaluate(() => {
      window.__AGENTVN_EDITOR_STORE__?.getState?.().selectNode?.("transition_persist_scene_node");
    });
  }
  await page.locator(".command-card").first().waitFor({ state: "visible", timeout: 15_000 });
}

async function ensureCard(page, index) {
  const card = page.locator(`.command-card[data-command-index="${index}"]`);
  await card.waitFor({ state: "visible", timeout: 10_000 });
  await card.locator(".command-card-header").scrollIntoViewIfNeeded().catch(() => {});
  const body = card.locator(".command-card-body");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await body.isVisible().catch(() => false)) {
      return { card, body, controls: body.locator('[data-testid="visual-transition-controls"]') };
    }
    await page.waitForTimeout(220);
    await card.evaluate((element) => {
      if (!element.classList.contains("is-collapsed")) return;
      const button = element.querySelector('button[data-help-key="command.expand"]');
      if (button instanceof HTMLElement) button.click();
    }).catch(() => {});
  }
  await body.waitFor({ state: "visible", timeout: 10_000 });
  return { card, body, controls: body.locator('[data-testid="visual-transition-controls"]') };
}

async function selectTransitionKind(page, controls, optionIndex) {
  await controls.locator('button[data-help-key="command.visualTransition.kind"]').click();
  const option = page.locator('.rich-select-popover[role="listbox"] [role="option"]').nth(optionIndex);
  await option.waitFor({ state: "visible", timeout: 5000 });
  await option.click();
}

async function waitForCommand(page, index, expected) {
  await page.waitForFunction(({ commandIndex, match }) => {
    const nodes = window.__AGENTVN_EDITOR_STORE__?.getState?.().nodes ?? [];
    const command = nodes.find((node) => node.id === "transition_persist_scene_node")
      ?.data?.scene?.commands?.[commandIndex];
    return Boolean(command) && Object.entries(match).every(([pathKey, value]) => {
      const actual = pathKey.split(".").reduce((current, key) => current?.[key], command);
      return actual === value;
    });
  }, { commandIndex: index, match: expected }, { timeout: 5000 });
}

async function selectRichOptionByIndex(page, helpKey, optionIndex) {
  await page.locator(`button[data-help-key="${helpKey}"]`).first().click();
  const option = page.locator('.rich-select-popover[role="listbox"] [role="option"]').nth(optionIndex);
  await option.waitFor({ state: "visible", timeout: 5000 });
  await option.click();
}

async function exportCartridge(page) {
  await page.locator('[data-help-key="toolbar.exportCartridge"]').click({ force: true });
  await page.locator(".cartridge-export-panel").waitFor({ state: "visible", timeout: 10_000 });
  await selectRichOptionByIndex(page, "package.mode", 1);
  const confirm = page.locator('input[data-help-key="package.confirmWarnings"]');
  if (await confirm.count()) await confirm.check({ force: true });
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-help-key="package.export"]');
    return button && !button.disabled;
  }, null, { timeout: 15_000 });
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.locator('[data-help-key="package.export"]').click();
  const download = await downloadPromise;
  const cartridgePath = path.join(testDir, "transition-persist.vncart");
  await download.saveAs(cartridgePath);
  return cartridgePath;
}

function commandSnapshot(command) {
  return command?.type === "background"
    ? {
      type: command.type,
      background_id: command.background_id,
      background_fit: command.background_fit,
      transition: command.transition,
      transition_display_name: command.transition_display_name,
      transition_config: command.transition_config,
    }
    : {
      type: command?.type,
      character_id: command?.character_id,
      sprite_id: command?.sprite_id,
      position: command?.position,
      animation: command?.animation,
      animation_display_name: command?.animation_display_name,
      animation_config: command?.animation_config,
      switch_transition: command?.switch_transition,
      scale: command?.scale,
      visible: command?.visible,
    };
}

function loadGameCliApi() {
  const esbuild = require("../Editor/node_modules/esbuild");
  const result = esbuild.buildSync({
    stdin: {
      contents: [
        "export { importRuntimeCartridge } from './GameCli_framework/src/cartridge/importCartridge';",
        "export { importCartridgeFromFile } from './GameCli_framework/src/cartridge/desktopLibrary';",
      ].join("\n"),
      loader: "ts",
      resolveDir: root,
      sourcefile: "output/playwright/transition-persist-entry.ts",
    },
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    write: false,
    logLevel: "silent",
  });
  const filename = path.join(outputDir, "transition-persist-gamecli.cjs");
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(root);
  compiled._compile(result.outputFiles[0].text, filename);
  return compiled.exports;
}

async function main() {
  resetDirectories();
  const project = buildProject();
  const projectPath = path.join(testDir, "transition-persist.agentvn");
  saveProjectContainerSync(projectPath, project, { container: "zip" });
  const report = {
    ok: false,
    startedAt: new Date().toISOString(),
    checks: [],
    artifacts: { projectPath, outputDir },
  };
  const browserErrors = [];
  let browser;
  let startedServer;
  const pass = (assertion, file = "Editor/src/store/editorStore.ts") => report.checks.push({ assertion, file });

  try {
    startedServer = await ensureServer();
    browser = await chromium.launch({ headless: !headed });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
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

    await openProject(page, project, projectPath);
    await selectScene(page);
    pass("真实 Editor 打开包含新旧过场字段的工程", "scripts/client-experience-transition-persist-playwright.cjs");

    const background = await ensureCard(page, 0);
    await background.controls.waitFor({ state: "visible" });
    await selectTransitionKind(page, background.controls, 3);
    await background.controls.locator('[data-testid="visual-transition-duration"]').fill("760");
    await background.controls.locator('[data-testid="visual-transition-easing"]').fill("ease-out");
    await waitForCommand(page, 0, {
      "transition_config.kind": "reveal_center",
      "transition_config.duration_ms": 760,
      "transition_config.easing": "ease-out",
    });
    pass("背景过场通过 UI 更新为 reveal_center + 760ms + ease-out", "Editor/src/components/command-editors/BackgroundCommandEditor.tsx");

    const sprite = await ensureCard(page, 1);
    await sprite.controls.waitFor({ state: "visible" });
    await selectTransitionKind(page, sprite.controls, 6);
    await sprite.controls.locator('[data-testid="visual-transition-duration"]').fill("640");
    await sprite.controls.locator('[data-testid="visual-transition-easing"]').fill("ease-in-out");
    await waitForCommand(page, 1, {
      "switch_transition.kind": "blur",
      "switch_transition.duration_ms": 640,
      "switch_transition.easing": "ease-in-out",
    });
    pass("立绘替换过场通过 UI 更新为 blur + 640ms + ease-in-out", "Editor/src/components/command-editors/SpriteCommandEditor.tsx");

    const snapshots = await page.evaluate(() => {
      const store = window.__AGENTVN_EDITOR_STORE__.getState();
      const sceneCommands = () => window.__AGENTVN_EDITOR_STORE__.getState().nodes
        .find((node) => node.id === "transition_persist_scene_node").data.scene.commands;
      const before = structuredClone(sceneCommands());
      const exportedProject = store.exportProject({
        projectId: "transition_persist_roundtrip",
        title: "Transition Persist Roundtrip",
        author: "AgentVN QA",
        assetManifest: [],
        editorSettings: {},
      });
      const exportedScript = store.exportScript();
      store.importProject(exportedProject);
      const after = structuredClone(sceneCommands());
      const reexportedScript = window.__AGENTVN_EDITOR_STORE__.getState().exportScript();
      return { before, exportedProject, exportedScript, after, reexportedScript };
    });
    const before = snapshots.before.map(commandSnapshot);
    const after = snapshots.after.map(commandSnapshot);
    expect(JSON.stringify(after) === JSON.stringify(before), "Editor project import/export changed transition commands", { before, after });
    pass("Editor exportProject 保留 transition_config、switch_transition 与无关字段");
    pass("Editor importProject 重开后关键命令深比较一致");
    expect(JSON.stringify(snapshots.exportedScript.scenes[0].commands.map(commandSnapshot))
      === JSON.stringify(before), "exportScript changed transition commands");
    pass("首次 exportScript 保留结构化与 legacy 字段", "Editor/src/utils/exportScript.ts");
    expect(JSON.stringify(snapshots.reexportedScript.scenes[0].commands.map(commandSnapshot))
      === JSON.stringify(before), "Reopened exportScript changed transition commands");
    pass("重开工程后的 exportScript 仍保持命令字段", "Editor/src/utils/exportScript.ts");
    expect(snapshots.after[1].animation_config.kind === "move", "Sprite animation_config was overwritten");
    pass("switch_transition 编辑和工程往返不覆盖 animation_config");
    expect(snapshots.after[0].transition === "fade" && snapshots.after[2].transition === "wipe_rtl", "Legacy background fields were lost");
    pass("新旧字段并存和 legacy-only 背景命令均被保留");

    await selectScene(page);
    const reopenedBackground = await ensureCard(page, 0);
    await reopenedBackground.controls.scrollIntoViewIfNeeded();
    const screenshotPath = path.join(outputDir, "01-transition-persistence-editor.png");
    await reopenedBackground.card.screenshot({ path: screenshotPath });
    report.artifacts.screenshot = screenshotPath;
    pass("工程重开后编辑器正确回显持久化的背景过场", "scripts/client-experience-transition-persist-playwright.cjs");

    const cartridgePath = await exportCartridge(page);
    report.artifacts.cartridgePath = cartridgePath;
    pass("通过真实 Editor 导出界面生成 .vncart", "Editor/src/cartridge/ExportCartridgePanel.tsx");
    expect(browserErrors.length === 0, "Editor browser emitted errors", browserErrors);
    pass("Editor Playwright 全流程 console/pageerror 为 0", "scripts/client-experience-transition-persist-playwright.cjs");
    await context.close();
    await browser.close();
    browser = undefined;

    const bytes = fs.readFileSync(cartridgePath);
    const zip = await JSZip.loadAsync(bytes);
    const scriptEntry = zip.file("script.json");
    expect(Boolean(scriptEntry), "Exported cartridge is missing script.json");
    const archivedScript = JSON.parse(await scriptEntry.async("string"));
    const archived = archivedScript.scenes[0].commands;
    expect(JSON.stringify(archived.map(commandSnapshot)) === JSON.stringify(before), "Archive script.json changed transition commands");
    pass(".vncart 的 script.json 深比较保留全部过场字段", "Editor/src/cartridge/exportCartridge.ts");
    expect(archived[0].transition_config.kind === "reveal_center" && archived[0].transition === "fade", "Structured/legacy background coexistence lost");
    pass("卡带中背景结构化字段与 legacy 字段可同时存在");
    expect(archived[1].switch_transition.kind === "blur" && archived[1].animation_config.kind === "move", "Sprite transition fields lost");
    pass("卡带中 switch_transition 与 animation_config 同时保留");
    expect(archived[2].transition === "wipe_rtl" && archived[2].transition_config === undefined, "Legacy-only command was rewritten");
    pass("legacy-only 命令不会被强制重写为结构化字段");

    const localStorageValues = new Map();
    global.window = {
      localStorage: {
        getItem: (key) => localStorageValues.get(key) ?? null,
        setItem: (key, value) => localStorageValues.set(key, String(value)),
        removeItem: (key) => localStorageValues.delete(key),
        clear: () => localStorageValues.clear(),
      },
    };
    const api = loadGameCliApi();
    const file = new File([bytes], "transition-persist.vncart", { type: "application/vnd.agentvn.cartridge" });
    const runtimeImported = await api.importRuntimeCartridge(file);
    expect(runtimeImported.validation.ok, "GameCli runtime import validation failed", runtimeImported.validation);
    const runtimeCommands = runtimeImported.cartridge.script.scenes[0].commands;
    expect(JSON.stringify(runtimeCommands.map(commandSnapshot)) === JSON.stringify(before), "GameCli runtime import changed transition commands");
    pass("GameCli importRuntimeCartridge 保留过场命令", "GameCli_framework/src/cartridge/importCartridge.ts");

    const libraryImported = await api.importCartridgeFromFile(
      new File([bytes], "transition-persist.vncart", { type: "application/vnd.agentvn.cartridge" }),
      [],
    );
    expect(libraryImported.validation.ok, "GameCli library import validation failed", libraryImported.validation);
    expect(JSON.stringify(libraryImported.game.script.scenes[0].commands.map(commandSnapshot))
      === JSON.stringify(before), "GameCli library import changed transition commands");
    pass("GameCli 真实游戏库导入路径保留结构化、动画与 legacy 字段", "GameCli_framework/src/cartridge/desktopLibrary.ts");
    pass("结构化字段贯穿 Editor → project → script → vncart → GameCli 全链路");

    report.ok = true;
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Transition persistence acceptance passed: ${report.checks.length} checks.`);
    console.log(`Screenshot: ${screenshotPath}`);
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
