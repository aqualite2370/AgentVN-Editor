const fs = require("fs");
const path = require("path");
const { loadProjectContainerSync, saveProjectContainerSync } = require("./project-container.cjs");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");
const net = require("node:net");
const JSZip = require("../editor/node_modules/jszip");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const testDir = path.join(root, "test_AgentVN", "client-layout-options");
const outputDir = path.join(root, "output", "playwright", "client-layout-options");
const editorUrl = "http://127.0.0.1:6767/";
const gameCliUrl = "http://127.0.0.1:6868/";
const backendPort = Number(process.env.AGENTVN_LAYOUT_TEST_BACKEND_PORT || 18278);
const backendUrl = `http://127.0.0.1:${backendPort}`;
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const headed = process.argv.includes("--headed");

const titleButtonExpectations = {
  title_continue_button: { backgroundColor: "#c0392b", color: "#ffffff", borderColor: "#ff7979", rect: { x: 63, y: 12, width: 29, height: 9 } },
  title_start_button: { backgroundColor: "#ff3366", color: "#ffffff", borderColor: "#23d18b", rect: { x: 63, y: 24, width: 29, height: 9 }, anchor: "bottom_center" },
  title_save_load_button: { backgroundColor: "#123456", color: "#f6e58d", borderColor: "#f0932b", rect: { x: 63, y: 36, width: 29, height: 9 } },
  title_gallery_button: { backgroundColor: "#006266", color: "#ffffff", borderColor: "#f8c291", rect: { x: 63, y: 60, width: 29, height: 9 } },
  title_settings_button: { backgroundColor: "#2f3640", color: "#dcdde1", borderColor: "#00a8ff", rect: { x: 63, y: 72, width: 29, height: 9 } },
  title_about_button: { backgroundColor: "#8c7ae6", color: "#ffffff", borderColor: "#fbc531", rect: { x: 63, y: 84, width: 29, height: 9 } },
};

const defaultTitleContinueRect = { x: 78, y: 28, width: 18, height: 7 };

const requiredOptionChecks = [
  "screen:title", "screen:player", "screen:save_load", "screen:preferences", "screen:history", "screen:gallery", "screen:about",
  "layout:unified",
  "zoom:fit", "zoom:50", "zoom:75", "zoom:100",
  "align:left", "align:centerX", "align:right", "align:top", "align:centerY", "align:bottom", "align:sameWidth", "align:sameHeight", "align:distributeX", "align:distributeY",
  "snap:grid", "snap:edges", "snap:center", "snap:safe",
  "view:grid", "view:safeArea", "view:names",
  "preset:default", "preset:renpy", "preset:subtitle", "presetScope:current", "presetScope:all",
  "rect:x", "rect:y", "rect:width", "rect:height", "rect:anchor", "rect:anchorDefaultRemoval",
  "style:backgroundColor", "style:textColor", "style:borderColor", "style:borderWidth", "style:borderRadius", "style:opacity", "style:padding", "style:gap", "style:backdropBlur", "style:fontSize", "style:shadow",
  "text:label", "text:fontWeight", "text:textAlign",
  "backgroundImage:resource", "backgroundImage:fit",
  "save:layout", "export:cartridge", "gamecli:titleButtons", "migrate:legacyTitleGroup",
];

function assertInsideRoot(target) {
  const resolved = path.resolve(target);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) throw new Error(`Refusing outside-root path: ${resolved}`);
  return resolved;
}

