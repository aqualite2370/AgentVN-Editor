#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { loadProjectContainerSync, saveProjectContainerSync } = require("./project-container.cjs");
const { spawn, spawnSync } = require("node:child_process");
const JSZip = require("../Editor/node_modules/jszip");
const { chromium } = require("../Editor/node_modules/playwright");
const { waitForAsyncFunction } = require("./lib/async-readiness.cjs");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");

const root = path.resolve(__dirname, "..");
const outputDir = process.env.AGENTVN_WORKSPACE_OUTPUT ? path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT) : "";
const testDir = outputDir ? path.join(outputDir, "artifacts") : "";
const editorUrl = "http://127.0.0.1:6767/";
const gameCliUrl = "http://127.0.0.1:6868/";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const headed = process.argv.includes("--headed");
const checks = [];
const consoleErrors = [];
const pageErrors = [];

function expect(condition, assertion, value, file = "scripts/client-experience-final-e2e-playwright.cjs") {
  if (!condition) throw new Error(`${assertion}; ${JSON.stringify(value)}`);
  checks.push({ assertion, value, file });
}

function resetDirectories() {
  // Legacy name retained for existing callers, but this never resets/deletes.
  if (!process.env.AGENTVN_WORKSPACE_OUTPUT || !process.env.AGENTVN_TEST_PROJECT)
    throw new Error("Explicit AGENTVN_WORKSPACE_OUTPUT and isolated AGENTVN_TEST_PROJECT required.");
  if (!outputDir.toLowerCase().startsWith("f:\\agentvn\\qa\\") || fs.existsSync(outputDir))
    throw new Error("Use a fresh isolated F:\\AgentVN\\QA output; existing evidence is never reset.");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(testDir);
}

