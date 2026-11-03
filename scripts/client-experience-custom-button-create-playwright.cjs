#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { saveProjectContainerSync } = require("./project-container.cjs");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const EDIT_MODE = process.argv.includes("--edit");
const EXISTING_IMAGE_MODE = process.argv.includes("--existing-image");
const IMAGE_IMPORT_MODE = process.argv.includes("--image-import");
const CONTAINER_MODE = process.argv.includes("--container");
const PERSIST_MODE = process.argv.includes("--persist");
const OUTPUT_CASE = PERSIST_MODE
  ? "custom-button-persist"
  : CONTAINER_MODE
  ? "custom-button-container"
  : IMAGE_IMPORT_MODE
    ? "custom-button-image-import"
  : EXISTING_IMAGE_MODE
    ? "custom-button-existing-image"
  : EDIT_MODE
    ? "custom-button-edit"
    : "custom-button-create";
const OUTPUT_DIR = path.join(
  ROOT,
  "output",
  "playwright",
  "client-experience-enhancement",
  OUTPUT_CASE,
);
const EDITOR_URL = "http://127.0.0.1:6767/";
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const HEADED = process.argv.includes("--headed");

function assertInsideRoot(target) {
  const resolved = path.resolve(target);
  const rootWithSeparator = ROOT.endsWith(path.sep) ? ROOT : `${ROOT}${path.sep}`;
  if (resolved !== ROOT && !resolved.startsWith(rootWithSeparator)) {
    throw new Error(`Refusing path outside project root: ${resolved}`);
  }
  return resolved;
}