function resetOutputDirs() {
  for (const dir of [testDir, outputDir]) {
    fs.rmSync(assertInsideRoot(dir), { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
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

function startDevServer(name, cwd) {
  const child = spawn(npmCommand, ["run", "dev"], {
    cwd,
    shell: process.platform === "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(name === "editor-dev" ? { VITE_BACKEND_URL: backendUrl } : {}),
    },
  });
  const logFile = path.join(outputDir, `${name}.log`);
  const writeLog = (data) => fs.appendFileSync(logFile, data.toString());
  child.stdout.on("data", writeLog);
  child.stderr.on("data", writeLog);
  return child;
}

function stopDevServer(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGTERM");
}

async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}

function startBackend() {
  return spawn(process.env.PYTHON || "python", ["backend_launcher.py"], {
    cwd: path.join(root, "backend"),
    env: {
      ...process.env,
      AGENTVN_EDITOR_DATA_DIR: path.join(testDir, "isolated-data"),
      AGENTVN_BACKEND_DATA_DIR: path.join(testDir, "isolated-data"),
      DATABASE_PATH: path.join(testDir, "isolated-data", "vn_engine.db"),
      AGENTVN_BACKEND_PORT: String(backendPort),
      AGENTVN_LEGACY_DATABASE_PATHS: "",
    },
    windowsHide: true,
    stdio: "ignore",
  });
}

async function ensureBackend() {
  await assertPortFree(backendPort);
  const child = startBackend();
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Isolated backend exited before becoming ready (${child.exitCode}).`);
    try {
      const response = await fetch(`${backendUrl}/api/health`);
      if (response.ok) return child;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  stopDevServer(child);
  throw new Error(`Isolated backend did not become ready: ${backendUrl}/api/health`);
}

async function ensureServer(name, url, cwd) {
  if (await isListening(url)) return undefined;
  const child = startDevServer(name, cwd);
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (await isListening(url)) return child;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${name} did not start at ${url}`);
}

function buildProjectFile() {
  const now = new Date().toISOString();
  const scene = {
    scene_id: "client_layout_options_scene",
    title: "Client Layout Options",
    summary: "Client layout options acceptance scene.",
    chapter: 1,
    tags: ["layout", "acceptance"],
    commands: [
      { type: "narration", text: "客户端布局全选项验收。" },
      { type: "dialog", character_id: "tester", text: "按钮、对话框、菜单和设置页布局都需要被实际客户端消费。", side: "left" },
    ],
  };
  return {
    schema_version: "1.0.0",
    project_id: `client_layout_options_${Date.now()}`,
    title: "AgentVN Client Layout Options",
    author: "AgentVN QA",
    nodes: [
      { id: "start", type: "startNode", position: { x: 40, y: 220 }, data: { nodeKind: "start", label: "入口", description: "", memoryMode: "hybrid", aiSettings: { authorGoal: "", autoExtractMemory: false, autoApplyMemory: false }, previewState: { currentCommandIndex: 0, isPlaying: false }, editorMeta: { collapsedInspectorSections: [], source: "manual" } } },
      { id: "scene", type: "sceneNode", position: { x: 320, y: 180 }, data: { nodeKind: "scene", label: scene.title, description: scene.summary, memoryMode: "hybrid", aiSettings: { authorGoal: "", autoExtractMemory: false, autoApplyMemory: false }, previewState: { currentCommandIndex: 0, isPlaying: false }, editorMeta: { collapsedInspectorSections: [], source: "manual" }, scene } },
    ],
    edges: [{ id: "edge_start_scene", source: "start", target: "scene", sourceHandle: "default" }],
    viewport: { x: 0, y: 0, zoom: 1 },
    memory_mode: "hybrid",
    asset_manifest: [],
    editor_settings: {},
    created_at: now,
    updated_at: now,
  };
}

async function importProject(page, projectPath) {
  const project = loadProjectContainerSync(projectPath).project;
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
  await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
  const toolbar = page.locator(".editor-toolbar");
  if (await toolbar.isVisible({ timeout: 3000 }).catch(() => false)) return;
  await page.waitForFunction(() => {
    const input = document.querySelector(".project-import-button input");
    const button = document.querySelector(".project-import-button");
    return input && !input.disabled && button?.getAttribute("aria-disabled") !== "true";
  }, null, { timeout: 20000 });
  await page.locator(".project-import-button input").first().setInputFiles(projectPath);
  await page.waitForFunction(() => Array.from(document.querySelectorAll('[data-help-key="home.openDraft"], [data-help-key="home.recentProject"]')).some((element) => element instanceof HTMLElement && element.offsetParent !== null), null, { timeout: 20000 });
  await page.evaluate(() => {
    document.querySelectorAll(".project-entry-loading-overlay").forEach((element) => {
      element.style.pointerEvents = "none";
    });
    const entries = Array.from(document.querySelectorAll('[data-help-key="home.openDraft"], [data-help-key="home.recentProject"]'));
    const entry = entries.find((element) => element instanceof HTMLElement && element.offsetParent !== null);
    if (entry instanceof HTMLElement) entry.click();
  });
  await toolbar.waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(800);
}

async function openLayoutDesigner(page) {
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    document.querySelectorAll(".project-entry-loading-overlay").forEach((element) => {
      element.style.pointerEvents = "none";
    });
  });
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("agentvn:open-advanced-tools", {
      detail: {
        id: "client-layout-options-acceptance",
        tab: "layout",
        title: "Client layout options acceptance",
      },
    }));
  });
  await page.locator(".advanced-tools-panel").waitFor({ state: "visible", timeout: 10000 });
  await page.locator(".runtime-layout-stage").waitFor({ state: "visible", timeout: 10000 });
}

