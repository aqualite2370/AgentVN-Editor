#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { saveProjectContainerSync } = require("./project-container.cjs");
const { spawn, execFileSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { chromium } = require("../editor/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const EDITOR_URL = process.env.AGENTVN_EDITOR_URL || "http://127.0.0.1:6767/";
const TEST_DIR = path.join(ROOT, "test_AgentVN", "asset-generation");
const OUT_DIR = path.join(ROOT, "output", "playwright", "asset-generation");
const REPORT_PATH = path.join(OUT_DIR, "report.json");
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const headed = process.argv.includes("--headed");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function assertInsideRoot(target) {
  const resolved = path.resolve(target);
  const rootWithSep = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
  if (resolved !== ROOT && !resolved.startsWith(rootWithSep)) {
    throw new Error("Refusing to operate outside workspace: " + resolved);
  }
  return resolved;
}

function resetOutput() {
  for (const dir of [TEST_DIR, OUT_DIR]) {
    fs.rmSync(assertInsideRoot(dir), { recursive: true, force: true });
    ensureDir(dir);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isListening(url) {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

function startEditor(report) {
  const logPath = path.join(OUT_DIR, "editor.log");
  const child = spawn(NPM, ["run", "dev"], {
    cwd: path.join(ROOT, "editor"),
    shell: process.platform === "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => fs.appendFileSync(logPath, chunk));
  child.stderr.on("data", (chunk) => fs.appendFileSync(logPath, chunk));
  report.logs.push(logPath);
  return child;
}

async function ensureEditor(report) {
  if (await isListening(EDITOR_URL)) return [];
  const started = [startEditor(report)];
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (await isListening(EDITOR_URL)) return started;
    await sleep(700);
  }
  throw new Error("Editor did not become ready: " + EDITOR_URL);
}

function stopServices(started) {
  for (const child of started) {
    if (!child?.pid) continue;
    try {
      if (process.platform === "win32") {
        execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        child.kill("SIGTERM");
      }
    } catch {
      // Already stopped.
    }
  }
}

function emptySharedState() {
  return {
    project_graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, memoryMode: "hybrid" },
    project_metadata: {},
    recent_projects: [],
    provider_connections: [],
    provider_models: [],
    provider_selections: {},
    provider_secrets: {},
  };
}

async function installProjectStateRoute(page) {
  let sharedState = emptySharedState();
  await page.route("**/api/project/state", async (route) => {
    const request = route.request();
    if (request.method().toUpperCase() === "POST") {
      let patch = {};
      try {
        patch = JSON.parse(request.postData() || "{}");
      } catch {
        patch = {};
      }
      sharedState = {
        ...sharedState,
        ...patch,
        project_graph: patch.project_graph || sharedState.project_graph,
        project_metadata: { ...sharedState.project_metadata, ...(patch.project_metadata || {}) },
        recent_projects: patch.recent_projects || sharedState.recent_projects,
        provider_connections: patch.provider_connections || sharedState.provider_connections,
        provider_models: patch.provider_models || sharedState.provider_models,
        provider_selections: patch.provider_selections || sharedState.provider_selections,
        provider_secrets: patch.provider_secrets || sharedState.provider_secrets,
      };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: sharedState }),
    });
  });
}

function buildProject() {
  const now = new Date().toISOString();
  const scene = {
    scene_id: "asset_generation_scene",
    title: "Asset Generation Acceptance Scene",
    summary: "Minimal scene for asset generation export.",
    chapter: 1,
    tags: ["asset-generation", "acceptance"],
    commands: [
      { type: "background", background_id: "", background_fit: "cover" },
      { type: "narration", text: "The saved generated asset should be packaged into the cartridge." },
    ],
  };
  return {
    schema_version: "1.0.0",
    project_id: "asset_generation_acceptance_" + Date.now(),
    title: "Asset Generation Acceptance",
    author: "AgentVN QA",
    nodes: [
      {
        id: "start",
        type: "startNode",
        position: { x: 40, y: 160 },
        data: {
          nodeKind: "start",
          label: "Start",
          description: "",
          memoryMode: "hybrid",
          aiSettings: { authorGoal: "", autoExtractMemory: false, autoApplyMemory: false },
          previewState: { currentCommandIndex: 0, isPlaying: false },
          editorMeta: { collapsedInspectorSections: [], source: "asset-generation-acceptance" },
        },
      },
      {
        id: "scene_asset_generation",
        type: "sceneNode",
        position: { x: 340, y: 130 },
        data: {
          nodeKind: "scene",
          label: scene.title,
          description: scene.summary,
          memoryMode: "hybrid",
          aiSettings: { authorGoal: "", autoExtractMemory: false, autoApplyMemory: false },
          previewState: { currentCommandIndex: 0, isPlaying: false },
          editorMeta: { collapsedInspectorSections: [], source: "asset-generation-acceptance" },
          scene,
        },
      },
    ],
    edges: [{ id: "edge_start_asset_generation", source: "start", target: "scene_asset_generation", sourceHandle: "default" }],
    viewport: { x: 0, y: 0, zoom: 1 },
    memory_mode: "hybrid",
    asset_manifest: [],
    editor_settings: {},
    created_at: now,
    updated_at: now,
  };
}

function writeSampleProject(report) {
  const project = buildProject();
  const projectPath = path.join(TEST_DIR, "asset-generation-source.vnproj");
  saveProjectContainerSync(projectPath, project, { container: "zip" });
  report.samples.push(projectPath);
  return project;
}

async function seedProject(page, project) {
  await page.addInitScript((draft) => {
    localStorage.clear();
    localStorage.setItem("agentvn.currentProjectDraft", JSON.stringify(draft));
    localStorage.setItem("agentvn.recentProjects", JSON.stringify([{
      project_id: draft.project_id,
      title: draft.title,
      author: draft.author,
      updated_at: draft.updated_at,
      project: draft,
    }]));
  }, project);
}

async function openSeededProject(page, report) {
  await page.goto(EDITOR_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const stage = document.querySelector(".app-transition-stage");
    return !document.querySelector(".project-entry-loading-overlay") &&
      (!stage ||
        (!stage.classList.contains("is-home-hydrating") &&
          !stage.classList.contains("is-switching") &&
          !stage.classList.contains("is-enter-cartridge") &&
          !stage.classList.contains("is-project-entry-loading")));
  }, null, { timeout: 30000 }).catch(() => {});
  if (!(await page.locator(".editor-toolbar").isVisible({ timeout: 1000 }).catch(() => false))) {
    await page.locator('[data-help-key="home.openDraft"]:visible, [data-help-key="home.recentProject"]:visible').first().click({ force: true });
  }
  try {
    await page.locator(".editor-toolbar").waitFor({ state: "visible", timeout: 60000 });
  } catch (error) {
    await captureFailure(page, report, "open-project");
    throw error;
  }
}

async function domClick(page, selector, options = {}) {
  const index = options.index || 0;
  await page.locator(selector).nth(index).waitFor({ state: "visible", timeout: options.timeout || 30000 });
  await page.evaluate(({ targetSelector, targetIndex }) => {
    const element = document.querySelectorAll(targetSelector)[targetIndex];
    if (element instanceof HTMLElement) element.click();
    else throw new Error("Cannot click selector: " + targetSelector);
  }, { targetSelector: selector, targetIndex: index });
  await page.waitForTimeout(options.delayMs || 120);
}

async function selectRichOptionByDom(page, scopeSelector, helpKey, optionIndex) {
  await domClick(page, scopeSelector + ' button[data-help-key="' + helpKey + '"][role="combobox"]');
  await page.locator('.rich-select-popover[role="listbox"] button[data-help-key="' + helpKey + '"][role="option"]').nth(optionIndex).waitFor({ state: "visible", timeout: 10000 });
  await page.evaluate(({ key, index }) => {
    const option = document.querySelectorAll('.rich-select-popover[role="listbox"] button[data-help-key="' + key + '"][role="option"]')[index];
    if (option instanceof HTMLElement) option.click();
    else throw new Error("Cannot select rich option: " + key);
  }, { key: helpKey, index: optionIndex });
  await page.waitForTimeout(150);
}

async function domCheck(page, selector) {
  await page.locator(selector).waitFor({ state: "visible", timeout: 30000 });
  await page.evaluate((targetSelector) => {
    const input = document.querySelector(targetSelector);
    if (!(input instanceof HTMLInputElement)) throw new Error("Cannot check selector: " + targetSelector);
    if (!input.checked) input.click();
    if (!input.checked) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked");
      descriptor?.set?.call(input, true);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, selector);
  await page.waitForTimeout(120);
}

async function openAssetGenerationPanel(page) {
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("agentvn:open-advanced-tools", {
      detail: {
        id: "asset-generation-acceptance",
        tab: "assets",
        title: "Asset generation acceptance",
        message: "Open asset generation for acceptance testing.",
      },
    }));
  });
  await page.locator(".advanced-tools-panel").waitFor({ state: "visible", timeout: 30000 });
  await page.locator(".asset-generation-panel").waitFor({ state: "visible", timeout: 30000 });
}