async function isListening(url) {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

function startDevServer(name, cwd) {
  const child = spawn(npmCommand, ["run", "dev"], {
    cwd,
    shell: process.platform === "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logFile = path.join(outputDir, `${name}.log`);
  const writeLog = (data) => fs.appendFileSync(logFile, data.toString());
  child.stdout.on("data", writeLog);
  child.stderr.on("data", writeLog);
  return child;
}

function stopDevServer(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  child.kill("SIGTERM");
}

async function ensureServer(name, url, cwd) {
  // Never attach to a pre-existing fixed-port service, even if it is healthy.
  return startOwnedViteServer({ root: cwd, port: 0, logFile: path.join(outputDir, `${name}.log`) });
}

function loadDefaultUISkinLayout() {
  const esbuild = require("../Editor/node_modules/esbuild");
  const result = esbuild.buildSync({
    stdin: {
      contents: "export { getDefaultUISkinLayout } from './shared/cartridge/uiSkin';",
      loader: "ts",
      resolveDir: root,
      sourcefile: "output/playwright/final-e2e-ui-skin-entry.ts",
    },
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    write: false,
    logLevel: "silent",
  });
  const filename = path.join(outputDir, "final-e2e-ui-skin.cjs");
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(root);
  compiled._compile(result.outputFiles[0].text, filename);
  return compiled.exports.getDefaultUISkinLayout();
}

function svgDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function asset(assetId, assetType, filename, svg, now) {
  return {
    asset_id: assetId,
    asset_type: assetType,
    metadata: {
      display_name: assetId,
      filename,
      mime_type: "image/svg+xml",
      size_bytes: Buffer.byteLength(svg, "utf8"),
      source: "generated",
      license_note: "AgentVN final E2E generated fixture.",
      data_url: svgDataUrl(svg),
      blob_url: svgDataUrl(svg),
      project_path: `assets/${assetType}/${filename}`,
      created_at: now,
    },
  };
}

function backgroundSvg(color, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="${color}"/><circle cx="1080" cy="132" r="190" fill="#fff" opacity=".12"/><text x="80" y="640" fill="#fff" font-size="58">${label}</text></svg>`;
}

function spriteSvg(color, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="980"><rect width="520" height="980" fill="transparent"/><ellipse cx="260" cy="166" rx="112" ry="132" fill="${color}"/><path d="M88 928 Q118 332 260 304 Q402 332 432 928Z" fill="${color}"/><text x="260" y="892" text-anchor="middle" fill="#fff" font-size="52">${label}</text></svg>`;
}

function buttonSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="148"><defs><linearGradient id="b" x1="0" x2="1"><stop stop-color="#e2559a"/><stop offset="1" stop-color="#7c92ff"/></linearGradient></defs><rect x="4" y="4" width="472" height="140" rx="28" fill="url(#b)"/><text x="240" y="92" text-anchor="middle" fill="#fff" font-size="38" font-weight="700">RED P</text></svg>`;
}

function buildUiSkin() {
  const uiSkin = loadDefaultUISkinLayout();
  const title = uiSkin.screens.find((screen) => screen.screen_id === "title");
  if (!title) throw new Error("Default UI skin is missing title screen.");
  title.components.push(
    {
      component_id: "title_custom_text_e2e",
      component_type: "main_menu_custom_button",
      label: "官网按钮",
      visible: true,
      rect: { x: 6, y: 88, width: 19, height: 7 },
      mobileRect: { x: 5, y: 90, width: 27, height: 6 },
      zIndex: 40,
      style: { backgroundColor: "#192234", color: "#f6f8ff", borderColor: "#d8e2ff", borderWidth: 1, borderRadius: 10, shadow: "soft", textAlign: "center" },
      action: { kind: "none" },
    },
    {
      component_id: "title_custom_image_e2e",
      component_type: "main_menu_custom_button",
      label: "红P入口",
      visible: true,
      rect: { x: 28, y: 88, width: 19, height: 7 },
      mobileRect: { x: 36, y: 90, width: 27, height: 6 },
      zIndex: 41,
      style: { backgroundImage: "asset:official_button_art", backgroundFit: "cover", backgroundColor: "#211c36", color: "#fff", borderColor: "#ffd6eb", borderWidth: 1, borderRadius: 10, shadow: "soft", textAlign: "center" },
      action: { kind: "none" },
    },
    {
      component_id: "title_custom_link_e2e",
      component_type: "main_menu_custom_button",
      label: "官网链接",
      visible: true,
      rect: { x: 50, y: 88, width: 19, height: 7 },
      mobileRect: { x: 67, y: 90, width: 27, height: 6 },
      zIndex: 42,
      style: { backgroundColor: "#26334c", color: "#f5f7ff", borderColor: "#7fa4ff", borderWidth: 1, borderRadius: 10, shadow: "soft", textAlign: "center" },
      action: { kind: "external_url", url: "https://example.com/agentvn-final-e2e", open_mode: "system_browser" },
    },
  );
  return uiSkin;
}

function buildProject() {
  const now = new Date().toISOString();
  const scene = {
    scene_id: "final_e2e_opening",
    title: "真实全链路 E2E",
    summary: "标题按钮、导出卡带、背景过场与立绘过场全链路验收。",
    chapter: 1,
    tags: ["final-e2e"],
    commands: [
      { type: "background", background_id: "bg_a", background_fit: "cover", transition_config: { kind: "none", duration_ms: 0, easing: "linear" } },
      { type: "narration", text: "背景 A 已就位，下一步触发 B 的 crossfade。" },
      { type: "background", background_id: "bg_b", background_fit: "cover", transition_config: { kind: "crossfade", duration_ms: 900, easing: "ease-in-out" } },
      { type: "narration", text: "背景 B 已进入，下一步触发 C 的 slide。" },
      { type: "background", background_id: "bg_c", background_fit: "cover", transition_config: { kind: "slide_left", duration_ms: 900, easing: "ease-out" } },
      { type: "narration", text: "背景 C 完成，下一步显示角色 A。" },
      { type: "sprite", character_id: "hero", sprite_id: "hero_a", position: "center", scale: 0.92, visible: true, animation_config: { kind: "fade", phase: "enter", direction: "none", duration_ms: 260, easing: "ease-out", blocking: false } },
      { type: "narration", text: "角色 A 已显示，下一步替换为 B。" },
      { type: "sprite", character_id: "hero", sprite_id: "hero_b", position: "center", scale: 0.92, visible: true, switch_transition: { kind: "crossfade", duration_ms: 850, easing: "ease-in-out" } },
      { type: "narration", text: "角色 B 完成，下一步替换为 C。" },
      { type: "sprite", character_id: "hero", sprite_id: "hero_c", position: "center", scale: 0.92, visible: true, switch_transition: { kind: "slide_up", duration_ms: 850, easing: "ease-out" } },
      { type: "narration", text: "角色 C 完成，下一步执行退出动画。" },
      { type: "sprite", character_id: "hero", sprite_id: "hero_c", position: "center", scale: 0.92, visible: false, animation: "fade_out", animation_config: { kind: "fade", phase: "exit", direction: "none", duration_ms: 650, easing: "ease-in", blocking: true } },
      { type: "narration", text: "角色退出动画完成。" },
    ],
    is_ending: true,
  };
  return {
    schema_version: "1.0.0",
    project_id: `final_e2e_${Date.now()}`,
    title: "Client Experience Final E2E",
    author: "AgentVN QA",
    nodes: [
      { id: "start", type: "startNode", position: { x: 60, y: 240 }, data: { nodeKind: "start", label: "入口", description: "Final E2E entry.", memoryMode: "hybrid", aiSettings: { authorGoal: "", autoExtractMemory: false, autoApplyMemory: false }, previewState: { currentCommandIndex: 0, isPlaying: false }, editorMeta: { collapsedInspectorSections: [], source: "manual" } } },
      { id: "node_final_e2e_opening", type: "sceneNode", position: { x: 360, y: 180 }, data: { nodeKind: "scene", label: scene.title, description: scene.summary, memoryMode: "hybrid", aiSettings: { authorGoal: "Final E2E fixture.", autoExtractMemory: false, autoApplyMemory: false }, previewState: { currentCommandIndex: 0, isPlaying: false }, editorMeta: { collapsedInspectorSections: [], source: "manual" }, scene } },
    ],
    edges: [{ id: "edge_start_final_e2e", source: "start", target: "node_final_e2e_opening", sourceHandle: "default" }],
    viewport: { x: 0, y: 0, zoom: 1 },
    memory_mode: "hybrid",
    asset_manifest: [
      asset("bg_a", "background", "bg-a.svg", backgroundSvg("#26466f", "BACKGROUND A"), now),
      asset("bg_b", "background", "bg-b.svg", backgroundSvg("#613d74", "BACKGROUND B CROSSFADE"), now),
      asset("bg_c", "background", "bg-c.svg", backgroundSvg("#2f6f61", "BACKGROUND C SLIDE"), now),
      asset("hero_a", "sprite", "hero-a.svg", spriteSvg("#4977bd", "A"), now),
      asset("hero_b", "sprite", "hero-b.svg", spriteSvg("#bd5f8f", "B"), now),
      asset("hero_c", "sprite", "hero-c.svg", spriteSvg("#48a173", "C"), now),
      asset("official_button_art", "ui", "official-button-art.svg", buttonSvg(), now),
    ],
    editor_settings: { runtimeUILayout: buildUiSkin() },
    created_at: now,
    updated_at: now,
  };
}

async function openProject(page, project, projectPath) {
  await page.addInitScript((draft) => {
    localStorage.setItem("agentvn.currentProjectDraft", JSON.stringify(draft));
    localStorage.setItem("agentvn.recentProjects", JSON.stringify([{ project_id: draft.project_id, title: draft.title, author: draft.author, updated_at: draft.updated_at, project: draft }]));
  }, project);
  await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
  const toolbar = page.locator(".editor-toolbar");
  if (!(await toolbar.isVisible({ timeout: 3000 }).catch(() => false))) {
    const input = page.locator(".project-import-button input").first();
    await input.waitFor({ state: "attached", timeout: 20_000 });
    await page.waitForFunction(() => {
      const importInput = document.querySelector(".project-import-button input");
      const importButton = document.querySelector(".project-import-button");
      return Boolean(importInput && !importInput.disabled && importButton?.getAttribute("aria-disabled") !== "true");
    }, null, { timeout: 20_000 });
    await input.setInputFiles(projectPath);
    const openDraft = page.locator('[data-help-key="home.openDraft"]:visible, [data-help-key="home.recentProject"]:visible').first();
    await openDraft.waitFor({ state: "visible", timeout: 20_000 });
    await openDraft.click({ force: true });
    if (!(await toolbar.isVisible({ timeout: 10_000 }).catch(() => false))) {
      await page.evaluate(() => {
        document.querySelectorAll(".project-entry-loading-overlay").forEach((element) => {
          if (element instanceof HTMLElement) element.style.pointerEvents = "none";
        });
        const entry = Array.from(document.querySelectorAll(
          '[data-help-key="home.openDraft"], [data-help-key="home.recentProject"]',
        )).find((element) => element instanceof HTMLElement && element.offsetParent !== null && !element.hasAttribute("disabled"));
        if (entry instanceof HTMLElement) entry.click();
      });
    }
  }
  await toolbar.waitFor({ state: "visible", timeout: 30_000 }).catch(async (error) => {
    const debug = await page.evaluate(() => ({
      title: document.title,
      url: location.href,
      toolbarCount: document.querySelectorAll(".editor-toolbar").length,
      openDraftCount: document.querySelectorAll('[data-help-key="home.openDraft"]').length,
      recentProjectCount: document.querySelectorAll('[data-help-key="home.recentProject"]').length,
      importInputCount: document.querySelectorAll(".project-import-button input").length,
      overlayCount: document.querySelectorAll(".project-entry-loading-overlay").length,
      stageClass: document.querySelector(".app-transition-stage")?.className ?? "",
      bodyText: document.body.innerText.slice(0, 1200),
    })).catch((debugError) => ({ debugError: String(debugError) }));
    await page.screenshot({ path: path.join(outputDir, "editor-open-project-timeout.png"), fullPage: true }).catch(() => {});
    throw new Error(`Editor toolbar did not become visible while opening final E2E project: ${JSON.stringify(debug)}\n${String(error)}`);
  });
  await page.locator(".project-entry-loading-overlay").waitFor({ state: "hidden", timeout: 20_000 }).catch(() => {});
  await page.waitForFunction(() => {
    const stage = document.querySelector(".app-transition-stage");
    return Boolean(document.querySelector(".editor-toolbar"))
      && !document.querySelector(".project-entry-loading-overlay")
      && !stage?.classList.contains("is-home-hydrating")
      && !stage?.classList.contains("is-switching")
      && !stage?.classList.contains("is-enter-cartridge")
      && !stage?.classList.contains("is-project-entry-loading");
  }, null, { timeout: 30_000 }).catch(async () => {
    await page.evaluate(() => {
      document.querySelectorAll(".project-entry-loading-overlay").forEach((element) => {
        if (!(element instanceof HTMLElement)) return;
        element.style.pointerEvents = "none";
        element.dispatchEvent(new AnimationEvent("animationiteration", {
          animationName: "project-entry-rose-cycle",
          bubbles: true,
        }));
      });
    });
    await page.waitForFunction(() => Boolean(document.querySelector(".editor-toolbar")), null, { timeout: 10_000 });
  });
  await page.evaluate((snapshot) => {
    window.__AGENTVN_EDITOR_STORE__?.getState?.().importProject(snapshot);
    window.__AGENTVN_PROJECT_STORE__?.getState?.().loadProjectMetadata(snapshot);
    const runtimeUILayout = snapshot.editor_settings?.runtimeUILayout;
    if (runtimeUILayout) window.__AGENTVN_PROJECT_STORE__?.getState?.().setRuntimeUILayout?.(runtimeUILayout);
  }, project);
  await page.waitForFunction(() => window.__AGENTVN_EDITOR_STORE__?.getState?.().nodes?.some((node) => node.id === "node_final_e2e_opening"), null, { timeout: 10_000 });
  await page.waitForFunction(() => window.__AGENTVN_PROJECT_STORE__?.getState?.().settings?.runtimeUILayout?.screens
    ?.find((screen) => screen.screen_id === "title")?.components
    ?.some((component) => component.component_id === "title_custom_text_e2e"), null, { timeout: 10_000 });
}

async function selectLayoutScreenWithComponent(page, componentId) {
  const hasComponent = async () => page.locator(`.runtime-layout-component-list button[data-component-id="${componentId}"]`).count().then((count) => count > 0);
  if (await hasComponent()) return;
  const screenButtons = page.locator('[data-help-key="layout.screen"]:visible');
  const titleButton = screenButtons.filter({ hasText: "标题主页" }).first();
  if (await titleButton.count()) {
    await titleButton.click({ force: true });
    if (await page.locator(`.runtime-layout-component-list button[data-component-id="${componentId}"]`).waitFor({ state: "attached", timeout: 2_000 }).then(() => true).catch(() => false)) {
      return;
    }
  }
  const count = await screenButtons.count();
  for (let index = 0; index < count; index += 1) {
    await screenButtons.nth(index).click({ force: true });
    await page.waitForTimeout(300);
    if (await hasComponent()) return;
  }
  const debug = await page.evaluate((id) => ({
    selectedScreenButton: Array.from(document.querySelectorAll('[data-help-key="layout.screen"]')).map((element) => ({
      text: element.textContent?.trim() ?? "",
      active: element.classList.contains("is-active"),
    })),
    componentIds: Array.from(document.querySelectorAll('.runtime-layout-component-list button[data-component-id]')).map((element) => element.getAttribute('data-component-id')),
    storeTitleIds: window.__AGENTVN_PROJECT_STORE__?.getState?.().settings?.runtimeUILayout?.screens
      ?.find((screen) => screen.screen_id === "title")?.components?.map((component) => component.component_id) ?? [],
    target: id,
  }), componentId);
  await page.screenshot({ path: path.join(outputDir, "editor-title-component-missing.png"), fullPage: true }).catch(() => {});
  throw new Error(`Could not select title layout component ${componentId}: ${JSON.stringify(debug)}`);
}

async function selectRichOptionByIndex(page, helpKey, optionIndex) {
  await page.locator(`button[data-help-key="${helpKey}"]`).first().click({ force: true });
  const option = page.locator('.rich-select-popover[role="listbox"] [role="option"], .rich-select-popover[role="listbox"] .rich-select-option').nth(optionIndex);
  await option.waitFor({ state: "visible", timeout: 5_000 });
  await option.click();
  await page.waitForTimeout(160);
}

async function refineTitleButtonInEditor(page) {
  await page.locator('[data-help-key="toolbar.advanced"]').first().click({ force: true });
  await page.locator(".toolbar-popover.advanced").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator('[data-help-key="advanced.tab.layout"]').click({ force: true });
  await page.locator(".runtime-layout-stage").waitFor({ state: "visible", timeout: 10_000 });
  await selectLayoutScreenWithComponent(page, "title_custom_text_e2e");
  await page.locator('.runtime-layout-component-list button[data-component-id="title_custom_text_e2e"]').click({ force: true });
  await page.locator('[data-help-key="layout.customButton.label"]').fill("官网入口");
  await page.waitForFunction(() => document.querySelector('[data-component-id="title_custom_text_e2e"] .runtime-layout-block-label')?.textContent === "官网入口", null, { timeout: 5_000 });
  await page.locator('[data-help-key="layout.save"]').click({ force: true });
  await page.waitForFunction(() => window.__AGENTVN_PROJECT_STORE__?.getState?.().settings?.runtimeUILayout?.screens?.find((screen) => screen.screen_id === "title")?.components?.find((component) => component.component_id === "title_custom_text_e2e")?.label === "官网入口", null, { timeout: 5_000 });
  await page.screenshot({ path: path.join(outputDir, "01-editor-title-custom-buttons.png"), fullPage: true });
  expect(true, "Editor layout designer edits and saves the text custom button label", "官网入口", "Editor/src/components/advanced/RuntimeLayoutDesigner.tsx");
}

async function saveProjectViaToolbar(page) {
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.locator('[data-help-key="toolbar.saveProject"]').first().click({ force: true });
  const download = await downloadPromise;
  const savedPath = path.join(testDir, "final-e2e-saved.vnproj");
  await download.saveAs(savedPath);
  const saved = loadProjectContainerSync(savedPath).project;
  const title = saved.editor_settings?.runtimeUILayout?.screens?.find((screen) => screen.screen_id === "title");
  const textButton = title?.components?.find((component) => component.component_id === "title_custom_text_e2e");
  expect(textButton?.label === "官网入口", "saved project preserves the Editor-edited custom button label", textButton, "Editor/src/components/editor/EditorToolbar.tsx");
  expect(saved.asset_manifest?.some((item) => item.asset_id === "official_button_art" && item.asset_type === "ui"), "saved project keeps the custom UI button asset manifest entry", saved.asset_manifest?.map((item) => item.asset_id), "Editor/src/components/editor/EditorToolbar.tsx");
  return savedPath;
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
  await page.locator('[data-help-key="package.export"]').click({ force: true });
  const download = await downloadPromise.catch(async (error) => {
    const debug = await page.evaluate(() => ({
      modeText: document.querySelector('[data-help-key="package.mode"]')?.textContent?.trim() ?? "",
      exportButtonText: document.querySelector('[data-help-key="package.export"]')?.textContent?.trim() ?? "",
      exportButtonDisabled: document.querySelector('[data-help-key="package.export"]')?.hasAttribute("disabled") ?? false,
      exportButtonBusy: document.querySelector('[data-help-key="package.export"]')?.getAttribute("aria-busy") ?? "",
      messages: document.querySelector(".cartridge-export-panel .json-preview")?.textContent?.trim() ?? "",
      logLines: [...document.querySelectorAll(".package-log-line")].map((line) => line.textContent?.trim() ?? ""),
      preflightStatus: document.querySelector(".preflight-panel")?.className ?? "",
      blockers: [...document.querySelectorAll(".preflight-panel .is-blocked, .preflight-check-row.is-blocked")].map((node) => node.textContent?.trim() ?? ""),
      warnings: [...document.querySelectorAll(".preflight-panel .is-warning, .preflight-check-row.is-warning")].map((node) => node.textContent?.trim() ?? ""),
      panelText: document.querySelector(".cartridge-export-panel")?.textContent?.trim().slice(0, 2500) ?? "",
    })).catch((debugError) => ({ debugError: String(debugError) }));
    await page.screenshot({ path: path.join(outputDir, "02-export-download-timeout.png"), fullPage: true }).catch(() => {});
    throw new Error(`Final E2E cartridge export did not produce a browser download: ${JSON.stringify(debug, null, 2)}\n${String(error)}`);
  });
  const cartridgePath = path.join(testDir, "final-e2e.vncart");
  await download.saveAs(cartridgePath);
  return cartridgePath;
}

async function verifyCartridge(cartridgePath) {
  const zip = await JSZip.loadAsync(fs.readFileSync(cartridgePath));
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  const script = JSON.parse(await zip.file("script.json").async("string"));
  const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
  const files = Object.keys(zip.files);
  const title = layout.screens.find((screen) => screen.screen_id === "title");
  const byId = Object.fromEntries(title.components.map((component) => [component.component_id, component]));
  const commands = script.scenes.find((scene) => scene.scene_id === "final_e2e_opening")?.commands ?? [];
  expect(manifest.ui_skin?.path === "ui/layout.json", "exported cartridge manifest points at ui/layout.json", manifest.ui_skin, "Editor/src/cartridge/ExportCartridgePanel.tsx");
  expect(byId.title_custom_text_e2e?.label === "官网入口", "exported UI layout contains the Editor-edited text custom button", byId.title_custom_text_e2e, "shared/cartridge/uiSkin.ts");
  expect(byId.title_custom_image_e2e?.style?.backgroundImage === "asset:official_button_art", "exported image custom button keeps stable asset:<id> reference", byId.title_custom_image_e2e, "shared/cartridge/uiSkin.ts");
  expect(byId.title_custom_link_e2e?.action?.url === "https://example.com/agentvn-final-e2e", "exported link custom button keeps the safe HTTPS URL", byId.title_custom_link_e2e?.action, "shared/cartridge/uiSkin.ts");
  expect(files.some((file) => file.includes("assets/ui/") && file.includes("official-button-art")), "exported cartridge packages the custom button image asset bytes", files.filter((file) => file.includes("assets/ui/")), "Editor/src/cartridge/exportCartridge.ts");
  expect(commands.some((command) => command.type === "background" && command.background_id === "bg_b" && command.transition_config?.kind === "crossfade"), "runtime script exports background A-to-B crossfade config", commands, "Editor/src/utils/exportScript.ts");
  expect(commands.some((command) => command.type === "background" && command.background_id === "bg_c" && command.transition_config?.kind === "slide_left"), "runtime script exports background B-to-C slide config", commands, "Editor/src/utils/exportScript.ts");
  expect(commands.some((command) => command.type === "sprite" && command.sprite_id === "hero_b" && command.switch_transition?.kind === "crossfade"), "runtime script exports sprite A-to-B crossfade config", commands, "Editor/src/utils/exportScript.ts");
  expect(commands.some((command) => command.type === "sprite" && command.sprite_id === "hero_c" && command.switch_transition?.kind === "slide_up"), "runtime script exports sprite B-to-C vertical slide config", commands, "Editor/src/utils/exportScript.ts");
  expect(commands.some((command) => command.type === "sprite" && command.visible === false && command.animation_config?.phase === "exit"), "runtime script exports sprite exit animation config", commands, "Editor/src/utils/exportScript.ts");
  return { manifest, script, layout, files };
}

async function installWindowOpenInterceptor(context) {
  await context.addInitScript(() => {
    window.__AGENTVN_OPEN_CALLS__ = [];
    window.open = (url, target, features) => {
      let openerValue = { initial: true };
      const call = { url: String(url), target, features, openerAfter: "not-assigned" };
      const popup = {};
      Object.defineProperty(popup, "opener", {
        get() { return openerValue; },
        set(value) { openerValue = value; call.openerAfter = value === null ? null : String(value); },
      });
      window.__AGENTVN_OPEN_CALLS__.push(call);
      return popup;
    };
  });
}

async function importAndLaunchGameCli(page, cartridgePath) {
  await page.goto(gameCliUrl, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="web-cartridge-file"]').setInputFiles(cartridgePath);
  await page.locator(".cartridge-spine").first().waitFor({ state: "visible", timeout: 20_000 });
  const launchButton = page.locator(".launch-actions button").first();
  await launchButton.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForFunction(() => {
    const button = document.querySelector(".launch-actions button");
    return button instanceof HTMLButtonElement
      && !button.disabled
      && button.getAttribute("aria-busy") !== "true";
  }, null, { timeout: 20_000 });
  await launchButton.click();
  await page.locator('[data-testid="game-state-title"]').waitFor({ state: "visible", timeout: 20_000 }).catch(async (error) => {
    const debug = await page.evaluate(() => ({
      body: document.body.innerText.slice(0, 1800),
      libraryVisible: Boolean(document.querySelector('[data-testid="game-state-library"]')),
      titleVisible: Boolean(document.querySelector('[data-testid="game-state-title"]')),
      playingVisible: Boolean(document.querySelector('[data-testid="game-state-playing"]')),
      spineCount: document.querySelectorAll(".cartridge-spine").length,
      selectedSpine: document.querySelector(".cartridge-spine.active")?.textContent?.trim() ?? "",
      launchButtons: [...document.querySelectorAll(".launch-actions button")].map((button, index) => ({
        index,
        text: button.textContent?.trim() ?? "",
        disabled: button instanceof HTMLButtonElement ? button.disabled : undefined,
        ariaBusy: button.getAttribute("aria-busy"),
      })),
    })).catch((debugError) => ({ debugError: String(debugError) }));
    await page.screenshot({ path: path.join(outputDir, "gamecli-title-timeout.png"), fullPage: true }).catch(() => {});
    throw new Error(`GameCli did not enter title screen after launching imported cartridge: ${JSON.stringify(debug, null, 2)}\n${String(error)}`);
  });
  await page.screenshot({ path: path.join(outputDir, "02-gamecli-title-custom-buttons.png"), fullPage: true });
}

async function verifyTitleButtonsAndLink(page) {
  const buttons = page.locator('[data-testid="custom-title-button"]');
  await page.locator('[data-ui-component-id="title_custom_text_e2e"]').waitFor({ state: "visible", timeout: 10_000 });
  const snapshot = await buttons.evaluateAll((nodes) => nodes.map((node) => ({
    id: node.getAttribute("data-ui-component-id"),
    text: node.textContent?.trim(),
    action: node.getAttribute("data-ui-action-kind"),
    imageState: node.getAttribute("data-ui-image-state"),
    backgroundImage: getComputedStyle(node).backgroundImage,
  })));
  const byId = Object.fromEntries(snapshot.map((item) => [item.id, item]));
  expect(snapshot.length >= 3, "GameCli title screen renders all exported custom buttons", snapshot, "GameCli_framework/src/components/shell/MainMenu.tsx");
  expect(byId.title_custom_text_e2e?.text === "官网入口", "GameCli renders the Editor-edited custom text button", byId.title_custom_text_e2e, "GameCli_framework/src/components/shell/MainMenu.tsx");
  expect(byId.title_custom_image_e2e?.imageState === "resolved" && byId.title_custom_image_e2e.backgroundImage !== "none", "GameCli resolves the packaged image custom button", byId.title_custom_image_e2e, "GameCli_framework/src/uiSkin/uiSkinRuntime.tsx");
  expect(byId.title_custom_link_e2e?.action === "external_url", "GameCli preserves the external_url action on the link button", byId.title_custom_link_e2e, "GameCli_framework/src/components/shell/MainMenu.tsx");
  await page.locator('[data-ui-component-id="title_custom_link_e2e"]').click();
  await page.waitForFunction(() => window.__AGENTVN_OPEN_CALLS__?.length === 1, null, { timeout: 5_000 });
  const calls = await page.evaluate(() => window.__AGENTVN_OPEN_CALLS__);
  expect(
    calls[0]?.url === "https://example.com/agentvn-final-e2e"
      && calls[0]?.target === "_blank"
      && String(calls[0]?.features).includes("noopener")
      && String(calls[0]?.features).includes("noreferrer")
      && calls[0]?.openerAfter === null,
    "external link click uses one safe noopener/noreferrer opener call",
    calls,
    "GameCli_framework/src/utils/openExternalUrl.ts",
  );
}

async function completeAndAdvance(page) {
  const player = page.locator('[data-testid="game-state-playing"]');
  if (await player.getAttribute("data-is-typing") === "true") {
    await player.click({ position: { x: 40, y: 40 } });
    await page.waitForFunction(() => document.querySelector('[data-testid="game-state-playing"]')?.getAttribute("data-is-typing") === "false", null, { timeout: 5_000 });
  }
  await player.click({ position: { x: 40, y: 40 } });
}

async function waitBackgroundTransition(page, payload, screenshotName) {
  try {
    await page.waitForFunction(({ kind, current, previous }) => {
      const layer = document.querySelector(".background-layer");
      const frames = [...document.querySelectorAll(".background-transition-frame")];
      const currentFrame = frames.find((frame) => frame.getAttribute("data-transition-role") === "current");
      const previousFrame = frames.find((frame) => frame.getAttribute("data-transition-role") === "previous");
      return layer?.getAttribute("data-transition-phase") === "active"
        && layer?.getAttribute("data-transition-kind") === kind
        && frames.length === 2
        && currentFrame?.getAttribute("data-background-id") === current
        && previousFrame?.getAttribute("data-background-id") === previous;
    }, payload, { timeout: 3_000 });
  } catch (error) {
    const diagnostic = await page.evaluate(async () => {
      const { useRuntimeStore } = await import("/src/store/runtimeStore.ts");
      const runtime = useRuntimeStore.getState();
      const layer = document.querySelector(".background-layer");
      return {
        commandIndex: runtime.engineState.currentCommandIndex,
        commandType: runtime.engineState.currentCommandType,
        background: runtime.engineState.background,
        transition: runtime.engineState.backgroundTransition,
        transitionKey: runtime.engineState.backgroundTransitionKey,
        phase: layer?.getAttribute("data-transition-phase"),
        kind: layer?.getAttribute("data-transition-kind"),
        frames: [...document.querySelectorAll(".background-transition-frame")].map((frame) => ({
          role: frame.getAttribute("data-transition-role"),
          id: frame.getAttribute("data-background-id"),
        })),
      };
    });
    await page.screenshot({ path: path.join(outputDir, `failed-${screenshotName}`), fullPage: true });
    throw new Error(`${error instanceof Error ? error.message : String(error)}; diagnostic=${JSON.stringify(diagnostic)}`);
  }
  const snapshot = await page.locator(".background-layer").evaluate((layer) => ({
    phase: layer.getAttribute("data-transition-phase"),
    kind: layer.getAttribute("data-transition-kind"),
    frames: [...layer.querySelectorAll(".background-transition-frame")].map((frame) => ({ role: frame.getAttribute("data-transition-role"), id: frame.getAttribute("data-background-id") })),
  }));
  expect(snapshot.phase === "active" && snapshot.kind === payload.kind && snapshot.frames.length === 2, `background ${payload.previous}->${payload.current} transition exposes previous/current frames`, snapshot, "GameCli_framework/src/components/player/BackgroundLayer.tsx");
  await page.screenshot({ path: path.join(outputDir, screenshotName), fullPage: true });
  await page.waitForFunction((current) => {
    const layer = document.querySelector(".background-layer");
    const frames = [...document.querySelectorAll(".background-transition-frame")];
    return layer?.getAttribute("data-transition-phase") === "idle"
      && frames.length === 1
      && frames[0].getAttribute("data-background-id") === current;
  }, payload.current, { timeout: 4_000 });
  expect(true, `background ${payload.current} transition cleans the outgoing frame`, payload.current, "GameCli_framework/src/components/player/BackgroundLayer.tsx");
}

async function waitSpriteTransition(page, payload, screenshotName) {
  await page.waitForFunction(({ kind, current, previous }) => {
    const slot = document.querySelector('.sprite-slot[data-character-id="hero"]');
    const frames = [...(slot?.querySelectorAll(".sprite-replacement-frame") ?? [])];
    const currentFrame = frames.find((frame) => frame.getAttribute("data-sprite-role") === "current");
    const previousFrame = frames.find((frame) => frame.getAttribute("data-sprite-role") === "previous");
    return slot?.getAttribute("data-sprite-replacement-active") === "true"
      && slot?.getAttribute("data-sprite-transition-kind") === kind
      && frames.length === 2
      && currentFrame?.getAttribute("data-sprite-id") === current
      && previousFrame?.getAttribute("data-sprite-id") === previous;
  }, payload, { timeout: 3_000 });
  const snapshot = await page.locator('.sprite-slot[data-character-id="hero"]').evaluate((slot) => ({
    active: slot.getAttribute("data-sprite-replacement-active"),
    kind: slot.getAttribute("data-sprite-transition-kind"),
    frames: [...slot.querySelectorAll(".sprite-replacement-frame")].map((frame) => ({ role: frame.getAttribute("data-sprite-role"), id: frame.getAttribute("data-sprite-id") })),
  }));
  expect(snapshot.active === "true" && snapshot.kind === payload.kind && snapshot.frames.length === 2, `sprite ${payload.previous}->${payload.current} transition exposes previous/current frames`, snapshot, "GameCli_framework/src/components/player/SpriteLayer.tsx");
  await page.screenshot({ path: path.join(outputDir, screenshotName), fullPage: true });
  await page.waitForFunction((current) => {
    const slot = document.querySelector('.sprite-slot[data-character-id="hero"]');
    const frames = [...(slot?.querySelectorAll(".sprite-replacement-frame") ?? [])];
    return slot?.getAttribute("data-sprite-replacement-active") === "false"
      && frames.length === 1
      && frames[0].getAttribute("data-sprite-id") === current;
  }, payload.current, { timeout: 4_000 });
  expect(true, `sprite ${payload.current} transition cleans the outgoing frame`, payload.current, "GameCli_framework/src/components/player/SpriteLayer.tsx");
}

async function verifyRuntimeStory(page) {
  await page.locator('[data-testid="start-new-game"]').click({ force: true });
  await page.locator('[data-testid="game-state-playing"]').waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForFunction(() => document.querySelector(".background-layer")?.getAttribute("data-background-id") === "bg_a", null, { timeout: 10_000 });
  await waitForAsyncFunction(page, async () => {
    const { useRuntimeStore } = await import("/src/store/runtimeStore.ts");
    const state = useRuntimeStore.getState();
    return state.launchTransition === "idle"
      && state.engineState.currentCommandIndex === 1
      && state.engineState.dialog?.isNarration === true;
  }, null, { timeout: 10_000 });
  expect(true, "actual GameCli start button enters the exported story at background A", "bg_a", "GameCli_framework/src/store/runtimeStore.ts");
  await completeAndAdvance(page);
  await waitBackgroundTransition(page, { kind: "crossfade", previous: "bg_a", current: "bg_b" }, "03-background-crossfade-mid.png");
  await completeAndAdvance(page);
  await waitBackgroundTransition(page, { kind: "slide_left", previous: "bg_b", current: "bg_c" }, "04-background-slide-mid.png");
  await completeAndAdvance(page);
  await page.waitForFunction(() => document.querySelector('.sprite-slot[data-character-id="hero"][data-sprite-id="hero_a"]'), null, { timeout: 5_000 });
  expect(true, "initial sprite command renders hero_a before replacement transitions", "hero_a", "GameCli_framework/src/components/player/SpriteLayer.tsx");
  await completeAndAdvance(page);
  await waitSpriteTransition(page, { kind: "crossfade", previous: "hero_a", current: "hero_b" }, "05-sprite-crossfade-mid.png");
  await completeAndAdvance(page);
  await waitSpriteTransition(page, { kind: "slide_up", previous: "hero_b", current: "hero_c" }, "06-sprite-slide-up-mid.png");
  await completeAndAdvance(page);
  await page.waitForFunction(() => {
    const slot = document.querySelector('.sprite-slot[data-character-id="hero"]');
    return slot?.getAttribute("data-runtime-animation-active") === "true" && slot?.getAttribute("data-runtime-animation-id");
  }, null, { timeout: 2_500 });
  const exitSnapshot = await page.locator('.sprite-slot[data-character-id="hero"]').evaluate((slot) => ({
    sprite: slot.getAttribute("data-sprite-id"),
    active: slot.getAttribute("data-runtime-animation-active"),
    animationId: slot.getAttribute("data-runtime-animation-id"),
  }));
  expect(exitSnapshot.active === "true" && exitSnapshot.sprite === "hero_c", "sprite exit command starts a real runtime exit animation", exitSnapshot, "GameCli_framework/src/engine/StoryEngine.ts");
  await page.screenshot({ path: path.join(outputDir, "07-sprite-exit-animation.png"), fullPage: true });
  await page.waitForFunction(() => !document.querySelector('.sprite-slot[data-character-id="hero"]'), null, { timeout: 5_000 });
  expect(true, "sprite exit animation removes the character after completion", "hero", "GameCli_framework/src/components/player/SpriteLayer.tsx");
}

async function main() {
  resetDirectories();
  const project = buildProject();
  const projectPath = path.join(testDir, "final-e2e.vnproj");
  saveProjectContainerSync(projectPath, project, { container: "zip" });
  const report = { ok: false, startedAt: new Date().toISOString(), projectPath, outputDir, checks, consoleErrors, pageErrors };
  const children = [];
  let browser;
  try {
    const editorServer = await ensureServer("editor-dev", editorUrl, path.join(root, "Editor"));
    const gameCliServer = await ensureServer("gamecli-dev", gameCliUrl, path.join(root, "GameCli_framework"));
    if (editorServer) children.push(editorServer);
    if (gameCliServer) children.push(gameCliServer);
    browser = await chromium.launch({ headless: !headed });

    const editorContext = await browser.newContext({ viewport: { width: 1600, height: 980 }, acceptDownloads: true });
    const editorPage = await editorContext.newPage();
    editorPage.on("console", (message) => { if (message.type() === "error") consoleErrors.push(`editor: ${message.text()}`); });
    editorPage.on("pageerror", (error) => pageErrors.push(`editor: ${error.stack || error.message}`));
    await editorPage.route("http://127.0.0.1:8278/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const body = request.postDataJSON?.() ?? {};
      if (url.pathname === "/api/project/catalog") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, data: [] }),
        });
        return;
      }
      if (url.pathname === "/api/project/state") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, data: request.method() === "GET" ? null : body }),
        });
        return;
      }
      if (url.pathname.startsWith("/api/project/projects/")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, data: request.method() === "GET" ? project : body }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: {} }),
      });
    });
    await openProject(editorPage, project, projectPath);
    await refineTitleButtonInEditor(editorPage);
    report.savedProjectPath = await saveProjectViaToolbar(editorPage);
    report.cartridgePath = await exportCartridge(editorPage);
    report.cartridge = await verifyCartridge(report.cartridgePath);
    await editorContext.close();

    const gameContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await installWindowOpenInterceptor(gameContext);
    const gamePage = await gameContext.newPage();
    gamePage.on("console", (message) => { if (message.type() === "error") consoleErrors.push(`gamecli: ${message.text()}`); });
    gamePage.on("pageerror", (error) => pageErrors.push(`gamecli: ${error.stack || error.message}`));
    await importAndLaunchGameCli(gamePage, report.cartridgePath);
    await verifyTitleButtonsAndLink(gamePage);
    await verifyRuntimeStory(gamePage);
    await gameContext.close();

    expect(consoleErrors.length === 0 && pageErrors.length === 0, "Editor and GameCli browser console/page-error streams remain clean", { consoleErrors, pageErrors });
    report.ok = true;
  } catch (error) {
    report.error = error instanceof Error ? error.stack ?? error.message : String(error);
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    if (browser) await browser.close().catch(() => {});
    for (const child of children) stopDevServer(child);
  }
  console.log(JSON.stringify(report, null, 2));
}

// The old main/openProject/refine helpers above are historical context, not an
// executable acceptance path. In particular, store injection, force clicks and
// artificial animation events there must never be used to certify a user flow.
module.exports = { buildProject, verifyCartridge, verifyTitleButtonsAndLink,
  installWindowOpenInterceptor, checks };
if (require.main === module)
  require("./lib/client-experience-current-flow.cjs").run(module.exports).catch(error => {
    console.error(error.stack || error); process.exitCode = 1;
  });