async function selectRichOptionByIndex(page, helpKey, optionIndex, triggerIndex = 0) {
  const trigger = page.locator(`button[data-help-key="${helpKey}"]`).nth(triggerIndex);
  await trigger.click();
  const option = page.locator('.rich-select-popover[role="listbox"] .rich-select-option').nth(optionIndex);
  await option.waitFor({ state: "visible", timeout: 5000 });
  await option.click();
  await page.waitForTimeout(120);
}

async function selectComponent(page, componentId) {
  await page.locator(`.runtime-layout-component-list button[data-component-id="${componentId}"]`).click({ force: true });
  await page.locator(`.runtime-layout-stage .runtime-layout-block[data-component-id="${componentId}"]`).waitFor({ state: "visible", timeout: 5000 });
}

async function selectScreen(page, index, label, report) {
  await page.locator('[data-help-key="layout.screen"]').nth(index).click();
  await page.locator(".runtime-layout-stage").waitFor({ state: "visible", timeout: 5000 });
  report.checks.push({ id: label, ok: true });
}

async function setRectFields(page, rect, report) {
  const inputs = page.locator(".runtime-layout-fieldset").first().locator('input[type="number"]');
  for (const [index, field] of ["x", "y", "width", "height"].entries()) {
    await inputs.nth(index).fill(String(rect[field]));
    await inputs.nth(index).press("Tab").catch(() => {});
    // The inspector fields are controlled inputs backed by the layout session.
    // Let React commit each field before the next update reads selectedRect.
    await page.waitForTimeout(80);
    report.checks.push({ id: `rect:${field}`, ok: true, value: rect[field] });
  }
}

async function verifyAnchorSelectionBehavior(page, componentId, expectedRect, report) {
  const block = page.locator(`.runtime-layout-stage .runtime-layout-block[data-component-id="${componentId}"]`);
  const inputs = page.locator(".runtime-layout-fieldset").first().locator('input[type="number"]');
  const anchors = [
    { index: 0, name: "default", transform: "", factorX: 0, factorY: 0, x: 0, y: 0 },
    { index: 1, name: "top_left", transform: "", factorX: 0, factorY: 0, x: 0, y: 0 },
    { index: 2, name: "top_center", transform: "translateX(-50%)", factorX: 0.5, factorY: 0, x: 50, y: 0 },
    { index: 3, name: "top_right", transform: "translateX(-100%)", factorX: 1, factorY: 0, x: 100, y: 0 },
    { index: 4, name: "center", transform: "translate(-50%, -50%)", factorX: 0.5, factorY: 0.5, x: 50, y: 50 },
    { index: 5, name: "bottom_left", transform: "translateY(-100%)", factorX: 0, factorY: 1, x: 0, y: 100 },
    { index: 6, name: "bottom_center", transform: "translate(-50%, -100%)", factorX: 0.5, factorY: 1, x: 50, y: 100 },
    { index: 7, name: "bottom_right", transform: "translate(-100%, -100%)", factorX: 1, factorY: 1, x: 100, y: 100 },
  ];
  for (const anchor of anchors) {
    await selectRichOptionByIndex(page, "layout.anchor", anchor.index);
    const values = (await inputs.evaluateAll((nodes) => nodes.slice(0, 4).map((node) => Number(node.value))));
    const expectedValues = [anchor.x, anchor.y, expectedRect.width, expectedRect.height];
    if (values.some((value, index) => Math.abs(value - expectedValues[index]) > 0.01)) {
      throw new Error(`${componentId} ${anchor.name} canvas preset mismatch: expected ${JSON.stringify(expectedValues)}, got ${JSON.stringify(values)}`);
    }
    const geometry = await block.evaluate((node) => {
      const actual = node.getBoundingClientRect();
      const transform = node.style.transform;
      const marker = document.createElement("span");
      marker.style.position = "absolute";
      marker.style.left = node.style.left;
      marker.style.top = node.style.top;
      marker.style.width = "0";
      marker.style.height = "0";
      marker.style.margin = "0";
      marker.style.padding = "0";
      marker.style.border = "0";
      marker.style.visibility = "hidden";
      marker.style.pointerEvents = "none";
      node.parentElement.appendChild(marker);
      const anchorPoint = marker.getBoundingClientRect();
      marker.remove();
      return {
        transform,
        actual: { left: actual.left, top: actual.top, width: actual.width, height: actual.height },
        anchorPoint: { left: anchorPoint.left, top: anchorPoint.top },
      };
    });
    if (geometry.transform !== anchor.transform) {
      throw new Error(`${componentId} ${anchor.name} transform expected ${JSON.stringify(anchor.transform)}, got ${JSON.stringify(geometry.transform)}`);
    }
    const actualAnchorLeft = geometry.actual.left + geometry.actual.width * anchor.factorX;
    const actualAnchorTop = geometry.actual.top + geometry.actual.height * anchor.factorY;
    if (Math.abs(actualAnchorLeft - geometry.anchorPoint.left) > 1.5 || Math.abs(actualAnchorTop - geometry.anchorPoint.top) > 1.5) {
      throw new Error(`${componentId} ${anchor.name} visual anchor mismatch: expected (${geometry.anchorPoint.left}, ${geometry.anchorPoint.top}), got (${actualAnchorLeft}, ${actualAnchorTop})`);
    }
  }
  await selectRichOptionByIndex(page, "layout.anchor", 6);
  report.checks.push({ id: "rect:anchor", ok: true, anchors: anchors.map((item) => item.name), final: "bottom_center" });
}