function resetOutput() {
  fs.rmSync(assertInsideRoot(OUTPUT_DIR), { recursive: true, force: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadDefaultUISkinLayout() {
  const esbuild = require("../editor/node_modules/esbuild");
  const result = esbuild.buildSync({
    stdin: {
      contents: 'export { getDefaultUISkinLayout } from "./shared/cartridge/uiSkin";',
      loader: "ts",
      resolveDir: ROOT,
      sourcefile: "output/playwright/custom-button-existing-image-entry.ts",
    },
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node18",
    write: false,
    logLevel: "silent",
  });
  const output = result.outputFiles?.[0]?.text;
  if (!output) throw new Error("Unable to load the shared default UI skin.");
  const compiled = new Module(path.join(ROOT, "output/playwright/custom-button-existing-image-entry.cjs"), module);
  compiled.filename = path.join(ROOT, "output/playwright/custom-button-existing-image-entry.cjs");
  compiled.paths = Module._nodeModulePaths(ROOT);
  compiled._compile(output, compiled.filename);
  return compiled.exports.getDefaultUISkinLayout();
}

async function isListening(url) {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

function startEditorServer() {
  const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : NPM;
  const args = process.platform === "win32" ? ["/d", "/s", "/c", "npm run dev"] : ["run", "dev"];
  const child = spawn(command, args, {
    cwd: path.join(ROOT, "editor"),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logFile = path.join(OUTPUT_DIR, "editor-dev.log");
  const appendLog = (chunk) => fs.appendFileSync(logFile, chunk.toString());
  child.stdout.on("data", appendLog);
  child.stderr.on("data", appendLog);
  return child;
}

function stopEditorServer(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    child.kill("SIGTERM");
  }
}

async function ensureEditorServer() {
  if (await isListening(EDITOR_URL)) return undefined;
  const child = startEditorServer();
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await isListening(EDITOR_URL)) return child;
    await sleep(400);
  }
  stopEditorServer(child);
  throw new Error(`Editor did not start at ${EDITOR_URL}`);
}

function buildProject() {
  const now = new Date().toISOString();
  const imageDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const assetManifest = EXISTING_IMAGE_MODE
    ? [
        {
          asset_id: "ui_button_art",
          asset_type: "ui",
          metadata: {
            display_name: "Button Artwork",
            filename: "button-art.png",
            mime_type: "image/png",
            data_url: imageDataUrl,
          },
        },
        {
          asset_id: "background_button_art",
          asset_type: "background",
          metadata: {
            display_name: "Background Artwork",
            filename: "background-art.png",
            mime_type: "image/png",
            data_url: imageDataUrl,
          },
        },
        {
          asset_id: "sprite_button_art",
          asset_type: "sprite",
          metadata: {
            display_name: "Sprite Artwork",
            filename: "sprite-art.png",
            mime_type: "image/png",
            data_url: imageDataUrl,
          },
        },
      ]
    : IMAGE_IMPORT_MODE
      ? [
          {
            asset_id: "button-art",
            asset_type: "ui",
            metadata: {
              display_name: "Existing Button Artwork",
              filename: "existing-button-art.png",
              mime_type: "image/png",
              data_url: imageDataUrl,
              project_path: "assets/ui/button-art-existing-button-art.png",
            },
          },
        ]
    : [];
  const editorSettings = {};
  if (PERSIST_MODE) {
    const runtimeUILayout = loadDefaultUISkinLayout();
    const titleScreen = runtimeUILayout.screens.find((screen) => screen.screen_id === "title");
    if (!titleScreen) throw new Error("Shared default UI skin is missing the title screen.");
    titleScreen.components.push(
      {
        component_id: "title_custom_button_persist_primary",
        component_type: "main_menu_custom_button",
        label: "官方网站",
        visible: true,
        required: false,
        locked: false,
        zIndex: 31,
        rect: { x: 6, y: 88, width: 20, height: 7 },
        mobileRect: { x: 6, y: 90, width: 27, height: 6 },
        style: {
          backgroundColor: "#24324d",
          backgroundImage: "asset:persist-button-art",
          backgroundFit: "cover",
          color: "#f6f8ff",
          borderColor: "#82b6ff",
          borderWidth: 2,
          borderRadius: 12,
          opacity: 0.94,
          shadow: "strong",
          textAlign: "center",
        },
        action: {
          kind: "external_url",
          url: "https://example.com/persist",
          open_mode: "system_browser",
        },
      },
      {
        component_id: "title_custom_button_persist_secondary",
        component_type: "main_menu_custom_button",
        label: "社区",
        visible: false,
        required: false,
        locked: false,
        zIndex: 32,
        rect: { x: 28, y: 88, width: 20, height: 7 },
        mobileRect: { x: 35, y: 90, width: 27, height: 6 },
        style: {
          backgroundColor: "#192234",
          color: "#f6f8ff",
          borderColor: "#d8e2ff",
          borderWidth: 1,
          borderRadius: 10,
          shadow: "soft",
          textAlign: "center",
        },
        action: { kind: "none" },
      },
    );
    editorSettings.runtimeUILayout = runtimeUILayout;
  }
  if (EXISTING_IMAGE_MODE || IMAGE_IMPORT_MODE) {
    const runtimeUILayout = loadDefaultUISkinLayout();
    const titleScreen = runtimeUILayout.screens.find((screen) => screen.screen_id === "title");
    if (!titleScreen) throw new Error("Shared default UI skin is missing the title screen.");
    const componentId = IMAGE_IMPORT_MODE
      ? "title_custom_button_image_import"
      : "title_custom_button_existing_image";
    titleScreen.components.push({
      component_id: componentId,
      component_type: "main_menu_custom_button",
      label: "Official",
      visible: true,
      required: false,
      locked: false,
      zIndex: 20,
      rect: { x: 6, y: 84, width: 20, height: 7 },
      mobileRect: { x: 7, y: 92, width: 27, height: 6 },
      style: {
        backgroundColor: "#192234",
        ...(EXISTING_IMAGE_MODE ? { backgroundImage: "asset:missing_button_art" } : {}),
        backgroundFit: "cover",
        color: "#f6f8ff",
      },
      action: { kind: "none" },
    });
    editorSettings.runtimeUILayout = runtimeUILayout;
  }
  const scene = {
    scene_id: "custom_button_create_scene",
    title: "Custom Button Create",
    summary: "Playwright acceptance fixture.",
    chapter: 1,
    tags: ["layout", "acceptance"],
    commands: [{ type: "narration", text: "Custom button create acceptance." }],
    is_ending: true,
  };
  return {
    schema_version: "1.0.0",
    project_id: `custom_button_create_${Date.now()}`,
    title: "AgentVN Custom Button Create",
    author: "AgentVN QA",
    nodes: [
      {
        id: "start",
        type: "startNode",
        position: { x: 40, y: 220 },
        data: {
          nodeKind: "start",
          label: "Start",
          description: "",
          memoryMode: "hybrid",
          aiSettings: { authorGoal: "", autoExtractMemory: false, autoApplyMemory: false },
          previewState: { currentCommandIndex: 0, isPlaying: false },
          editorMeta: { collapsedInspectorSections: [], source: "manual" },
        },
      },
      {
        id: "scene",
        type: "sceneNode",
        position: { x: 320, y: 180 },
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
    edges: [{ id: "edge_start_scene", source: "start", target: "scene", sourceHandle: "default" }],
    viewport: { x: 0, y: 0, zoom: 1 },
    memory_mode: "hybrid",
    asset_manifest: PERSIST_MODE
      ? [{
          asset_id: "persist-button-art",
          asset_type: "ui",
          metadata: {
            display_name: "Persist Button Artwork",
            filename: "persist-button-art.png",
            mime_type: "image/png",
            data_url: imageDataUrl,
            project_path: "assets/ui/persist-button-art.png",
          },
        }]
      : assetManifest,
    editor_settings: editorSettings,
    created_at: now,
    updated_at: now,
  };
}

async function openProject(page, project, projectPath) {
  await page.addInitScript((draft) => {
    window.localStorage.setItem("agentvn.currentProjectDraft", JSON.stringify(draft));
    window.localStorage.setItem("agentvn.recentProjects", JSON.stringify([{
      project_id: draft.project_id,
      title: draft.title,
      author: draft.author,
      updated_at: draft.updated_at,
      project: draft,
    }]));
  }, project);
  await page.goto(EDITOR_URL, { waitUntil: "domcontentloaded" });
  const toolbar = page.locator(".editor-toolbar");
  if (await toolbar.isVisible({ timeout: 3000 }).catch(() => false)) return;

  const importInput = page.locator(".project-import-button input").first();
  await importInput.waitFor({ state: "attached", timeout: 20_000 });
  await page.waitForFunction(() => {
    const input = document.querySelector(".project-import-button input");
    const button = document.querySelector(".project-import-button");
    return Boolean(input && !input.disabled && button?.getAttribute("aria-disabled") !== "true");
  }, null, { timeout: 20_000 });
  await importInput.setInputFiles(projectPath);

  const openDraft = page.locator(
    '[data-help-key="home.openDraft"]:visible, [data-help-key="home.recentProject"]:visible',
  ).first();
  await openDraft.waitFor({ state: "visible", timeout: 20_000 });
  await openDraft.evaluate((element) => {
    if (element instanceof HTMLElement) element.click();
  });
  if (!(await toolbar.isVisible({ timeout: 10_000 }).catch(() => false))) {
    await page.evaluate(() => {
      document.querySelectorAll(".project-entry-loading-overlay").forEach((element) => {
        if (element instanceof HTMLElement) element.style.pointerEvents = "none";
      });
      const entry = Array.from(document.querySelectorAll(
        '[data-help-key="home.openDraft"], [data-help-key="home.recentProject"]',
      )).find((element) => element instanceof HTMLElement && element.offsetParent !== null);
      if (entry instanceof HTMLElement) entry.click();
    });
  }
  await toolbar.waitFor({ state: "visible", timeout: 20_000 });
}

async function openLayoutDesigner(page) {
  await page.evaluate(() => {
    document.querySelectorAll(".project-entry-loading-overlay").forEach((element) => {
      if (element instanceof HTMLElement) element.style.pointerEvents = "none";
    });
    const advanced = document.querySelector('[data-help-key="toolbar.advanced"]');
    if (advanced instanceof HTMLElement) advanced.click();
  });
  const popover = page.locator(".toolbar-popover.advanced");
  if (!(await popover.isVisible({ timeout: 3000 }).catch(() => false))) {
    await page.locator('[data-help-key="toolbar.advanced"]').click({ force: true });
  }
  await popover.waitFor({ state: "visible", timeout: 10_000 });
  await page.locator('[data-help-key="advanced.tab.layout"]').click();
  await page.locator(".runtime-layout-stage").waitFor({ state: "visible", timeout: 15_000 });
}

async function closeLayoutDesigner(page) {
  await page.keyboard.press("Escape");
  await page.locator(".toolbar-popover.advanced").waitFor({ state: "hidden", timeout: 10_000 });
}

async function customButtonSnapshot(page) {
  return page.locator(
    '.runtime-layout-stage .runtime-layout-block[data-component-type="main_menu_custom_button"]',
  ).evaluateAll((elements) => elements.map((element) => ({
    id: element.getAttribute("data-component-id"),
    actionKind: element.getAttribute("data-action-kind"),
    selected: element.classList.contains("is-selected"),
    left: element.style.left,
    top: element.style.top,
    width: element.style.width,
    height: element.style.height,
  })));
}

async function componentRectSnapshot(page, componentId) {
  return page.locator(
    `.runtime-layout-stage .runtime-layout-block[data-component-id="${componentId}"]`,
  ).evaluate((element) => ({
    left: element.style.left,
    top: element.style.top,
    width: element.style.width,
    height: element.style.height,
    autoSize: element.getAttribute("data-auto-size"),
  }));
}

function addCheck(report, assertion, value) {
  report.checks.push({
    assertion,
    value,
    file: "editor/src/components/advanced/RuntimeLayoutDesigner.tsx",
  });
}

function expect(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `; ${JSON.stringify(details)}` : ""}`);
}

async function runEditFlow(page, report, createdIds) {
  const editedId = createdIds[2];
  const labelInput = page.locator('[data-help-key="layout.customButton.label"]');
  await labelInput.waitFor({ state: "visible", timeout: 5000 });
  await labelInput.fill("官方网站");
  await page.waitForFunction(
    ({ id, label }) => document.querySelector(
      `.runtime-layout-stage [data-component-id="${id}"] .runtime-layout-block-label`,
    )?.textContent === label,
    { id: editedId, label: "官方网站" },
  );
  addCheck(report, "editing label updates the canvas immediately", "官方网站");

  await labelInput.fill("   ");
  const labelError = page.locator('[data-testid="custom-button-label-error"]');
  await labelError.waitFor({ state: "visible", timeout: 5000 });
  expect(await page.locator('[data-help-key="layout.save"]').isDisabled(), "Blank-only label must block layout save");
  addCheck(report, "blank-only label shows validation and blocks save", true);
  await labelInput.fill("官方网站");
  await labelError.waitFor({ state: "hidden", timeout: 5000 });
  expect(await page.locator('[data-help-key="layout.save"]').isEnabled(), "Valid custom button label must re-enable save");

  const visibleToggle = page.locator('input[data-help-key="layout.customButton.visible"]');
  await visibleToggle.uncheck();
  await page.waitForFunction(
    (id) => document.querySelector(`.runtime-layout-stage [data-component-id="${id}"]`)?.classList.contains("is-hidden"),
    editedId,
  );
  addCheck(report, "visible=false uses the existing design-time hidden state", true);

  const actionTrigger = page.locator('button[data-help-key="layout.customButton.actionKind"]');
  await actionTrigger.click();
  const actionOption = page.locator('.rich-select-popover[role="listbox"] .rich-select-option').nth(1);
  await actionOption.waitFor({ state: "visible", timeout: 5000 });
  await actionOption.click();
  await page.waitForFunction(
    (id) => document.querySelector(`.runtime-layout-stage [data-component-id="${id}"]`)?.getAttribute("data-action-kind") === "external_url",
    editedId,
  );
  addCheck(report, "action kind updates to external_url", true);

  const urlInput = page.locator('[data-help-key="layout.customButton.externalUrl"]');
  await urlInput.waitFor({ state: "visible", timeout: 5000 });
  const urlError = page.locator('[data-testid="custom-button-url-error"]');
  await urlError.waitFor({ state: "visible", timeout: 5000 });
  const testLinkButton = page.locator('[data-help-key="layout.customButton.testExternalUrl"]');
  expect(await testLinkButton.isDisabled(), "Empty external URL must disable test-link action");
  expect(await page.locator('[data-help-key="layout.save"]').isDisabled(), "Empty external URL must block layout save");
  addCheck(report, "external_url action reveals a required URL field and blocks save while empty", true);

  await urlInput.fill("javascript:alert(1)");
  await urlError.waitFor({ state: "visible", timeout: 5000 });
  expect(await testLinkButton.isDisabled(), "Unsafe URL protocol must keep test-link disabled");
  expect(await page.locator('[data-help-key="layout.save"]').isDisabled(), "Unsafe URL protocol must block layout save");
  addCheck(report, "unsafe protocol shows validation and cannot be tested or saved", "javascript:");

  await urlInput.fill("  https://example.com/docs  ");
  await urlError.waitFor({ state: "hidden", timeout: 5000 });
  expect(await urlInput.inputValue() === "https://example.com/docs", "URL input must trim surrounding whitespace without guessing a scheme");
  expect(await testLinkButton.isEnabled(), "Safe HTTPS URL must enable test-link action");
  expect(await page.locator('[data-help-key="layout.save"]').isEnabled(), "Safe HTTPS URL must allow layout save");
  const editedStageButton = page.locator(`.runtime-layout-stage [data-component-id="${editedId}"]`);
  expect(
    await editedStageButton.getAttribute("data-action-url") === "https://example.com/docs",
    "Canvas diagnostic must expose the normalized safe URL",
  );
  addCheck(report, "safe HTTPS URL is trimmed, stored, and saveable", "https://example.com/docs");

  await testLinkButton.click();
  const testStatus = page.locator('[data-testid="custom-button-url-test-status"]');
  await testStatus.waitFor({ state: "visible", timeout: 5000 });
  expect(
    await testStatus.getAttribute("data-tested-url") === "https://example.com/docs",
    "Test-link status must identify the validated URL",
  );
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardText === "https://example.com/docs", "Test-link action must safely copy only the validated URL", clipboardText);
  addCheck(report, "test-link safely copies the validated URL without opening an unsafe fallback", clipboardText);
  await testStatus.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUTPUT_DIR, "04-valid-external-link.png"), fullPage: true });

  await actionTrigger.click();
  await page.locator('.rich-select-popover[role="listbox"] .rich-select-option').nth(0).click();
  await page.waitForFunction(
    (id) => document.querySelector(`.runtime-layout-stage [data-component-id="${id}"]`)?.getAttribute("data-action-kind") === "none",
    editedId,
  );
  expect(await urlInput.count() === 0, "Switching to none must hide the URL editor");
  expect(await editedStageButton.getAttribute("data-action-url") === "", "Switching to none must clear the stale URL");
  addCheck(report, "switching back to none removes stale URL and test capability", true);

  await actionTrigger.click();
  await page.locator('.rich-select-popover[role="listbox"] .rich-select-option').nth(1).click();
  await urlInput.waitFor({ state: "visible", timeout: 5000 });
  expect(await urlInput.inputValue() === "", "Re-enabling external_url must not restore the stale URL");
  await urlInput.fill("https://example.com/docs");
  await urlError.waitFor({ state: "hidden", timeout: 5000 });

  await page.locator('.runtime-layout-component-list button[data-component-id="title_start_button"]').click();
  expect(
    await page.locator('[data-help-key="layout.customButton.delete"]').count() === 0,
    "Fixed title buttons must not expose the custom delete action",
  );
  addCheck(report, "fixed title button does not expose delete", true);

  await page.locator(`.runtime-layout-component-list button[data-component-id="${editedId}"]`).click();
  const deleteButton = page.locator('[data-help-key="layout.customButton.delete"]');
  await deleteButton.waitFor({ state: "visible", timeout: 5000 });
  await deleteButton.click();
  await page.waitForFunction(
    (id) => !document.querySelector(`.runtime-layout-stage [data-component-id="${id}"]`),
    editedId,
  );
  expect(
    await page.locator('.runtime-layout-stage [data-component-id="title_start_button"]').count() === 1,
    "Deleting a custom button must not remove fixed title buttons",
  );
  addCheck(report, "delete removes only the selected custom button", editedId);

  await page.locator('[data-help-key="layout.undo"]').click();
  await page.waitForFunction(
    (id) => Boolean(document.querySelector(`.runtime-layout-stage [data-component-id="${id}"]`)),
    editedId,
  );
  const restored = page.locator(`.runtime-layout-stage [data-component-id="${editedId}"]`);
  expect(
    await restored.locator(".runtime-layout-block-label").textContent() === "官方网站",
    "Undo must restore the edited label",
  );
  expect(await restored.getAttribute("data-action-kind") === "external_url", "Undo must restore action kind");
  expect(await restored.getAttribute("data-action-url") === "https://example.com/docs", "Undo must restore the validated external URL");
  expect(await restored.evaluate((element) => element.classList.contains("is-hidden")), "Undo must restore visibility");
  addCheck(report, "undo restores deleted button with label, visibility, safe URL action and stable ID", editedId);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "05-undo-restored-button.png"), fullPage: true });
}

async function runExistingImageFlow(page, report) {
  const componentId = "title_custom_button_existing_image";
  const stageButton = page.locator(
    `.runtime-layout-stage [data-component-id="${componentId}"]`,
  );
  await stageButton.waitFor({ state: "visible", timeout: 5000 });
  await page.locator(
    `.runtime-layout-component-list button[data-component-id="${componentId}"]`,
  ).click();

  expect(
    await stageButton.getAttribute("data-background-image-reference") === "asset:missing_button_art",
    "Fixture must expose the missing stable asset reference on the stage",
  );
  await page.locator(".asset-picker-warning[role=alert]").waitFor({ state: "visible", timeout: 5000 });
  addCheck(report, "missing stable asset reference produces a visible warning", "asset:missing_button_art");
  await page.screenshot({ path: path.join(OUTPUT_DIR, "01-missing-image-warning.png"), fullPage: true });

  const pickerTrigger = page.locator('[data-help-key="layout.customButton.image.openPicker"]');
  const inlinePicker = page.locator(".runtime-layout-custom-button-image .asset-picker");
  if (await pickerTrigger.count()) await pickerTrigger.click();
  const popover = await pickerTrigger.count()
    ? page.locator('.asset-picker-popover[role="dialog"]')
    : inlinePicker;
  await popover.waitFor({ state: "visible", timeout: 5000 });
  expect(
    await popover.locator('[data-asset-id="ui_button_art"]').count() === 1,
    "UI assets must be available in the button image picker",
  );
  await popover.locator('[data-help-key="layout.customButton.image.type"][data-asset-type="background"]').click();
  expect(
    await popover.locator('[data-asset-id="background_button_art"]').count() === 1,
    "Background assets must be available in the button image picker",
  );
  await popover.locator('[data-help-key="layout.customButton.image.type"][data-asset-type="sprite"]').click();
  expect(
    await popover.locator('[data-asset-id="sprite_button_art"]').count() === 1,
    "Compatible sprite assets must be available in the button image picker",
  );
  addCheck(report, "picker exposes ui, background, and compatible sprite image assets", true);
  await popover.locator('[data-help-key="layout.customButton.image.type"][data-asset-type="ui"]').click();
  await popover.locator('[data-asset-id="ui_button_art"]').click();

  await page.waitForFunction(
    (id) => document.querySelector(`.runtime-layout-stage [data-component-id="${id}"]`)
      ?.getAttribute("data-background-image-reference") === "asset:ui_button_art",
    componentId,
  );
  const storedReference = await stageButton.getAttribute("data-background-image-reference");
  expect(storedReference === "asset:ui_button_art", "Selected image must persist an asset:<id> reference", storedReference);
  expect(!storedReference.startsWith("blob:") && !storedReference.startsWith("data:"), "UI skin reference must not persist a temporary preview URL", storedReference);
  addCheck(report, "selection stores asset:ui_button_art instead of data/blob URL", storedReference);

  const stageBackground = await stageButton.evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(stageBackground.includes("data:image/png"), "Stage must resolve the stable reference to the manifest preview source", stageBackground);
  const expectedPreview = page.locator(
    `.runtime-layout-expected-preview [data-preview-component-id="${componentId}"]`,
  );
  expect(
    await expectedPreview.getAttribute("data-background-image-reference") === "asset:ui_button_art",
    "Expected preview must expose the same stable reference",
  );
  const expectedBackground = await expectedPreview.evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(expectedBackground.includes("data:image/png"), "Expected preview must resolve the stable reference", expectedBackground);
  addCheck(report, "stage and expected preview resolve the manifest image source", true);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "02-selected-existing-image.png"), fullPage: true });

  await page.locator('[data-help-key="layout.customButton.image.clear"]').click();
  await page.waitForFunction(
    (id) => document.querySelector(`.runtime-layout-stage [data-component-id="${id}"]`)
      ?.getAttribute("data-background-image-reference") === "",
    componentId,
  );
  expect(
    !(await stageButton.evaluate((element) => getComputedStyle(element).backgroundImage)).includes("data:image/png"),
    "Clearing the image must remove the resolved preview",
  );
  addCheck(report, "clear image removes both the stable reference and preview", true);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "03-cleared-existing-image.png"), fullPage: true });
}

async function runImageImportFlow(page, report) {
  const componentId = "title_custom_button_image_import";
  const stageButton = page.locator(
    `.runtime-layout-stage [data-component-id="${componentId}"]`,
  );
  await stageButton.waitFor({ state: "visible", timeout: 5000 });
  await page.locator(
    `.runtime-layout-component-list button[data-component-id="${componentId}"]`,
  ).click();

  const fileInput = page.locator('input[data-help-key="layout.customButton.imageImport.input"]');
  await fileInput.waitFor({ state: "attached", timeout: 5000 });
  await fileInput.setInputFiles({
    name: "button-art.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });

  const status = page.locator('[data-testid="custom-button-image-import-status"]');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="custom-button-image-import-status"]')
      ?.getAttribute("data-status") === "success",
  );
  const imported = await status.evaluate((element) => ({
    assetId: element.getAttribute("data-asset-id"),
    assetType: element.getAttribute("data-asset-type"),
    filename: element.getAttribute("data-filename"),
    mimeType: element.getAttribute("data-mime-type"),
    projectPath: element.getAttribute("data-project-path"),
    hasDataUrl: element.getAttribute("data-has-data-url"),
  }));
  expect(imported.assetId && imported.assetId !== "button-art", "Duplicate filename import must generate a unique asset id", imported);
  expect(imported.assetType === "ui", "Imported custom button image must use asset_type ui", imported);
  expect(imported.filename === "button-art.png", "Imported asset must preserve the safe filename", imported);
  expect(imported.mimeType === "image/png", "Imported asset must preserve the normalized image MIME type", imported);
  expect(imported.hasDataUrl === "true", "Imported asset must store a data URL in the manifest", imported);
  expect(imported.projectPath?.startsWith("assets/ui/"), "Imported asset must use an assets/ui/ project path", imported);
  expect(!/^[a-zA-Z]:[\\/]/.test(imported.projectPath ?? ""), "Imported asset must not persist an absolute local path", imported);
  addCheck(report, "PNG import creates a complete ui AssetRef with safe project path", imported);
  addCheck(report, "duplicate base id receives a unique non-destructive asset id", imported.assetId);

  await page.waitForFunction(
    ({ id, assetId }) => document.querySelector(`.runtime-layout-stage [data-component-id="${id}"]`)
      ?.getAttribute("data-background-image-reference") === `asset:${assetId}`,
    { id: componentId, assetId: imported.assetId },
  );
  const stageReference = await stageButton.getAttribute("data-background-image-reference");
  expect(stageReference === `asset:${imported.assetId}`, "Imported image must bind to the current button immediately", stageReference);
  await page.waitForFunction(
    (id) => getComputedStyle(
      document.querySelector(`.runtime-layout-stage [data-component-id="${id}"]`),
    ).backgroundImage.includes("data:image/png"),
    componentId,
    { timeout: 15000 },
  );
  const importedFrame = await stageButton.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundSize: style.backgroundSize,
      backgroundColor: style.backgroundColor,
      borderWidth: style.borderWidth,
      boxShadow: style.boxShadow,
    };
  });
  const expectedFrame = await page.locator(
    `.runtime-layout-expected-preview [data-preview-component-id="${componentId}"]`,
  ).evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundSize: style.backgroundSize,
      backgroundColor: style.backgroundColor,
      borderWidth: style.borderWidth,
      boxShadow: style.boxShadow,
    };
  });
  expect(
    importedFrame.backgroundSize === "contain"
      && importedFrame.backgroundColor === "rgba(0, 0, 0, 0)"
      && importedFrame.borderWidth === "0px"
      && expectedFrame.backgroundSize === "contain"
      && expectedFrame.backgroundColor === "rgba(0, 0, 0, 0)"
      && expectedFrame.borderWidth === "0px"
      && expectedFrame.boxShadow === "none",
    "Newly imported button artwork must default to proportional scaling and a transparent frame",
    { importedFrame, expectedFrame },
  );
  addCheck(report, "current button is immediately bound to and previews the imported asset", stageReference);
  await status.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUTPUT_DIR, "01-imported-button-image.png"), fullPage: true });

  await fileInput.setInputFiles({
    name: "not-an-image.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image", "utf8"),
  });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="custom-button-image-import-status"]')
      ?.getAttribute("data-status") === "error",
  );
  expect(
    await stageButton.getAttribute("data-background-image-reference") === stageReference,
    "Rejected file must not replace the current button image",
  );
  addCheck(report, "unsupported MIME type shows an error and preserves the current image", true);
  await status.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUTPUT_DIR, "02-invalid-image-error.png"), fullPage: true });

  const pickerTrigger = page.locator('[data-help-key="layout.customButton.image.openPicker"]');
  const inlinePicker = page.locator(".runtime-layout-custom-button-image .asset-picker");
  if (await pickerTrigger.count()) await pickerTrigger.click();
  const popover = await pickerTrigger.count()
    ? page.locator('.asset-picker-popover[role="dialog"]')
    : inlinePicker;
  await popover.waitFor({ state: "visible", timeout: 5000 });
  const uiAssetIds = await popover.locator('[data-asset-type="ui"][data-asset-id]').evaluateAll(
    (elements) => elements.map((element) => element.getAttribute("data-asset-id")),
  );
  expect(uiAssetIds.length === 2, "Rejected file must not add another manifest asset", uiAssetIds);
  expect(uiAssetIds.includes("button-art") && uiAssetIds.includes(imported.assetId), "Existing and newly imported assets must both remain available", uiAssetIds);
  addCheck(report, "invalid file does not mutate the manifest or overwrite the existing asset", uiAssetIds);
  if (await page.locator('[data-help-key="assetPicker.close"]').count()) {
    await page.locator('[data-help-key="assetPicker.close"]').click();
  }
}

async function runContainerFlow(page, report) {
  const containerId = "title_custom_button_container";
  const container = page.locator(
    `.runtime-layout-stage .runtime-layout-block[data-component-id="${containerId}"]`,
  );
  await container.waitFor({ state: "visible", timeout: 5000 });
  let containerRect = await componentRectSnapshot(page, containerId);
  expect(
    containerRect.left === "5%"
      && containerRect.top === "87%"
      && containerRect.width === "22%"
      && containerRect.height === "9%",
    "Empty custom button container must default to the lower-left corner",
    containerRect,
  );
  expect(containerRect.autoSize === "true", "Custom button container must declare automatic sizing", containerRect);
  addCheck(report, "custom button container exists at the lower-left default position", containerRect);

  await page.locator(
    `.runtime-layout-component-list button[data-component-id="${containerId}"]`,
  ).click();
  const rectInputs = page.locator('.runtime-layout-inspector input[type="number"][data-help-key="layout.rect"]');
  expect(await rectInputs.nth(0).isEnabled(), "Container x position must remain editable");
  expect(await rectInputs.nth(1).isEnabled(), "Container y position must remain editable");
  expect(await rectInputs.nth(2).isDisabled(), "Auto-sized container width must not be manually editable");
  expect(await rectInputs.nth(3).isDisabled(), "Auto-sized container height must not be manually editable");
  expect(await container.locator(".runtime-layout-resize-handle").count() === 0, "Auto-sized container must not expose a resize handle");
  addCheck(report, "container position is editable while width and height remain auto-sized", true);

  const addButton = page.locator('[data-help-key="layout.addCustomButton"]');
  const expectedContainers = [
    { left: "5%", top: "87%", width: "22%", height: "9%" },
    { left: "5%", top: "87%", width: "44%", height: "9%" },
    { left: "5%", top: "87%", width: "66%", height: "9%" },
    { left: "5%", top: "79%", width: "66%", height: "17%" },
  ];
  for (let index = 0; index < expectedContainers.length; index += 1) {
    await addButton.click();
    await page.waitForFunction(
      (expectedCount) => document.querySelectorAll(
        '.runtime-layout-stage .runtime-layout-block[data-component-type="main_menu_custom_button"]',
      ).length === expectedCount,
      index + 1,
    );
    containerRect = await componentRectSnapshot(page, containerId);
    expect(
      JSON.stringify(containerRect) === JSON.stringify({ ...expectedContainers[index], autoSize: "true" }),
      "Container did not auto-expand around custom buttons",
      { index, containerRect, expected: expectedContainers[index] },
    );
  }
  addCheck(report, "container expands horizontally and then upward as buttons are added", expectedContainers);

  await page.locator(
    `.runtime-layout-component-list button[data-component-id="${containerId}"]`,
  ).click();
  await rectInputs.nth(0).fill("12");
  await rectInputs.nth(1).fill("70");
  await page.waitForFunction(
    (id) => {
      const element = document.querySelector(`.runtime-layout-stage [data-component-id="${id}"]`);
      return element?.style.left === "12%" && element?.style.top === "70%";
    },
    containerId,
  );
  containerRect = await componentRectSnapshot(page, containerId);
  expect(
    containerRect.left === "12%" && containerRect.top === "70%",
    "Container position fields must move the container",
    containerRect,
  );
  const movedButtons = await customButtonSnapshot(page);
  expect(
    movedButtons[0].left === "13%"
      && movedButtons[0].top === "79%"
      && movedButtons[3].left === "13%"
      && movedButtons[3].top === "71%",
    "Moving the container must translate every custom button by the same delta",
    movedButtons,
  );
  addCheck(report, "editing container x/y translates all contained custom buttons", movedButtons);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "01-moved-auto-sized-container.png"), fullPage: true });

  await page.locator(
    `.runtime-layout-component-list button[data-component-id="${containerId}"]`,
  ).click();
  await rectInputs.nth(0).fill("34");
  await rectInputs.nth(1).fill("68");
  const healthStatus = page.locator('[data-testid="runtime-layout-health-status"]');
  await healthStatus.waitFor({ state: "visible", timeout: 5000 });
  await page.waitForFunction(() => (
    document.querySelector('[data-testid="runtime-layout-health-status"]')
      ?.getAttribute("data-health-state") === "warning"
  ));
  await healthStatus.click();
  const overlapIssue = page.locator(
    '.runtime-layout-status [data-issue-code="ui_custom_button_overlap"]',
  );
  await overlapIssue.first().waitFor({ state: "visible", timeout: 5000 });
  expect(
    await overlapIssue.evaluateAll((elements) => elements.some((element) => (
      element.getAttribute("data-issue-path")?.includes("title_about_button")
    ))),
    "Moving the custom-button container across fixed title actions must expose an editor-visible overlap warning",
  );
  addCheck(report, "layout health visibly diagnoses custom-button overlap with fixed title actions", true);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "02-fixed-action-overlap-warning.png"), fullPage: true });

  await rectInputs.nth(0).fill("12");
  await rectInputs.nth(1).fill("70");
  await page.waitForFunction(
    (id) => {
      const element = document.querySelector(`.runtime-layout-stage [data-component-id="${id}"]`);
      return element?.style.left === "12%" && element?.style.top === "70%";
    },
    containerId,
  );

  const fourthId = movedButtons[3].id;
  await page.locator(
    `.runtime-layout-component-list button[data-component-id="${fourthId}"]`,
  ).click();
  await page.locator('[data-help-key="layout.customButton.delete"]').click();
  await page.waitForFunction(
    (id) => !document.querySelector(`.runtime-layout-stage [data-component-id="${id}"]`),
    fourthId,
  );
  containerRect = await componentRectSnapshot(page, containerId);
  expect(
    containerRect.left === "12%"
      && containerRect.top === "78%"
      && containerRect.width === "66%"
      && containerRect.height === "9%",
    "Container must shrink back to the remaining button bounds",
    containerRect,
  );
  addCheck(report, "container shrinks automatically after a button is removed", containerRect);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "02-container-shrunk-after-delete.png"), fullPage: true });
}

function persistedButtonFields(component) {
  return component ? {
    component_id: component.component_id,
    component_type: component.component_type,
    label: component.label,
    action: component.action,
    rect: component.rect,
    mobileRect: component.mobileRect,
    style: component.style,
    visible: component.visible,
  } : undefined;
}

async function runPersistFlow(page, report, project) {
  const primaryId = "title_custom_button_persist_primary";
  const secondaryId = "title_custom_button_persist_secondary";
  const primaryStage = page.locator(`.runtime-layout-stage [data-component-id="${primaryId}"]`);
  const secondaryStage = page.locator(`.runtime-layout-stage [data-component-id="${secondaryId}"]`);
  await primaryStage.waitFor({ state: "visible", timeout: 5000 });
  await secondaryStage.waitFor({ state: "visible", timeout: 5000 });
  addCheck(report, "project fixture with two custom buttons loads in the layout canvas", [primaryId, secondaryId]);

  await page.locator(`.runtime-layout-component-list button[data-component-id="${primaryId}"]`).click();
  const labelInput = page.locator('[data-help-key="layout.customButton.label"]');
  await labelInput.fill("保存后的官网");
  await page.waitForFunction((id) => document.querySelector(
    `.runtime-layout-stage [data-component-id="${id}"] .runtime-layout-block-label`,
  )?.textContent === "保存后的官网", primaryId);
  const visibleToggle = page.locator('input[data-help-key="layout.customButton.visible"]');
  expect(await visibleToggle.isChecked(), "Primary button must begin visible");
  expect(await page.locator('[data-help-key="layout.save"]').evaluate((element) => element.classList.contains("is-primary")), "Edited layout must be dirty before save");
  const persistedLayoutRequestPromise = page.waitForRequest((request) => {
    if (request.method() !== "POST" || new URL(request.url()).pathname !== "/api/project/state") return false;
    const body = request.postDataJSON?.();
    const savedPrimary = body?.project_metadata?.settings?.runtimeUILayout?.screens
      ?.find((screen) => screen.screen_id === "title")
      ?.components?.find((component) => component.component_id === primaryId);
    return Array.isArray(body?.project_graph?.nodes) && savedPrimary?.label === "保存后的官网";
  }, { timeout: 5000 });
  await page.locator('[data-help-key="layout.save"]').click();
  const persistedLayoutRequest = await persistedLayoutRequestPromise;
  const persistedLayoutPayload = persistedLayoutRequest.postDataJSON();
  expect(
    Array.isArray(persistedLayoutPayload?.project_graph?.nodes)
      && persistedLayoutPayload?.project_metadata?.settings?.runtimeUILayout,
    "Save layout must persist a complete project snapshot instead of updating only memory",
    persistedLayoutPayload,
  );
  addCheck(report, "save layout sends graph and runtimeUILayout to persistent project storage", true);
  await page.waitForFunction(() => {
    const store = window.__AGENTVN_PROJECT_STORE__;
    return store?.getState?.().settings?.runtimeUILayout?.screens
      ?.find((screen) => screen.screen_id === "title")
      ?.components?.find((component) => component.component_id === "title_custom_button_persist_primary")
      ?.label === "保存后的官网";
  });
  addCheck(report, "save writes the edited custom button into projectStore runtimeUILayout", true);

  const savedSnapshot = await page.evaluate(() => {
    const projectState = window.__AGENTVN_PROJECT_STORE__?.getState?.();
    const editorState = window.__AGENTVN_EDITOR_STORE__?.getState?.();
    if (!projectState || !editorState) throw new Error("Editor stores are unavailable.");
    return editorState.exportProject({
      projectId: projectState.projectId,
      title: projectState.title,
      author: projectState.author,
      assetManifest: projectState.assetManifest,
      editorSettings: { ...projectState.settings },
      createdAt: projectState.createdAt,
    });
  });
  const persistedSnapshot = {
    schema_version: persistedLayoutPayload.project_metadata.schemaVersion ?? savedSnapshot.schema_version,
    project_id: persistedLayoutPayload.project_metadata.projectId ?? savedSnapshot.project_id,
    title: persistedLayoutPayload.project_metadata.title ?? savedSnapshot.title,
    author: persistedLayoutPayload.project_metadata.author ?? savedSnapshot.author,
    nodes: persistedLayoutPayload.project_graph.nodes,
    edges: persistedLayoutPayload.project_graph.edges,
    viewport: persistedLayoutPayload.project_graph.viewport,
    memory_mode: persistedLayoutPayload.project_graph.memoryMode,
    asset_manifest: persistedLayoutPayload.project_metadata.assetManifest ?? [],
    editor_settings: persistedLayoutPayload.project_metadata.settings,
    created_at: persistedLayoutPayload.project_metadata.createdAt ?? savedSnapshot.created_at,
    updated_at: persistedLayoutPayload.project_metadata.updatedAt ?? savedSnapshot.updated_at,
  };
  const savedTitle = savedSnapshot.editor_settings.runtimeUILayout.screens
    .find((screen) => screen.screen_id === "title");
  const savedPrimary = savedTitle.components.find((component) => component.component_id === primaryId);
  const savedSecondary = savedTitle.components.find((component) => component.component_id === secondaryId);
  const originalTitle = project.editor_settings.runtimeUILayout.screens
    .find((screen) => screen.screen_id === "title");
  const originalPrimary = originalTitle.components.find((component) => component.component_id === primaryId);
  const originalSecondary = originalTitle.components.find((component) => component.component_id === secondaryId);
  const expectedPrimary = persistedButtonFields({ ...originalPrimary, label: "保存后的官网" });
  expect(
    JSON.stringify(persistedButtonFields(savedPrimary)) === JSON.stringify(expectedPrimary),
    "Serialized project must preserve every custom button business field",
    { saved: persistedButtonFields(savedPrimary), expected: expectedPrimary },
  );
  expect(
    JSON.stringify(persistedButtonFields(savedSecondary)) === JSON.stringify(persistedButtonFields(originalSecondary)),
    "Serialized project must preserve hidden custom button fields",
    persistedButtonFields(savedSecondary),
  );
  addCheck(report, "project serialization preserves id/type/label/action/image/rect/style/visible", true);
  expect(!("selectedId" in savedSnapshot.editor_settings), "Project must not persist layout selection state");
  expect(!("selectedIds" in savedSnapshot.editor_settings), "Project must not persist multi-selection state");
  expect(!("history" in savedSnapshot.editor_settings), "Project must not persist layout undo history");
  expect(!("customButtonUrlTest" in savedSnapshot.editor_settings), "Project must not persist temporary URL-test UI state");
  addCheck(report, "serialized project excludes layout-local temporary UI state", true);

  await labelInput.fill("未保存临时改动");
  expect(await page.locator('[data-help-key="layout.save"]').evaluate((element) => element.classList.contains("is-primary")), "Unsaved change must mark save as dirty");
  await page.locator('[data-help-key="layout.undo"]').click();
  expect(await labelInput.inputValue() === "保存后的官网", "Undo after save must return to the saved baseline");
  expect(!(await page.locator('[data-help-key="layout.save"]').evaluate((element) => element.classList.contains("is-primary"))), "Undo to saved baseline must clear dirty state");
  addCheck(report, "undo after save returns to the saved baseline without mutating it", true);
  await page.locator('[data-help-key="layout.redo"]').click();
  expect(await labelInput.inputValue() === "未保存临时改动", "Redo must restore only the unsaved draft edit");
  expect(await page.locator('[data-help-key="layout.save"]').evaluate((element) => element.classList.contains("is-primary")), "Redo must restore dirty state");
  const storeLabelAfterRedo = await page.evaluate((id) => window.__AGENTVN_PROJECT_STORE__?.getState?.().settings.runtimeUILayout.screens
    .find((screen) => screen.screen_id === "title")?.components.find((component) => component.component_id === id)?.label, primaryId);
  expect(storeLabelAfterRedo === "保存后的官网", "Draft undo/redo must not pollute the saved project-store baseline", storeLabelAfterRedo);
  addCheck(report, "redo restores the draft while the saved project-store baseline remains unchanged", storeLabelAfterRedo);

  await closeLayoutDesigner(page);
  await page.evaluate((snapshot) => {
    window.__AGENTVN_EDITOR_STORE__?.getState?.().importProject(snapshot);
    window.__AGENTVN_PROJECT_STORE__?.getState?.().loadProjectMetadata(snapshot);
  }, persistedSnapshot);
  addCheck(report, "persisted backend payload can be re-imported through both editor stores", true);

  await openLayoutDesigner(page);
  await page.locator('[data-help-key="layout.screen"]').nth(0).click();
  const reopenedStage = page.locator(`.runtime-layout-stage [data-component-id="${primaryId}"]`);
  await reopenedStage.waitFor({ state: "visible", timeout: 5000 });
  expect(await reopenedStage.locator(".runtime-layout-block-label").textContent() === "保存后的官网", "Reopened layout must show the saved label");
  expect(await reopenedStage.getAttribute("data-action-kind") === "external_url", "Reopened layout must preserve action kind");
  expect(await reopenedStage.getAttribute("data-action-url") === "https://example.com/persist", "Reopened layout must preserve action URL");
  expect(await reopenedStage.getAttribute("data-background-image-reference") === "asset:persist-button-art", "Reopened layout must preserve image reference");
  addCheck(report, "reopened layout renders the saved label, safe action, and stable image reference", true);

  await page.locator(`.runtime-layout-component-list button[data-component-id="${primaryId}"]`).click();
  const reopenedLabelInput = page.locator('[data-help-key="layout.customButton.label"]');
  expect(await reopenedLabelInput.inputValue() === "保存后的官网", "Reopened button must remain editable");
  expect(!(await page.locator('[data-help-key="layout.save"]').evaluate((element) => element.classList.contains("is-primary"))), "Reopened saved layout must begin clean");
  await reopenedLabelInput.fill("重开后仍可编辑");
  expect(await page.locator('[data-help-key="layout.save"]').evaluate((element) => element.classList.contains("is-primary")), "Editing after reopen must mark layout dirty");
  addCheck(report, "reopened custom button remains editable and dirty tracking restarts correctly", true);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "01-reopened-editable-layout.png"), fullPage: true });

  const legacySnapshot = JSON.parse(JSON.stringify(savedSnapshot));
  legacySnapshot.project_id = "legacy_custom_button_project";
  legacySnapshot.updated_at = new Date(Date.now() + 1000).toISOString();
  const legacyTitle = legacySnapshot.editor_settings.runtimeUILayout.screens
    .find((screen) => screen.screen_id === "title");
  legacyTitle.components = legacyTitle.components.filter((component) => (
    component.component_type !== "main_menu_custom_button"
    && component.component_type !== "main_menu_custom_button_container"
  ));
  await closeLayoutDesigner(page);
  await page.evaluate((snapshot) => {
    window.__AGENTVN_EDITOR_STORE__?.getState?.().importProject(snapshot);
    window.__AGENTVN_PROJECT_STORE__?.getState?.().loadProjectMetadata(snapshot);
  }, legacySnapshot);
  await openLayoutDesigner(page);
  await page.locator('[data-help-key="layout.screen"]').nth(0).click();
  const legacyContainer = page.locator('.runtime-layout-stage [data-component-id="title_custom_button_container"]');
  await legacyContainer.waitFor({ state: "visible", timeout: 5000 });
  expect(await page.locator('.runtime-layout-stage [data-component-type="main_menu_custom_button"]').count() === 0, "Legacy project must not invent custom buttons");
  addCheck(report, "legacy project without custom buttons reopens with a safe empty default container", true);
  addCheck(report, "browser console and page error streams remain clean", true);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "02-legacy-project-safe-load.png"), fullPage: true });
}

async function run() {
  resetOutput();
  const server = await ensureEditorServer();
  const browser = await chromium.launch({ headless: !HEADED });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
  if (EDIT_MODE) {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: EDITOR_URL });
  }
  const project = buildProject();
  await page.route("http://127.0.0.1:8278/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const contentType = request.headers()["content-type"] ?? "";
    const body = contentType.includes("application/json") ? (request.postDataJSON?.() ?? {}) : {};
    if (url.pathname === "/api/project/catalog") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: [] }) });
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
  const report = {
    ok: false,
    checks: [],
    consoleErrors: [],
    pageErrors: [],
    outputDir: OUTPUT_DIR,
  };
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => report.pageErrors.push(String(error.stack || error)));

  try {
    const projectPath = path.join(OUTPUT_DIR, `${OUTPUT_CASE}.vnproj`);
    saveProjectContainerSync(projectPath, project, { container: "zip" });
    await openProject(page, project, projectPath);
    await openLayoutDesigner(page);

    const addButton = page.locator('[data-help-key="layout.addCustomButton"]');
    expect(await addButton.count() === 0, "Add custom button must not appear on the initial player screen");
    addCheck(report, "add entry is absent outside the title screen", true);

    await page.locator('[data-help-key="layout.screen"]').nth(0).click();
    await addButton.waitFor({ state: "visible", timeout: 5000 });
    expect(await addButton.isEnabled(), "Add custom button must be enabled on the title screen");
    addCheck(report, "title screen exposes an enabled add-button entry", true);

    if (PERSIST_MODE) {
      await runPersistFlow(page, report, project);
      expect(report.pageErrors.length === 0, "Page emitted uncaught errors", report.pageErrors);
      expect(report.consoleErrors.length === 0, "Page emitted console errors", report.consoleErrors);
      report.ok = true;
      fs.writeFileSync(path.join(OUTPUT_DIR, "report.json"), JSON.stringify(report, null, 2), "utf8");
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    if (CONTAINER_MODE) {
      await runContainerFlow(page, report);
      expect(report.pageErrors.length === 0, "Page emitted uncaught errors", report.pageErrors);
      expect(report.consoleErrors.length === 0, "Page emitted console errors", report.consoleErrors);
      addCheck(report, "browser console and page error streams remain clean", true);
      report.ok = true;
      fs.writeFileSync(path.join(OUTPUT_DIR, "report.json"), JSON.stringify(report, null, 2), "utf8");
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    if (EXISTING_IMAGE_MODE) {
      await runExistingImageFlow(page, report);
      expect(report.pageErrors.length === 0, "Page emitted uncaught errors", report.pageErrors);
      expect(report.consoleErrors.length === 0, "Page emitted console errors", report.consoleErrors);
      addCheck(report, "browser console and page error streams remain clean", true);
      report.ok = true;
      fs.writeFileSync(path.join(OUTPUT_DIR, "report.json"), JSON.stringify(report, null, 2), "utf8");
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    if (IMAGE_IMPORT_MODE) {
      await runImageImportFlow(page, report);
      expect(report.pageErrors.length === 0, "Page emitted uncaught errors", report.pageErrors);
      expect(report.consoleErrors.length === 0, "Page emitted console errors", report.consoleErrors);
      addCheck(report, "browser console and page error streams remain clean", true);
      report.ok = true;
      fs.writeFileSync(path.join(OUTPUT_DIR, "report.json"), JSON.stringify(report, null, 2), "utf8");
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    await page.screenshot({ path: path.join(OUTPUT_DIR, "01-title-add-entry.png"), fullPage: true });

    const expectedUnifiedRects = [
      { left: "6%", top: "88%", width: "20%", height: "7%" },
      { left: "28%", top: "88%", width: "20%", height: "7%" },
      { left: "50%", top: "88%", width: "20%", height: "7%" },
    ];
    const createdIds = [];
    for (let index = 0; index < 3; index += 1) {
      await addButton.click();
      await page.waitForFunction(
        (expectedCount) => document.querySelectorAll(
          '.runtime-layout-stage .runtime-layout-block[data-component-type="main_menu_custom_button"]',
        ).length === expectedCount,
        index + 1,
      );
      const snapshot = await customButtonSnapshot(page);
      const latest = snapshot.find((item) => item.selected);
      expect(latest, "New custom button must be selected immediately", snapshot);
      expect(latest.actionKind === "none", "New custom button must use the none action", latest);
      expect(
        latest.left === expectedUnifiedRects[index].left
        && latest.top === expectedUnifiedRects[index].top
        && latest.width === expectedUnifiedRects[index].width
        && latest.height === expectedUnifiedRects[index].height,
        "New custom button unified rect is not the planned staggered default",
        { latest, expected: expectedUnifiedRects[index] },
      );
      const labelInput = page.locator('[data-help-key="layout.customButton.label"]');
      expect(await labelInput.inputValue() === "自定义按钮", "New custom button must use the default label");
      createdIds.push(latest.id);
    }
    expect(createdIds.every(Boolean), "Custom button IDs must be present", createdIds);
    expect(new Set(createdIds).size === 3, "Three custom button IDs must be unique", createdIds);
    expect(
      createdIds.every((id) => /^title_custom_button_[a-z0-9_]+$/i.test(id)),
      "Custom button IDs must use the stable title_custom_button prefix",
      createdIds,
    );
    addCheck(report, "three buttons are created with unique stable IDs", createdIds);
    addCheck(report, "new button is selected after every creation", true);
    addCheck(report, "default label is applied", "自定义按钮");
    addCheck(report, "default action is none", true);
    addCheck(report, "unified rects use a non-overlapping staggered row", expectedUnifiedRects);
    await page.screenshot({ path: path.join(OUTPUT_DIR, "02-three-buttons-unified.png"), fullPage: true });

    const splitLayoutControls = await page.locator(
      '[data-help-key="layout.desktop"], [data-help-key="layout.mobile"], [data-help-key="layout.copyBreakpoint"]',
    ).count();
    expect(
      splitLayoutControls === 0,
      "Editor must not expose desktop/mobile split layout controls",
      { splitLayoutControls },
    );
    addCheck(report, "desktop/mobile split layout controls are absent", true);

    await page.locator('[data-help-key="layout.undo"]').click();
    await page.waitForFunction(() => document.querySelectorAll(
      '.runtime-layout-stage .runtime-layout-block[data-component-type="main_menu_custom_button"]',
    ).length === 2);
    addCheck(report, "one undo removes exactly the last created button", true);

    await page.locator('[data-help-key="layout.redo"]').click();
    await page.waitForFunction(() => document.querySelectorAll(
      '.runtime-layout-stage .runtime-layout-block[data-component-type="main_menu_custom_button"]',
    ).length === 3);
    const redoSnapshot = await customButtonSnapshot(page);
    expect(
      redoSnapshot.map((item) => item.id).join("|") === createdIds.join("|"),
      "Redo must restore the same stable component ID",
      { redoSnapshot, createdIds },
    );
    addCheck(report, "redo restores the same button and stable ID", createdIds[2]);

    if (EDIT_MODE) await runEditFlow(page, report, createdIds);

    await page.locator('[data-help-key="layout.screen"]').nth(1).click();
    expect(await addButton.count() === 0, "Add custom button must disappear after leaving title screen");
    addCheck(report, "add entry disappears after switching away from title", true);

    expect(report.pageErrors.length === 0, "Page emitted uncaught errors", report.pageErrors);
    expect(report.consoleErrors.length === 0, "Page emitted console errors", report.consoleErrors);
    addCheck(report, "browser console and page error streams remain clean", true);

    report.ok = true;
    fs.writeFileSync(path.join(OUTPUT_DIR, "report.json"), JSON.stringify(report, null, 2), "utf8");
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.error = String(error.stack || error);
    fs.writeFileSync(path.join(OUTPUT_DIR, "report.json"), JSON.stringify(report, null, 2), "utf8");
    await page.screenshot({ path: path.join(OUTPUT_DIR, "failure.png"), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    stopEditorServer(server);
  }
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