async function captureResponsiveStudio(page, report) {
  const viewports = [
    { name: "desktop-1440", width: 1440, height: 900 },
    { name: "desktop-1024", width: 1024, height: 768 },
    { name: "tablet-768", width: 768, height: 1024 },
    { name: "mobile-375", width: 375, height: 812 },
  ];
  for (const theme of ["white_gray", "blue_gray"]) {
    await page.evaluate((nextTheme) => document.documentElement.setAttribute("data-theme", nextTheme), theme);
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.waitForTimeout(280);
      if (viewport.width <= 1023) {
        await page.getByRole("button", { name: "画布", exact: true }).click();
      }
      const metrics = await page.locator(".asset-studio").evaluate((studio) => {
        const button = studio.querySelector('[data-help-key="asset.generate"]');
        const rect = studio.getBoundingClientRect();
        const buttonRect = button?.getBoundingClientRect();
        return {
          noHorizontalOverflow: studio.scrollWidth <= studio.clientWidth + 2,
          studioVisible: rect.width > 0 && rect.height > 0,
          generateVisible: Boolean(buttonRect && buttonRect.top >= 0 && buttonRect.bottom <= window.innerHeight + 1),
        };
      });
      if (!metrics.noHorizontalOverflow || !metrics.studioVisible || !metrics.generateVisible) {
        throw new Error(`Asset Studio responsive check failed for ${theme}/${viewport.name}: ${JSON.stringify(metrics)}`);
      }
      const screenshot = path.join(OUT_DIR, `${theme}-${viewport.name}.png`);
      await page.screenshot({ path: screenshot });
      report.screenshots.push(screenshot);
    }
  }
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "white_gray"));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(220);
}