async function verifyDefaultAnchorRemoval(page, componentId, expectedRect, report) {
  await selectComponent(page, componentId);
  await setRectFields(page, expectedRect, report);
  const inputs = page.locator(".runtime-layout-fieldset").first().locator('input[type="number"]');
  const expectedValues = [0, 0, expectedRect.width, expectedRect.height];
  await selectRichOptionByIndex(page, "layout.anchor", 3);
  await selectRichOptionByIndex(page, "layout.anchor", 0);
  const values = await inputs.evaluateAll((nodes) => nodes.slice(0, 4).map((node) => Number(node.value)));
  if (values.some((value, index) => Math.abs(value - expectedValues[index]) > 0.01)) {
    throw new Error(`${componentId} default canvas preset mismatch: expected ${JSON.stringify(expectedValues)}, got ${JSON.stringify(values)}`);
  }
  const transform = await page.locator(`.runtime-layout-stage .runtime-layout-block[data-component-id="${componentId}"]`).evaluate((node) => node.style.transform);
  if (transform) throw new Error(`${componentId} retained inline anchor transform after selecting default anchor: ${transform}`);
  report.checks.push({ id: "rect:anchorDefaultRemoval", ok: true });
}

async function setColorInput(page, fieldIndex, color, id, report) {
  await page.locator(".runtime-layout-fieldset").nth(1).evaluate((node) => node.setAttribute("open", ""));
  const rows = page.locator(".runtime-layout-fieldset").nth(1).locator(".runtime-layout-color-row");
  const input = rows.nth(fieldIndex).locator("input").nth(1);
  await input.fill(color);
  await input.press("Tab").catch(() => {});
  await page.waitForTimeout(80);
  report.checks.push({ id, ok: true, value: color });
}

async function setNumberStyle(page, index, value, id, report) {
  await page.locator(".runtime-layout-fieldset").nth(1).evaluate((node) => node.setAttribute("open", ""));
  const numberInputs = page.locator(".runtime-layout-fieldset").nth(1).locator('input[type="number"]');
  await numberInputs.nth(index).fill(String(value));
  await numberInputs.nth(index).press("Tab").catch(() => {});
  await page.waitForTimeout(80);
  report.checks.push({ id, ok: true, value });
}

async function exerciseLayoutOptions(page, report) {
  await openLayoutDesigner(page);
  const screenChecks = ["screen:title", "screen:player", "screen:save_load", "screen:preferences", "screen:history", "screen:gallery", "screen:about"];
  for (const [index, id] of screenChecks.entries()) await selectScreen(page, index, id, report);

  const splitLayoutControls = await page.locator(
    '[data-help-key="layout.desktop"], [data-help-key="layout.mobile"], [data-help-key="layout.copyBreakpoint"]',
  ).count();
  if (splitLayoutControls !== 0) throw new Error(`Split layout controls still exist: ${splitLayoutControls}`);
  report.checks.push({ id: "layout:unified", ok: true });

  for (const [index, id] of ["zoom:fit", "zoom:50", "zoom:75", "zoom:100"].entries()) {
    await page.locator('[data-help-key="layout.zoom"]').nth(index).click();
    report.checks.push({ id, ok: true });
  }

  await selectScreen(page, 0, "screen:title:return", report);
  await verifyDefaultAnchorRemoval(page, "title_continue_button", defaultTitleContinueRect, report);
  await selectComponent(page, "title_start_button");
  await setRectFields(page, titleButtonExpectations.title_start_button.rect, report);
  await verifyAnchorSelectionBehavior(page, "title_start_button", titleButtonExpectations.title_start_button.rect, report);
  await setColorInput(page, 0, titleButtonExpectations.title_start_button.backgroundColor, "style:backgroundColor", report);
  await setColorInput(page, 1, titleButtonExpectations.title_start_button.color, "style:textColor", report);
  await setColorInput(page, 2, titleButtonExpectations.title_start_button.borderColor, "style:borderColor", report);
  await setNumberStyle(page, 0, 3, "style:borderWidth", report);
  await setNumberStyle(page, 1, 18, "style:borderRadius", report);
  await setNumberStyle(page, 2, 0.95, "style:opacity", report);
  await setNumberStyle(page, 3, 8, "style:padding", report);
  await setNumberStyle(page, 4, 6, "style:gap", report);
  await setNumberStyle(page, 5, 0, "style:backdropBlur", report);
  await setNumberStyle(page, 6, 17, "style:fontSize", report);
  await selectRichOptionByIndex(page, "layout.shadow", 2);
  report.checks.push({ id: "style:shadow", ok: true });
  await page.locator(".runtime-layout-fieldset").nth(2).evaluate((node) => node.setAttribute("open", ""));
  await page.locator('input[data-help-key="layout.label"]').fill("开始按钮验收");
  report.checks.push({ id: "text:label", ok: true });
  await selectRichOptionByIndex(page, "layout.fontWeight", 5);
  report.checks.push({ id: "text:fontWeight", ok: true });
  await selectRichOptionByIndex(page, "layout.textAlign", 2);
  report.checks.push({ id: "text:textAlign", ok: true });
  await page.locator(".runtime-layout-fieldset").nth(3).evaluate((node) => node.setAttribute("open", ""));
  await page.locator(".runtime-layout-component-background-image").waitFor({ state: "visible" });
  await page.locator(".runtime-layout-component-background-image .asset-picker-empty").waitFor({ state: "visible" });
  report.checks.push({ id: "backgroundImage:resource", ok: true });
  await selectRichOptionByIndex(page, "layout.backgroundFit", 2);
  report.checks.push({ id: "backgroundImage:fit", ok: true });

  await page.locator(".runtime-layout-menu").evaluateAll((nodes) => nodes.forEach((node) => node.setAttribute("open", "")));
  const alignmentButtons = page.locator('[data-help-key="layout.align"]');
  for (const [index, id] of ["align:left", "align:centerX", "align:right", "align:top", "align:centerY", "align:bottom", "align:sameWidth", "align:sameHeight", "align:distributeX", "align:distributeY"].entries()) {
    await alignmentButtons.nth(index).click({ force: true });
    report.checks.push({ id, ok: true });
  }
  for (const id of ["snap:grid", "snap:edges", "snap:center", "snap:safe"]) {
    await page.locator(`input[data-help-key="${id === "snap:grid" ? "layout.snapGrid" : id === "snap:edges" ? "layout.snapEdges" : id === "snap:center" ? "layout.snapCenter" : "layout.snapSafe"}"]`).click({ force: true });
    report.checks.push({ id, ok: true });
  }
  for (const id of ["view:grid", "view:safeArea", "view:names"]) {
    await page.locator(`input[data-help-key="${id === "view:grid" ? "layout.showGrid" : id === "view:safeArea" ? "layout.showSafe" : "layout.showNames"}"]`).click({ force: true }).catch(async () => {
      await page.locator(`input[data-help-key="${id === "view:grid" ? "layout.showGrid" : id === "view:safeArea" ? "layout.showSafeArea" : "layout.showNames"}"]`).click({ force: true });
    });
    report.checks.push({ id, ok: true });
  }

  for (const [componentId, expectation] of Object.entries(titleButtonExpectations)) {
    if (componentId === "title_start_button") continue;
    await selectComponent(page, componentId);
    await setRectFields(page, expectation.rect, report);
    await setColorInput(page, 0, expectation.backgroundColor, `style:${componentId}:backgroundColor`, report);
    await setColorInput(page, 1, expectation.color, `style:${componentId}:textColor`, report);
    await setColorInput(page, 2, expectation.borderColor, `style:${componentId}:borderColor`, report);
  }

  await selectRichOptionByIndex(page, "layout.preset", 0);
  report.checks.push({ id: "preset:default", ok: true });
  await selectRichOptionByIndex(page, "layout.preset", 1);
  report.checks.push({ id: "preset:renpy", ok: true });
  await selectRichOptionByIndex(page, "layout.preset", 2);
  report.checks.push({ id: "preset:subtitle", ok: true });
  await selectRichOptionByIndex(page, "layout.preset", 0, 1);
  report.checks.push({ id: "presetScope:current", ok: true });
  await selectRichOptionByIndex(page, "layout.preset", 1, 1);
  report.checks.push({ id: "presetScope:all", ok: true });
  for (const [componentId, expectation] of Object.entries(titleButtonExpectations)) {
    await selectComponent(page, componentId);
    await setRectFields(page, expectation.rect, report);
    await setColorInput(page, 0, expectation.backgroundColor, `final:${componentId}:backgroundColor`, report);
    await setColorInput(page, 1, expectation.color, `final:${componentId}:textColor`, report);
    await setColorInput(page, 2, expectation.borderColor, `final:${componentId}:borderColor`, report);
  }

  await page.screenshot({ path: path.join(outputDir, "editor-layout-options.png"), fullPage: true });
  await page.locator('[data-help-key="layout.save"]').click();
  report.checks.push({ id: "save:layout", ok: true });
  await page.locator('[data-help-key="layout.save"][data-save-state="saved"]').waitFor({ state: "visible", timeout: 30000 });
}