async function runAssetGenerationFlow(page, report) {
  await openAssetGenerationPanel(page);
  const brand = await page.locator(".asset-studio-brand").evaluate((element) => ({
    text: element.textContent?.replace(/\s+/g, ""),
    heading: element.querySelector("h1")?.textContent?.trim(),
    eyebrowCount: element.querySelectorAll(".asset-studio-eyebrow").length,
  }));
  if (brand.text !== "绘梦" || brand.heading !== "绘梦" || brand.eyebrowCount !== 0) {
    throw new Error(`Asset Studio brand should only show the icon and 绘梦: ${JSON.stringify(brand)}`);
  }
  const titledButtons = await page.locator(".asset-studio button[title]").count();
  if (titledButtons !== 0) {
    throw new Error(`Asset Studio still contains ${titledButtons} button title tooltips.`);
  }
  const emptyStageText = await page.locator(".asset-studio-stage-canvas .asset-studio-empty-state").textContent();
  if (emptyStageText?.trim() !== "请在左侧操作与编辑") {
    throw new Error(`Asset Studio empty stage should guide users to the left editor: ${emptyStageText?.trim()}`);
  }
  await page.locator('.asset-studio button[data-help-key="asset.operation"]').first().hover();
  await page.waitForTimeout(350);
  if (await page.locator(".hover-help-card").isVisible().catch(() => false)) {
    throw new Error("Asset Studio buttons still trigger the global hover help card.");
  }
  await page.locator('.asset-studio-type-grid button[data-help-key="asset.type"]', { hasText: "UI 素材" }).click();
  await page.locator(".asset-studio-disclosure").last().evaluate((element) => {
    element.open = true;
  });
  await page.waitForFunction(() => {
    const width = document.querySelector('input[data-help-key="asset.width"]');
    const height = document.querySelector('input[data-help-key="asset.height"]');
    return width && height && width.value === "1024" && height.value === "1024";
  }, null, { timeout: 10000 });

  await domClick(page, '.asset-generation-panel [data-help-key="asset.rewrite"]');
  await page.locator('.asset-generation-panel [data-help-key="asset.useRewrite"]').first().waitFor({ state: "visible", timeout: 20000 });
  await domClick(page, '.asset-generation-panel [data-help-key="asset.useRewrite"]');

  await domClick(page, '.asset-generation-panel [data-help-key="asset.generate"]');
  await page.waitForFunction(() => document.querySelectorAll(".asset-studio-filmstrip button").length >= 2, null, { timeout: 30000 });
  const candidateCount = await page.locator(".asset-studio-filmstrip button").count();
  if (candidateCount < 2) throw new Error("Expected at least two generated candidates, got " + candidateCount + ".");
  report.resultActionDiagnostics = await page.locator(".asset-studio-result-actions > button").evaluateAll((buttons) => buttons.map((button) => {
    const style = getComputedStyle(button);
    const rect = button.getBoundingClientRect();
    return {
      text: button.textContent?.trim(),
      disabled: button.disabled,
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      color: style.color,
      background: style.backgroundColor,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  }));
  const generatedShot = path.join(OUT_DIR, "generated-candidates.png");
  await page.screenshot({ path: generatedShot, fullPage: true });
  report.screenshots.push(generatedShot);
  await captureResponsiveStudio(page, report);

  await domClick(page, '.asset-studio-stage [data-help-key="asset.saveGenerated"]');
  await page.locator(".asset-studio-save-dialog").waitFor({ state: "visible", timeout: 15000 });
  await page.locator('input[data-help-key="asset.displayName"]').fill("asset_generation_acceptance_saved");
  await page.locator('textarea[data-help-key="asset.license"]').fill("Mock provider output for asset generation acceptance.");
  await domClick(page, '.asset-studio-save-dialog [data-help-key="asset.saveGenerated"]');
  await page.locator(".asset-studio-save-dialog").waitFor({ state: "hidden", timeout: 15000 });
  await page.waitForFunction(() => {
    const raw = localStorage.getItem("agentvn.currentProjectDraft");
    if (!raw) return false;
    try {
      const draft = JSON.parse(raw);
      return Array.isArray(draft.asset_manifest) && draft.asset_manifest.some((asset) => asset.metadata?.data_url?.startsWith("data:image/"));
    } catch {
      return false;
    }
  }, null, { timeout: 10000 }).catch(() => {});

  const savedShot = path.join(OUT_DIR, "saved-asset.png");
  await page.screenshot({ path: savedShot, fullPage: true });
  report.screenshots.push(savedShot);
}

async function closeAdvancedTools(page) {
  await page.keyboard.press("Escape");
  await page.locator(".advanced-tools-panel").waitFor({ state: "hidden", timeout: 15000 });
}

async function selectAcceptanceScene(page) {
  const closeWorkbench = page.locator('button[data-help-key="workbench.close"]').first();
  if (await closeWorkbench.isVisible().catch(() => false)) {
    await closeWorkbench.click({ force: true });
    await page.locator(".floating-command-workbench").waitFor({ state: "hidden", timeout: 10000 });
  }
  const sceneNode = page.locator('.react-flow__node[data-id="scene_asset_generation"]').first();
  await sceneNode.waitFor({ state: "visible", timeout: 15000 });
  await sceneNode.click({ position: { x: 44, y: 34 }, force: true });
  if (!(await page.locator('.command-card[data-command-index="0"]').isVisible({ timeout: 3000 }).catch(() => false))) {
    await sceneNode.focus();
    await page.keyboard.press("Enter");
  }
  const card = page.locator('.command-card[data-command-index="0"]');
  await card.waitFor({ state: "visible", timeout: 15000 });
  const body = card.locator(".command-card-body");
  if (!(await body.isVisible().catch(() => false))) {
    await card.locator('button[data-help-key="command.expand"]').click({ force: true });
  }
  await body.waitFor({ state: "visible", timeout: 10000 });
  return { card, body };
}

async function readAppliedBackground(page) {
  return page.evaluate(() => {
    const editorStore = window.__AGENTVN_EDITOR_STORE__?.getState?.();
    const projectStore = window.__AGENTVN_PROJECT_STORE__?.getState?.();
    const node = editorStore?.nodes?.find((candidate) => candidate.id === "scene_asset_generation");
    const command = node?.data?.scene?.commands?.[0];
    const asset = projectStore?.assetManifest?.find((candidate) => candidate.asset_id === command?.background_id);
    return {
      command,
      asset,
      assetStudio: projectStore?.settings?.assetStudio,
    };
  });
}

async function runAssetPickerIntegrationFlow(page, report) {
  await closeAdvancedTools(page);
  const { body } = await selectAcceptanceScene(page);
  const aiGenerate = body.getByRole("button", { name: "AI 生成", exact: true });
  await aiGenerate.waitFor({ state: "visible", timeout: 10000 });
  await aiGenerate.click();
  await page.locator(".asset-generation-panel").waitFor({ state: "visible", timeout: 30000 });
  await page.waitForFunction(() => {
    const selected = document.querySelector('.asset-studio-type-grid button[data-help-key="asset.type"][aria-pressed="true"]');
    const width = document.querySelector('input[data-help-key="asset.width"]');
    const height = document.querySelector('input[data-help-key="asset.height"]');
    return selected?.textContent?.includes("背景") && width?.value === "1024" && height?.value === "576";
  }, null, { timeout: 10000 });

  const prompt = page.locator('textarea[data-help-key="asset.prompt"]');
  await prompt.fill("雨夜旧车站，电影感远景，留出视觉小说对白区域");
  await page.locator('input[data-help-key="asset.customPresetName"]').fill("雨夜背景验收预设");
  await domClick(page, 'button[data-help-key="asset.saveCustomPreset"]');
  await page.waitForFunction(() => (
    window.__AGENTVN_PROJECT_STORE__?.getState?.().settings?.assetStudio?.customPresets
      ?.some((preset) => preset.name === "雨夜背景验收预设")
  ), null, { timeout: 10000 });

  await prompt.fill("临时覆盖文本");
  await page.locator('[data-help-key="asset.customPreset"][role="combobox"]').click();
  const customPresetOption = page.locator('button[role="option"][data-help-key="asset.customPreset"]')
    .filter({ hasText: "雨夜背景验收预设" });
  await customPresetOption.waitFor({ state: "visible", timeout: 10000 });
  await customPresetOption.click();
  if ((await prompt.inputValue()) !== "雨夜旧车站，电影感远景，留出视觉小说对白区域") {
    throw new Error("Custom Asset Studio preset did not restore its saved prompt.");
  }

  await domClick(page, '.asset-generation-panel [data-help-key="asset.generate"]');
  await page.waitForFunction(() => document.querySelectorAll(".asset-studio-filmstrip button").length >= 2, null, { timeout: 30000 });
  await domClick(page, '.asset-studio-stage [data-help-key="asset.saveGenerated"]');
  await page.locator(".asset-studio-save-dialog").waitFor({ state: "visible", timeout: 15000 });
  await page.locator('input[data-help-key="asset.displayName"]').fill("asset_picker_applied_background");
  await domClick(page, '.asset-studio-save-dialog [data-help-key="asset.saveAndApply"]');
  await page.locator(".asset-studio-save-dialog").waitFor({ state: "hidden", timeout: 15000 });

  await page.waitForFunction(() => {
    const editorStore = window.__AGENTVN_EDITOR_STORE__?.getState?.();
    const projectStore = window.__AGENTVN_PROJECT_STORE__?.getState?.();
    const node = editorStore?.nodes?.find((candidate) => candidate.id === "scene_asset_generation");
    const assetId = node?.data?.scene?.commands?.[0]?.background_id;
    const asset = projectStore?.assetManifest?.find((candidate) => candidate.asset_id === assetId);
    return Boolean(assetId && asset?.metadata?.generation?.prompt?.includes("雨夜旧车站"));
  }, null, { timeout: 15000 });

  const applied = await readAppliedBackground(page);
  if (!applied.command?.background_id || applied.asset?.asset_type !== "background") {
    throw new Error("Save-and-apply did not write a generated background into the current command slot.");
  }
  if (!applied.assetStudio?.customPresets?.some((preset) => preset.name === "雨夜背景验收预设")) {
    throw new Error("Custom Asset Studio preset was not persisted in project editor settings.");
  }

  await closeAdvancedTools(page);
  const reopened = await selectAcceptanceScene(page);
  const restore = reopened.body.getByRole("button", { name: "恢复配方", exact: true });
  await restore.waitFor({ state: "visible", timeout: 10000 });
  await restore.click();
  await page.locator(".asset-generation-panel").waitFor({ state: "visible", timeout: 30000 });
  await page.waitForFunction(() => {
    const promptField = document.querySelector('textarea[data-help-key="asset.prompt"]');
    const selected = document.querySelector('.asset-studio-type-grid button[data-help-key="asset.type"][aria-pressed="true"]');
    return promptField?.value?.includes("雨夜旧车站") && selected?.textContent?.includes("背景");
  }, null, { timeout: 10000 });

  const screenshot = path.join(OUT_DIR, "asset-picker-save-apply-restore.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  report.screenshots.push(screenshot);
  report.assetPickerIntegration = {
    appliedAssetId: applied.command.background_id,
    generationPrompt: applied.asset.metadata.generation.prompt,
    customPresetCount: applied.assetStudio.customPresets.length,
  };
}

async function exportCartridge(page, report) {
  await page.locator('[data-workspace-surface="publish"]:visible').click({ force: true });
  await page.locator(".cartridge-export-panel").waitFor({ state: "visible", timeout: 30000 });
  const modeTrigger = page.locator('button[data-help-key="package.mode"]');
  await modeTrigger.click();
  await page.locator('.rich-select-popover[role="listbox"] .rich-select-option')
    .filter({ hasText: "游戏卡带 .vncart" })
    .click();
  const checksStage = page.locator('[data-package-stage="checks"]');
  if (await checksStage.count()) {
    await checksStage.click({ force: true });
  }
  if (await page.locator('input[data-help-key="package.confirmWarnings"]').count()) {
    await domCheck(page, 'input[data-help-key="package.confirmWarnings"]');
  }
  await page.locator('[data-package-stage="settings"]').click({ force: true }).catch(() => {});
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-help-key="package.export"]');
    return button && !button.disabled;
  }, null, { timeout: 30000 });
  const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
  await domClick(page, '[data-help-key="package.export"]');
  const download = await downloadPromise;
  const cartridgePath = path.join(TEST_DIR, "asset-generation-acceptance.vncart");
  await download.saveAs(cartridgePath);
  report.artifacts.push(cartridgePath);
  return cartridgePath;
}