async function selectRichOptionByTextOrIndex(page, helpKey, index) {
  await selectRichOptionByIndex(page, helpKey, index);
}

async function exportCartridge(page) {
  await page.locator('[data-workspace-surface="publish"]:visible').click({ force: true });
  await page.locator(".cartridge-export-panel").waitFor({ state: "visible", timeout: 30000 });
  const modeTrigger = page.locator('button[data-help-key="package.mode"]');
  await modeTrigger.click();
  await page.locator('.rich-select-popover[role="listbox"] .rich-select-option')
    .filter({ hasText: "游戏卡带 .vncart" })
    .click();
  const checksStage = page.locator('[data-package-stage="checks"]');
  if (await checksStage.count()) await checksStage.click({ force: true });
  const warningConfirm = page.locator('input[data-help-key="package.confirmWarnings"]');
  if (await warningConfirm.count()) await warningConfirm.check({ force: true });
  await page.locator('[data-package-stage="settings"]').click({ force: true }).catch(() => {});
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-help-key="package.export"]');
    return button && !button.disabled;
  }, null, { timeout: 30000 });
  const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
  await page.locator('[data-help-key="package.export"]').click();
  const download = await downloadPromise;
  const cartridgePath = path.join(testDir, "client-layout-options.vncart");
  await download.saveAs(cartridgePath);
  return cartridgePath;
}