async function inspectCartridge(cartridgePath) {
  const zip = await JSZip.loadAsync(fs.readFileSync(cartridgePath));
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("Exported cartridge is missing manifest.json.");
  const manifest = JSON.parse(await manifestFile.async("string"));
  const generatedAssets = (manifest.assets || []).filter((asset) => asset.ai_generated && asset.asset_type === "ui");
  if (generatedAssets.length === 0) throw new Error("Exported manifest does not contain the saved generated UI asset.");
  const asset = generatedAssets.find((item) => item.path && zip.file(item.path));
  if (!asset) throw new Error("Generated UI asset was listed in manifest but missing from the zip.");
  if (asset.placeholder) throw new Error("Generated UI asset was exported as a placeholder.");
  const bytes = await zip.file(asset.path).async("nodebuffer");
  if (bytes.length < 80) throw new Error("Generated UI asset is unexpectedly small: " + bytes.length + " bytes.");
  const isPng = bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (!isPng) throw new Error("Generated mock asset did not preserve the selected PNG output format.");
  return { asset, sizeBytes: bytes.length, manifestAssetCount: manifest.assets.length };
}

async function captureFailure(page, report, label) {
  const safe = String(label || "failure").replace(/[^A-Za-z0-9._-]+/g, "-");
  const screenshot = path.join(OUT_DIR, safe + ".png");
  const dom = path.join(OUT_DIR, safe + ".html");
  await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
  await fs.promises.writeFile(dom, await page.content().catch(() => ""), "utf8").catch(() => {});
  report.screenshots.push(screenshot);
  report.artifacts.push(dom);
}

async function main() {
  resetOutput();
  const report = {
    ok: true,
    at: new Date().toISOString(),
    editorUrl: EDITOR_URL,
    samples: [],
    screenshots: [],
    artifacts: [],
    logs: [],
    steps: [],
  };
  const project = writeSampleProject(report);
  let browser;
  let context;
  let page;
  let started = [];
  try {
    started = await ensureEditor(report);
    browser = await chromium.launch({ headless: !headed });
    context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
    page = await context.newPage();
    await installProjectStateRoute(page);
    await seedProject(page, project);
    await openSeededProject(page, report);
    report.steps.push({ name: "open-project", ok: true });
    await runAssetGenerationFlow(page, report);
    report.steps.push({ name: "generate-and-save", ok: true });
    await runAssetPickerIntegrationFlow(page, report);
    report.steps.push({ name: "asset-picker-save-apply-restore", ok: true });
    const cartridgePath = await exportCartridge(page, report);
    report.steps.push({ name: "export-cartridge", ok: true, cartridgePath });
    report.cartridge = await inspectCartridge(cartridgePath);
    report.steps.push({ name: "inspect-cartridge", ok: true, generatedAsset: report.cartridge.asset });
  } catch (error) {
    report.ok = false;
    report.error = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
    if (page) await captureFailure(page, report, "failure");
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    stopServices(started);
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
    console.log(JSON.stringify({
      ok: report.ok,
      reportPath: REPORT_PATH,
      samples: report.samples,
      screenshots: report.screenshots,
      artifacts: report.artifacts,
      cartridge: report.cartridge,
      error: report.error,
    }, null, 2));
  }
  if (!report.ok) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