async function verifyCartridgeLayout(cartridgePath, report) {
  const zip = await JSZip.loadAsync(fs.readFileSync(cartridgePath));
  const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
  const title = layout.screens.find((screen) => screen.screen_id === "title");
  if (!title) throw new Error("ui/layout.json missing title screen");
  for (const [componentId, expectation] of Object.entries(titleButtonExpectations)) {
    const component = title.components.find((item) => item.component_id === componentId);
    if (!component) throw new Error(`ui/layout.json missing ${componentId}`);
    for (const [field, expected] of Object.entries(expectation.rect)) {
      if (Math.abs(component.rect[field] - expected) > 0.1) throw new Error(`${componentId}.rect.${field} expected ${expected}, got ${component.rect[field]}`);
    }
    if (expectation.anchor && component.rect.anchor !== expectation.anchor) {
      throw new Error(`${componentId}.rect.anchor expected ${expectation.anchor}, got ${component.rect.anchor}`);
    }
    if (!expectation.anchor && Object.prototype.hasOwnProperty.call(component.rect, "anchor")) {
      throw new Error(`${componentId}.rect.anchor should be omitted, got ${component.rect.anchor}`);
    }
    for (const field of ["backgroundColor", "color", "borderColor"]) {
      if (component.style?.[field]?.toLowerCase() !== expectation[field].toLowerCase()) {
        throw new Error(`${componentId}.style.${field} expected ${expectation[field]}, got ${component.style?.[field]}`);
      }
    }
  }
  report.checks.push({ id: "export:cartridge", ok: true, cartridgePath });
  return layout;
}

async function importAndLaunchGameCli(page, cartridgePath) {
  await page.route("**/runtime-mode.json", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ mode: "library" }),
  }));
  await page.route("**/fixed-only.json", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ fixedOnly: false }),
  }));
  await page.addInitScript(() => window.localStorage.removeItem("agentvn.gamecli.webLibrary"));
  await page.goto(gameCliUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    if (document.querySelector('[data-testid="web-cartridge-file"]')) return true;
    const library = document.querySelector('[data-testid="open-library"]');
    if (!(library instanceof HTMLElement)) return false;
    const rect = library.getBoundingClientRect();
    const style = getComputedStyle(library);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }, null, { timeout: 30_000 });
  if (!(await page.locator('[data-testid="web-cartridge-file"]').count())) {
    await page.locator('[data-testid="open-library"]').click();
  }
  await page.locator('[data-testid="web-cartridge-file"]').setInputFiles(cartridgePath);
  await page.locator(".cartridge-spine").first().waitFor({ state: "visible", timeout: 20000 });
  await page.locator(".launch-actions button").first().click();
  await page.locator('[data-testid="start-new-game"]').waitFor({ state: "visible", timeout: 10000 });
}

function rgbToHex(rgb) {
  const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
  if (!match) return rgb;
  return `#${match.slice(1, 4).map((value) => Number(value).toString(16).padStart(2, "0")).join("")}`;
}

async function verifyGameCliTitleButtons(page, report) {
  await page.screenshot({ path: path.join(outputDir, "gamecli-title-buttons.png"), fullPage: true });
  const result = await page.evaluate(() => {
    const output = {};
    document.querySelectorAll("[data-ui-component-id]").forEach((node) => {
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      output[node.getAttribute("data-ui-component-id")] = {
        text: node.textContent,
        backgroundColor: style.backgroundColor,
        color: style.color,
        borderColor: style.borderColor,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
    });
    return output;
  });
  for (const [componentId, expectation] of Object.entries(titleButtonExpectations)) {
    if (componentId === "title_continue_button") continue;
    const actual = result[componentId];
    if (!actual) throw new Error(`GameCli did not render ${componentId}`);
    if (rgbToHex(actual.backgroundColor).toLowerCase() !== expectation.backgroundColor.toLowerCase()) {
      throw new Error(`${componentId} background expected ${expectation.backgroundColor}, got ${actual.backgroundColor}`);
    }
    if (rgbToHex(actual.color).toLowerCase() !== expectation.color.toLowerCase()) {
      throw new Error(`${componentId} color expected ${expectation.color}, got ${actual.color}`);
    }
    if (rgbToHex(actual.borderColor).toLowerCase() !== expectation.borderColor.toLowerCase()) {
      throw new Error(`${componentId} border expected ${expectation.borderColor}, got ${actual.borderColor}`);
    }
  }
  report.gameCliTitleButtons = result;
  report.checks.push({ id: "gamecli:titleButtons", ok: true });
}

async function verifyLegacyMigration(page, layout, cartridgePath, report) {
  const legacy = JSON.parse(JSON.stringify(layout));
  legacy.ui_layout_version = "1.4.0";
  const title = legacy.screens.find((screen) => screen.screen_id === "title");
  const legacyGroupType = ["main", "menu", "actions"].join("_");
  title.components = [
    title.components.find((component) => component.component_type === "main_menu_hero"),
    {
      component_id: ["title", "actions"].join("_"),
      component_type: legacyGroupType,
      required: true,
      rect: { x: 66, y: 40, width: 22, height: 39 },
      mobileRect: { x: 8, y: 52, width: 84, height: 34 },
    },
  ].filter(Boolean);
  const zip = await JSZip.loadAsync(fs.readFileSync(cartridgePath));
  const legacyLayoutText = JSON.stringify(legacy, null, 2);
  zip.file("ui/layout.json", legacyLayoutText);
  const checksumFile = zip.file("checksum.json");
  if (checksumFile) {
    const checksum = JSON.parse(await checksumFile.async("string"));
    const entry = checksum.files.find((item) => item.path === "ui/layout.json");
    if (entry) {
      entry.size_bytes = Buffer.byteLength(legacyLayoutText, "utf8");
      entry.hash_sha256 = crypto.createHash("sha256").update(legacyLayoutText).digest("hex");
      zip.file("checksum.json", JSON.stringify(checksum, null, 2));
    }
  }
  const legacyPath = path.join(testDir, "client-layout-options-legacy.vncart");
  fs.writeFileSync(legacyPath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  await page.addInitScript(() => window.localStorage.removeItem("agentvn.gamecli.webLibrary"));
  await page.goto(gameCliUrl, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="web-cartridge-file"]').setInputFiles(legacyPath);
  await page.locator(".cartridge-spine").first().waitFor({ state: "visible", timeout: 20_000 });
  await page.locator(".launch-actions button").first().click();
  await page.locator('[data-testid="start-new-game"]').waitFor({ state: "visible", timeout: 10_000 });
  if (await page.locator('[data-testid="open-library"]').count()) {
    throw new Error("Legacy title button group migration restored the removed cartridge-library title button.");
  }
  report.checks.push({ id: "migrate:legacyTitleGroup", ok: true, legacyPath });
}

async function main() {
  resetOutputDirs();
  const projectPath = path.join(testDir, "client-layout-options.vnproj");
  saveProjectContainerSync(projectPath, buildProjectFile(), { container: "zip" });
  const children = [];
  const report = { startedAt: new Date().toISOString(), checks: [], requiredOptionChecks, artifacts: { outputDir, testDir } };
  try {
    children.push(await ensureBackend());
    const editorServer = await ensureServer("editor-dev", editorUrl, path.join(root, "editor"));
    const gameCliServer = await ensureServer("gamecli-dev", gameCliUrl, path.join(root, "GameCli_framework"));
    if (editorServer) children.push(editorServer);
    if (gameCliServer) children.push(gameCliServer);
    const browser = await chromium.launch({ headless: !headed });
    try {
      const editorPage = await browser.newPage({ viewport: { width: 1600, height: 960 }, acceptDownloads: true });
      await importProject(editorPage, projectPath);
      await exerciseLayoutOptions(editorPage, report);
      const cartridgePath = await exportCartridge(editorPage);
      const layout = await verifyCartridgeLayout(cartridgePath, report);
      const gamePage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      await importAndLaunchGameCli(gamePage, cartridgePath);
      await verifyGameCliTitleButtons(gamePage, report);
      await verifyLegacyMigration(gamePage, layout, cartridgePath, report);
      const completed = new Set(report.checks.map((check) => check.id));
      const missing = requiredOptionChecks.filter((id) => !completed.has(id));
      if (missing.length) throw new Error(`Missing required option checks: ${missing.join(", ")}`);
    } finally {
      await browser.close();
    }
    report.ok = true;
  } catch (error) {
    report.ok = false;
    report.error = error instanceof Error ? error.stack ?? error.message : String(error);
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(outputDir, "client-layout-options-report.json"), JSON.stringify(report, null, 2), "utf8");
    for (const child of children) stopDevServer(child);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
